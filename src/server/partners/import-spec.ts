import { Prisma } from "@prisma/client";
import { parseViNumber } from "@/lib/parse-number";
import { normalizeSearch } from "@/lib/search";
import type { ImportColumn, ImportSpec } from "@/server/import/types";
import type { PartnerKind } from "./codes";
import { searchTextOf } from "./service";

export interface PartnerImportRow { code: string; name: string; groupId: number; phone: string; address: string; note: string; debtLimit: string; allowCredit: boolean; ownerUserId: number | null }
export interface PartnerImportCtx { groups: Map<string, number>; owners: Map<string, number> }
const COLUMNS: readonly ImportColumn[] = [
  { key: "code", header: "Mã", required: true, sample: "KH001" }, { key: "name", header: "Tên", required: true, sample: "Nguyễn Văn Đạt" }, { key: "group", header: "Nhóm", required: true, sample: "Khách lẻ" }, { key: "phone", header: "Điện thoại", sample: "0912345678" }, { key: "address", header: "Địa chỉ", sample: "Quận 12, TP.HCM" }, { key: "debtLimit", header: "Hạn mức nợ", sample: "12.500.000" }, { key: "allowCredit", header: "Cho ghi nợ", sample: "Có" }, { key: "owner", header: "Người phụ trách", aliases: ["Nhân viên phụ trách"], sample: "nam" }, { key: "note", header: "Ghi chú", sample: "" },
];
const str = (value: unknown) => value == null ? "" : String(value).trim();
/** Giá trị không nhận diện được cố ý trả null để báo lỗi thay vì đoán. */
export function parseYesNo(value: unknown): boolean | null {
  const normalized = normalizeSearch(str(value));
  if (["", "khong", "k", "0", "no", "false", "n"].includes(normalized)) return false;
  if (["co", "c", "x", "1", "yes", "true", "y"].includes(normalized)) return true;
  return null;
}
/** Khớp người phụ trách theo tên đăng nhập, không phân biệt hoa/thường và dấu ("Nhâm" ⇒ "nham"); tên đăng nhập luôn thắng họ tên, họ tên trùng nhau thì bỏ qua vì mơ hồ. */
export function ownerMap(users: { id: number; username: string; fullName: string }[]): Map<string, number> {
  const map = new Map<string, number>(); const ambiguous = new Set<string>();
  for (const u of users) map.set(normalizeSearch(u.username), u.id);
  for (const u of users) { const k = normalizeSearch(u.fullName); if (map.has(k) && map.get(k) !== u.id) ambiguous.add(k); else map.set(k, u.id); }
  for (const k of ambiguous) if (!users.some((u) => normalizeSearch(u.username) === k)) map.delete(k);
  return map;
}
export function partnerImportSpec(kind: PartnerKind): ImportSpec<PartnerImportRow, PartnerImportCtx> {
  return {
    entity: "Partner", label: kind === "customer" ? "khách hàng" : "nhà cung cấp", columns: COLUMNS,
    async loadContext(db) {
      const [groups, users] = await Promise.all([db.partnerGroup.findMany({ where: { isActive: true }, select: { id: true, name: true } }), db.user.findMany({ where: { isLocked: false }, select: { id: true, username: true, fullName: true } })]);
      return { groups: new Map(groups.map((g) => [normalizeSearch(g.name), g.id])), owners: ownerMap(users) };
    },
    parseRow(cells, ctx) {
      const errors: string[] = []; const code = str(cells.code).toUpperCase();
      if (!code) errors.push("Thiếu mã."); else if (!/^[A-Z0-9._-]{1,30}$/.test(code)) errors.push("Mã chỉ gồm chữ không dấu, số và . _ - (tối đa 30 ký tự).");
      const name = str(cells.name); if (!name) errors.push("Thiếu tên."); else if (name.length > 120) errors.push("Tên tối đa 120 ký tự.");
      const groupName = str(cells.group); const groupId = ctx.groups.get(normalizeSearch(groupName)); if (!groupName) errors.push("Thiếu nhóm."); else if (groupId === undefined) errors.push(`Nhóm "${groupName}" chưa có — tạo ở Hệ thống → Cài đặt danh mục trước.`);
      const limit = parseViNumber(cells.debtLimit); if (!limit.ok) errors.push(`Hạn mức nợ: ${limit.message}`);
      const allowCredit = parseYesNo(cells.allowCredit); if (allowCredit === null) errors.push(`Cho ghi nợ: "${str(cells.allowCredit)}" — nhập Có hoặc Không.`);
      const ownerName = str(cells.owner); const ownerUserId = ownerName ? ctx.owners.get(normalizeSearch(ownerName)) : null; if (ownerName && ownerUserId === undefined) errors.push(`Người phụ trách "${ownerName}" không có (hoặc đã khoá) — nhập tên đăng nhập hoặc họ tên.`);
      if (errors.length) return { ok: false, errors };
      return { ok: true, data: { code, name, groupId: groupId!, phone: str(cells.phone), address: str(cells.address), note: str(cells.note), debtLimit: (limit as { value: string | null }).value ?? "0", allowCredit: allowCredit!, ownerUserId: ownerUserId ?? null } };
    },
    keyOf: (row) => row.code,
    async existingKeys(db, keys) { return new Set((await db.partner.findMany({ where: { code: { in: keys } }, select: { code: true } })).map((p) => p.code)); },
    async create(tx, _actor, rows) { if (rows.length) await tx.partner.createMany({ data: rows.map((r) => ({ code: r.code, name: r.name, searchText: searchTextOf(r), groupId: r.groupId, isCustomer: kind === "customer", isSupplier: kind === "supplier", ownerUserId: r.ownerUserId, debtLimit: new Prisma.Decimal(r.debtLimit), allowCredit: r.allowCredit, phone: r.phone || null, address: r.address || null, note: r.note || null })) }); },
    async update(tx, _actor, rows) { for (const r of rows) await tx.partner.update({ where: { code: r.code }, data: { name: r.name, searchText: searchTextOf(r), groupId: r.groupId, ownerUserId: r.ownerUserId, debtLimit: new Prisma.Decimal(r.debtLimit), allowCredit: r.allowCredit, phone: r.phone || null, address: r.address || null, note: r.note || null, ...(kind === "customer" ? { isCustomer: true } : { isSupplier: true }) } }); },
  };
}
