import { describe, expect, it } from "vitest";
import {
  TRANSACTIONAL_MODELS,
  badDecimalFields,
  bannedBalanceFields,
  findModel,
  missingVoucherFields,
  models,
  type DmmfModelLike,
} from "./checkers";

describe("bất biến schema (DMMF thật)", () => {
  it.each(TRANSACTIONAL_MODELS)("%s có periodId, createdBy, createdAt", (name) => {
    expect(missingVoucherFields(findModel(models, name))).toEqual([]);
  });

  it("KHÔNG có cột số dư chạy ở bất kỳ bảng nào (spec 1.3)", () => {
    expect(bannedBalanceFields(models)).toEqual([]);
  });

  it("mọi cột Decimal khai báo @db.Decimal với độ chính xác chuẩn", () => {
    expect(badDecimalFields(models)).toEqual([]);
  });
});

// Chứng minh checker thật sự "có răng": đưa model giả vi phạm → phải báo lỗi.
describe("self-test checker với model vi phạm giả lập", () => {
  const bad: DmmfModelLike = {
    name: "FakeLedger",
    fields: [
      { name: "id", type: "Int" },
      { name: "runningQty", type: "Decimal", nativeType: ["Decimal", ["18", "3"]] },
      { name: "balanceAmount", type: "Decimal", nativeType: ["Decimal", ["18", "2"]] },
      { name: "loose", type: "Decimal" },
      { name: "wrongPrecision", type: "Decimal", nativeType: ["Decimal", ["10", "2"]] },
    ],
  };
  const good: DmmfModelLike = {
    name: "GoodLedger",
    fields: [
      { name: "periodId", type: "Int" },
      { name: "createdBy", type: "Int" },
      { name: "createdAt", type: "DateTime" },
      { name: "amount", type: "Decimal", nativeType: ["Decimal", ["18", "2"]] },
    ],
  };

  it("báo thiếu periodId/createdBy/createdAt", () => {
    expect(missingVoucherFields(bad)).toEqual([
      "FakeLedger: thiếu periodId",
      "FakeLedger: thiếu createdBy",
      "FakeLedger: thiếu createdAt",
    ]);
    expect(missingVoucherFields(good)).toEqual([]);
  });

  it("báo cột số dư chạy", () => {
    expect(bannedBalanceFields([bad, good])).toEqual(["FakeLedger.runningQty", "FakeLedger.balanceAmount"]);
  });

  it("báo Decimal thiếu native type hoặc sai độ chính xác", () => {
    expect(badDecimalFields([bad, good])).toEqual([
      "FakeLedger.loose: thiếu @db.Decimal",
      "FakeLedger.wrongPrecision: độ chính xác 10,2",
    ]);
  });

  it("findModel ném lỗi khi model không tồn tại", () => {
    expect(() => findModel(models, "KhongTonTai")).toThrow(/Không thấy model/);
  });
});
