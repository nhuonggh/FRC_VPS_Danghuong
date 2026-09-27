import type { Prisma, PrismaClient } from "@prisma/client";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { searchTextWhere } from "@/lib/search";
import { buildXlsx } from "@/server/export/xlsx";
import { DomainError } from "@/server/http/errors";
import type { PartnerKind } from "./codes";

type Db = Prisma.TransactionClient | PrismaClient;
export type { PartnerKind };
export const PARTNER_FILTER_KEYS = ["status", "group", "owner"] as const;
export interface PartnerDTO { id: number; code: string; name: string; groupId: number; groupName: string; isCustomer: boolean; isSupplier: boolean; ownerUserId: number | null; ownerName: string | null; debtLimit: string; allowCredit: boolean; phone: string | null; address: string | null; note: string | null; isActive: boolean; mergedIntoId: number | null; createdAt: Date }

const INCLUDE = { group: { select: { name: true } }, owner: { select: { fullName: true } } } satisfies Prisma.PartnerInclude;
type Row = Prisma.PartnerGetPayload<{ include: typeof INCLUDE }>;
const toDto = (p: Row): PartnerDTO => ({ id: p.id, code: p.code, name: p.name, groupId: p.groupId, groupName: p.group.name, isCustomer: p.isCustomer, isSupplier: p.isSupplier, ownerUserId: p.ownerUserId, ownerName: p.owner?.fullName ?? null, debtLimit: p.debtLimit.toString(), allowCredit: p.allowCredit, phone: p.phone, address: p.address, note: p.note, isActive: p.isActive, mergedIntoId: p.mergedIntoId, createdAt: p.createdAt });
const ints = (value: string[] | undefined) => (value ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);

/** Điều kiện dùng chung cho danh sách, thống kê và Excel để export không vượt quá phạm vi người xem. */
export function partnerWhere(actor: Actor, params: ListParams, kind: PartnerKind, opts: { ignoreStatus?: boolean } = {}): Prisma.PartnerWhereInput {
  const and: Prisma.PartnerWhereInput[] = [{ mergedIntoId: null }, kind === "customer" ? { isCustomer: true } : { isSupplier: true }, partnerScopeWhere(actor), searchTextWhere(params.q)];
  const groups = ints(params.filters.group); if (groups.length) and.push({ groupId: { in: groups } });
  const owners = ints(params.filters.owner); if (owners.length) and.push({ ownerUserId: { in: owners } });
  const status = params.filters.status?.[0]; if (!opts.ignoreStatus && (status === "active" || status === "inactive")) and.push({ isActive: status === "active" });
  return { AND: and };
}
const SORTABLE = ["name", "code", "createdAt"] as const;
export async function listPartners(db: Db, actor: Actor, params: ListParams, kind: PartnerKind) {
  const where = partnerWhere(actor, params, kind); const base = partnerWhere(actor, params, kind, { ignoreStatus: true });
  const [rows, total, all, active] = await Promise.all([
    db.partner.findMany({ where, include: INCLUDE, orderBy: sortToOrderBy(params.sort, SORTABLE, { createdAt: "desc" }), skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    db.partner.count({ where }), db.partner.count({ where: base }), db.partner.count({ where: { AND: [base, { isActive: true }] } }),
  ]);
  return { rows: rows.map(toDto), total, stats: { all, active, inactive: all - active } };
}
export async function getPartner(db: Db, actor: Actor, id: number, kind?: PartnerKind): Promise<PartnerDTO> {
  const row = await db.partner.findFirst({ where: { id, ...partnerScopeWhere(actor), ...(kind === "customer" ? { isCustomer: true } : kind === "supplier" ? { isSupplier: true } : {}) }, include: INCLUDE });
  if (!row) throw new DomainError("Không tìm thấy đối tác.", 404);
  return toDto(row);
}
export async function searchPartners(db: Db, actor: Actor, opts: { q?: string; kind: PartnerKind; limit?: number }) {
  const rows = await db.partner.findMany({ where: { AND: [{ mergedIntoId: null, isActive: true }, opts.kind === "customer" ? { isCustomer: true } : { isSupplier: true }, partnerScopeWhere(actor), searchTextWhere(opts.q)] }, orderBy: { name: "asc" }, take: Math.min(Math.max(opts.limit ?? 20, 1), 50), select: { id: true, code: true, name: true, phone: true } });
  return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}`, hint: r.phone ?? undefined }));
}
const MAX_EXPORT = 50_000;
export async function exportPartnersXlsx(db: Db, actor: Actor, params: ListParams, kind: PartnerKind): Promise<Buffer> {
  const rows = await db.partner.findMany({ where: partnerWhere(actor, params, kind), include: INCLUDE, orderBy: { code: "asc" }, take: MAX_EXPORT });
  return buildXlsx(kind === "customer" ? "Khách hàng" : "Nhà cung cấp", [
    { header: "Mã", key: "code", width: 14, text: true }, { header: "Tên", key: "name", width: 34 }, { header: "Nhóm", key: "groupName", width: 18 }, { header: "Người phụ trách", key: "ownerName", width: 20 }, { header: "Hạn mức nợ", key: "debtLimit", width: 16, numFmt: "#,##0" }, { header: "Cho ghi nợ", key: "allowCredit", width: 12 }, { header: "Điện thoại", key: "phone", width: 16, text: true }, { header: "Địa chỉ", key: "address", width: 36 }, { header: "Ghi chú", key: "note", width: 30 }, { header: "Trạng thái", key: "status", width: 14 },
  ], rows.map((p) => ({ ...toDto(p), allowCredit: p.allowCredit ? "Có" : "Không", status: p.isActive ? "Đang hoạt động" : "Đã tắt" })));
}
