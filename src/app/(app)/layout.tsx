import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { emptyPrefs } from "@/lib/workspace";
import { getPreferences } from "@/server/preferences/service";
import { requireActor } from "@/server/auth/session";

/**
 * Layout của mọi trang cần đăng nhập. Tự gọi `requireActor()` (không dựa riêng vào middleware).
 *
 * PHÒNG THỦ NHIỀU LỚP: layout KHÔNG thay thế việc kiểm quyền ở từng trang — Next có thể render
 * page/route handler độc lập với layout (điều hướng phía client, route handler, server action).
 * Vì vậy MỌI page và MỌI route handler vẫn phải tự gọi `requireActor(perm)` / `getActor()`
 * (kèm quyền của chính trang đó); menu chỉ ẩn để gọn giao diện, không phải rào bảo mật.
 *
 * Trang "Đổi mật khẩu" (tài khoản `mustChangePassword`) PHẢI nằm NGOÀI route group `(app)`,
 * nếu không layout này sẽ redirect vào chính nó (vòng lặp).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (actor.mustChangePassword) redirect("/change-password"); // bị bắt đổi mật khẩu trước khi dùng
  const nav = buildNav(APP_NAV, actor.perms);
  const prefs = await getPreferences(prisma, actor.userId).catch(() => emptyPrefs()); // lỗi đọc cấu hình giao diện không được làm hỏng cả trang
  return (
    <AppShell nav={nav} user={{ fullName: actor.fullName, username: actor.username }} prefs={prefs}>
      {children}
    </AppShell>
  );
}
