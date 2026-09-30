# Áp `dherp.caddy` lên VPS — quy trình an toàn

Phạm vi: chỉ file `/opt/caddy/sites/dherp.caddy`. **Không** sửa `/opt/caddy/Caddyfile` và file site của dự án khác (crm, lms, bldemo, WordPress…). Reload của Caddy là graceful (không rớt kết nối đang chạy); nếu cấu hình mới lỗi, Caddy giữ cấu hình cũ.

Nội dung cần áp là `docs/infra/caddy/dherp.caddy` trong repo (bản đã merge vào `main`).

## Bẫy cần tránh
1. **Đuôi `.caddy` là bị nạp** (`import /etc/caddy/sites/*.caddy`). File nháp/backup để trong thư mục `sites/` với đuôi `.caddy` sẽ khai báo trùng địa chỉ `dherp.sheetapp.store` → Caddy lỗi. Nháp dùng đuôi `.new`, backup để ở `/opt/caddy/backup/`.
2. **Không dùng `127.0.0.1`** làm upstream (trong container `caddy` đó là chính nó). Giữ `dherp_app:3000`.
3. **HSTS** (`max-age=31536000`, không `includeSubDomains`, không `preload`): trình duyệt sẽ từ chối HTTP với domain này 1 năm. Chỉ áp khi HTTPS của `dherp.sheetapp.store` đã ổn định (đang vậy). Không thêm `includeSubDomains`/`preload` khi VPS còn site khác dưới cùng domain gốc.
4. `frame-ancestors 'none'` + `X-Frame-Options DENY` cấm nhúng site vào iframe. Nếu có nơi nhúng DHERP trong iframe thì báo trước.
5. Kiểm `Origin` trong app so với header `Host` do Caddy giữ nguyên — **đừng** thêm `header_up Host …` vào `reverse_proxy`, sẽ làm mọi thao tác ghi bị 403.

## Các bước (SSH vào VPS bằng root hoặc user có quyền docker)

**0. Trước khi làm — chụp hiện trạng**
```bash
docker ps --filter name=caddy --format '{{.Names}} {{.Status}}'
cat /opt/caddy/sites/dherp.caddy
ls /opt/caddy/sites/
grep -rl "dherp.sheetapp.store" /opt/caddy/ 2>/dev/null          # chỉ được ra 1 file (dherp.caddy)
docker exec caddy caddy validate --config /etc/caddy/Caddyfile   # phải "Valid configuration" TRƯỚC khi sửa
for h in dherp crm lms; do :; done                               # (tuỳ) ghi lại mã HTTP các site khác để so sau
curl -sI https://dherp.sheetapp.store | head -5
```
Nếu `validate` đã lỗi từ trước → dừng, không sửa gì, báo lại.

**1. Backup (ngoài thư mục `sites/`)**
```bash
mkdir -p /opt/caddy/backup
cp -a /opt/caddy/sites/dherp.caddy /opt/caddy/backup/dherp.caddy.$(date +%Y%m%d-%H%M%S).bak
```

**2. Ghi bản mới vào file nháp (đuôi `.new`, KHÔNG bị nạp)**
```bash
cat > /opt/caddy/sites/dherp.caddy.new <<'CADDY'
dherp.sheetapp.store {
    header {
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Content-Security-Policy "frame-ancestors 'none'"
        Strict-Transport-Security "max-age=31536000"
        -Server
    }
    reverse_proxy dherp_app:3000
}
CADDY
docker exec caddy caddy fmt --diff /etc/caddy/sites/dherp.caddy.new || true   # chỉ xem định dạng, không sửa file
```
(Có thể copy nguyên nội dung file `docs/infra/caddy/dherp.caddy` từ repo, bỏ các dòng comment.)

**3. Thay file rồi validate ngay — lỗi thì tự khôi phục**
```bash
cp /opt/caddy/sites/dherp.caddy /opt/caddy/backup/dherp.caddy.before-swap
mv /opt/caddy/sites/dherp.caddy.new /opt/caddy/sites/dherp.caddy
if docker exec caddy caddy validate --config /etc/caddy/Caddyfile; then echo OK
else cp /opt/caddy/backup/dherp.caddy.before-swap /opt/caddy/sites/dherp.caddy; echo "LOI - da khoi phuc file cu"; fi
```
Chỉ sang bước 4 khi in `OK`.

**4. Reload (không downtime)**
```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
docker logs caddy --tail 30        # không được có "error" mới
```

**5. Kiểm tra sau khi áp**
```bash
curl -sI https://dherp.sheetapp.store/login | egrep -i 'HTTP/|strict-transport|x-frame|x-content-type|referrer|content-security|^server'
```
Kỳ vọng: `200`, đủ 5 header, **không** có dòng `server:`.
Rồi bằng trình duyệt: (a) đăng nhập tài khoản thường và Google; (b) tạo/sửa một bản ghi bất kỳ (thao tác POST/PATCH phải thành công, không 403); (c) mở vài trang mới (Báo giá, Trả hàng, Công nợ); (d) mở 1–2 site khác trên VPS (crm, lms) thấy y như trước.

**6. Hoàn tác nếu có bất thường**
```bash
cp /opt/caddy/backup/dherp.caddy.before-swap /opt/caddy/sites/dherp.caddy
docker exec caddy caddy validate --config /etc/caddy/Caddyfile && docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```
(HSTS đã gửi tới trình duyệt vẫn còn hiệu lực đến hết `max-age` — chỉ ảnh hưởng nếu HTTPS hỏng.)

## Sau khi xong
Ghi vào `docs/STATUS.md` mục 5: "Việc #7 — header Caddy đã áp VPS ngày …".
