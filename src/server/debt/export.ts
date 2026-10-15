import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { buildXlsx } from "@/server/export/xlsx";
import { listDebts } from "./queries";

export async function exportDebtsXlsx(db: PrismaClient, actor: Actor, params: ListParams): Promise<Buffer> {
  const { rows } = await listDebts(db, actor, params, { all: true });
  return buildXlsx("Công nợ", [
    { header: "Mã", key: "code", width: 14, text: true }, { header: "Tên", key: "name", width: 34 }, { header: "Nhóm", key: "groupName", width: 18 }, { header: "Loại", key: "kind", width: 12 },
    { header: "Đầu kỳ", key: "opening", width: 16, numFmt: "#,##0" }, { header: "Phát sinh nợ", key: "debit", width: 16, numFmt: "#,##0" }, { header: "Phát sinh có", key: "credit", width: 16, numFmt: "#,##0" },
    { header: "Số dư (+ phải thu / − phải trả)", key: "balance", width: 22, numFmt: "#,##0" }, { header: "Chiết khấu tích lũy", key: "discountBalance", width: 18, numFmt: "#,##0" },
  ], rows.map((r) => ({ ...r, kind: [r.isCustomer ? "Khách" : null, r.isSupplier ? "NCC" : null].filter(Boolean).join(" / ") })));
}
