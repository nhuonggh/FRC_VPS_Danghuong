import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/version";
import { getActor } from "@/server/auth/session";
import { LoginForm } from "./LoginForm";

// Trang công khai có chủ đích (không requireActor): đã đăng nhập thì về trang chủ.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  if (await getActor()) redirect("/");
  const { callbackUrl } = await searchParams;
  return (
    <main className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-2xl font-semibold">{APP_NAME}</h1>
          <p className="mb-6 text-sm text-fg-secondary">Đăng nhập để tiếp tục.</p>
          <LoginForm callbackUrl={Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl} />
        </div>
      </section>
      <aside aria-hidden className="hidden items-end bg-accent p-10 lg:flex">
        <p className="max-w-md text-2xl font-semibold text-fg-on-accent">Đơn hàng — kho — giao hàng — kế toán trên một hệ thống.</p>
      </aside>
    </main>
  );
}
