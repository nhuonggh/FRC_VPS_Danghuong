import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { redactDeep } from "@/lib/permissions/redact";

const dto = () => ({
  id: 1,
  total: new Prisma.Decimal("1500000"),
  at: new Date("2026-09-24T00:00:00Z"),
  lines: [
    { id: 10, price: 100, unitCostFifo: new Prisma.Decimal("20444.4444"), lineProfit: 5 },
    { id: 11, price: 200, unitCostFifo: new Prisma.Decimal("1"), lineProfit: 6 },
  ],
  customer: { name: "A", lastPurchasePrice: 9 },
});

describe("redactDeep", () => {
  it("bỏ field nhạy cảm ở MỌI tầng (kể cả trong mảng dòng hàng) khi thiếu quyền", () => {
    const out = redactDeep(dto(), new Set<string>());
    expect(out.lines[0]).toEqual({ id: 10, price: 100 });
    expect(out.lines[1]).toEqual({ id: 11, price: 200 });
    expect(out.customer).toEqual({ name: "A" });
    expect("unitCostFifo" in out.lines[0]!).toBe(false); // bỏ KEY, không phải gán null
  });

  it("giữ field khi đủ quyền tương ứng, bỏ field thiếu quyền", () => {
    const out = redactDeep(dto(), new Set(["cost.view"]));
    expect(out.lines[0]!.unitCostFifo).toBeDefined();
    expect("lineProfit" in out.lines[0]!).toBe(false);
    expect("lastPurchasePrice" in out.customer).toBe(false);
  });

  it("không đụng Decimal/Date (không đi vào object không phải plain)", () => {
    const out = redactDeep(dto(), new Set<string>());
    expect(out.total).toBeInstanceOf(Prisma.Decimal);
    expect(out.at).toBeInstanceOf(Date);
  });

  it("không mutate đầu vào", () => {
    const input = dto();
    redactDeep(input, new Set<string>());
    expect(input.lines[0]!.unitCostFifo).toBeDefined();
    expect(input.lines[0]!.lineProfit).toBe(5);
    expect(input.customer.lastPurchasePrice).toBe(9);
  });

  it("nhận bảng field tuỳ biến", () => {
    const out = redactDeep({ a: 1, secret: 2 }, new Set<string>(), { secret: "cost.view" });
    expect(out).toEqual({ a: 1 });
  });

  it("đi xuyên mảng trong mảng và nhiều tầng object/mảng xen kẽ", () => {
    const input = {
      groups: [
        [{ profit: 1, keep: "a" }, { profit: 2, keep: "b" }],
        [[{ orderProfit: 3, keep: "c" }]],
      ],
      deep: { a: { b: [{ c: { unitCostOut: 4, keep: "d" } }] } },
    };
    const out = redactDeep(input, new Set<string>());
    expect(out).toEqual({
      groups: [[{ keep: "a" }, { keep: "b" }], [[{ keep: "c" }]]],
      deep: { a: { b: [{ c: { keep: "d" } }] } },
    });
  });

  it("mảng ở gốc và mảng rỗng", () => {
    const out = redactDeep([{ profit: 1, id: 1 }, []], new Set<string>());
    expect(out).toEqual([{ id: 1 }, []]);
  });

  it("an toàn với null/undefined/nguyên thuỷ, giữ giá trị null của field thường", () => {
    const perms = new Set<string>();
    expect(redactDeep(null, perms)).toBeNull();
    expect(redactDeep(undefined, perms)).toBeUndefined();
    expect(redactDeep(5, perms)).toBe(5);
    expect(redactDeep("x", perms)).toBe("x");
    const out = redactDeep({ a: null, b: undefined, c: [null, undefined], profit: null }, perms);
    expect(out).toEqual({ a: null, b: undefined, c: [null, undefined] });
    expect("profit" in out).toBe(false); // field nhạy cảm bị bỏ kể cả khi giá trị null
  });

  it("bỏ field nhạy cảm kể cả khi giá trị là Decimal/Date/mảng/object", () => {
    const out = redactDeep(
      { a: 1, profit: new Prisma.Decimal(5), orderProfit: new Date(), costAmount: [1], unitCostFifo: { x: 1 } },
      new Set<string>(),
    );
    expect(out).toEqual({ a: 1 });
  });

  it("mặc định từ chối: quyền không liên quan không mở field nhạy cảm", () => {
    const out = redactDeep({ profit: 1, id: 1 }, new Set(["cost.view", "order.view"]));
    expect(out).toEqual({ id: 1 });
  });

  it("giữ nguyên Decimal/Date bên trong mảng dòng hàng (cùng tham chiếu)", () => {
    const d = new Prisma.Decimal("3.5");
    const at = new Date(0);
    const out = redactDeep({ lines: [{ qty: d, at }] }, new Set<string>());
    expect(out.lines[0]!.qty).toBe(d);
    expect(out.lines[0]!.at).toBe(at);
  });
});
