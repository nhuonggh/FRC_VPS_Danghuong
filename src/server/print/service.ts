import type { PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { decryptSecret } from "@/server/company/secret";
import { getCompany } from "@/server/company/queries";
import { DomainError } from "@/server/http/errors";
import { buildContract } from "./contracts";
import { CONTRACT_VERSION, printDoc, type PrintPayload } from "./types";
import { callPrintWebhook } from "./webhook";

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export interface PrintResult { url: string; name: string; replaced: boolean }
export interface PrintOptions { now?: Date; env?: Env; fetchImpl?: FetchLike; timeoutMs?: number; templateId?: number | null }

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80);

/**
 * In chứng từ qua Apps Script (D-38). Đọc dữ liệu → gọi webhook (NGOÀI transaction, tối đa 12 giây) → ghi `print_files` (mỗi chứng từ MỘT dòng).
 * In lại: gửi `replaceFileId` để Apps Script bỏ file cũ vào thùng rác; nếu lần in thất bại thì giữ nguyên bản cũ.
 * Secret chỉ đi trong body; không xuất hiện trong log/audit/DTO/lỗi.
 */
export async function printDocument(prisma: PrismaClient, actor: Actor, docType: string, docId: number, opts: PrintOptions = {}): Promise<PrintResult> {
  assertCan(actor.perms, "print.use");
  const def = printDoc(docType);
  if (!def) throw new DomainError("Loại chứng từ in không hợp lệ.", 404);
  if (!def.supported) throw new DomainError(`${def.label} chưa hỗ trợ in (chưa có chứng từ trong hệ thống).`, 409, "PRINT_UNSUPPORTED");
  assertCan(actor.perms, def.perm);
  const env = opts.env ?? process.env; const now = opts.now ?? new Date();

  const tpl = await prisma.printTemplate.findFirst({ where: { docType, isActive: true, ...(opts.templateId ? { id: opts.templateId } : {}) }, orderBy: { id: "asc" } });
  if (!tpl) throw new DomainError(`Chưa bật mẫu in cho “${def.label}”. Cấu hình ở Hệ thống → Công ty & mẫu in (loại chứng từ ${docType}).`, 409, "PRINT_NO_TEMPLATE");
  if (!tpl.webhookUrl || !tpl.secretCiphertext) throw new DomainError(`Mẫu in “${tpl.name}” chưa có địa chỉ webhook hoặc secret.`, 409, "PRINT_TEMPLATE_INCOMPLETE");
  let secret: string;
  try { secret = decryptSecret(tpl.secretCiphertext, env); } catch { throw new DomainError(`Không giải mã được secret của mẫu in “${tpl.name}” — hãy nhập lại secret.`, 409, "PRINT_SECRET_UNREADABLE"); }

  const [body, company, prev] = await Promise.all([
    buildContract(prisma, actor, docType, docId, now),
    tpl.showCompanyInfo ? getCompany(prisma) : Promise.resolve(null),
    prisma.printFile.findUnique({ where: { docType_docId: { docType, docId } } }),
  ]);
  const payload: PrintPayload = {
    version: CONTRACT_VERSION, secret, action: "create", docType, docId, docCode: body.docCode, fileName: `${def.fileTag}_${safeName(body.docCode)}`,
    replaceFileId: prev?.fileId ?? null,
    template: { title: tpl.title ?? def.label.toUpperCase(), signerName: tpl.signerName ?? "", phone: tpl.phone ?? "", qrImage: tpl.qrImage ?? "", footerNote: tpl.footerNote ?? "" },
    company: company ? { name: company.name, address: company.address, phone: company.phone, taxCode: company.taxCode, logo: company.logo, bank: company.bank } : null,
    partner: body.partner, doc: body.doc, lines: body.lines, totals: body.totals,
  };
  const file = await callPrintWebhook(tpl.webhookUrl, payload, { env, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });

  const orphan = await prisma.$transaction(async (tx) => {
    // hai người in cùng lúc: dòng print_files hiện tại có thể đã đổi sau khi ta đọc `prev` ⇒ file đó thành mồ côi, dọn sau
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`print:${docType}:${docId}`}))`; // tuần tự hoá các lần in cùng chứng từ (kể cả khi chưa có dòng để khoá)
    const now2 = await tx.printFile.findUnique({ where: { docType_docId: { docType, docId } } });
    const row = await tx.printFile.upsert({
      where: { docType_docId: { docType, docId } },
      create: { docType, docId, templateId: tpl.id, fileId: file.fileId, url: file.url, name: file.name || payload.fileName, printedBy: actor.userId, printedAt: now },
      update: { templateId: tpl.id, fileId: file.fileId, url: file.url, name: file.name || payload.fileName, printedBy: actor.userId, printedAt: now },
    });
    await writeAudit(tx, { userId: actor.userId, action: "print.create", entity: "PrintFile", entityId: row.id, after: { docType, docId, docCode: body.docCode, templateId: tpl.id, fileId: file.fileId, replaced: !!prev } });
    return now2 && now2.fileId !== prev?.fileId && now2.fileId !== file.fileId ? now2.fileId : null;
  });
  if (orphan) await callPrintWebhook(tpl.webhookUrl, { version: CONTRACT_VERSION, secret, action: "delete", fileId: orphan } as never, { env, expectFile: false, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) }).catch(() => undefined);
  return { url: file.url, name: file.name || payload.fileName, replaced: !!prev };
}

/** Bản in gần nhất của chứng từ (nếu có) — để nút In hiện “Mở bản in trước”. */
export async function getLastPrint(prisma: PrismaClient, actor: Actor, docType: string, docId: number): Promise<{ url: string; name: string; printedAt: Date } | null> {
  assertCan(actor.perms, "print.use");
  if (!printDoc(docType)) throw new DomainError("Loại chứng từ in không hợp lệ.", 404);
  const f = await prisma.printFile.findUnique({ where: { docType_docId: { docType, docId } }, select: { url: true, name: true, printedAt: true } });
  return f;
}
