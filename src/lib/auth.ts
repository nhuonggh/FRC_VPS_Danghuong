import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyCredentials } from "@/server/auth/credentials";

export const authOptions: NextAuthOptions = {
  // Gán rõ AUTH_SECRET (pitfalls mục 4): next-auth v4 không tự đọc tên biến này
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // 12 giờ = 1 ca làm việc
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: { username: {}, password: {} },
      async authorize(creds) {
        const r = await verifyCredentials(prisma, creds?.username ?? "", creds?.password ?? "");
        if (r.ok) return { id: String(r.user.id), name: r.user.fullName };
        if (r.reason === "LOCKED") throw new Error("LOCKED"); // login page đọc ?error=LOCKED
        return null;
      },
    }),
  ],
  callbacks: {
    // JWT chỉ giữ id — quyền đọc từ DB mỗi request (loadActor)
    jwt({ token, user }) {
      if (user) token.uid = Number(user.id);
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.uid as number;
      return session;
    },
  },
};
