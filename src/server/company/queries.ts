import type { Prisma, PrismaClient } from "@prisma/client";
import { lockCompanyRow, stripUrlQuery } from "./service";

type Db = Prisma.TransactionClient | PrismaClient;

export interface CompanyDTO {
  name: string; address: string; phone: string; taxCode: string; logo: string;
  bank: { bankName: string; accountNo: string; accountHolder: string; branch: string };
  /** updatedAt (ms): gửi lại khi PATCH để chống ghi đè mù. */
  version: number;
}
/** DTO mẫu in: KHÔNG có secretCiphertext (chỉ `hasSecret`), URL webhook đã bỏ query. */
export interface PrintTemplateDTO {
  id: number; docType: string; name: string; webhookUrl: string; hasSecret: boolean; isActive: boolean;
  title: string; signerName: string; phone: string; qrImage: string; showCompanyInfo: boolean; footerNote: string;
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** Đọc cấu hình công ty; hàng singleton id=1 thiếu (DB cũ rỗng) thì tự tạo lại trong một transaction rồi đọc. */
export async function getCompany(prisma: PrismaClient): Promise<CompanyDTO> {
  const row = (await prisma.companySetting.findUnique({ where: { id: 1 } })) ?? (await prisma.$transaction((tx) => lockCompanyRow(tx)));
  const bank = (row.bankInfo ?? {}) as Record<string, unknown>;
  return {
    name: row.name, address: row.address ?? "", phone: row.phone ?? "", taxCode: row.taxCode ?? "", logo: row.logo ?? "",
    bank: { bankName: s(bank.bankName), accountNo: s(bank.accountNo), accountHolder: s(bank.accountHolder), branch: s(bank.branch) },
    version: row.updatedAt.getTime(),
  };
}

export async function listPrintTemplates(db: Db): Promise<PrintTemplateDTO[]> {
  const rows = await db.printTemplate.findMany({ orderBy: [{ docType: "asc" }, { name: "asc" }] });
  return rows.map((t) => ({
    id: t.id, docType: t.docType, name: t.name, webhookUrl: stripUrlQuery(t.webhookUrl), hasSecret: !!t.secretCiphertext, isActive: t.isActive,
    title: t.title ?? "", signerName: t.signerName ?? "", phone: t.phone ?? "", qrImage: t.qrImage ?? "", showCompanyInfo: t.showCompanyInfo, footerNote: t.footerNote ?? "",
  }));
}
