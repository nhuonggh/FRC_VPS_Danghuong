/**
 * Chỉ nhận đường dẫn nội bộ tương đối; mọi thứ khác về "/".
 * Ký tự điều khiển (tab/xuống dòng — trình duyệt bỏ chúng khi phân tích URL, "/\t/evil.com" thành "//evil.com")
 * và dấu "\" (trình duyệt coi như "/") bị từ chối ở BẤT KỲ vị trí nào.
 */
export function safeCallbackUrl(raw: string | undefined | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (/[\x00-\x1f\x7f\\]/.test(raw)) return "/";
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) return "/";
  return raw;
}

/**
 * Callback `redirect` của next-auth (mọi chuyển hướng sau đăng nhập/đăng xuất/OAuth): chỉ cho CÙNG origin với `baseUrl`;
 * URL ngoài, giao thức lạ, "//evil.com", ký tự điều khiển hay "\" → về `baseUrl`. Đường dẫn tương đối được nối vào baseUrl.
 */
export function sameOriginRedirect(url: string, baseUrl: string): string {
  try {
    if (/[\x00-\x1f\x7f\\]/.test(url)) return baseUrl;
    const base = new URL(baseUrl);
    const target = new URL(url, base);
    if (target.origin !== base.origin) return baseUrl;
    return target.toString();
  } catch {
    return baseUrl;
  }
}
