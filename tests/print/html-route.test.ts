import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/print/[docType]/[docId]/html/route";
import { requireActorApi } from "@/server/auth/session";
import { buildHtmlPrint } from "@/server/print/html-document";
import { DomainError } from "@/server/http/errors";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/auth/session", () => ({ requireActorApi: vi.fn() }));
vi.mock("@/server/print/html-document", () => ({ buildHtmlPrint: vi.fn(), renderHtmlPrint: vi.fn(() => "<!doctype html><html lang='vi'>Phiếu</html>") }));
const request = () => new NextRequest("http://localhost/api/print/SALE_INVOICE/1/html?auto=1");
const context = { params: Promise.resolve({ docType: "sale_invoice", docId: "1" }) };
describe("route HTML", () => {
  it("phiếu chứa dữ liệu riêng tư không cache, chỉ chạy script có nonce", async () => {
    const actor = { userId: 1, perms: new Set(["print.use"]) };
    vi.mocked(requireActorApi).mockResolvedValue(actor as never);
    vi.mocked(buildHtmlPrint).mockResolvedValue({} as never);
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'nonce-");
    expect(buildHtmlPrint).toHaveBeenCalledWith({}, actor, "SALE_INVOICE", 1);
  });
  it("chưa đăng nhập trả 401, không trả HTML chứng từ", async () => {
    vi.mocked(requireActorApi).mockRejectedValue(new DomainError("Chưa đăng nhập", 401));
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("<!doctype html>");
  });
});
