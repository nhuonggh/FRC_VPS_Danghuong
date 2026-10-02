import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { EngineCtx } from "@/server/inventory";
type Db = Prisma.TransactionClient | PrismaClient;
export interface ImportColumn { key: string; header: string; aliases?: readonly string[]; required?: boolean; sample: string }
export type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };
export interface ImportSpec<T, C = undefined> { entity: string; label: string; columns: readonly ImportColumn[]; loadContext(db: Db): Promise<C>; parseRow(cells: Record<string, unknown>, ctx: C): ParseResult<T>; keyOf(data: T): string; /** Nhập theo NHÓM dòng (vd: nhiều dòng NVL của một định mức): có dòng lỗi/nhóm không hợp lệ ⇒ loại CẢ nhóm, không nhập dở. `of` đọc ô thô nên áp được cả cho dòng lỗi parse; rỗng = không thuộc nhóm. */ group?: { of(cells: Record<string, unknown>): string; check?(rows: T[]): string | null }; skipReason?(data: T): string | null; existingKeys(db: Db, keys: string[]): Promise<Set<string>>; /** Có khai báo ⇒ commit chạy trong giao dịch kho (withIdempotentInventoryTx) và create/update nhận `engine`. */ engineProducts?(rows: T[], ctx: C): number[]; create(tx: Prisma.TransactionClient, actor: Actor, rows: T[], ctx: C, engine?: EngineCtx): Promise<void>; update(tx: Prisma.TransactionClient, actor: Actor, rows: T[], ctx: C, engine?: EngineCtx): Promise<void> }
export type RowStatus = "create" | "update" | "skip-existing" | "skip-reason" | "error";
export interface PreviewRow { line: number; status: RowStatus; key: string | null; message: string | null; summary: string }
export interface ImportPreview { total: number; counts: Record<RowStatus, number>; rows: PreviewRow[] }
export interface ImportResult { created: number; updated: number; skippedExisting: number; skippedReason: number; failed: number; failures: { line: number; message: string }[] }
