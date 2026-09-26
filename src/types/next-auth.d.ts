import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    /** amr: cách phiên được xác thực ("password" | "google") — quyết định có bắt đổi mật khẩu hay không. */
    user: { id: number; name?: string | null; amr?: "password" | "google"; authAt?: number };
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    uid?: number;
    amr?: "password" | "google";
    /** Chỉ phiên Google: ms epoch lúc đăng nhập Google. */
    authAt?: number;
  }
}
