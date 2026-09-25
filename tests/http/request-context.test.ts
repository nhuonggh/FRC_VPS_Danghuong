import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { writeAudit } from "@/server/audit/write";
import { apiHandler } from "@/server/http/handler";
import { clientIpFromHeaders, currentRequestIp, runWithRequestContext } from "@/server/http/request-context";
import { prisma, resetDb } from "../helpers/db";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIpFromHeaders", () => {
  it("lấy hop ĐẦU của X-Forwarded-For (bỏ khoảng trắng)", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.2" }))).toBe("203.0.113.7");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "2001:db8::1, 10.0.0.2" }))).toBe("2001:db8::1");
  });

  it("không có X-Forwarded-For → X-Real-IP; không có gì → null", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIpFromHeaders(h({}))).toBeNull();
  });

  it("chuẩn hoá cổng / IPv4-mapped; giá trị không phải IP → null (không ghi chuỗi tuỳ ý vào audit)", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.7:5123" }))).toBe("203.0.113.7");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "::ffff:192.0.2.9" }))).toBe("192.0.2.9");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "<script>" }))).toBeNull();
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "unknown, 1.2.3.4" }))).toBeNull();
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1".repeat(100) }))).toBeNull();
  });
});

describe("ngữ cảnh request → IP trong nhật ký", () => {
  beforeEach(resetDb);

  it("ngoài request → null; trong runWithRequestContext → IP đó", () => {
    expect(currentRequestIp()).toBeNull();
    expect(runWithRequestContext({ ip: "192.0.2.1" }, () => currentRequestIp())).toBe("192.0.2.1");
  });

  it("apiHandler đặt IP từ header ⇒ writeAudit trong service tự ghi IP (không phải truyền tay)", async () => {
    const handler = apiHandler(async () => {
      await writeAudit(prisma, { userId: 1, action: "x.test", entity: "E" });
      return { ok: true };
    });
    const req = new NextRequest("http://localhost/api/x", { method: "POST", headers: { "x-forwarded-for": "203.0.113.50, 172.18.0.2" } });
    expect((await handler(req, undefined)).status).toBe(200);
    expect((await prisma.auditLog.findFirstOrThrow()).ip).toBe("203.0.113.50");
  });

  it("ip truyền tường minh thắng ngữ cảnh; ngoài request → null", async () => {
    await runWithRequestContext({ ip: "192.0.2.1" }, () => writeAudit(prisma, { userId: 1, action: "a", entity: "E", ip: "198.51.100.1" }));
    await writeAudit(prisma, { userId: 1, action: "b", entity: "E" });
    const rows = await prisma.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((r) => r.ip)).toEqual(["198.51.100.1", null]);
  });
});
