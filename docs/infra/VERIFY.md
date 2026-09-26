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

## CRUD
- [ ] Tạo 1 người dùng qua UI; reload còn; sửa; khoá/mở khoá
- [ ] Mỗi thao tác trên xuất hiện trong Nhật ký thao tác (giá trị cũ/mới), IP là IP máy khách thật (không phải IP của Caddy)

## CI/CD
- [ ] Push thay đổi nhỏ lên `main` → Actions xanh (test + build + deploy + health probe); app vẫn phản hồi trong lúc deploy
- [ ] Log bước deploy có dòng `Image đang chạy trước deploy (dùng để rollback): …` và `App healthy: …`
- [ ] Thử rollback một lần theo RUNBOOK mục 8 (chạy lại tag sha trước, rồi trả lại bản mới)

## Bảo mật
- [ ] `git log --all -- .env` → rỗng; `git grep -nEi "password|secret"` không có giá trị thật
- [ ] `stat -c '%a %U' /home/deploy_dherp/app/.env` → `600 deploy_dherp`
- [ ] `BOOTSTRAP_ADMIN_PASSWORD` đã xoá khỏi `.env` sau lần đăng nhập đầu VÀ container đã được tạo lại:
      `docker exec dherp_app printenv BOOTSTRAP_ADMIN_PASSWORD` không in gì (RUNBOOK mục 10)
- [ ] `ss -ltn | grep 3004` chỉ lắng nghe `127.0.0.1` (không mở cổng app ra Internet — IP trong nhật ký dựa vào Caddy)
- [ ] Container của dự án khác trên VPS không đổi trạng thái (so `docker ps` trước/sau)
