import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { getCompany, listPrintTemplates } from "@/server/company/queries";
import { createTemplateSchema, updateCompanySchema, updateTemplateSchema } from "@/server/company/schemas";
import { decryptSecret, encryptSecret } from "@/server/company/secret";
import { createPrintTemplate, createPrintTemplateIdempotent, stripUrlQuery, updateCompany, updatePrintTemplate } from "@/server/company/service";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
const ENV = { AUTH_SECRET: "test-only-secret", COMPANY_IMAGE_HOSTS: "cdn.example.vn" };
const PLAIN = "PLAIN-SECRET-VALUE-123";
let actor: Actor;

const tpl = (over: Record<string, unknown> = {}) => createTemplateSchema.parse({
  docType: "sale_invoice", name: "Hoá đơn bán", webhookUrl: "https://script.google.com/macros/s/AKfy/exec?key=QUERYSECRET",
  title: "", signerName: "", phone: "", qrImage: "", showCompanyInfo: true, footerNote: "", isActive: true, secretAction: "replace", secret: PLAIN, ...over,
});
const upd = (over: Record<string, unknown> = {}) => updateTemplateSchema.parse({
  name: "Hoá đơn bán", webhookUrl: "https://script.google.com/macros/s/AKfy/exec", title: "", signerName: "", phone: "", qrImage: "",
  showCompanyInfo: true, footerNote: "", isActive: true, secretAction: "keep", ...over,
});
const info = (over = {}) => ({ name: "Xưởng tôn Đặng Hương", address: "", phone: "", taxCode: "", logo: "", ...over });

beforeEach(async () => {
  await resetDb();
  actor = { userId: (await makeUser()).id, perms: new Set(["company.manage"]) };
});

describe("mã hoá secret", () => {
  it("round-trip, mỗi lần mã hoá khác nhau, sai khoá không giải mã được, ciphertext không chứa plaintext", () => {
    const a = encryptSecret(PLAIN, ENV), b = encryptSecret(PLAIN, ENV);
    expect(a).not.toBe(b);
    expect(a).not.toContain(PLAIN);
    expect(decryptSecret(a, ENV)).toBe(PLAIN);
    expect(() => decryptSecret(a, { AUTH_SECRET: "khac" })).toThrow();
    expect(() => encryptSecret(PLAIN, {})).toThrow(/Thiếu/);
    expect(decryptSecret(encryptSecret(PLAIN, { ...ENV, PRINT_TEMPLATE_KEY: "k2" }), { ...ENV, PRINT_TEMPLATE_KEY: "k2" })).toBe(PLAIN);
  });
});

describe("công ty (singleton id=1)", () => {
  it("getCompany tự hồi phục hàng thiếu, luôn đúng một hàng, kể cả gọi đồng thời", async () => {
    expect(await prisma.companySetting.count()).toBe(0);
    const results = await Promise.all([getCompany(prisma), getCompany(prisma), getCompany(prisma)]);
    expect(results.every((r) => r.name === "Xưởng tôn Đặng Hương")).toBe(true);
    expect(await prisma.companySetting.count()).toBe(1);
  });

  it("thiếu company.manage → 403 trước khi ghi", async () => {
    const viewer: Actor = { userId: actor.userId, perms: new Set() };
    const c = await getCompany(prisma);
    await expect(tx((db) => updateCompany(db, viewer, { section: "info", version: c.version, value: info({ name: "X" }) }, ENV))).rejects.toThrow();
    expect((await getCompany(prisma)).name).toBe("Xưởng tôn Đặng Hương");
  });

  it("sửa thông tin/ngân hàng, audit có giá trị cũ-mới; version cũ bị từ chối (chống ghi đè mù)", async () => {
    const c = await getCompany(prisma);
    const r = await tx((db) => updateCompany(db, actor, { section: "info", version: c.version, value: info({ name: "Đặng Hương 2", phone: "0912345678" }) }, ENV));
    expect(r.version).toBeGreaterThan(c.version);
    await expect(tx((db) => updateCompany(db, actor, { section: "bank", version: c.version, value: { bankName: "VCB", accountNo: "1", accountHolder: "A", branch: "" } }, ENV)))
      .rejects.toMatchObject({ status: 409, code: "STALE" });
    await tx((db) => updateCompany(db, actor, { section: "bank", version: r.version, value: { bankName: "VCB", accountNo: "123", accountHolder: "DANG HUONG", branch: "HCM" } }, ENV));
    const after = await getCompany(prisma);
    expect(after).toMatchObject({ name: "Đặng Hương 2", phone: "0912345678", bank: { bankName: "VCB", accountNo: "123" } });
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "company.update_" } } })).toBe(2);
  });

  it("hai người sửa cùng version đồng thời: một thành công, một 409", async () => {
    const c = await getCompany(prisma);
    const run = (name: string) => tx((db) => updateCompany(db, actor, { section: "info", version: c.version, value: info({ name }) }, ENV));
    const res = await Promise.allSettled([run("A"), run("B")]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(await prisma.companySetting.count()).toBe(1);
  });

  it("ảnh: /uploads/… hợp lệ; https chỉ khi host trong allowlist; đường dẫn lạ/traversal bị schema chặn", async () => {
    const c = await getCompany(prisma);
    const set = (logo: string, env = ENV) => tx((db) => updateCompany(db, actor, { section: "info", version: c.version, value: info({ logo }) }, env));
    await expect(set("https://evil.example/x.png")).rejects.toMatchObject({ status: 409, fields: { logo: expect.any(String) } });
    expect(updateCompanySchema.safeParse({ section: "info", version: 1, value: info({ logo: "/uploads/../etc/passwd" }) }).success).toBe(false);
    expect(updateCompanySchema.safeParse({ section: "info", version: 1, value: info({ logo: "http://x/y.png" }) }).success).toBe(false);
    await expect(set("https://cdn.example.vn/logo.png")).resolves.toBeTruthy();
  });
});

describe("mẫu in — secret không lộ (D-21)", () => {
  it("DTO chỉ có hasSecret, URL đã bỏ query; JSON serialize không chứa plaintext/ciphertext/query-secret", async () => {
    await tx((db) => createPrintTemplate(db, actor, tpl(), ENV));
    const list = await listPrintTemplates(prisma);
    expect(list[0]).toMatchObject({ docType: "SALE_INVOICE", hasSecret: true, webhookUrl: "https://script.google.com/macros/s/AKfy/exec", isActive: true });
    const json = JSON.stringify(list);
    const stored = (await prisma.printTemplate.findFirstOrThrow()).secretCiphertext!;
    for (const bad of [PLAIN, stored, "QUERYSECRET", "secretCiphertext"]) expect(json).not.toContain(bad);
    expect(decryptSecret(stored, ENV)).toBe(PLAIN);
  });

  it("audit không chứa secret, ciphertext, query của URL; đổi secret có audit riêng", async () => {
    const { id } = await tx((db) => createPrintTemplate(db, actor, tpl(), ENV));
    await tx((db) => updatePrintTemplate(db, actor, id, upd({ secretAction: "replace", secret: "NEW-SECRET-VALUE-456" }), ENV));
    const dump = JSON.stringify(await prisma.auditLog.findMany());
    const stored = (await prisma.printTemplate.findUniqueOrThrow({ where: { id } })).secretCiphertext!;
    for (const bad of [PLAIN, "NEW-SECRET-VALUE-456", stored, "QUERYSECRET"]) expect(dump).not.toContain(bad);
    expect((await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action)).toEqual(
      expect.arrayContaining(["print_template.create", "print_template.update", "print_template.secret_replace"]),
    );
  });

  it("PATCH keep/để trống KHÔNG xoá secret hay query của URL; clear mới xoá; replace bắt buộc secret ≥ 8 ký tự", async () => {
    const { id } = await tx((db) => createPrintTemplate(db, actor, tpl(), ENV));
    const before = await prisma.printTemplate.findUniqueOrThrow({ where: { id } });
    await tx((db) => updatePrintTemplate(db, actor, id, upd({ title: "Mới", secret: "" }), ENV));
    const kept = await prisma.printTemplate.findUniqueOrThrow({ where: { id } });
    expect(kept.secretCiphertext).toBe(before.secretCiphertext);
    expect(kept.webhookUrl).toBe(before.webhookUrl); // vẫn còn ?key=… dù form chỉ thấy bản đã bỏ query
    expect(kept.title).toBe("Mới");

    expect(updateTemplateSchema.safeParse({ ...upd(), secretAction: "replace", secret: "short" }).success).toBe(false);
    expect(updateTemplateSchema.safeParse({ ...upd(), secretAction: "replace" }).success).toBe(false);

    await tx((db) => updatePrintTemplate(db, actor, id, upd({ secretAction: "clear", webhookUrl: "" }), ENV));
    const cleared = await prisma.printTemplate.findUniqueOrThrow({ where: { id } });
    expect(cleared).toMatchObject({ secretCiphertext: null, webhookUrl: null });
  });

  it("URL mới khác bản hiển thị thì được thay; webhook http/nội bộ/có tài khoản bị chặn ở schema", async () => {
    const { id } = await tx((db) => createPrintTemplate(db, actor, tpl(), ENV));
    await tx((db) => updatePrintTemplate(db, actor, id, upd({ webhookUrl: "https://hooks.example.com/abc?t=1" }), ENV));
    expect((await prisma.printTemplate.findUniqueOrThrow({ where: { id } })).webhookUrl).toBe("https://hooks.example.com/abc?t=1");
    for (const bad of ["http://x.example.com/a", "https://localhost/a", "https://10.0.0.5/a", "https://192.168.1.2/a", "https://u:p@x.example.com/a", "ftp://x.example.com"]) {
      expect(updateTemplateSchema.safeParse({ ...upd(), webhookUrl: bad }).success, bad).toBe(false);
    }
  });

  it("unique (loại, tên) → 409 tại ô tên; idempotent: cùng key tạo một mẫu; thiếu quyền → 403; docType sai định dạng", async () => {
    await tx((db) => createPrintTemplate(db, actor, tpl(), ENV));
    await expect(tx((db) => createPrintTemplate(db, actor, tpl(), ENV))).rejects.toMatchObject({ status: 409, fields: { name: expect.any(String) } });
    const a = await createPrintTemplateIdempotent(prisma, actor, "k1", tpl({ name: "Khác" }));
    const b = await createPrintTemplateIdempotent(prisma, actor, "k1", tpl({ name: "Khác" }));
    expect(b).toEqual(a);
    expect(await prisma.printTemplate.count()).toBe(2);
    await expect(tx((db) => createPrintTemplate(db, { userId: actor.userId, perms: new Set() }, tpl({ name: "Z" }), ENV))).rejects.toThrow();
    expect(createTemplateSchema.safeParse({ ...tpl(), docType: "hoá đơn" }).success).toBe(false);
    expect(stripUrlQuery("https://a.b/c?d=1#e")).toBe("https://a.b/c");
    expect(stripUrlQuery("không phải url")).toBe("");
  });
});
