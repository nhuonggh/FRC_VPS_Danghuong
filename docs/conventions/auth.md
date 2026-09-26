# Quy ước đăng nhập — Credentials + Google

> **D-1 đã được thay (2026-09-26):** master plan chốt "Auth = Credentials, không Google OAuth". Chủ dự án đổi ý: giữ
> nguyên Credentials (admin khởi tạo + dự phòng) và **thêm** Google. Các plan 01a/01b/01c vẫn mô tả D-1 gốc — tài liệu này
> là nguồn sự thật cho phần đăng nhập. Hạ tầng: `docs/infra/RUNBOOK.md` mục 13; xác minh: `docs/infra/VERIFY.md`.

## Mô hình

| | Tên/mật khẩu (Credentials) | Google |
|---|---|---|
| Luôn bật | Có | Chỉ khi đặt ĐỦ `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (`isGoogleConfigured`) |
| Ai vào được | user có mật khẩu đúng, không bị khoá | user đang hoạt động có `users.email` khớp CHÍNH XÁC email Google đã xác minh |
| Tạo tài khoản | Quản trị viên (`user.manage`) | **Không bao giờ** tự tạo — quản trị viên gán email trước |
| JWT | `uid`, `amr="password"`, `name`, `sub` | `uid` (id DB, KHÔNG phải `sub` Google), `amr="google"`, `name`, `sub`=id DB |
| Bắt đổi mật khẩu | Có (khi `mustChangePassword`) | **Không** |

Mã: `src/lib/auth.ts` (`buildAuthOptions`), `src/server/auth/google.ts` (`decideGoogleSignIn`), `src/server/auth/actor.ts`
(`mustChangePasswordApplies`), `src/server/auth/session.ts`.

## Quy tắc Google (bắt buộc)

1. Cho vào **chỉ khi**: `profile.email_verified === true` (boolean, không nhận chuỗi) **và** email (trim + chữ thường) khớp
   chính xác `users.email` của một user **không bị khoá**. Không khớp theo tên, `sub`, hay bất kỳ claim nào khác.
2. Không adapter, không `allowDangerousEmailAccountLinking`, không lưu token Google. `state` + PKCE giữ mặc định của provider.
3. Từ chối (mọi lý do) → `/login?error=GoogleNotAllowed`, **một** thông báo chung (không lộ "không tồn tại" hay "bị khoá").
   Lỗi OAuth khác (`OAuthCallback`, `AccessDenied`, `Configuration`…) → `pages.error = /login`, dịch sang tiếng Việt ở
   `src/lib/auth-errors.ts`; mã lạ → thông báo chung, không in lại mã.
4. Callback `jwt` tra lại user theo email đã xác minh và đặt `uid` = id DB; token dựng mới (bỏ email/ảnh/`sub` Google).
5. Quyền **không** nằm trong JWT: mỗi request `loadActor` đọc lại user + quyền từ DB → khoá tài khoản / đổi quyền / gỡ nhóm
   có hiệu lực ngay cho cả phiên Google. JWT Google còn mang `authAt` (ms lúc đăng nhập Google — không dùng `iat`);
   `loadActor` trả null cho phiên Google khi user không còn email, thiếu `authAt`, hoặc `users.emailChangedAt > authAt`
   → quản trị viên gỡ HOẶC đổi email sang địa chỉ khác thì phiên Google đang mở bị cắt ở request kế tiếp (không thêm truy vấn).
   `emailChangedAt` đặt khi giá trị email thật sự đổi/gỡ (setUserEmail), khi tạo user có email, và khi seed tạo admin có email.
7. Claim email phải là ASCII in được TRƯỚC khi chuẩn hoá (chặn ký tự Unicode bị gập chữ thường thành ASCII như dấu Kelvin).
6. Chuyển hướng: `callbackUrl` phía client qua `safeCallbackUrl` (chỉ đường dẫn nội bộ); phía server callback `redirect`
   (`sameOriginRedirect`) chỉ cho cùng origin.

## `users.email` — chìa khoá đăng nhập Google

- Tuỳ chọn (NULL = không đăng nhập Google). Lưu dạng chuẩn hoá; DB chặn bằng `UNIQUE` + CHECK `users_email_normalized_chk`
  (chữ thường, không khoảng trắng, không rỗng) — migration `20260926090000_user_email`.
- Đặt/đổi/gỡ **chỉ** qua quản trị người dùng (`user.manage`): tạo mới (`POST /api/users`, có Idempotency-Key) hoặc phần
  "Đăng nhập Google" trên trang chi tiết (`PATCH …/section-update`, `section: "email"`). Không có trang tự sửa email.
- Đổi email = trao chìa khoá vào tài khoản → cùng rào với "Cấp lại mật khẩu": không leo thang đặc quyền
  (`assertCanAffectUser` — không gắn email lên tài khoản có quyền cao hơn mình), khoá tư vấn chống TOCTOU, audit
  `user.set_email` với email cũ/mới. Không đổi giá trị → không ghi, không audit.
- Trùng email → 409 `{ error, fields: { email } }` ("Email đã được dùng cho tài khoản khác."), kể cả khi 2 yêu cầu đồng thời
  (bắt P2002 trên cột email).
- Seed: `BOOTSTRAP_ADMIN_EMAIL` chỉ dùng khi seed TẠO `admin`; admin đã tồn tại → bỏ qua (không gán, không khôi phục email đã
  bị gỡ). Chỉ ASCII. Xoá biến sau lần deploy đầu.
- **Rủi ro đã chấp nhận**: người giữ `user.manage` gán được email Google của mình cho tài khoản KHÔNG cao quyền hơn mình rồi
  đăng nhập vào đó — cùng năng lực với "Cấp lại mật khẩu" cho tài khoản đó (đã có từ trước). Bù lại: mọi thay đổi có nhật ký
  `user.set_email` (cũ/mới, người thực hiện), cần rà định kỳ.

## Mật khẩu tạm có hạn

`users.tempPasswordExpiresAt` = bây giờ + `TEMP_PASSWORD_TTL_HOURS` (72) mỗi khi phát mật khẩu tạm: tạo user, "Cấp lại mật
khẩu", seed tạo admin, script cứu hộ `admin:reset`. Tự đổi mật khẩu → NULL. `verifyCredentials` từ chối (cùng lỗi INVALID như
sai mật khẩu — không lộ) khi `mustChangePassword && tempPasswordExpiresAt < now`. Migration backfill hạn cho các tài khoản đang
chờ đổi mật khẩu. Vì vậy người chỉ dùng Google không để lại mật khẩu tạm dùng được mãi. Cứu hộ: RUNBOOK mục 13.

## Bắt đổi mật khẩu (`mustChangePassword`)

`SessionActor.mustChangePassword` là giá trị **có hiệu lực cho phiên**: `cờ DB && amr === "password"`.

- Phiên mật khẩu: như cũ — layout `(app)` chuyển sang `/change-password`, mọi API (trừ đổi mật khẩu) trả 403
  `MUST_CHANGE_PASSWORD`.
- Phiên Google: danh tính do Google chứng minh; người dùng có thể không có/không biết mật khẩu tạm → dùng app bình thường
  (layout + `requireActorApi` thống nhất vì cùng đọc giá trị có hiệu lực). Cờ trong DB giữ nguyên (huy hiệu "Chờ đổi mật
  khẩu" vẫn hiện) — lần đăng nhập bằng mật khẩu kế tiếp vẫn bị bắt đổi. Họ vẫn tự nguyện đổi được (cần mật khẩu hiện tại).
- Phiên cũ không có `amr` (trước khi có Google) → coi là mật khẩu.

## Kiểm thử

`tests/auth/google.test.ts` (thuần), `tests/auth/auth-options.test.ts` (callback signIn/jwt/session/redirect, không mạng,
secret giả không lọt vào JWT/session), `tests/auth/google-session.test.ts` (amr ↔ mustChangePassword, route thật),
`tests/db/user-email.test.ts` (UNIQUE/CHECK/app_rw), `tests/users/email.test.ts`, `tests/api/users-email.test.ts`,
`tests/ui/login-google.test.tsx`, `tests/ui/user-email-ui.test.tsx`, `tests/seed.test.ts` (BOOTSTRAP_ADMIN_EMAIL),
`tests/auth/credentials.test.ts` (mật khẩu tạm hết hạn), `tests/scripts/admin-reset.test.ts` (cứu hộ).
