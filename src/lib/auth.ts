import type { PrismaClient } from "@prisma/client";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { sameOriginRedirect } from "@/lib/safe-callback";
import { verifyCredentials } from "@/server/auth/credentials";
import {
  GOOGLE_DENY_REDIRECT, GOOGLE_NOT_ALLOWED, decideGoogleSignIn, isGoogleConfigured, prismaEmailLookup, toAuthMethod,
} from "@/server/auth/google";

type Env = Record<string, string | undefined>;

/**
 * Dựng cấu hình next-auth. `env`/`db` chỉ tiêm để test (production: process.env + prisma).
 *
 * - Credentials: luôn có (admin khởi tạo + dự phòng).
 * - Google: CHỈ đăng ký khi có đủ GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. Không adapter, không
 *   allowDangerousEmailAccountLinking; state + PKCE giữ mặc định của provider. Quyết định cho vào: decideGoogleSignIn.
 * - JWT chỉ giữ `uid` (id user trong DB) + `amr` (cách xác thực) + `name`; quyền đọc lại từ DB mỗi request (loadActor).
 */
export function buildAuthOptions(env: Env = process.env, db: PrismaClient = prisma): NextAuthOptions {
  const lookup = prismaEmailLookup(db);
  const providers: NextAuthOptions["providers"] = [
    CredentialsProvider({
      name: "credentials",
      credentials: { username: {}, password: {} },
      async authorize(creds) {
        const r = await verifyCredentials(db, creds?.username ?? "", creds?.password ?? "");
        if (r.ok) return { id: String(r.user.id), name: r.user.fullName };
        if (r.reason === "LOCKED") throw new Error("LOCKED"); // login page đọc ?error=LOCKED
        return null;
      },
    }),
  ];
  if (isGoogleConfigured(env)) {
    providers.push(GoogleProvider({ clientId: env.GOOGLE_CLIENT_ID!.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET!.trim() }));
  }

  return {
    // Gán rõ AUTH_SECRET (pitfalls mục 4): next-auth v4 không tự đọc tên biến này
    secret: env.AUTH_SECRET,
    session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // 12 giờ = 1 ca làm việc
    // Lỗi OAuth (OAuthCallback, AccessDenied, Configuration…) về /login?error=… — trang login dịch sang tiếng Việt
    pages: { signIn: "/login", error: "/login" },
    providers,
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== "google") return true; // Credentials đã tự kiểm trong authorize
        const d = await decideGoogleSignIn(profile as Record<string, unknown> | undefined, lookup);
        return d.ok ? true : GOOGLE_DENY_REDIRECT;
      },
      async jwt({ token, user, account, profile }) {
        if (account?.provider === "google") {
          // Tra lại từ DB theo email ĐÃ xác minh — KHÔNG dùng user.id/sub của Google làm uid.
          const d = await decideGoogleSignIn(profile as Record<string, unknown> | undefined, lookup);
          if (!d.ok) throw new Error(GOOGLE_NOT_ALLOWED); // phòng thủ lớp 2 (signIn đã chặn)
          // Token mới tinh: bỏ email/ảnh/sub của Google, không giữ access/id/refresh token.
          return { name: d.user.fullName, sub: String(d.user.id), uid: d.user.id, amr: "google" };
        }
        if (user) {
          token.uid = Number(user.id);
          token.amr = "password";
        }
        return token;
      },
      session({ session, token }) {
        session.user = { id: token.uid as number, name: token.name ?? null, amr: toAuthMethod(token.amr) };
        return session;
      },
      redirect({ url, baseUrl }) {
        return sameOriginRedirect(url, baseUrl);
      },
    },
  };
}

export const authOptions: NextAuthOptions = buildAuthOptions();
