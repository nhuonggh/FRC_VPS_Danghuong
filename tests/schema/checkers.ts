import { Prisma } from "@prisma/client";

/** Tối thiểu của DMMF model/field mà các checker cần (để self-test bằng model giả). */
export type DmmfFieldLike = { name: string; type: string; nativeType?: [string, string[]] | null };
export type DmmfModelLike = { name: string; fields: readonly DmmfFieldLike[] };

export const models: readonly DmmfModelLike[] = Prisma.dmmf.datamodel.models as unknown as DmmfModelLike[];

// Bảng CHỨNG TỪ/SỔ CÁI: bắt buộc periodId + createdBy + createdAt (D-3).
// GĐ sau thêm bảng chứng từ mới → thêm tên vào danh sách này.
export const TRANSACTIONAL_MODELS = ["StockLedger", "PartnerLedger", "CashLedger", "DiscountLedger"];
export const REQUIRED_VOUCHER_FIELDS = ["periodId", "createdBy", "createdAt"];
export const BANNED_BALANCE_FIELD = /^(running|balance)/i;
export const ALLOWED_DECIMAL_PRECISION = new Set(["18,2", "18,3", "18,4", "18,6"]);

export function findModel(list: readonly DmmfModelLike[], name: string): DmmfModelLike {
  const m = list.find((x) => x.name === name);
  if (!m) throw new Error(`Không thấy model ${name}`);
  return m;
}

/** Trả về danh sách vi phạm dạng "Model: thiếu X". Rỗng = hợp lệ. */
export function missingVoucherFields(model: DmmfModelLike): string[] {
  const have = new Set(model.fields.map((f) => f.name));
  return REQUIRED_VOUCHER_FIELDS.filter((r) => !have.has(r)).map((r) => `${model.name}: thiếu ${r}`);
}

/** Cột số dư chạy bị cấm (spec 1.3). */
export function bannedBalanceFields(list: readonly DmmfModelLike[]): string[] {
  return list.flatMap((m) =>
    m.fields.filter((f) => BANNED_BALANCE_FIELD.test(f.name)).map((f) => `${m.name}.${f.name}`),
  );
}

/** Cột Decimal thiếu @db.Decimal hoặc sai độ chính xác chuẩn. */
export function badDecimalFields(list: readonly DmmfModelLike[]): string[] {
  const bad: string[] = [];
  for (const m of list) {
    for (const f of m.fields) {
      if (f.type !== "Decimal") continue;
      if (!f.nativeType) {
        bad.push(`${m.name}.${f.name}: thiếu @db.Decimal`);
      } else if (!ALLOWED_DECIMAL_PRECISION.has(f.nativeType[1].join(","))) {
        bad.push(`${m.name}.${f.name}: độ chính xác ${f.nativeType[1].join(",")}`);
      }
    }
  }
  return bad;
}
