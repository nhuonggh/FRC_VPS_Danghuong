import { confirm } from "@/lib/confirm-store";

/**
 * Sổ đăng ký "đang có dữ liệu chưa lưu": form/section đang sửa đăng ký một hàm đọc trạng thái dirty mới nhất.
 * Điều hướng trong ứng dụng (tab module, sidebar, card chức năng) hỏi sổ này TRƯỚC khi rời trang — Next.js điều hướng
 * client không phát `beforeunload`, nên nếu không có sổ này, bấm sang tab khác sẽ mất dữ liệu đang nhập mà không báo.
 */
const guards = new Set<() => boolean>();
export function registerDirtyGuard(isDirty: () => boolean): () => void { guards.add(isDirty); return () => { guards.delete(isDirty); }; }
export const hasUnsavedChanges = () => [...guards].some((g) => g());
export const DISCARD_NAV_CONFIRM = { title: "Bỏ thay đổi chưa lưu?", description: "Bạn đang nhập dở dữ liệu. Rời khỏi trang này sẽ mất những thay đổi chưa lưu.", confirmLabel: "Rời đi", danger: true } as const;
/** true = được phép rời (không có gì dở, hoặc người dùng đồng ý bỏ). */
export async function confirmLeaveIfDirty(): Promise<boolean> { return !hasUnsavedChanges() || confirm(DISCARD_NAV_CONFIRM); }
