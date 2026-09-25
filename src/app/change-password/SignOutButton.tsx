"use client";

import { signOut } from "next-auth/react";
import { useRef, useState } from "react";
import { toast } from "@/lib/toast";

/** Trang đổi mật khẩu nằm NGOÀI khung ứng dụng (không có menu người dùng) → cần lối thoát riêng, kể cả khi bị bắt đổi. */
export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function onClick() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await signOut({ callbackUrl: "/login" });
    } catch {
      toast.error("Không đăng xuất được. Vui lòng thử lại."); // nút được bật lại ở finally
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <button type="button" onClick={() => void onClick()} disabled={pending}
      className="mt-4 h-11 w-full rounded-sm border border-border text-sm font-medium text-fg-secondary hover:bg-hover disabled:opacity-60 md:h-10">
      {pending ? "Đang đăng xuất" : "Đăng xuất"}
    </button>
  );
}
