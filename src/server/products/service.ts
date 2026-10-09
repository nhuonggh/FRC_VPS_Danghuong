import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { parseViNumber } from "@/lib/parse-number";
import { normalizeSearch } from "@/lib/search";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import type { CreateProductInput } from "./schemas";

type Db = Prisma.TransactionClient;
export const productSearchText = (product: { code: string; name: string }) => normalizeSearch(`${product.code} ${product.name}`);
const unitsOf = (units: { unit: string; factor: number }[]) => ({ create: units.map((u) => ({ unit: u.unit, factor: new Prisma.Decimal(u.factor) })) });
const conflict = () => new FieldConflictError("Mã đã tồn tại.", { code: "Mã đã tồn tại." });
async function load(db: Db, id: number) { const row = await db.product.findUnique({ where: { id }, include: { units: true } }); if (!row) throw new DomainError("Không tìm thấy sản phẩm.", 404); return row; }

export async function createProduct(db: Db, actor: Actor, input: CreateProductInput) {
  assertCan(actor.perms, "product.manage"); const code = input.code.toUpperCase();
  try { const row = await db.product.create({ data: { code, name: input.name, searchText: productSearchText({ code, name: input.name }), kind: input.kind, baseUnit: input.baseUnit, minStock: new Prisma.Decimal(input.minStock), isCoil: input.isCoil, isActive: input.isActive, note: input.note || null, imageUrl: input.imageUrl || null, groupId: input.groupId ?? null, units: unitsOf(input.units) } }); await writeAudit(db, { userId: actor.userId, action: "product.create", entity: "Product", entityId: row.id, after: { code, name: row.name, baseUnit: row.baseUnit } }); return { id: row.id, code }; } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict(); throw error; }
}
export async function createProductIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: CreateProductInput) { assertCan(actor.perms, "product.manage"); return withIdempotency(prisma, { userId: actor.userId, scope: "product.create", key }, (tx) => createProduct(tx, actor, input)); }
export async function updateProductBasic(db: Db, actor: Actor, id: number, value: { name: string; kind: "HANG" | "NVL" | "THANH_PHAM" | "PHU_KIEN"; baseUnit: string; isCoil: boolean; note: string; imageUrl?: string; groupId?: number | null }) { assertCan(actor.perms, "product.manage"); const before = await load(db, id); if (before.baseUnit !== value.baseUnit) { if (await db.stockLedger.count({ where: { productId: id } })) throw new DomainError("Sản phẩm đã có phát sinh kho, không đổi đơn vị gốc được.", 409); if (before.units.some((u) => u.unit.toLocaleLowerCase("vi") === value.baseUnit.toLocaleLowerCase("vi"))) throw new DomainError("Đơn vị gốc mới đang trùng một đơn vị quy đổi — xóa đơn vị quy đổi đó trước.", 409); } await db.product.update({ where: { id }, data: { ...value, note: value.note || null, imageUrl: value.imageUrl === undefined ? undefined : value.imageUrl || null, searchText: productSearchText({ code: before.code, name: value.name }) } }); await writeAudit(db, { userId: actor.userId, action: "product.update_basic", entity: "Product", entityId: id, before: { name: before.name, baseUnit: before.baseUnit }, after: value }); }
export async function setProductStock(db: Db, actor: Actor, id: number, value: { minStock: number }) { assertCan(actor.perms, "product.manage"); const before = await load(db, id); await db.product.update({ where: { id }, data: { minStock: new Prisma.Decimal(value.minStock) } }); await writeAudit(db, { userId: actor.userId, action: "product.update_stock", entity: "Product", entityId: id, before: { minStock: before.minStock }, after: value }); }
export async function setProductUnits(db: Db, actor: Actor, id: number, value: { units: { unit: string; factor: number }[] }) { assertCan(actor.perms, "product.manage"); const before = await load(db, id); if (value.units.some((u) => u.unit.toLocaleLowerCase("vi") === before.baseUnit.toLocaleLowerCase("vi"))) throw new DomainError("Đơn vị gốc không được là đơn vị quy đổi.", 400); const keep = value.units.map((u) => u.unit); await db.productUnit.deleteMany({ where: { productId: id, unit: { notIn: keep } } }); for (const unit of value.units) await db.productUnit.upsert({ where: { productId_unit: { productId: id, unit: unit.unit } }, create: { productId: id, unit: unit.unit, factor: new Prisma.Decimal(unit.factor) }, update: { factor: new Prisma.Decimal(unit.factor) } }); await writeAudit(db, { userId: actor.userId, action: "product.update_units", entity: "Product", entityId: id, before: { units: before.units }, after: value }); }
/** Sửa nhanh nhiều SP: mỗi SP một đơn vị quy đổi + tỷ trọng (cả hai trống = xoá). SP đã có ≥ 2 đơn vị phải sửa ở trang chi tiết. */
export async function setProductUnitsBulk(db: Db, actor: Actor, items: { id: number; unit: string; factor: string }[]) {
  assertCan(actor.perms, "product.manage");
  for (const item of items) {
    const before = await load(db, item.id); const label = `${before.code}: `;
    if (before.units.length > 1) throw new DomainError(`${label}có nhiều đơn vị quy đổi — sửa ở trang chi tiết.`, 400);
    const unit = item.unit.trim(); const f = parseViNumber(item.factor);
    if (!f.ok) throw new DomainError(`${label}Tỷ trọng: ${f.message}`, 400);
    if (!unit && f.value === null) { await setProductUnits(db, actor, item.id, { units: [] }); continue; }
    if (!unit || f.value === null) throw new DomainError(`${label}nhập đủ cả Đơn vị quy đổi và Tỷ trọng.`, 400);
    if (unit.length > 10) throw new DomainError(`${label}Đơn vị quy đổi tối đa 10 ký tự.`, 400);
    if (!(Number(f.value) > 0) || Number(f.value) > 1_000_000) throw new DomainError(`${label}Tỷ trọng phải lớn hơn 0.`, 400);
    await setProductUnits(db, actor, item.id, { units: [{ unit, factor: Number(f.value) }] });
  }
}
export async function setProductActive(db: Db, actor: Actor, id: number, value: { isActive: boolean }) { assertCan(actor.perms, "product.manage"); const before = await load(db, id); await db.product.update({ where: { id }, data: value }); await writeAudit(db, { userId: actor.userId, action: "product.update_status", entity: "Product", entityId: id, before: { isActive: before.isActive }, after: value }); }
