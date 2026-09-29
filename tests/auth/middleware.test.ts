import { NextRequest, type NextFetchEvent } from "next/server";
import { encode } from "next-auth/jwt";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { afterEach, describe, expect, it, vi } from "vitest";
import middleware, { config } from "@/middleware";

// Regex thật mà Next dựng từ matcher (cùng hàm Next dùng lúc build), không tự viết lại regex trong test.
const matcher = new RegExp(tryToParsePath(config.matcher[0]!).regexStr!);
const isProtected = (path: string) => matcher.test(path);

describe("middleware matcher — đường dẫn nào được bảo vệ", () => {
  const PROTECTED = [
    "/", "/system/users", "/system/users/12", "/m/sales", "/change-password",
    "/api/users", "/api/users/3/lock", "/api/account/change-password", "/api/roles",
    "/loginx", "/login-admin", "/403x", "/403-old", "/api/authx", "/api/auth-other", "/api/healthz", "/api/health-check",
    "/favicon.icox", "/faviconxico", "/_nextfoo", "/_next/data/abc.json",
    "/api/report.png", "/api/files/logo.svg", // đuôi ảnh dưới /api/ vẫn cần đăng nhập
    "/system/users.png/edit", "/png",
  ];
  const EXEMPT = [
    "/login", "/login/", "/login/forgot", "/403", "/403/x",
    "/api/auth/session", "/api/auth/callback/credentials", "/api/auth", "/api/health", "/api/health/",
    "/_next/static/chunks/main.js", "/_next/image", "/_next/image/x",
    "/favicon.ico",
    "/logo.png", "/logo.svg", "/images/logo.webp", "/img/a/b/photo.jpg", "/fonts/inter.woff2", "/robots.txt", "/site.webmanifest",
  ];

  it.each(PROTECTED)("BẢO VỆ %s", (p) => expect(isProtected(p)).toBe(true));
  it.each(EXEMPT)("MIỄN %s", (p) => expect(isProtected(p)).toBe(false));
});

// ---- hành vi: 401 JSON cho API, redirect cho trang ----
const SECRET = process.env.AUTH_SECRET!;
const event = {} as NextFetchEvent;
const cookieName = () => (process.env.NEXTAUTH_URL?.startsWith("https://") ? "__Secure-" : "") + "next-auth.session-token";
const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers });
async function authedHeaders() {
  const jwt = await encode({ token: { uid: 1 }, secret: SECRET });
  return { cookie: `${cookieName()}=${jwt}` };
}

// withAuth trả undefined khi cho đi tiếp; các test 401/307 luôn nhận Response
const call = (req: NextRequest) => middleware(req, event) as Promise<Response>;

afterEach(() => vi.unstubAllEnvs());

describe("middleware — chưa đăng nhập", () => {
  it("API → 401 JSON tiếng Việt, KHÔNG redirect", async () => {
    const r = await call(request("/api/users"));
    expect(r.status).toBe(401);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect((await r.json()).error).toMatch(/hết hạn/);
  });

  it.each(["/api/users/3/lock", "/api/account/change-password", "/api/roles/1"])("API lồng nhau %s → 401", async (p) => {
    expect((await call(request(p))).status).toBe(401);
  });

  it("API với cookie phiên hỏng/giả → 401", async () => {
    const r = await call(request("/api/users", { cookie: `${cookieName()}=khong-phai-jwt` }));
    expect(r.status).toBe(401);
  });

  it("API với JWT ký bằng secret khác → 401", async () => {
    const jwt = await encode({ token: { uid: 1 }, secret: "secret-khac-hoan-toan-32-ky-tu-tro-len!!" });
    expect((await call(request("/api/users", { cookie: `${cookieName()}=${jwt}` }))).status).toBe(401);
  });

  it("trang HTML → 307 sang /login kèm callbackUrl (giữ hành vi cũ)", async () => {
    const r = await call(request("/system/users?page=2"));
    expect(r.status).toBe(307);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("callbackUrl")).toBe("/system/users?page=2");
  });

  it("thiếu AUTH_SECRET → API bị từ chối (fail closed), không lộ chi tiết", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call(request("/api/users", await authedHeaders()));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/AUTH_SECRET/);
    spy.mockRestore();
  });
});

describe("middleware — đã đăng nhập", () => {
  it("API với JWT hợp lệ → cho đi tiếp", async () => {
    const r = await call(request("/api/users", await authedHeaders()));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-middleware-next")).toBe("1");
  });

  it("trang với JWT hợp lệ → cho đi tiếp", async () => {
    const r = (await middleware(request("/system/users", await authedHeaders()), event)) as Response | undefined;
    // withAuth trả undefined = "đi tiếp"; điều cần ghim là KHÔNG bị redirect/chặn
    expect(r?.headers.get("location") ?? null).toBeNull();
    expect(r?.status ?? 200).toBe(200);
  });
});

describe("middleware — kiểm Origin cho API ghi", () => {
  const write = (method: string, headers: Record<string, string>) =>
    new NextRequest("http://localhost/api/users", { method, headers: { host: "localhost", ...headers } });

  it("POST từ Origin khác host → 403 (kể cả đã đăng nhập)", async () => {
    const r = await call(write("POST", { origin: "https://evil.example", ...(await authedHeaders()) }));
    expect(r.status).toBe(403);
  });
  it("Origin 'null' hoặc hỏng → 403", async () => {
    expect((await call(write("DELETE", { origin: "null" }))).status).toBe(403);
  });
  it("không Origin nhưng Sec-Fetch-Site cross-site → 403", async () => {
    expect((await call(write("PATCH", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
  it("cùng Origin → đi tiếp tới kiểm phiên (401 khi chưa đăng nhập, không phải 403)", async () => {
    expect((await call(write("POST", { origin: "http://localhost" }))).status).toBe(401);
  });
  it("cùng Origin + đã đăng nhập → cho qua", async () => {
    const r = await call(write("POST", { origin: "http://localhost", ...(await authedHeaders()) }));
    expect(r.status).toBe(200);
  });
  it("GET từ Origin khác không bị chặn bởi kiểm Origin", async () => {
    const r = await call(write("GET", { origin: "https://evil.example" }));
    expect(r.status).toBe(401);
  });
});
