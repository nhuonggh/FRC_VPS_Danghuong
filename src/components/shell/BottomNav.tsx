"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavModule } from "@/config/app.config";
import { findActiveFunction } from "@/lib/nav";
import { Icon } from "./icons";
import { BOTTOM_NAV_HEIGHT } from "./layout-constants";

const hrefOf = (m: NavModule) => (m.type === "flat" ? m.path! : `/m/${m.key}`);

export function BottomNav({ nav }: { nav: NavModule[] }) {
  const pathname = usePathname();
  const active = findActiveFunction(nav, pathname);
  const [sheet, setSheet] = useState(false);
  const shown = nav.slice(0, 4); // Trang chủ đầu tiên + 3 module hay dùng nhất theo thứ tự nghiệp vụ

  return (
    <nav aria-label="Điều hướng nhanh" className={clsx("fixed inset-x-0 bottom-0 z-sidebar flex border-t border-border bg-surface md:hidden", BOTTOM_NAV_HEIGHT)}>
      {shown.map((m) => {
        const on = active?.module.key === m.key || (m.type === "flat" && pathname === m.path);
        return (
          <Link key={m.key} href={hrefOf(m)} className={clsx("flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs", on ? "text-accent" : "text-fg-secondary")}>
            <Icon name={m.icon} />
            <span className="truncate">{m.label}</span>
          </Link>
        );
      })}
      <Dialog.Root open={sheet} onOpenChange={setSheet}>
        <Dialog.Trigger className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-fg-secondary">
          <Menu size={20} aria-hidden />
          <span>Thêm</span>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-sheet max-h-[80dvh] overflow-y-auto rounded-t-lg border-t border-border bg-raised p-4 shadow-lg">
            <Dialog.Title className="mb-3 text-base font-semibold">Tất cả chức năng</Dialog.Title>
            <Dialog.Description className="sr-only">Danh sách module và chức năng</Dialog.Description>
            {nav.map((m) => (
              <div key={m.key} className="mb-3">
                <Link href={hrefOf(m)} onClick={() => setSheet(false)} className="flex min-h-11 items-center gap-3 text-sm font-semibold">
                  <Icon name={m.icon} />
                  {m.label}
                </Link>
                {m.categories.flatMap((c) => c.functions).map((f) => (
                  <Link key={f.key} href={f.path} onClick={() => setSheet(false)} className="ml-8 flex min-h-11 items-center text-sm text-fg-secondary">
                    {f.label}
                  </Link>
                ))}
              </div>
            ))}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </nav>
  );
}
