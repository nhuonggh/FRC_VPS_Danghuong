import { redirect } from "next/navigation";
import { COMPANY_NAME } from "@/lib/version";
import { isGoogleConfigured } from "@/server/auth/google";
import { getActor } from "@/server/auth/session";
import { LoginForm } from "./LoginForm";

type Search = { callbackUrl?: string | string[]; error?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Trang công khai có chủ đích (không requireActor): đã đăng nhập thì về trang chủ.
// Cũng là pages.error của next-auth: lỗi OAuth Google về đây kèm ?error=… (LoginForm dịch sang tiếng Việt).
export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (await getActor()) redirect("/");
  const { callbackUrl, error } = await searchParams;
  return (
    <main className="relative flex min-h-dvh items-end justify-center overflow-hidden bg-canvas p-4 pb-10 sm:items-center lg:justify-end lg:pr-[7vw]">
      {/* Ảnh nền thương hiệu (public/login-bg.webp). Chữ/logo đã nằm trong ảnh nên chỉ để trang trí (alt rỗng). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/login-bg.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-[28%_top] sm:object-[25%_center]" />
      <section className="relative z-10 w-full max-w-[440px] rounded-2xl border border-border bg-surface/95 p-7 shadow-xl backdrop-blur sm:p-9">
        <h1 className="mb-1 text-3xl font-bold">Đăng nhập</h1>
        <p className="mb-7 text-base text-fg-secondary">Chào mừng bạn quay trở lại</p>
        {/* googleEnabled chỉ là boolean suy ra ở server — client id/secret không bao giờ rời server */}
        <LoginForm callbackUrl={first(callbackUrl)} error={first(error)} googleEnabled={isGoogleConfigured()} />
      </section>
      <p className="absolute bottom-4 left-5 z-10 hidden text-xs text-fg-secondary sm:block">© {new Date().getFullYear()} {COMPANY_NAME}. Tất cả quyền được bảo lưu.</p>
    </main>
  );
}
