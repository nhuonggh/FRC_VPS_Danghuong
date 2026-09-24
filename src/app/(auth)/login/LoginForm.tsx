"use client";

import { Eye, EyeOff } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { safeCallbackUrl } from "@/lib/safe-callback";

// Sai tên hay sai mật khẩu đều CredentialsSignin → một thông báo chung (không lộ tài khoản có tồn tại hay không)
const MESSAGES: Record<string, string> = {
  CredentialsSignin: "Tên đăng nhập hoặc mật khẩu không đúng.",
  LOCKED: "Tài khoản đã bị khóa. Liên hệ giám đốc để mở khóa.",
};

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false); // chặn Enter/bấm đúp kể cả trước khi state `pending` kịp cập nhật
  const [errors, setErrors] = useState<{ username?: string; password?: string; form?: string }>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const next = {
      username: username.trim() ? undefined : "Nhập tên đăng nhập.",
      password: password ? undefined : "Nhập mật khẩu.",
    };
    setErrors(next);
    if (next.username || next.password) return;

    busy.current = true;
    setPending(true);
    let ok = false;
    try {
      const res = await signIn("credentials", { username: username.trim(), password, redirect: false });
      if (!res || res.error || res.ok === false) {
        setErrors({ form: MESSAGES[res?.error ?? ""] ?? "Không đăng nhập được, vui lòng thử lại." });
        return;
      }
      ok = true;
      router.replace(safeCallbackUrl(callbackUrl));
      router.refresh();
    } catch {
      setErrors({ form: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại." });
    } finally {
      // Thành công: giữ nút khoá cho tới khi trang chuyển đi (tránh đăng nhập lần 2 trong lúc điều hướng)
      if (!ok) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  const field = "h-11 w-full rounded-sm border bg-canvas px-3 text-sm hover:border-border-strong";
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.form && (
        <div role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.form}</div>
      )}
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">Tên đăng nhập</label>
        <input id="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)}
          aria-invalid={!!errors.username} aria-describedby={errors.username ? "username-error" : undefined}
          className={`${field} ${errors.username ? "border-danger" : "border-border"}`} />
        {errors.username && <p id="username-error" className="mt-1 text-xs text-danger">{errors.username}</p>}
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">Mật khẩu</label>
        <div className="relative">
          <input id="password" type={show ? "text" : "password"} autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error" : undefined}
            className={`${field} pr-11 ${errors.password ? "border-danger" : "border-border"}`} />
          <button type="button" aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"} onClick={() => setShow((s) => !s)}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-fg-muted hover:text-fg">
            {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        </div>
        {errors.password && <p id="password-error" className="mt-1 text-xs text-danger">{errors.password}</p>}
      </div>
      <button type="submit" disabled={pending} className="h-11 w-full rounded-sm bg-accent text-sm font-medium text-fg-on-accent disabled:opacity-60">
        {pending ? "Đang đăng nhập" : "Đăng nhập"}
      </button>
    </form>
  );
}
