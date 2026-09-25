import { describe, expect, it } from "vitest";
import { LOCK_CLASS_PRODUCT, assertLocked, lockProducts, sortedUniqueIds } from "@/server/inventory/lock";
import { EngineInvariantError, ProductNotLockedError } from "@/server/inventory/errors";
import type { EngineCtx } from "@/server/inventory/types";
import { prisma } from "../helpers/db";

const stub = (tx: EngineCtx["tx"]) => ({ tx, locked: new Set<number>() }) as Pick<EngineCtx, "tx" | "locked">;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thử lấy khoá (non-blocking) ngay trong tx: true = khoá đang rảnh. */
async function tryLock(tx: EngineCtx["tx"], id: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_CLASS_PRODUCT}::int, ${id}::int) AS ok`;
  return rows[0]!.ok;
}

/**
 * Giữ khoá trong một transaction MỞ cho tới khi gọi release(). `held` chỉ resolve SAU khi lockFn đã xong
 * (tức A đã thật sự cầm khoá) → không cần sleep để "chờ A giữ khoá".
 */
function hold(lockFn: (tx: EngineCtx["tx"]) => Promise<void>) {
  let open!: () => void;
  let markHeld!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const heldSignal = new Promise<void>((r) => (markHeld = r));
  const done = prisma.$transaction(
    async (tx) => {
      await lockFn(tx);
      markHeld();
      await gate;
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
  return {
    /** Resolve khi đã giữ khoá; reject nếu transaction hỏng trước đó (khỏi treo). */
    held: Promise.race([heldSignal, done]).then(() => undefined),
    /** Nhả khoá (commit); onBeforeCommit chạy ngay trước khi commit để ghi log đúng thứ tự. */
    release: (onBeforeCommit?: () => void) => {
      onBeforeCommit?.();
      open();
    },
    done,
  };
}

/** Số khoá (LOCK_CLASS_PRODUCT, id) ở trạng thái granted / chưa granted. Dạng 2-int: classid = số 1, objid = số 2, objsubid = 2. */
async function lockCount(id: number, granted: boolean): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_locks
     WHERE locktype = 'advisory' AND classid = ${LOCK_CLASS_PRODUCT}::oid AND objid = ${id}::oid
       AND objsubid = 2 AND granted = ${granted}`;
  return rows[0]!.n;
}
const grantedCount = (id: number) => lockCount(id, true);

/** Chờ (poll, tối đa 5s) tới khi có giao dịch đang CHỜ khoá (id) trong pg_locks. */
async function waitUntilBlocked(id: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((await lockCount(id, false)) === 0) {
    if (Date.now() > deadline) throw new Error(`Không thấy giao dịch nào đang chờ khoá mã ${id} sau ${timeoutMs}ms`);
    await sleep(20);
  }
}

describe("sortedUniqueIds", () => {
  it("loại trùng và sắp tăng dần", () => {
    expect(sortedUniqueIds([5, 3, 5, 1, 3])).toEqual([1, 3, 5]);
    expect(sortedUniqueIds([])).toEqual([]);
  });

  it("sắp theo số (không theo chuỗi): 10 đứng sau 9", () => {
    expect(sortedUniqueIds([10, 9, 100, 2])).toEqual([2, 9, 10, 100]);
  });

  it("không đổi mảng đầu vào", () => {
    const input = [3, 1, 2];
    sortedUniqueIds(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("lockProducts", () => {
  it("ghi nhận mã đã khoá, khoá lại mã đã có thì bỏ qua", async () => {
    await prisma.$transaction(async (tx) => {
      const ctx = stub(tx);
      await lockProducts(ctx, [3, 1, 3]);
      expect([...ctx.locked].sort((a, b) => a - b)).toEqual([1, 3]);
      await lockProducts(ctx, [1]);
      expect(ctx.locked.size).toBe(2);
    });
  });

  it("danh sách rỗng: không làm gì", async () => {
    await prisma.$transaction(async (tx) => {
      const ctx = stub(tx);
      await lockProducts(ctx, []);
      expect(ctx.locked.size).toBe(0);
    });
  });

  it("assertLocked ném lỗi lập trình khi chưa khoá", async () => {
    await prisma.$transaction(async (tx) => {
      const ctx = stub(tx);
      expect(() => assertLocked(ctx, 7)).toThrow(ProductNotLockedError);
      await lockProducts(ctx, [7]);
      expect(() => assertLocked(ctx, 7)).not.toThrow();
    });
  });

  it("id âm / 0 / lẻ / NaN / vượt int32 → EngineInvariantError RÕ RÀNG, chưa khoá mã nào (kể cả mã hợp lệ đứng trước)", async () => {
    for (const bad of [-1, 0, 1.5, Number.NaN, 2 ** 31, Number.POSITIVE_INFINITY]) {
      await prisma.$transaction(async (tx) => {
        const ctx = stub(tx);
        await expect(lockProducts(ctx, [1, bad])).rejects.toThrow(EngineInvariantError);
        expect(ctx.locked.size).toBe(0);
        expect(await tryLock(tx, 1)).toBe(true); // mã hợp lệ 1 KHÔNG bị khoá dở dang
      });
    }
  });

  it("id trùng nhau (kể cả nhiều lần) chỉ khoá 1 lần, không tự nghẽn", async () => {
    await prisma.$transaction(async (tx) => {
      const ctx = stub(tx);
      await lockProducts(ctx, [9, 9, 9, 9]);
      expect([...ctx.locked]).toEqual([9]);
    });
  });

  it("2 transaction khoá CÙNG mã: bên sau phải CHỜ bên trước commit", async () => {
    const log: string[] = [];
    const a = hold(async (tx) => {
      await lockProducts(stub(tx), [42]);
      log.push("A giữ khoá");
    });
    await a.held; // A chắc chắn đã giữ khoá trước khi B bắt đầu
    const b = prisma.$transaction(async (tx) => {
      await lockProducts(stub(tx), [42]);
      log.push("B giữ khoá");
    });
    await waitUntilBlocked(42); // B thực sự đang chờ trong Postgres (ungranted)
    expect(log).toEqual(["A giữ khoá"]);
    a.release(() => log.push("A xong"));
    await Promise.all([a.done, b]);
    expect(log).toEqual(["A giữ khoá", "A xong", "B giữ khoá"]);
  });

  it("2 transaction khoá mã KHÁC nhau: không chờ nhau (B xong khi A còn đang giữ)", async () => {
    const log: string[] = [];
    const a = hold(async (tx) => {
      await lockProducts(stub(tx), [51]);
      log.push("A giữ khoá");
    });
    await a.held;
    // Nếu B bị chặn thì await này treo tới timeout của vitest → test đỏ (không dựa vào ngân sách thời gian).
    await prisma.$transaction(async (tx) => {
      await lockProducts(stub(tx), [52]);
      log.push("B giữ khoá");
    });
    expect(log).toEqual(["A giữ khoá", "B giữ khoá"]);
    a.release(() => log.push("A xong"));
    await a.done;
    expect(log).toEqual(["A giữ khoá", "B giữ khoá", "A xong"]);
  });

  it("khoá theo thứ tự tăng dần: giao dịch yêu cầu [62,61] khi 62 đang bị giữ đã cầm 61 TRƯỚC rồi mới chờ 62", async () => {
    const a = hold((tx) => lockProducts(stub(tx), [62]));
    await a.held;

    const ctxB = { locked: new Set<number>() } as Pick<EngineCtx, "tx" | "locked">;
    const b = prisma.$transaction(async (tx) => {
      ctxB.tx = tx;
      await lockProducts(ctxB, [62, 61]); // input đảo thứ tự
    });
    await waitUntilBlocked(62); // B đã bị chặn ở 62 (chứng minh dương tính)
    expect([...ctxB.locked]).toEqual([61]); // đã có 61 (nhỏ hơn) và đang chờ 62 ⇒ đi tăng dần
    expect(await grantedCount(61)).toBe(1); // 61 do B giữ thật trong Postgres (A chỉ giữ 62)
    a.release();
    await Promise.all([a.done, b]);
    expect([...ctxB.locked]).toEqual([61, 62]);
  });

  it("khoá theo thứ tự tăng dần → nhiều giao dịch chéo [1,2,3] / [3,2,1] KHÔNG deadlock", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) =>
      prisma.$transaction(
        async (tx) => {
          await lockProducts(stub(tx), i % 2 === 0 ? [1, 2, 3] : [3, 2, 1]);
          await sleep(20);
        },
        { maxWait: 15_000, timeout: 30_000 },
      ),
    );
    await expect(Promise.all(jobs)).resolves.toHaveLength(12);
  });

  it("khoá tự NHẢ khi transaction commit (xact) — không rò sang giao dịch sau", async () => {
    await prisma.$transaction(async (tx) => {
      await lockProducts(stub(tx), [71]);
    });
    await prisma.$transaction(async (tx) => {
      expect(await tryLock(tx, 71)).toBe(true);
    });
  });

  it("khoá tự NHẢ khi transaction ROLLBACK", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await lockProducts(stub(tx), [72]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await prisma.$transaction(async (tx) => {
      expect(await tryLock(tx, 72)).toBe(true);
    });
  });

  it("đang giữ khoá thì giao dịch khác thử khoá thấy BẬN (xác nhận try-lock của test có nghĩa)", async () => {
    const a = hold((tx) => lockProducts(stub(tx), [73]));
    await a.held;
    await prisma.$transaction(async (tx) => {
      expect(await tryLock(tx, 73)).toBe(false);
    });
    a.release();
    await a.done;
  });

  it("không gian khoá tách biệt khoá quản trị viên (bigint đơn 7710001): không chặn nhau", async () => {
    const admin = hold(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${7710001})`;
    });
    await admin.held;
    await prisma.$transaction(
      async (tx) => {
        const ctx = stub(tx);
        await lockProducts(ctx, [1, 7710001]);
        expect(ctx.locked.size).toBe(2);
      },
      { maxWait: 2_000, timeout: 5_000 },
    );
    admin.release();
    await admin.done;
  });
});
