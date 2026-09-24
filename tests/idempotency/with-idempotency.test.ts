import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

const opts = { userId: 1, scope: "order.create", key: "k-1" };

describe("withIdempotency", () => {
  it("chạy work đúng 1 lần; lần 2 cùng khoá trả kết quả lần 1", async () => {
    let calls = 0;
    const work = async (tx: Prisma.TransactionClient) => {
      calls++;
      const w = await tx.warehouse.create({ data: { name: `Kho ${calls}` } });
      return { warehouseId: w.id };
    };
    const first = await withIdempotency(prisma, opts, work);
    const second = await withIdempotency(prisma, opts, work);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(await prisma.warehouse.count()).toBe(1);
  });

  it("khác khoá → chạy lại", async () => {
    let calls = 0;
    const work = async () => ({ n: ++calls });
    await withIdempotency(prisma, opts, work);
    await withIdempotency(prisma, { ...opts, key: "k-2" }, work);
    expect(calls).toBe(2);
  });

  it("cùng khoá nhưng khác người dùng hoặc khác scope → chạy riêng", async () => {
    let calls = 0;
    const work = async () => ({ n: ++calls });
    await withIdempotency(prisma, opts, work);
    await withIdempotency(prisma, { ...opts, userId: 2 }, work);
    await withIdempotency(prisma, { ...opts, scope: "receipt.create" }, work);
    expect(calls).toBe(3);
    expect(await prisma.idempotencyKey.count()).toBe(3);
  });

  it("2 request ĐỒNG THỜI cùng khoá → chỉ 1 bản ghi (bấm 2 lần/retry mạng)", async () => {
    let calls = 0;
    const work = async (tx: Prisma.TransactionClient) => {
      calls++;
      await new Promise((r) => setTimeout(r, 200)); // giữ transaction mở đủ lâu để request 2 chen vào
      const w = await tx.warehouse.create({ data: { name: "Kho duy nhất" } });
      return { warehouseId: w.id };
    };
    const [a, b] = await Promise.all([
      withIdempotency(prisma, opts, work),
      withIdempotency(prisma, opts, work),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(await prisma.warehouse.count()).toBe(1);
    expect(await prisma.idempotencyKey.count()).toBe(1);
  });

  it("nhiều request đồng thời (5) cùng khoá → work chạy 1 lần, 1 kết quả lưu", async () => {
    let calls = 0;
    const work = async (tx: Prisma.TransactionClient) => {
      calls++;
      await new Promise((r) => setTimeout(r, 150));
      const w = await tx.warehouse.create({ data: { name: "Kho duy nhất" } });
      return { warehouseId: w.id };
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => withIdempotency(prisma, opts, work)));
    expect(calls).toBe(1);
    for (const r of results) expect(r).toEqual(results[0]);
    expect(await prisma.warehouse.count()).toBe(1);
    const rows = await prisma.idempotencyKey.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.responseJson).toEqual(results[0]);
  });

  it("work lỗi → rollback, khoá không bị giữ, thử lại được", async () => {
    await expect(
      withIdempotency(prisma, opts, async (tx) => {
        await tx.warehouse.create({ data: { name: "Kho lỗi" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.warehouse.count()).toBe(0);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    const ok = await withIdempotency(prisma, opts, async () => ({ ok: true }));
    expect(ok).toEqual({ ok: true });
  });

  it("request đầu lỗi khi request 2 đang chờ → request 2 tự chạy lại và thành công (1 bản ghi)", async () => {
    let calls = 0;
    const work = async (tx: Prisma.TransactionClient) => {
      const n = ++calls;
      await new Promise((r) => setTimeout(r, 200));
      if (n === 1) throw new Error("boom");
      const w = await tx.warehouse.create({ data: { name: "Kho retry" } });
      return { warehouseId: w.id };
    };
    const results = await Promise.allSettled([
      withIdempotency(prisma, opts, work),
      withIdempotency(prisma, opts, work),
    ]);
    // Request nào giành được khoá trước là không xác định → chỉ khẳng định: đúng 1 lỗi, đúng 1 thành công
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(calls).toBe(2);
    expect(await prisma.warehouse.count()).toBe(1);
    expect(await prisma.idempotencyKey.count()).toBe(1);
  });

  it("kết quả trả về luôn ở dạng JSON thuần (kể cả lần đầu)", async () => {
    const r = await withIdempotency(prisma, opts, async () => ({ at: new Date("2026-09-24T00:00:00Z") }));
    expect(r).toEqual({ at: "2026-09-24T00:00:00.000Z" });
  });

  it("work trả undefined → lưu/trả null (không lỗi ở lần lặp)", async () => {
    const first = await withIdempotency(prisma, opts, async () => undefined);
    const second = await withIdempotency(prisma, opts, async () => ({ khac: 1 }));
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it("chỉ lưu đúng giá trị work trả về: mật khẩu tạm (D-10) tính ở ngoài payload thì không nằm trong bảng", async () => {
    const tempPassword = "Tam-Xyz-987654";
    const r = await withIdempotency(prisma, { ...opts, scope: "user.create" }, async (tx) => {
      const user = await tx.user.create({ data: { username: "nam", passwordHash: "hash", fullName: "Nam" } });
      return { id: user.id, username: user.username }; // KHÔNG trả tempPassword trong payload lưu
    });
    expect(r).toEqual({ id: expect.any(Number), username: "nam" });
    const rows = await prisma.idempotencyKey.findMany();
    expect(JSON.stringify(rows)).not.toContain(tempPassword);
    expect(rows[0]!.responseJson).toEqual(r);
    // lần lặp trả lại đúng payload đã lưu, không thể chứa mật khẩu
    const again = await withIdempotency(prisma, { ...opts, scope: "user.create" }, async () => ({ tempPassword }));
    expect(again).toEqual(r);
    expect(JSON.stringify(again)).not.toContain(tempPassword);
  });
});
