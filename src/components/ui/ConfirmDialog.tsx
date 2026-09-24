"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { useConfirmStore } from "@/lib/confirm-store";

/** Radix Dialog: trap focus, Escape/click ngoài = Hủy (resolve false), khóa scroll, trả focus về trigger. */
export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const close = useConfirmStore((s) => s.close);
  return (
    <Dialog.Root open={!!request} onOpenChange={(o) => { if (!o) close(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">{request?.title}</Dialog.Title>
          <Dialog.Description className={clsx("mt-2 text-sm text-fg-secondary", !request?.description && "sr-only")}>
            {request?.description ?? request?.title}
          </Dialog.Description>
          {/* Hủy đứng TRƯỚC → nhận focus đầu tiên (an toàn với hành động phá hủy); thứ tự Hủy-trái/Chính-phải */}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => close(false)} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover md:h-10">
              Hủy
            </button>
            <button type="button" onClick={() => close(true)}
              className={clsx("h-11 rounded-sm px-4 text-sm font-medium text-fg-on-accent md:h-10", request?.danger ? "bg-danger" : "bg-accent")}>
              {request?.confirmLabel ?? "Xác nhận"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
