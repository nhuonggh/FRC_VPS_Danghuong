import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { encryptSecret } from "./secret";
import { IMAGE_PATH, type CompanyBankInput, type CompanyInfoInput, type CreateTemplateInput, type UpdateTemplateInput } from "./schemas";

type Db = Prisma.TransactionClient;
type Env = Record<string, string | undefined>;

/** Bỏ toàn bộ query/hash: URL webhook có thể mang khoá trong query → không hiển thị, không audit, không log. */
export function stripUrlQuery(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

const DEFAULT_NAME = "Xưởng tôn Đặng Hương";

/** Bảo đảm hàng singleton id = 1 tồn tại (DB cũ rỗng/đã reset) rồi KHOÁ nó cho transaction hiện tại. */
export async function lockCompanyRow(db: Db) {
  await db.$executeRaw`INSERT INTO company_settings ("id", "name") VALUES (1, ${DEFAULT_NAME}) ON CONFLICT ("id") DO NOTHING`;
  await db.$queryRaw`SELECT id FROM company_settings WHERE id = 1 FOR UPDATE`;
  return db.companySetting.findUniqueOrThrow({ where: { id: 1 } });
}

/** Ảnh https phải thuộc allowlist COMPANY_IMAGE_HOSTS (đường dẫn /uploads/… luôn hợp lệ). Server không bao giờ tải ảnh này. */
export function assertImageAllowed(value: string, field: string, env: Env = process.env) {
  if (!value || IMAGE_PATH.test(value)) return;
  const allowed = (env.COMPANY_IMAGE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  let host = "";
  try { host = new URL(value).hostname.toLowerCase(); } catch { /* schema đã chặn */ }
  if (!allowed.includes(host)) {
    const msg = "Địa chỉ ảnh không nằm trong danh sách cho phép. Dùng đường dẫn /uploads/… hoặc nhờ quản trị thêm máy chủ ảnh.";
    throw new FieldConflictError(msg, { [field]: msg });
  }
}

const staleError = () => new DomainError("Thông tin vừa được người khác cập nhật. Hãy tải lại trang rồi sửa lại.", 409, "STALE");

export async function updateCompany(
  db: Db, actor: Actor,
  input: { section: "info"; version: number; value: CompanyInfoInput } | { section: "bank"; version: number; value: CompanyBankInput },
  env: Env = process.env,
) {
  assertCan(actor.perms, "company.manage");
  if (input.section === "info") assertImageAllowed(input.value.logo, "logo", env);
  const before = await lockCompanyRow(db);
  if (before.updatedAt.getTime() !== input.version) throw staleError();

  const data = input.section === "info"
    ? { name: input.value.name, address: input.value.address || null, phone: input.value.phone || null, taxCode: input.value.taxCode || null, logo: input.value.logo || null }
    : { bankInfo: input.value as Prisma.InputJsonValue };
  const after = await db.companySetting.update({ where: { id: 1 }, data: { ...data, updatedBy: actor.userId } });
  await writeAudit(db, {
    userId: actor.userId, action: `company.update_${input.section}`, entity: "CompanySetting", entityId: 1,
    before: input.section === "info" ? { name: before.name, address: before.address, phone: before.phone, taxCode: before.taxCode, logo: before.logo } : { bankInfo: before.bankInfo },
    after: input.section === "info" ? { name: after.name, address: after.address, phone: after.phone, taxCode: after.taxCode, logo: after.logo } : { bankInfo: after.bankInfo },
  });
  return { version: after.updatedAt.getTime() };
}

const templateAudit = (t: { docType: string; name: string; webhookUrl: string | null; isActive: boolean; secretCiphertext: string | null }) => ({
  docType: t.docType, name: t.name, webhookUrl: stripUrlQuery(t.webhookUrl) || null, isActive: t.isActive, hasSecret: !!t.secretCiphertext,
});

export async function createPrintTemplate(db: Db, actor: Actor, input: CreateTemplateInput, env: Env = process.env) {
  assertCan(actor.perms, "company.manage");
  assertImageAllowed(input.qrImage, "qrImage", env);
  if (input.secretAction === "clear") throw new DomainError("Mẫu mới chưa có secret để xoá.", 400);
  try {
    const row = await db.printTemplate.create({
      data: {
        docType: input.docType, name: input.name, webhookUrl: input.webhookUrl || null,
        secretCiphertext: input.secretAction === "replace" ? encryptSecret(input.secret!, env) : null,
        isActive: input.isActive, title: input.title || null, signerName: input.signerName || null, phone: input.phone || null,
        qrImage: input.qrImage || null, showCompanyInfo: input.showCompanyInfo, footerNote: input.footerNote || null,
        createdBy: actor.userId, updatedBy: actor.userId,
      },
    });
    await writeAudit(db, { userId: actor.userId, action: "print_template.create", entity: "PrintTemplate", entityId: row.id, after: templateAudit(row) });
    return { id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new FieldConflictError("Đã có mẫu in cùng loại chứng từ và tên này.", { name: "Đã có mẫu in cùng loại và tên." });
    }
    throw e;
  }
}
export const createPrintTemplateIdempotent = (prisma: PrismaClient, actor: Actor, key: string, input: CreateTemplateInput) => {
  assertCan(actor.perms, "company.manage");
  return withIdempotency(prisma, { userId: actor.userId, scope: "print_template.create", key }, (tx) => createPrintTemplate(tx, actor, input));
};

export async function updatePrintTemplate(db: Db, actor: Actor, id: number, input: UpdateTemplateInput, env: Env = process.env) {
  assertCan(actor.perms, "company.manage");
  assertImageAllowed(input.qrImage, "qrImage", env);
  // Khoá hàng mẫu: hai người sửa cùng mẫu được xếp hàng, người sau thấy kết quả của người trước
  await db.$queryRaw`SELECT id FROM print_templates WHERE id = ${id} FOR UPDATE`;
  const before = await db.printTemplate.findUnique({ where: { id } });
  if (!before) throw new DomainError("Không tìm thấy mẫu in.", 404);

  // URL: khớp bản đã bỏ query đang hiển thị → giữ nguyên bản gốc (có thể mang khoá trong query); rỗng → xoá; khác → thay
  const shown = stripUrlQuery(before.webhookUrl);
  const webhookUrl = input.webhookUrl === "" ? null : input.webhookUrl === shown ? before.webhookUrl : input.webhookUrl;
  const secretCiphertext = input.secretAction === "replace" ? encryptSecret(input.secret!, env) : input.secretAction === "clear" ? null : before.secretCiphertext;

  const after = await db.printTemplate.update({
    where: { id },
    data: {
      name: input.name, webhookUrl, secretCiphertext, isActive: input.isActive, title: input.title || null,
      signerName: input.signerName || null, phone: input.phone || null, qrImage: input.qrImage || null,
      showCompanyInfo: input.showCompanyInfo, footerNote: input.footerNote || null, updatedBy: actor.userId,
    },
  });
  await writeAudit(db, { userId: actor.userId, action: "print_template.update", entity: "PrintTemplate", entityId: id, before: templateAudit(before), after: templateAudit(after) });
  // Đổi/xoá secret là hành động nhạy cảm → audit riêng, KHÔNG chứa giá trị
  if (input.secretAction !== "keep") {
    await writeAudit(db, { userId: actor.userId, action: input.secretAction === "replace" ? "print_template.secret_replace" : "print_template.secret_clear", entity: "PrintTemplate", entityId: id });
  }
}
