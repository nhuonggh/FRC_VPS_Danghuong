import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/version";
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
    <main className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-2xl font-semibold">{APP_NAME}</h1>
          <p className="mb-6 text-sm text-fg-secondary">Đăng nhập để tiếp tục.</p>
          {/* googleEnabled chỉ là boolean suy ra ở server — client id/secret không bao giờ rời server */}
          <LoginForm callbackUrl={first(callbackUrl)} error={first(error)} googleEnabled={isGoogleConfigured()} />
        </div>
      </section>
      <aside aria-hidden className="hidden items-end bg-accent p-10 lg:flex">
        <p className="max-w-md text-2xl font-semibold text-fg-on-accent">Đơn hàng — kho — giao hàng — kế toán trên một hệ thống.</p>
      </aside>
    </main>
  );
}
