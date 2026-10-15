"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { confirmLeaveIfDirty, hasUnsavedChanges } from "@/lib/dirty-guard";

/** <Link> hỏi xác nhận khi đang có dữ liệu chưa lưu (xem lib/dirty-guard). Ctrl/Cmd/Shift-click và mở tab mới không bị chặn. */
export function GuardedLink({ onClick, href, ...rest }: ComponentProps<typeof Link>) {
  const router = useRouter();
  async function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === "_blank") return;
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    if (await confirmLeaveIfDirty()) router.push(typeof href === "string" ? href : (href.pathname ?? "/"));
  }
  return <Link href={href} onClick={(e) => void handle(e)} {...rest} />;
}
