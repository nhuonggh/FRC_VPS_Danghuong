/** bcrypt chỉ dùng 72 byte đầu của mật khẩu; phần sau bị bỏ qua một cách im lặng. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Chuẩn hoá Unicode về NFC: chữ có dấu tiếng Việt gõ bằng bàn phím/điện thoại khác nhau có thể ra dạng
 * dựng sẵn (NFC) hoặc tổ hợp (NFD). Chuẩn hoá ở CẢ đường băm lẫn đường kiểm để cùng một mật khẩu
 * luôn khớp nhau. Mật khẩu ASCII không đổi nên hash cũ vẫn hợp lệ.
 */
export const normalizePassword = (plain: string): string => plain.normalize("NFC");

export const passwordByteLength = (plain: string): number => Buffer.byteLength(normalizePassword(plain), "utf8");

/** Tên đăng nhập: NFC + bỏ khoảng trắng đầu/cuối + chữ thường. Dùng cho cả tạo user lẫn đăng nhập. */
export const normalizeUsername = (username: string): string => username.normalize("NFC").trim().toLowerCase();
