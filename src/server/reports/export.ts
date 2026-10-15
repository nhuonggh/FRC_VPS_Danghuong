import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { buildXlsx } from "@/server/export/xlsx";
import { runReport } from "./queries";
import type { ColKind } from "./types";

const FMT: Partial<Record<ColKind, string>> = { money: "#,##0", qty: "#,##0.###", pct: "0.0", int: "#,##0" };

export async function exportReportXlsx(db: PrismaClient, actor: Actor, key: string, params: ListParams): Promise<Buffer> {
  const r = await runReport(db, actor, key, params);
  const numeric = (k: ColKind) => k === "money" || k === "qty" || k === "pct" || k === "int";
  const cols = r.columns.map((c) => ({ header: c.label, key: c.key, width: c.kind === "text" ? 30 : 16, ...(FMT[c.kind] ? { numFmt: FMT[c.kind]! } : {}), ...(c.kind === "text" ? { text: true } : {}) }));
  const conv = (row: Record<string, string | number | null>) => Object.fromEntries(r.columns.map((c) => { const v = row[c.key] ?? null; return [c.key, numeric(c.kind) && typeof v === "string" && v !== "" ? Number(v) : v]; }));
  return buildXlsx(r.title.slice(0, 30), cols, [...r.rows.map(conv), ...(r.totals ? [conv(r.totals)] : [])]);
}
