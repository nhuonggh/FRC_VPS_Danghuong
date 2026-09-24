"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Copy } from "lucide-react";
import { toast } from "@/lib/toast";

/**
 * Hiện mật khẩu tạm ĐÚNG 1 lần (sau tạo user / cấp lại mật khẩu). Component không giữ mật khẩu trong state riêng:
 * chủ (parent) giữ và PHẢI xoá khi onClose. Khi còn mật khẩu, click ra ngoài / Escape không đóng (bấm nhầm là mất
 * vĩnh viễn) — chỉ nút "Đã ghi lại". Không ghi mật khẩu vào log/toast/storage.
 */
export function TempPasswordDialog({
  open, username, password, onClose,
}: { open: boolean; username: string; password: string | null; onClose: () => void }) {
  async function copy() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password); // clipboard chỉ có ở ngữ cảnh an toàn (HTTPS/localhost)
      toast.success("Đã sao chép mật khẩu.");
    } catch {
      toast.error("Không sao chép được. Hãy chọn mật khẩu và sao chép thủ công.");
    }
  }
  const lock = (e: Event) => { if (password) e.preventDefault(); };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content onInteractOutside={lock} onEscapeKeyDown={lock}
          className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Mật khẩu tạm của {username}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-fg-secondary">
            {password
              ? "Chỉ hiển thị MỘT lần. Gửi cho nhân viên qua kênh riêng; họ sẽ phải đổi mật khẩu ở lần đăng nhập đầu."
              : "Yêu cầu này đã được xử lý trước đó nên không hiển thị lại mật khẩu. Dùng “Cấp lại mật khẩu” nếu cần mật khẩu mới."}
          </Dialog.Description>
          {password && (
            <div className="mt-4 flex items-center justify-between gap-2 rounded-sm border border-border bg-canvas p-3">
              <code className="select-all break-all font-mono text-base tracking-wide">{password}</code>
              <button type="button" aria-label="Sao chép mật khẩu" onClick={() => void copy()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm hover:bg-hover md:h-9 md:w-9">
                <Copy size={16} aria-hidden />
              </button>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={onClose} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10">
              Đã ghi lại
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
