"use client";

import { useCallback, useState } from "react";

/**
 * 1 khoá cho MỖI lần mở form: bấm 2 lần / retry mạng gửi CÙNG khoá → server chỉ thực thi 1 lần.
 * Gọi reset() sau khi tạo thành công (nếu form còn dùng tiếp để tạo bản ghi khác).
 * Lưu bằng state (không phải ref) để sau reset() lần render kế tiếp trả khoá mới, không bị closure cũ giữ khoá cũ.
 */
export function useIdempotencyKey(): { key: string; reset: () => void } {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const reset = useCallback(() => setKey(crypto.randomUUID()), []);
  return { key, reset };
}
