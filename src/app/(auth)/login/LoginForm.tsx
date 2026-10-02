"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle, Lock, User } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { loginErrorMessage } from "@/lib/auth-errors";
import { safeCallbackUrl } from "@/lib/safe-callback";

/**
 * `googleEnabled`: server tự suy ra (có đủ GOOGLE_CLIENT_ID + SECRET) — client KHÔNG bao giờ nhận client id/secret.
 * `error`: mã `?error=` trên URL (lỗi OAuth Google chuyển về /login) — dịch qua loginErrorMessage, không in nguyên mã.
 */
export function LoginForm({
  callbackUrl, error, googleEnabled = false,
}: { callbackUrl?: string; error?: string; googleEnabled?: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const busy = useRef(false); // chặn Enter/bấm đúp kể cả trước khi state `pending` kịp cập nhật
  const [errors, setErrors] = useState<{ username?: string; password?: string; form?: string }>(() => {
    const form = loginErrorMessage(error);
    return form ? { form } : {};
  });

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
        // Sai tên hay sai mật khẩu đều CredentialsSignin → một thông báo chung (không lộ tài khoản có tồn tại hay không)
        setErrors({ form: loginErrorMessage(res?.error || "Default")! });
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

  async function onGoogle() {
    if (busy.current) return;
    busy.current = true;
    setGooglePending(true);
    setErrors({});
    try {
      // Trình duyệt chuyển sang Google (redirect mặc định) → giữ nút khoá cho tới khi rời trang.
      // callbackUrl chỉ nhận đường dẫn nội bộ; server chặn thêm lớp nữa (callback `redirect` cùng origin).
      await signIn("google", { callbackUrl: safeCallbackUrl(callbackUrl) });
    } catch {
      busy.current = false;
      setGooglePending(false);
      setErrors({ form: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại." });
    }
  }

  const locked = pending || googlePending;
  const [forgot, setForgot] = useState(false);
  // Ô nhập có icon dẫn đầu (mẫu đăng nhập Thập Thảo); nhãn thật vẫn có cho trình đọc màn hình (sr-only).
  const field = "h-12 w-full rounded-md border bg-canvas pl-11 pr-3 text-sm placeholder:text-fg-muted hover:border-border-strong";
  const icon = "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-fg-secondary";
  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.form && (
          <div role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">{errors.form}</div>
        )}
        <div>
          <label htmlFor="username" className="sr-only">Tên đăng nhập</label>
          <div className="relative">
            <User size={18} aria-hidden className={icon} />
            <input id="username" placeholder="Tên đăng nhập" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)}
              aria-invalid={!!errors.username} aria-describedby={errors.username ? "username-error" : undefined}
              className={`${field} ${errors.username ? "border-danger" : "border-border"}`} />
          </div>
          {errors.username && <p id="username-error" className="mt-1 text-xs text-danger">{errors.username}</p>}
        </div>
        <div>
          <label htmlFor="password" className="sr-only">Mật khẩu</label>
          <div className="relative">
            <Lock size={18} aria-hidden className={icon} />
            <input id="password" placeholder="Mật khẩu" type={show ? "text" : "password"} autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error" : undefined}
              className={`${field} pr-12 ${errors.password ? "border-danger" : "border-border"}`} />
            <button type="button" aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"} onClick={() => setShow((v) => !v)}
              className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-fg-secondary hover:text-fg">
              {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          </div>
          {errors.password && <p id="password-error" className="mt-1 text-xs text-danger">{errors.password}</p>}
        </div>
        {/* Hệ thống không có tự đặt lại mật khẩu: quản trị cấp mật khẩu tạm (Người dùng → Cấp lại mật khẩu). */}
        <div className="flex justify-end">
          <button type="button" aria-expanded={forgot} onClick={() => setForgot((v) => !v)} className="text-sm font-medium text-accent hover:underline">Quên mật khẩu?</button>
        </div>
        {forgot && <p role="status" className="rounded-sm bg-accent-soft p-3 text-sm text-fg-secondary">Hãy liên hệ quản trị viên để được cấp lại mật khẩu tạm. Nếu tài khoản có email Google, bạn có thể đăng nhập bằng Google bên dưới.</p>}
        <button type="submit" disabled={locked} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-semibold text-fg-on-accent hover:bg-accent-600 disabled:opacity-60">
          {pending ? "Đang đăng nhập" : <>Đăng nhập<ArrowRight size={18} aria-hidden /></>}
        </button>
      </form>
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-sm text-fg-secondary">
            <span className="h-px flex-1 bg-border" aria-hidden />
            <span>hoặc</span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
          {/* Nút phụ (outline), không dùng logo thương hiệu (giữ kỷ luật token màu), cao ≥ 44px */}
          <button type="button" onClick={() => void onGoogle()} disabled={locked} aria-busy={googlePending}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm font-medium text-fg hover:bg-hover disabled:opacity-60">
            {googlePending && <LoaderCircle size={16} aria-hidden className="animate-spin motion-reduce:animate-none" />}
            {googlePending ? "Đang chuyển tới Google" : "Đăng nhập bằng Google"}
          </button>
        </>
      )}
    </div>
  );
}
