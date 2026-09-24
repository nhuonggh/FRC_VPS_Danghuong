import { getToken } from "next-auth/jwt";
import { withAuth, type NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Truyền secret TƯỜNG MINH: middleware next-auth v4 mặc định đọc NEXTAUTH_SECRET, KHÔNG đọc
// AUTH_SECRET; quên dòng này thì mọi trang trả NO_SECRET trên production (pitfalls mục 4).
const pageAuth = withAuth({
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/login" },
});

const isApiPath = (pathname: string) => pathname === "/api" || pathname.startsWith("/api/");

/**
 * Trang (HTML) chưa đăng nhập → 307 sang /login (next-auth). API (`/api/*`) chưa đăng nhập → 401 JSON:
 * client `fetch` nhận HTML của trang đăng nhập sau redirect sẽ vỡ khi parse JSON và mất luôn thông báo phiên hết hạn.
 * (`/api/auth/*` và `/api/health` đã bị loại khỏi matcher bên dưới.)
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!isApiPath(req.nextUrl.pathname)) return pageAuth(req as NextRequestWithAuth, event);

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error("[middleware] Thiếu AUTH_SECRET — từ chối mọi API (fail closed).");
    return NextResponse.json({ error: "Cấu hình máy chủ chưa đầy đủ." }, { status: 500 });
  }
  const token = await getToken({ req, secret });
  if (!token) {
    return NextResponse.json({ error: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." }, { status: 401 });
  }
  return NextResponse.next();
}

// Matcher PHẢI là chuỗi literal (Next phân tích tĩnh lúc build). Loại trừ (neo theo ranh giới đoạn đường dẫn):
//  - login, 403, api/auth, api/health: chính xác hoặc kèm "/…", KHÔNG khớp tiền tố (vd /loginx, /api/healthz vẫn được bảo vệ)
//  - _next/static, _next/image, favicon.ico
//  - tệp tĩnh trong public/ (ảnh, font, robots.txt, manifest) — trừ dưới /api/, để logo hiện được trên trang /login
// Test canh bảng đường dẫn: tests/auth/middleware.test.ts
export const config = {
  matcher: [
    "/((?!(?:login|403|api/auth|api/health)(?:/|$)|_next/static|_next/image|favicon\\.ico$|(?!api/).*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|txt|webmanifest)$).*)",
  ],
};
