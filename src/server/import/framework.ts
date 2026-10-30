import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { buildXlsx } from "@/server/export/xlsx";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import type { EngineCtx } from "@/server/inventory";
import { readSheet, type SheetRow } from "./xlsx-reader";
import type { ImportColumn, ImportPreview, ImportResult, ImportSpec, PreviewRow, RowStatus } from "./types";
type Db = Prisma.TransactionClient | PrismaClient;
export interface ClassifiedRow<T> { line: number; cells: Record<string, unknown>; key: string | null; status: RowStatus; message: string | null; data?: T }
const order: Record<RowStatus, number> = { error: 0, "skip-reason": 1, "skip-existing": 2, update: 3, create: 4 };
export async function classifyRows<T, C>(db: Db, spec: ImportSpec<T, C>, sheet: SheetRow[], overwrite: boolean): Promise<{ rows: ClassifiedRow<T>[]; ctx: C }> { const ctx = await spec.loadContext(db); const rows: ClassifiedRow<T>[] = []; const seen = new Map<string, number>(); for (const s of sheet) { const parsed = spec.parseRow(s.cells, ctx); if (!parsed.ok) { rows.push({ line: s.line, cells: s.cells, key: null, status: "error", message: parsed.errors.join(" ") }); continue; } const key = spec.keyOf(parsed.data); const first = seen.get(key); if (first !== undefined) { rows.push({ line: s.line, cells: s.cells, key, status: "error", message: `Trùng mã "${key}" với dòng ${first}.` }); continue; } seen.set(key, s.line); const reason = spec.skipReason?.(parsed.data) ?? null; rows.push({ line: s.line, cells: s.cells, key, data: parsed.data, status: reason ? "skip-reason" : "create", message: reason ?? parsed.warning ?? null }); } if (spec.group) { const groups = new Map<string, ClassifiedRow<T>[]>(); for (const r of rows) { const g = spec.group.of(r.cells); if (g) { const list = groups.get(g) ?? []; list.push(r); groups.set(g, list); } } for (const list of groups.values()) { const msg = list.some((r) => r.status === "error") ? "Nhóm có dòng lỗi — sửa hết các dòng của nhóm rồi nhập lại (không nhập dở)." : spec.group.check?.(list.map((r) => r.data as T)) ?? null; if (msg) for (const r of list) if (r.status !== "error") { r.status = "error"; r.message = msg; } } } const keys = rows.filter((r) => r.status === "create").map((r) => r.key!); const existing = keys.length ? await spec.existingKeys(db, keys) : new Set<string>(); for (const row of rows) if (row.status === "create" && existing.has(row.key!)) { row.status = overwrite ? "update" : "skip-existing"; row.message = overwrite ? null : "Đã có trong hệ thống (bỏ qua)."; } return { rows, ctx }; }
const summary = (cols: readonly ImportColumn[], cells: Record<string, unknown>) => cols.map((c) => cells[c.key]).filter((v) => v !== null && v !== undefined && v !== "").slice(0, 3).map(String).join(" · ");
export async function previewImport<T, C>(db: Db, spec: ImportSpec<T, C>, buffer: Buffer, opts: { overwrite: boolean }): Promise<ImportPreview> { const { rows } = await classifyRows(db, spec, await readSheet(buffer, spec.columns), opts.overwrite); const counts: Record<RowStatus, number> = { create: 0, update: 0, "skip-existing": 0, "skip-reason": 0, error: 0 }; rows.forEach((r) => counts[r.status]++); const view: PreviewRow[] = [...rows].sort((a, b) => order[a.status] - order[b.status] || a.line - b.line).slice(0, 500).map((r) => ({ line: r.line, status: r.status, key: r.key, message: r.message, summary: summary(spec.columns, r.cells) })); return { total: rows.length, counts, rows: view }; }
export async function commitImport<T, C>(prisma: PrismaClient, actor: Actor, spec: ImportSpec<T, C>, buffer: Buffer, opts: { overwrite: boolean; idempotencyKey: string }): Promise<ImportResult> {
  const sheet = await readSheet(buffer, spec.columns);
  const idem = { userId: actor.userId, scope: `import.${spec.entity}`, key: opts.idempotencyKey };
  const run = async (tx: Prisma.TransactionClient, engine?: EngineCtx): Promise<ImportResult> => {
    const { rows, ctx } = await classifyRows(tx, spec, sheet, opts.overwrite);
    const pick = (status: RowStatus) => rows.filter((r) => r.status === status).map((r) => r.data as T);
    await spec.create(tx, actor, pick("create"), ctx, engine); await spec.update(tx, actor, pick("update"), ctx, engine);
    const failures = rows.filter((r) => r.status === "error").map((r) => ({ line: r.line, message: r.message ?? "" }));
    const result = { created: pick("create").length, updated: pick("update").length, skippedExisting: rows.filter((r) => r.status === "skip-existing").length, skippedReason: rows.filter((r) => r.status === "skip-reason").length, failed: failures.length, failures: failures.slice(0, 500) };
    await writeAudit(tx, { userId: actor.userId, action: `import.${spec.entity}`, entity: spec.entity, after: { ...result, failures: undefined } });
    return result;
  };
  if (!spec.engineProducts) return withIdempotency(prisma, idem, (tx) => run(tx));
  // Import chạm kho: khoá đủ mọi mã hàng của các dòng sẽ ghi, idempotency key nằm CÙNG giao dịch kho (D-17).
  const first = await classifyRows(prisma, spec, sheet, opts.overwrite);
  const products = spec.engineProducts(first.rows.filter((r) => r.status === "create" || r.status === "update").map((r) => r.data as T), first.ctx);
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products, scope: idem.scope, key: idem.key }, (engine) => run(engine.tx, engine));
}
export async function buildRejectXlsx<T, C>(db: Db, spec: ImportSpec<T, C>, buffer: Buffer, opts: { overwrite: boolean }): Promise<Buffer> { const { rows } = await classifyRows(db, spec, await readSheet(buffer, spec.columns), opts.overwrite); const rejected = rows.filter((r) => r.status === "error" || r.status === "skip-existing" || r.status === "skip-reason").sort((a, b) => a.line - b.line); return buildXlsx("Dòng bị loại", [{ header: "Dòng", key: "__line", width: 8 }, { header: "Lý do", key: "__reason", width: 44 }, ...spec.columns.map((c) => ({ header: c.header, key: c.key, width: 22, text: true }))], rejected.map((r) => ({ __line: r.line, __reason: r.message, ...r.cells }))); }
export async function buildTemplateXlsx<T, C>(spec: ImportSpec<T, C>): Promise<Buffer> { const cols = spec.columns.map((c) => ({ header: c.header, key: c.key, width: 22, text: true })); const sample = Object.fromEntries(spec.columns.map((c, i) => [c.key, i ? c.sample : `# ${c.sample} (ví dụ — dòng này không được nhập)`])); return buildXlsx("Mẫu nhập", cols, [sample]); }
