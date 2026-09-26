/**
 * Mã lỗi đăng nhập (next-auth v4 + mã riêng của dự án) → thông báo tiếng Việt cho trang /login.
 * Không bao giờ hiển thị nguyên văn mã/chi tiết kỹ thuật: mã lạ → thông báo chung.
 * Dùng cho cả `res.error` của signIn("credentials") lẫn `?error=` trên URL (lỗi OAuth Google, pages.error = /login).
 */
const GENERIC = "Không đăng nhập được, vui lòng thử lại.";
const GOOGLE_FAILED = "Đăng nhập bằng Google không thành công. Vui lòng thử lại.";

const MESSAGES: Record<string, string> = {
  // Sai tên hay sai mật khẩu đều CredentialsSignin → một thông báo chung (không lộ tài khoản có tồn tại hay không)
  CredentialsSignin: "Tên đăng nhập hoặc mật khẩu không đúng.",
  LOCKED: "Tài khoản đã bị khóa. Liên hệ giám đốc để mở khóa.",
  // Google: không có user khớp email / email chưa xác minh / tài khoản bị khoá → MỘT thông báo (không lộ lý do)
  GoogleNotAllowed: "Tài khoản Google này chưa được cấp quyền vào hệ thống. Liên hệ quản trị viên.",
  AccessDenied: "Tài khoản Google này chưa được cấp quyền vào hệ thống. Liên hệ quản trị viên.",
  OAuthSignin: GOOGLE_FAILED,
  OAuthCallback: GOOGLE_FAILED,
  OAuthCreateAccount: GOOGLE_FAILED,
  OAuthAccountNotLinked: GOOGLE_FAILED,
  Callback: GOOGLE_FAILED,
  Configuration: "Hệ thống đăng nhập đang gặp sự cố cấu hình. Liên hệ quản trị viên.",
  Verification: GENERIC,
  SessionRequired: "Vui lòng đăng nhập để tiếp tục.",
  Default: GENERIC,
};

/** Thông báo cho một mã lỗi; không có mã → null (không hiện banner). */
export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(MESSAGES, code) ? MESSAGES[code]! : GENERIC;
}
