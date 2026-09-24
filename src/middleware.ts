import { withAuth } from "next-auth/middleware";

// Truyền secret TƯỜNG MINH: middleware next-auth v4 mặc định đọc NEXTAUTH_SECRET, KHÔNG đọc
// AUTH_SECRET; quên dòng này thì mọi trang trả NO_SECRET trên production (pitfalls mục 4).
export default withAuth({
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/login" },
});

export const config = {
  // Mọi route trừ trang đăng nhập, API auth, health, tài nguyên tĩnh
  matcher: ["/((?!login|403|api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
