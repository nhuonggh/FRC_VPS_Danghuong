import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createBomBatchSchema, createBomVersionSchema } from "@/server/bom/schemas";
import { BomNotFoundError, resolveBom } from "@/server/bom/resolve";
import { productSearchText } from "@/server/products/service";
import { cancelBomVersion, createBomBatchIdempotent, createBomVersion, createBomVersionIdempotent } from "@/server/bom/service";
import { getBom, listBoms } from "@/server/bom/queries";
import { parseListParams } from "@/lib/query-params";
import { prisma, resetDb } from "../helpers/db";
import { makeProcessingType, makeProduct, makeUser } from "../helpers/factories";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
// 15/09/2026 10:00 ICT
const NOW = new Date("2026-09-15T03:00:00Z");
let actor: Actor; let fg: { id: number; code: string }; let pt: { id: number }; let m1: { id: number }; let m2: { id: number };

const input = (over: Record<string, unknown> = {}) =>
  createBomVersionSchema.parse({
    productId: fg.id, processingTypeId: pt.id, validFrom: "2026-09-15",
    lines: [{ materialProductId: m1.id, qtyPerUnit: 1.25 }, { materialProductId: m2.id, qtyPerUnit: 0.5 }],
    ...over,
  });
const create = (over: Record<string, unknown> = {}, now = NOW) => tx((db) => createBomVersion(db, actor, input(over), now));

beforeEach(async () => {
  await resetDb();
  actor = { userId: (await makeUser()).id, perms: new Set(["bom.manage"]) };
  fg = await makeProduct({ kind: "THANH_PHAM" }); pt = await makeProcessingType();
  m1 = await makeProduct({ kind: "NVL" }); m2 = await makeProduct({ kind: "NVL" });
});

describe("batch BOM creation", () => {
  it("creates every selected pair atomically and replays without duplicates", async () => {
    const second = await makeProduct({ kind: "THANH_PHAM" });
    const type = await makeProcessingType();
    const batch = createBomBatchSchema.parse({ ...input(), productIds: [fg.id, second.id], processingTypeIds: [pt.id, type.id], validFrom: "2026-12-01" });
    const key = crypto.randomUUID();
    const result = await createBomBatchIdempotent(prisma, actor, key, batch);
    expect(result.count).toBe(4);
    expect(await prisma.bomVersion.count()).toBe(4);
    expect(await prisma.bomLine.count()).toBe(8);
    expect(await createBomBatchIdempotent(prisma, actor, key, batch)).toEqual(result);
    expect(await prisma.bomVersion.count()).toBe(4);
  });
  it("rolls back earlier pairs when a later pair conflicts", async () => {
    const second = await makeProduct({ kind: "THANH_PHAM" });
    await create({ productId: second.id, validFrom: "2026-12-01" });
    const batch = createBomBatchSchema.parse({ ...input(), productIds: [fg.id, second.id], processingTypeIds: [pt.id], validFrom: "2026-12-01" });
    await expect(createBomBatchIdempotent(prisma, actor, crypto.randomUUID(), batch)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.bomVersion.count()).toBe(1);
    expect(await prisma.bom.count()).toBe(1);
  });
});

describe("createBomVersion", () => {
  it("tạo Bom + phiên bản 1 + dòng, ghi audit không chứa giá", async () => {
    const r = await create();
    expect(r.versionNo).toBe(1);
    const lines = await prisma.bomLine.findMany({ where: { bomVersionId: r.versionId } });
    expect(lines).toHaveLength(2);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "bom.create_version" } });
    expect(JSON.stringify(audit.afterJson)).toContain("lineCount");
  });

  it("lưu lần hai tạo phiên bản MỚI, phiên bản cũ giữ nguyên dòng", async () => {
    const v1 = await create();
    const v2 = await create({ validFrom: "2026-10-01", lines: [{ materialProductId: m1.id, qtyPerUnit: 2 }] });
    expect(v2.versionNo).toBe(2);
    expect(await prisma.bom.count()).toBe(1);
    expect(await prisma.bomLine.count({ where: { bomVersionId: v1.versionId } })).toBe(2);
    expect(await prisma.bomLine.count({ where: { bomVersionId: v2.versionId } })).toBe(1);
  });

  it("thiếu quyền bom.manage → 403 trước khi ghi", async () => {
    const viewer: Actor = { userId: actor.userId, perms: new Set() };
    await expect(tx((db) => createBomVersion(db, viewer, input(), NOW))).rejects.toThrow();
    expect(await prisma.bom.count()).toBe(0);
  });

  it("ngày hiệu lực quá khứ bị chặn, trừ phiên bản đầu tiên", async () => {
    await expect(create({ validFrom: "2026-01-01" })).resolves.toMatchObject({ versionNo: 1 });
    await expect(create({ validFrom: "2026-09-14" })).rejects.toMatchObject({ status: 400 });
  });

  it("cùng ngày hiệu lực → 409 có field validFrom; sau khi huỷ bản đó thì tạo lại được", async () => {
    const v1 = await create({ validFrom: "2026-10-01" });
    await expect(create({ validFrom: "2026-10-01" })).rejects.toMatchObject({ status: 409, fields: { validFrom: expect.any(String) } });
    await tx((db) => cancelBomVersion(db, actor, v1.versionId, NOW));
    await expect(create({ validFrom: "2026-10-01" })).resolves.toMatchObject({ versionNo: 2 });
  });

  it("hai người lưu cùng ngày đồng thời: một thành công, bên kia 409 (không lỗi hệ thống)", async () => {
    await create({ validFrom: "2026-09-15" }); // tạo Bom trước để cả hai cùng tranh khoá hàng
    const results = await Promise.allSettled([create({ validFrom: "2026-10-01" }), create({ validFrom: "2026-10-01" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(await prisma.bomVersion.count({ where: { validFrom: new Date("2026-10-01T00:00:00Z") } })).toBe(1);
  });

  it("policy loại sản phẩm và trạng thái", async () => {
    const hang = await makeProduct({ kind: "HANG" });
    await expect(create({ productId: hang.id })).rejects.toMatchObject({ status: 400, fields: { productId: expect.any(String) } });
    const off = await makeProduct({ kind: "NVL", isActive: false });
    await expect(create({ lines: [{ materialProductId: off.id, qtyPerUnit: 1 }] })).rejects.toMatchObject({ status: 400 });
    const inactivePt = await makeProcessingType("Đã tắt"); await prisma.processingType.update({ where: { id: inactivePt.id }, data: { isActive: false } });
    await expect(create({ processingTypeId: inactivePt.id })).rejects.toMatchObject({ status: 400 });
    const bad = await makeProduct({ kind: "THANH_PHAM" });
    await expect(create({ lines: [{ materialProductId: bad.id, qtyPerUnit: 1 }] })).rejects.toMatchObject({ status: 400 });
    expect(await prisma.bomVersion.count()).toBe(0);
  });

  it("idempotent: cùng key chỉ tạo một phiên bản", async () => {
    const a = await createBomVersionIdempotent(prisma, actor, "k-1", input({ validFrom: "2026-09-20" }));
    const b = await createBomVersionIdempotent(prisma, actor, "k-1", input({ validFrom: "2026-09-20" }));
    expect(b).toEqual(a);
    expect(await prisma.bomVersion.count()).toBe(1);
  });
});

describe("schema zod", () => {
  const bad = (over: Record<string, unknown>) => createBomVersionSchema.safeParse({ productId: 1, processingTypeId: 1, validFrom: "2026-09-15", lines: [{ materialProductId: 2, qtyPerUnit: 1 }], ...over });
  it("chặn qty <= 0, quá 3 số lẻ, trùng NVL, NVL là chính thành phẩm, 0 hoặc >100 dòng, ngày sai", () => {
    expect(bad({ lines: [{ materialProductId: 2, qtyPerUnit: 0 }] }).success).toBe(false);
    expect(bad({ lines: [{ materialProductId: 2, qtyPerUnit: 1.2345 }] }).success).toBe(false);
    expect(bad({ lines: [{ materialProductId: 2, qtyPerUnit: 1 }, { materialProductId: 2, qtyPerUnit: 2 }] }).success).toBe(false);
    expect(bad({ lines: [{ materialProductId: 1, qtyPerUnit: 1 }] }).success).toBe(false);
    expect(bad({ lines: [] }).success).toBe(false);
    expect(bad({ lines: Array.from({ length: 101 }, (_, i) => ({ materialProductId: i + 10, qtyPerUnit: 1 })) }).success).toBe(false);
    expect(bad({ validFrom: "2026-02-30" }).success).toBe(false);
    expect(bad({}).success).toBe(true);
  });
});

describe("cancelBomVersion", () => {
  it("chỉ huỷ được phiên bản chưa hiệu lực", async () => {
    const past = await create({ validFrom: "2026-09-15" });
    const future = await create({ validFrom: "2026-10-01" });
    await expect(tx((db) => cancelBomVersion(db, actor, past.versionId, NOW))).rejects.toMatchObject({ status: 409 });
    await tx((db) => cancelBomVersion(db, actor, future.versionId, NOW));
    expect((await prisma.bomVersion.findUniqueOrThrow({ where: { id: future.versionId } })).status).toBe("CANCELLED");
    await expect(tx((db) => cancelBomVersion(db, actor, future.versionId, NOW))).rejects.toMatchObject({ status: 409 });
  });
});

describe("resolveBom (D-20)", () => {
  it("đổi định mức hiệu lực 01/10 không làm đổi bản của 30/09 (theo ngày ICT)", async () => {
    await create({ validFrom: "2026-09-01", lines: [{ materialProductId: m1.id, qtyPerUnit: 1 }] }, new Date("2026-09-01T03:00:00Z"));
    await create({ validFrom: "2026-10-01", lines: [{ materialProductId: m1.id, qtyPerUnit: 2 }] });
    const at = (iso: string) => resolveBom(prisma, fg.id, pt.id, new Date(iso));
    expect((await at("2026-09-30T16:59:59Z")).lines[0]!.qtyPerUnit).toBe("1"); // 30/09 23:59:59 ICT
    const oct = await at("2026-09-30T17:00:00Z"); // 01/10 00:00:00 ICT
    expect(oct.lines[0]!.qtyPerUnit).toBe("2");
    expect(oct).toMatchObject({ versionNo: 2, validFrom: "2026-10-01" });
  });

  it("không có bản nào hiệu lực / bản huỷ / kiểu gia công tắt / chưa có BOM → BomNotFoundError", async () => {
    await expect(resolveBom(prisma, fg.id, pt.id, NOW)).rejects.toBeInstanceOf(BomNotFoundError);
    const v = await create({ validFrom: "2026-10-01" });
    await expect(resolveBom(prisma, fg.id, pt.id, NOW)).rejects.toBeInstanceOf(BomNotFoundError); // trước bản đầu tiên
    await tx((db) => cancelBomVersion(db, actor, v.versionId, NOW));
    await expect(resolveBom(prisma, fg.id, pt.id, new Date("2026-11-01T00:00:00Z"))).rejects.toBeInstanceOf(BomNotFoundError);
    await create({ validFrom: "2026-09-15" });
    await prisma.processingType.update({ where: { id: pt.id }, data: { isActive: false } });
    await expect(resolveBom(prisma, fg.id, pt.id, NOW)).rejects.toBeInstanceOf(BomNotFoundError);
  });

  it("bản DRAFT không được resolve", async () => {
    const bom = await prisma.bom.create({ data: { productId: fg.id, processingTypeId: pt.id, createdBy: actor.userId } });
    await prisma.bomVersion.create({ data: { bomId: bom.id, versionNo: 1, validFrom: new Date("2026-09-01T00:00:00Z"), status: "DRAFT", createdBy: actor.userId, lines: { create: [{ materialProductId: m1.id, qtyPerUnit: 1 }] } } });
    await expect(resolveBom(prisma, fg.id, pt.id, NOW)).rejects.toBeInstanceOf(BomNotFoundError);
  });
});

describe("listBoms / getBom", () => {
  it("list có bản hiện hành + bản lên lịch, tìm không dấu theo sản phẩm, lọc kiểu gia công", async () => {
    await create({ validFrom: "2026-09-01" }, new Date("2026-09-01T03:00:00Z"));
    await create({ validFrom: "2026-10-01" });
    const other = await makeProduct({ kind: "THANH_PHAM", code: "TX-99", name: "Tôn xốp đặc biệt", searchText: productSearchText({ code: "TX-99", name: "Tôn xốp đặc biệt" }) });
    await tx((db) => createBomVersion(db, actor, input({ productId: other.id }), NOW));

    const all = await listBoms(prisma, parseListParams({}, ["processingType"]), NOW);
    expect(all.total).toBe(2);
    expect(all.stats.current + all.stats.noCurrent).toBe(all.total);
    expect(all.stats.upcoming).toBe(1);
    const row = all.rows.find((r) => r.productId === fg.id)!;
    expect(row).toMatchObject({ versionCount: 2, upcomingFrom: "2026-10-01", current: { versionNo: 1, lineCount: 2 } });

    const found = await listBoms(prisma, parseListParams({ q: "ton xop dac biet" }, ["processingType"]), NOW);
    expect(found.rows.map((r) => r.productId)).toEqual([other.id]);
    expect((await listBoms(prisma, parseListParams({ processingType: "999999" }, ["processingType"]), NOW)).total).toBe(0);
  });

  it("detail có lịch sử phiên bản, đánh dấu bản hiện hành; không có → 404", async () => {
    await create({ validFrom: "2026-09-01" }, new Date("2026-09-01T03:00:00Z"));
    await create({ validFrom: "2026-10-01" });
    const bom = await prisma.bom.findFirstOrThrow();
    const d = await getBom(prisma, bom.id, NOW);
    expect(d.versions.map((v) => [v.versionNo, v.isCurrent])).toEqual([[2, false], [1, true]]);
    expect(d.versions[1]!.lines[0]).toMatchObject({ materialCode: expect.any(String), qtyPerUnit: expect.any(String) });
    await expect(getBom(prisma, 999999, NOW)).rejects.toMatchObject({ status: 404 });
  });
});
