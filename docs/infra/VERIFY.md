# Xác minh trước khi báo "hoạt động OK" — `dherp`

Build pass / Actions xanh KHÔNG phải bằng chứng. Phải mở trang thật, đăng nhập thật, tạo bản ghi thật.
Lệnh chạy trên VPS bằng user `deploy_dherp` (hoặc root khi ghi chú). Giá trị: [INPUTS.md](INPUTS.md).

## Hạ tầng
- [ ] `docker ps --filter name=dherp_app` — `Up`, image `registry.francophiles.com.vn/dherp:<sha của commit vừa push>`, cổng `127.0.0.1:3004->3000/tcp`
- [ ] `docker inspect --format '{{json .Config.Cmd}} {{.Config.User}}' dherp_app` → `["node","server.js"] nextjs`
- [ ] `docker logs --tail 50 dherp_app` — không lỗi lặp (`NO_SECRET`, `ECONNREFUSED`, `P1001`, `[recompute]`)
- [ ] `curl -fsS http://127.0.0.1:3004/api/health` → `{"status":"ok","db":true,"time":"…"}` (chỉ 3 khoá, không lộ lỗi)
- [ ] `https://dherp.sheetapp.store` mở được, cert hợp lệ; `https://dherp.sheetapp.store/api/health` → 200
- [ ] `docker inspect --format '{{json .NetworkSettings.Networks}}' postgres_dherp` có `pgnet`; `dherp_app` cũng trên `pgnet`
- [ ] `docker exec caddy caddy validate --config /etc/caddy/Caddyfile` → `Valid configuration`

## Database
- [ ] `docker exec postgres_dherp psql -U dherp_user -d dherp_db -c '\dt'` — đủ bảng như `prisma/schema` (27 bảng ở bản GĐ0, gồm `_prisma_migrations`)
- [ ] `select count(*) from permissions` > 0; `roles` = 5 vai trò mẫu; `company_settings` = 1; đúng 1 dòng `periods` có `"isOpen" = true`
- [ ] Đăng nhập psql bằng `app_rw`: `UPDATE audit_log SET action = action;` → `permission denied for table audit_log`
- [ ] Bằng `dherp_user`: `UPDATE audit_log SET action = action;` (khi đã có dòng) → lỗi `audit_log là append-only`

## Auth (Credentials)
- [ ] Đăng nhập `admin` bằng `BOOTSTRAP_ADMIN_PASSWORD` trên trình duyệt THẬT → bị chuyển sang `/change-password`
- [ ] Đổi mật khẩu, đăng xuất, đăng nhập lại bằng mật khẩu mới — vào được
- [ ] Sai mật khẩu → báo lỗi chung (không lộ tài khoản có tồn tại hay không)
- [ ] Tài khoản bị khoá không đăng nhập được
- [ ] Gọi `/api/users` khi chưa đăng nhập → `401` JSON; mở `/` khi chưa đăng nhập → chuyển `/login`

## Auth (Google — chỉ khi đã đặt `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, RUNBOOK mục 13)
- [ ] Chưa đặt 2 biến: `/login` KHÔNG có nút "Đăng nhập bằng Google"; đăng nhập mật khẩu như cũ
- [ ] Đã đặt + tạo lại container: `/login` có nút "Đăng nhập bằng Google" dưới vạch "hoặc"; xem nguồn trang không chứa Client ID/secret
- [ ] Đổi email của một người đang đăng nhập Google sang địa chỉ khác → thao tác kế tiếp của họ bị đăng xuất (401 / về `/login`)
- [ ] Mật khẩu tạm quá 72 giờ không đăng nhập được (báo như sai mật khẩu); "Cấp lại mật khẩu" mở lại; `BOOTSTRAP_ADMIN_EMAIL` đã xoá khỏi `.env.migrate` sau lần deploy đầu
- [ ] `admin` có email (qua `BOOTSTRAP_ADMIN_EMAIL` lúc tạo hoặc giao diện) → đăng nhập Google bằng ĐÚNG email đó trên trình duyệt THẬT → vào `/` (không bị ép sang `/change-password` dù admin còn "Chờ đổi mật khẩu")
- [ ] Tài khoản Google KHÔNG khớp email người dùng nào → quay lại `/login` với "Tài khoản Google này chưa được cấp quyền vào hệ thống. Liên hệ quản trị viên."; bảng `users` không thêm dòng mới
- [ ] Khoá người dùng có email → Google của họ bị từ chối cùng thông báo; phiên Google đang mở bị đăng xuất ở thao tác kế tiếp
- [ ] (email_verified) Chỉ tài khoản Google đã xác minh email mới vào được — kiểm bằng unit test `tests/auth/google.test.ts` (Google thật luôn xác minh Gmail/Workspace; không cần tạo tài khoản chưa xác minh)
- [ ] Đổi email người dùng trên giao diện → Nhật ký thao tác có dòng "user.set_email" với email cũ/mới
- [ ] `https://dherp.sheetapp.store/api/auth/signin?callbackUrl=https://evil.example` rồi đăng nhập → về trang của dherp, không sang evil.example
- [ ] `docker logs dherp_app` không in Client secret, access/id token

## CRUD
- [ ] Tạo 1 người dùng qua UI; reload còn; sửa; khoá/mở khoá
- [ ] Mỗi thao tác trên xuất hiện trong Nhật ký thao tác (giá trị cũ/mới), IP là IP máy khách thật (không phải IP của Caddy)

## CI/CD
- [ ] Push thay đổi nhỏ lên `main` → Actions xanh (test + build + deploy + health probe); app vẫn phản hồi trong lúc deploy
- [ ] Log bước deploy có dòng `Image đang chạy trước deploy (dùng để rollback): …` và `App healthy: …`
- [ ] Thử rollback một lần theo RUNBOOK mục 8 (chạy lại tag sha trước, rồi trả lại bản mới)

## Bảo mật
- [ ] `git log --all -- .env` → rỗng; `git grep -nEi "password|secret"` không có giá trị thật (kể cả `GOOGLE_CLIENT_SECRET`)
- [ ] `stat -c '%a %U %n' /home/deploy_dherp/app/.env /home/deploy_dherp/app/.env.migrate` → cả hai `600 deploy_dherp`
- [ ] `grep -c MIGRATE /home/deploy_dherp/app/.env` → `0`; `grep -c BOOTSTRAP /home/deploy_dherp/app/.env` → `0`
- [ ] `docker exec dherp_app sh -c 'printenv | grep -cE "^(MIGRATE_DATABASE_URL|BOOTSTRAP_ADMIN_PASSWORD)="'` → `0`
- [ ] `BOOTSTRAP_ADMIN_PASSWORD` đã xoá khỏi `.env.migrate` sau lần đăng nhập đầu:
      `grep -c '^BOOTSTRAP_ADMIN_PASSWORD=' /home/deploy_dherp/app/.env.migrate` → `0` (RUNBOOK mục 10)
- [ ] `ss -ltn | grep 3004` chỉ lắng nghe `127.0.0.1` (không mở cổng app ra Internet — IP trong nhật ký dựa vào Caddy)
- [ ] Container của dự án khác trên VPS không đổi trạng thái (so `docker ps` trước/sau)
