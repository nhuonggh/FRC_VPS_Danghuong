"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(-2).map((w) => w[0]?.toUpperCase()).join("");

export function UserMenu({ fullName, username }: { fullName: string; username: string }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger aria-label={`Tài khoản ${fullName}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-fg-on-accent">
        {initials(fullName)}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-dropdown min-w-52 rounded-md border border-border bg-raised p-1 shadow-md">
          <div className="px-3 py-2">
            <div className="text-sm font-semibold">{fullName}</div>
            <div className="text-xs text-fg-muted">{username}</div>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-[var(--border-default)]" />
          <Dropdown.Item asChild>
            <Link href="/change-password" className="flex h-9 items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover">
              <KeyRound size={16} aria-hidden /> Đổi mật khẩu
            </Link>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => signOut({ callbackUrl: "/login" })}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover"
          >
            <LogOut size={16} aria-hidden /> Đăng xuất
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
