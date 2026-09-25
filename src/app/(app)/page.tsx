import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { APP_NAV } from "@/config/app.config";
import { greeting } from "@/lib/greeting";
import { buildNav } from "@/lib/nav";
import { requireActor } from "@/server/auth/session";

export const dynamic = "force-dynamic"; // lời chào phụ thuộc giờ hiện tại

/**
 * Trang chủ = Level 0 (chọn module). Chỉ liệt kê module mà tài khoản được vào (buildNav ẩn hẳn module rỗng).
 * Số liệu trong ngày (mã 7) chưa có: plan 03-B7 bổ sung — KHÔNG hiển thị số giả.
 */
export default async function HomePage() {
  const actor = await requireActor(); // layout không đủ (xem ghi chú trong layout.tsx)
  const modules = buildNav(APP_NAV, actor.perms).filter((m) => m.type === "accordion");
  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">
        {greeting(new Date())}, {actor.fullName}
      </h1>
      {modules.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-fg-muted">
          Tài khoản của bạn chưa được cấp quyền vào chức năng nào. Liên hệ giám đốc để được cấp quyền.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {modules.map((m) => (
            <Link
              key={m.key}
              href={`/m/${m.key}`}
              className="flex min-h-28 items-center gap-4 rounded-md border border-border bg-surface p-5 transition-shadow duration-150 ease-standard hover:shadow-md"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon name={m.icon} size={24} />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold">{m.label}</span>
                <span className="text-sm text-fg-secondary">
                  {m.categories.flatMap((c) => c.functions).length} chức năng
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
