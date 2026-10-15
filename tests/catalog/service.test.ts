import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createCatalogItem, deleteCatalogItem, setCatalogActive, updateCatalogItem } from "@/server/catalog/service";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup, makeUser } from "../helpers/factories";
const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
let actor: Actor;
beforeEach(async () => { await resetDb(); actor = { userId: (await makeUser()).id, perms: new Set(["catalog.manage"]) }; });
describe("Catalog service", () => {
  it("tạo/sửa/tắt kho và audit đúng entity", async () => {
    const { id } = await tx((db) => createCatalogItem(db, actor, "warehouses", { name: "  Kho 1 " }));
    await tx((db) => updateCatalogItem(db, actor, "warehouses", id, { name: "Kho chính" }));
    await tx((db) => setCatalogActive(db, actor, "warehouses", id, false));
    expect(await prisma.warehouse.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Kho chính", isActive: false });
    expect(await prisma.auditLog.count({ where: { entity: "Warehouse" } })).toBe(3);
  });
  it("trùng kho trả FieldConflictError, nhóm khách đang dùng không bị xóa", async () => {
    await tx((db) => createCatalogItem(db, actor, "warehouses", { name: "Kho A" }));
    await expect(tx((db) => createCatalogItem(db, actor, "warehouses", { name: "Kho A" }))).rejects.toBeInstanceOf(FieldConflictError);
    const group = await makePartnerGroup(); await makePartner({ groupId: group.id });
    const err = await tx((db) => deleteCatalogItem(db, actor, "partner-groups", group.id)).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError); expect((err as DomainError).status).toBe(409);
  });
});
