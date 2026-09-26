import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(resetDb);

describe("users.email — ràng buộc DB (migration 20260926090000_user_email)", () => {
  it("NULL cho phép nhiều dòng (email tuỳ chọn)", async () => {
    await makeUser();
    await makeUser({ email: null });
    expect(await prisma.user.count({ where: { email: null } })).toBe(2);
  });

  it("UNIQUE: 2 user cùng email → lỗi P2002 trên cột email", async () => {
    await makeUser({ email: "a@example.test" });
    const e = await makeUser({ email: "a@example.test" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((e as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    expect(JSON.stringify((e as Prisma.PrismaClientKnownRequestError).meta)).toContain("email");
  });

  it.each(["A@example.test", " a@example.test", "a@example.test ", "", "\ta@example.test", "a@example.test\n", "a b@example.test"])(
    "CHECK: email chưa chuẩn hoá %j bị DB từ chối (kể cả ghi thẳng, bỏ qua app)",
    async (email) => {
      await expect(makeUser({ email })).rejects.toThrow(/check constraint|users_email_normalized_chk/i);
      await expect(prisma.$executeRawUnsafe(`INSERT INTO users (username, "passwordHash", "fullName", email, "updatedAt") VALUES ('raw', 'x', 'Raw', $1, now())`, email))
        .rejects.toThrow(/users_email_normalized_chk/);
    },
  );

  it("CHECK + UNIQUE cùng nhau ⇒ không thể có 2 email chỉ khác hoa/thường", async () => {
    await makeUser({ email: "boss@example.test" });
    await expect(makeUser({ email: "Boss@example.test" })).rejects.toThrow(/check constraint|users_email_normalized_chk/i);
  });

  it("ràng buộc có trong catalog Postgres với đúng định nghĩa", async () => {
    const rows = await prisma.$queryRaw<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'users'::regclass AND conname = 'users_email_normalized_chk'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.def).toMatch(/lower\(email\)/);
    expect(rows[0]!.def).toMatch(/btrim\(email\)/);
    const idx = await prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_key'`;
    expect(idx[0]?.indexdef).toMatch(/UNIQUE INDEX users_email_key ON public\.users USING btree \(email\)/);
  });

  it("role app_rw đọc/ghi được cột email (GRANT mức bảng phủ cột mới)", async () => {
    const u = await makeUser();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(`UPDATE users SET email = 'rw@example.test' WHERE id = ${u.id}`);
      const rows = await tx.$queryRawUnsafe<{ email: string }[]>(`SELECT email FROM users WHERE id = ${u.id}`);
      expect(rows[0]!.email).toBe("rw@example.test");
      await tx.$executeRawUnsafe(`INSERT INTO users (username, "passwordHash", "fullName", email, "updatedAt") VALUES ('rw2', 'x', 'RW', 'rw2@example.test', now())`);
    });
    expect(await prisma.user.count({ where: { email: { in: ["rw@example.test", "rw2@example.test"] } } })).toBe(2);
  });

  it("app_rw cũng không vượt được CHECK", async () => {
    const u = await makeUser();
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(`UPDATE users SET email = 'UP@example.test' WHERE id = ${u.id}`);
    })).rejects.toThrow(/users_email_normalized_chk/);
  });
});

describe("users.emailChangedAt / tempPasswordExpiresAt (migration 20260926100000_user_temp_password_expiry)", () => {
  it("cột timestamptz, NULL được; app_rw đọc/ghi được", async () => {
    const cols = await prisma.$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN ('emailChangedAt', 'tempPasswordExpiresAt') ORDER BY column_name`;
    expect(cols).toEqual([
      { column_name: "emailChangedAt", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "tempPasswordExpiresAt", data_type: "timestamp with time zone", is_nullable: "YES" },
    ]);
    const u = await makeUser();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(`UPDATE users SET "emailChangedAt" = now(), "tempPasswordExpiresAt" = now() + interval '72 hours' WHERE id = ${u.id}`);
      const rows = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM users WHERE "emailChangedAt" IS NOT NULL AND "tempPasswordExpiresAt" IS NOT NULL`);
      expect(rows[0]!.n).toBe(1);
    });
  });
});
