import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createPartner, setPartnerActive } from "@/server/partners/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartnerGroup, makeUser } from "../helpers/factories";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor; let groupId: number;
const input = (over = {}) => ({ code: "", name: "Nguyễn Văn Đạt", groupId, isCustomer: true, isSupplier: false, ownerUserId: null, debtLimit: 0, allowCredit: false, phone: "0912345678", address: "", note: "", isActive: true, ...over });
beforeEach(async () => { await resetDb(); actor = { userId: (await makeUser()).id, perms: new Set(["partner.manage", "partner.view"]) }; groupId = (await makePartnerGroup("Khách lẻ")).id; });
describe("partner service", () => {
  it("tự sinh mã, chuẩn hoá searchText và gán người tạo khi chưa chọn phụ trách", async () => {
    const result = await tx((db) => createPartner(db, actor, input()));
    const row = await prisma.partner.findUniqueOrThrow({ where: { id: result.id } });
    expect(result.code).toBe("KH000001");
    expect(row).toMatchObject({ ownerUserId: actor.userId, searchText: "kh000001 nguyen van dat 0912345678" });
  });
  it("chỉ cho sửa đối tác trong phạm vi và audit thay đổi trạng thái", async () => {
    const created = await tx((db) => createPartner(db, actor, input()));
    await tx((db) => setPartnerActive(db, actor, created.id, { isActive: false }));
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: created.id } })).isActive).toBe(false);
    expect(await prisma.auditLog.findFirst({ where: { action: "partner.set_active", entityId: String(created.id) } })).not.toBeNull();
    const another: Actor = { userId: (await makeUser()).id, perms: new Set(["partner.manage", "partner.view"]) };
    await expect(tx((db) => setPartnerActive(db, another, created.id, { isActive: true }))).rejects.toMatchObject({ status: 404 });
  });
});
