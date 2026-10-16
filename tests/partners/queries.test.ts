import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { listPartners, PARTNER_FILTER_KEYS, searchPartners } from "@/server/partners/queries";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePartnerGroup, makeUser } from "../helpers/factories";

const params = (search: Record<string, string> = {}) => parseListParams(search, PARTNER_FILTER_KEYS);
let seller: Actor; let boss: Actor; let groupId: number;
beforeEach(async () => { await resetDb(); const a = await makeUser(); const b = await makeUser(); seller = { userId: a.id, perms: new Set(["partner.view"]) }; boss = { userId: b.id, perms: new Set(["partner.view", "partner.view_all"]) }; groupId = (await makePartnerGroup("Thợ")).id; });
describe("partner queries", () => {
  it("tìm không dấu và chỉ trả về đối tác trong phạm vi người dùng", async () => {
    await makePartner({ code: "KH1", name: "Nguyễn Văn Đạt", searchText: "kh1 nguyen van dat", groupId, ownerUserId: seller.userId });
    await makePartner({ code: "KH2", name: "Đạt Khác", searchText: "kh2 dat khac", groupId, ownerUserId: boss.userId });
    expect((await listPartners(prisma, seller, params({ q: "ĐẠT" }), "customer")).rows.map((row) => row.code)).toEqual(["KH1"]);
    expect((await searchPartners(prisma, boss, { q: "dat", kind: "customer" })).map((row) => row.value)).toHaveLength(2);
  });
});

describe("khách lẻ thân quen", () => {
  it("ẩn khỏi danh sách khách hàng và ô chọn mặc định; chỉ hiện khi bật bộ lọc retail=1", async () => {
    await makePartner({ code: "KH1", name: "Khách thường", searchText: "kh1 khach thuong", groupId });
    await makePartner({ code: "KL000001", name: "Chú Mạnh", searchText: "kl000001 chu manh 0349631425", groupId, isRegularRetail: true, phoneKey: "0349631425" });
    expect((await listPartners(prisma, boss, params(), "customer")).rows.map((r) => r.code)).toEqual(["KH1"]);
    expect((await listPartners(prisma, boss, params({ retail: "1" }), "customer")).rows.map((r) => r.code)).toEqual(["KL000001"]);
    expect((await searchPartners(prisma, boss, { q: "manh", kind: "customer" }))).toHaveLength(0);
  });
});
