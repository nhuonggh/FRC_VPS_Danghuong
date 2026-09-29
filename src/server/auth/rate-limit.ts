/**
 * Chống dò mật khẩu đăng nhập (Credentials). Bộ đếm nằm trong bộ nhớ tiến trình: dự án chạy MỘT container app
 * nên đủ dùng; khởi động lại thì bộ đếm về 0 (chấp nhận). Không thay thế khoá tài khoản của giám đốc.
 *
 * Hai lớp: theo (IP + tên đăng nhập) chặn dò một tài khoản; theo IP chặn quét nhiều tài khoản.
 * Chỉ đếm lần SAI; đăng nhập đúng xoá bộ đếm của cặp (IP + tên đăng nhập).
 */
export type RateLimitConfig = { windowMs: number; maxPerAccount: number; maxPerIp: number };

export const LOGIN_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, maxPerAccount: 8, maxPerIp: 40 };

const MAX_KEYS = 10_000; // trần bộ nhớ: quá thì dọn mục hết hạn, vẫn quá thì xoá mục cũ nhất

export function createLoginLimiter(cfg: RateLimitConfig = LOGIN_RATE_LIMIT, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();

  const recent = (key: string): number[] => {
    const cutoff = now() - cfg.windowMs;
    const list = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  };
  const accountKey = (ip: string, username: string) => `a|${ip}|${username}`;
  const ipKey = (ip: string) => `i|${ip}`;

  function prune() {
    if (hits.size <= MAX_KEYS) return;
    for (const k of [...hits.keys()]) recent(k);
    while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value as string);
  }

  return {
    /** true = đang bị chặn (chưa được thử tiếp). */
    isBlocked(ip: string, username: string): boolean {
      return recent(accountKey(ip, username)).length >= cfg.maxPerAccount || recent(ipKey(ip)).length >= cfg.maxPerIp;
    },
    recordFailure(ip: string, username: string): void {
      const t = now();
      for (const k of [accountKey(ip, username), ipKey(ip)]) hits.set(k, [...recent(k), t]);
      prune();
    },
    recordSuccess(ip: string, username: string): void {
      hits.delete(accountKey(ip, username));
    },
    reset(): void {
      hits.clear();
    },
  };
}

export const loginLimiter = createLoginLimiter();

/**
 * IP client phía sau Caddy. Caddy đặt `X-Forwarded-For` = IP kết nối thật (không tin giá trị client gửi vào),
 * nên lấy phần tử CUỐI (do proxy gần nhất thêm). Không có header → "unknown" (gộp chung một xô, an toàn hơn là bỏ qua).
 */
export function clientIp(headers: Record<string, string | string[] | undefined> | undefined): string {
  const raw = headers?.["x-forwarded-for"];
  const v = Array.isArray(raw) ? raw.join(",") : raw;
  const last = v?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last ?? "unknown";
}
