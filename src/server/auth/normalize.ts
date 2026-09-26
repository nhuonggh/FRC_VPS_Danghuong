/** bcrypt chỉ dùng 72 byte đầu của mật khẩu; phần sau bị bỏ qua một cách im lặng. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Chuẩn hoá Unicode về NFC: chữ có dấu tiếng Việt gõ bằng bàn phím/điện thoại khác nhau có thể ra dạng
 * dựng sẵn (NFC) hoặc tổ hợp (NFD). Chuẩn hoá ở CẢ đường băm lẫn đường kiểm để cùng một mật khẩu
 * luôn khớp nhau. Mật khẩu ASCII không đổi nên hash cũ vẫn hợp lệ.
 */
export const normalizePassword = (plain: string): string => plain.normalize("NFC");

export const passwordByteLength = (plain: string): number => Buffer.byteLength(normalizePassword(plain), "utf8");

/**
 * Email (khoá khớp đăng nhập Google): NFC + bỏ khoảng trắng đầu/cuối + chữ thường. Dùng cho cả lưu (users.email,
 * CHECK users_email_normalized_chk) lẫn tra cứu từ hồ sơ Google — hai phía luôn cùng một dạng.
 */
export const normalizeEmail = (email: string): string => email.normalize("NFC").trim().toLowerCase();

/**
 * Kiểm định dạng email tối thiểu (1 "@", có miền có dấu chấm, không khoảng trắng, ≤ 254 ký tự) — cho seed chạy trong
 * image migrator (không có zod). Form/API dùng zod `emailSchema` (chặt hơn).
 */
export const looksLikeEmail = (email: string): boolean =>
  email.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);

/** Tên đăng nhập: NFC + bỏ khoảng trắng đầu/cuối + chữ thường. Dùng cho cả tạo user lẫn đăng nhập. */
export const normalizeUsername = (username: string): string => username.normalize("NFC").trim().toLowerCase();
