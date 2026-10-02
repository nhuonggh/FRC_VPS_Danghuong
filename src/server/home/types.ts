import type { PrismaClient } from "@prisma/client";

/** Mô tả một widget số liệu; `run` chỉ được gọi sau khi quyền đã được kiểm (xem `homeWidgets`). */
export interface WidgetSpec {
  key: string;
  label: string;
  href: string;
  format: "count" | "currency";
  tone?: "warning";
  run: (db: PrismaClient) => Promise<number | string>;
}

/** Kết quả một widget: thành công có số thật; lỗi/quá hạn KHÔNG bao giờ được thay bằng 0. */
export type WidgetState = { ok: true; value: number | string } | { ok: false };
