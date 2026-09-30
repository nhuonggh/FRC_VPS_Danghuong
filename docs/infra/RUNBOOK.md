# Runbook VPS — dự án `dherp` (as-built)

Giá trị thật: [INPUTS.md](INPUTS.md). Xác minh sau deploy: [VERIFY.md](VERIFY.md). Khuôn gốc: skill `setup-project`
(runbook 10 bước) — bản này là **những gì đã cấp phát thật** trên VPS `194.233.87.152` và cách làm lại.

> **KHÔNG dán secret vào file này.** `<OWNER_PASSWORD>`, `<APP_PASSWORD>`, `<AUTH_SECRET>`… là chỗ tự điền lúc gõ lệnh.
> Secret thật chỉ nằm ở `/home/deploy_dherp/app/.env` + `.env.migrate` (mode 600) và GitHub Secrets.

## 0. Quy tắc bất di bất dịch

- VPS chạy **nhiều dự án khác**. Chỉ đụng tài nguyên mang tên `dherp`: user `deploy_dherp`, container `dherp_app`,
  `postgres_dherp`, thư mục `/opt/postgres_dherp`, file `/opt/caddy/sites/dherp.caddy`, image `<REGISTRY>/dherp`.
- **Cấm**: `docker system prune`, `docker image prune -a`, `docker volume prune`, `docker network prune`, restart/xoá
  container `caddy` hay container/DB của dự án khác, sửa site file khác trong `/opt/caddy/sites/`, sửa `Caddyfile` chung.
- Caddy chỉ **reload** (không restart). Luôn `validate` trước `reload`.
- Lệnh gõ trên VPS: mỗi lần 1–2 lệnh, đọc kết quả rồi mới làm tiếp.

## 1. Database (đã làm)

Container `postgres_dherp` (postgres:15, RAM tối đa 1g, `unless-stopped`, network `pgnet`, dữ liệu `/opt/postgres_dherp`).
Sinh 2 mật khẩu (owner, app) không có ký tự đặc biệt, lưu vào trình quản lý mật khẩu:

    openssl rand -base64 24 | tr -d '/+=@:#?%'

Làm lại từ đầu (chỉ khi dựng mới — **không** chạy khi container đang tồn tại):

    mkdir -p /opt/postgres_dherp
    docker run -d --name postgres_dherp --restart unless-stopped --memory 1g --network pgnet -e POSTGRES_USER=dherp_user -e POSTGRES_PASSWORD=<OWNER_PASSWORD> -e POSTGRES_DB=dherp_db -v /opt/postgres_dherp:/var/lib/postgresql/data postgres:15

Tạo role ứng dụng `app_rw` **trước lần deploy đầu** (migration foundation chỉ GRANT cho `app_rw` nếu role đã tồn tại):

    docker exec -it postgres_dherp psql -U dherp_user -d dherp_db

Trong psql:

    CREATE ROLE app_rw LOGIN PASSWORD '<APP_PASSWORD>';
    GRANT CONNECT ON DATABASE dherp_db TO app_rw;
    \q

Phần còn lại do migration cấp: `USAGE` schema, `SELECT/INSERT/UPDATE/DELETE` mọi bảng, sequence, default privileges cho
bảng sau này, và **REVOKE UPDATE/DELETE/TRUNCATE trên `audit_log`**.

> Nếu lỡ tạo `app_rw` SAU khi migration đã chạy: chạy lại khối GRANT ở cuối
> `prisma/migrations/20260924152222_foundation/migration.sql` (mục "4. Role ứng dụng app_rw") bằng `dherp_user`.

## 2. User deploy + SSH key (đã làm)

    useradd -m -s /bin/bash deploy_dherp
    usermod -aG docker deploy_dherp

Sinh key (đăng nhập bằng `su - deploy_dherp`):

    ssh-keygen -t ed25519 -C "deploy_dherp@vps" -N "" -f ~/.ssh/id_ed25519
    cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys

Private key (`cat ~/.ssh/id_ed25519`, cả dòng BEGIN/END) → GitHub Secret `VPS_SSH_KEY`.

**Không có bước sudoers/systemctl**: khác runbook gốc, Caddy ở đây chạy trong **container** `caddy` → reload bằng
`docker exec` (mục 5); CI không reload Caddy (site file chỉ đổi khi đổi domain).

## 3. Registry (đã làm)

`deploy_dherp` đã đăng nhập registry riêng (thông tin lưu ở `~/.docker/config.json` của user này):

    docker login registry.francophiles.com.vn

Workflow cũng tự `docker login` mỗi lần deploy bằng `REGISTRY_USER`/`REGISTRY_PASS` (qua biến môi trường SSH, không in ra log).

Lưu ý build — bài học lần deploy đầu (2026-09-27):

- Registry chung có cron **GC hằng tuần**: `0 3 * * 0 docker exec registry bin/registry garbage-collect --delete-untagged …` (Chủ nhật 03:00 giờ VPS, tức 01:00 UTC; log `/var/log/registry-gc.log`). Lần push đầu của dự án này rơi đúng phút GC chạy: GC xoá blob/manifest chưa gắn tag, để lại `_layers` link mồ côi, khiến pull báo `manifest unknown` rồi `blob ... EOF`, và các lần push sau bỏ qua upload vì registry tưởng blob còn.
- Vì GC `--delete-untagged` xoá mọi manifest không có tag (kể cả manifest attestation con của buildx), cả hai bước build đặt `provenance: false` và `sbom: false` (image là 1 manifest đơn, được gắn tag).
- **Không push/deploy vào Chủ nhật quanh 03:00 giờ VPS (±15 phút).**
- Xử lý khi gặp lại `manifest unknown`/`blob unknown` với repo `dherp`: xoá thư mục repo của CHÍNH dự án này trong storage registry (`/opt/registry/data/docker/registry/v2/repositories/dherp`) rồi chạy lại workflow. Không đụng repo của dự án khác, không đổi mật khẩu/htpasswd, không khởi động lại registry.
- Ghi nhận cho chủ registry: repo `crm` và `lms` cũng còn hàng nghìn link layer mồ côi (blob đã bị GC xoá) — pull lại image cũ chưa được đẩy lại sẽ lỗi.

## 4. Thư mục + 2 file env production

Hai file tách biệt, cùng chủ `deploy_dherp`, mode `600`. Container app **chỉ** nhận `.env`; image migrator **chỉ** nhận
`.env.migrate` — nên app (nếu bị chiếm) không có mật khẩu owner DB (superuser) hay mật khẩu admin khởi tạo.

`/home/deploy_dherp/app/.env` — container `dherp_app` (mẫu: `.env.example`):

| Khoá | Giá trị |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://app_rw:<APP_PASSWORD>@postgres_dherp:5432/dherp_db` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://dherp.sheetapp.store` |
| `GOOGLE_CLIENT_ID` | tuỳ chọn — Client ID OAuth (mục 13); để trống = tắt đăng nhập Google |
| `GOOGLE_CLIENT_SECRET` | tuỳ chọn — Client secret OAuth (mục 13); **secret**, chỉ nằm ở `.env` này |

`/home/deploy_dherp/app/.env.migrate` — image migrator: `migrate deploy` + `db seed` (mẫu: `.env.migrate.example`):

| Khoá | Giá trị |
|---|---|
| `MIGRATE_DATABASE_URL` | `postgresql://dherp_user:<OWNER_PASSWORD>@postgres_dherp:5432/dherp_db` |
| `BOOTSTRAP_ADMIN_PASSWORD` | mật khẩu đăng nhập đầu của `admin` — **xoá sau lần đăng nhập đầu** (mục 10) |
| `BOOTSTRAP_ADMIN_EMAIL` | tuỳ chọn — email Google gán cho `admin` CHỈ khi seed tạo admin (mục 13); **xoá sau lần deploy đầu** |

`DATABASE_URL` không cần trong `.env.migrate`: `prisma.config.ts` tự lấy `MIGRATE_DATABASE_URL` khi thiếu → migrate và
seed đều chạy bằng owner. `NODE_ENV=production` đã đặt sẵn trong image. Không đặt `RECOMPUTE_WORKER` trên production
(giá trị `off` tắt worker tính lại giá vốn — chỉ dùng cho test). Workflow **từ chối deploy** nếu thiếu 1 trong 2 file hoặc
`.env` còn `MIGRATE_DATABASE_URL`/`BOOTSTRAP_ADMIN_PASSWORD`.

Chuyển 1 lần từ layout cũ (1 file `.env` chứa tất cả) — chạy bằng `deploy_dherp`, **trước** lần push `main` đầu tiên:

    cd /home/deploy_dherp/app && (umask 077; grep -E '^(MIGRATE_DATABASE_URL|BOOTSTRAP_ADMIN_PASSWORD)=' .env > .env.migrate)
    sed -i -E '/^(MIGRATE_DATABASE_URL|BOOTSTRAP_ADMIN_PASSWORD)=/d' .env

Kiểm tra:

    grep -c MIGRATE /home/deploy_dherp/app/.env; grep -cE "^(MIGRATE_DATABASE_URL|BOOTSTRAP_ADMIN_PASSWORD)=" /home/deploy_dherp/app/.env.migrate
    stat -c '%a %U %n' /home/deploy_dherp/app/.env /home/deploy_dherp/app/.env.migrate

Kỳ vọng `0`, `2` (hoặc `1` khi đã gỡ BOOTSTRAP), và `600 deploy_dherp` cho cả hai. Nếu `dherp_app` đang chạy với `.env`
cũ, tạo lại container (mục 7) để env trong container cũng sạch.

## 5. Caddy (container) (đã làm)

`/opt/caddy/Caddyfile` có `import /etc/caddy/sites/*.caddy`; thư mục host `/opt/caddy/sites` mount vào
`/etc/caddy/sites`. Site file `/opt/caddy/sites/dherp.caddy` = bản tham chiếu [caddy/dherp.caddy](caddy/dherp.caddy):

    dherp.sheetapp.store {
        reverse_proxy dherp_app:3000
    }

Upstream là **tên container trên `pgnet`**, không phải `127.0.0.1:3004` (127.0.0.1 trong container caddy là chính nó).
Cổng `127.0.0.1:3004` chỉ để kiểm tra từ host. Sau khi sửa file:

    docker exec caddy caddy validate --config /etc/caddy/Caddyfile
    docker exec caddy caddy reload --config /etc/caddy/Caddyfile

DNS `dherp.sheetapp.store` → `194.233.87.152` đã trỏ; Caddy tự cấp HTTPS ở request đầu.

## 6. GitHub Secrets (đã đặt)

Repo `nhuonggh/FRC_VPS_Danghuong` → Settings → Secrets and variables → Actions:

| Secret | Giá trị |
|---|---|
| `VPS_HOST` | `194.233.87.152` |
| `VPS_USER` | `deploy_dherp` |
| `VPS_SSH_KEY` | private key mục 2 |
| `APP_PORT` | `3004` |
| `REGISTRY_URL` | `registry.francophiles.com.vn` |
| `REGISTRY_USER` | user registry |
| `REGISTRY_PASS` | mật khẩu registry |

## 7. Deploy (tự động)

Push `main` → `.github/workflows/deploy.yml`:

1. **test**: lint, typecheck, toàn bộ vitest trên Postgres service (`localhost:5434/dh_test`, env từ `.env.test`).
2. **build-and-deploy**: build + push `dherp:<sha>` (+`latest`, target `runner`) và `dherp:migrate-<sha>` (+`migrate`,
   target `migrator`); SSH vào VPS: kiểm 2 file env → pull → `migrate deploy` → `db seed` (idempotent) (cả hai với
   `--env-file .env.migrate`) → swap `dherp_app` (`--env-file .env`) → probe
   `/api/health` (fail job nếu 60s không `200`) → dọn image cũ **của dherp** (giữ 3 bản gần nhất).

Migrate/seed chạy TRƯỚC khi swap: lỗi ở đây thì container cũ vẫn chạy nguyên. Lần deploy đầu, seed tạo quyền, 5 vai trò
mẫu, công ty, kỳ đầu và `admin` (vì bảng `users` trống và có `BOOTSTRAP_ADMIN_PASSWORD`).

Lệnh tạo lại container **y hệt workflow** (dùng khi sửa `.env`, xoay secret…; `docker restart` KHÔNG nạp lại `.env`):

    IMG=$(docker inspect --format '{{.Config.Image}}' dherp_app)
    docker stop dherp_app && docker rm dherp_app

    docker run -d --name dherp_app --restart always --network pgnet --env-file /home/deploy_dherp/app/.env -p 127.0.0.1:3004:3000 "$IMG"
    curl -fsS http://127.0.0.1:3004/api/health

## 8. Rollback

Mỗi bản deploy có tag bất biến `dherp:<git-sha>`; VPS giữ 3 bản gần nhất, registry giữ tất cả (tới khi GC registry).
Workflow in dòng `Image đang chạy trước deploy (dùng để rollback): …`. Xem các bản đang có:

    docker images registry.francophiles.com.vn/dherp --format '{{.Tag}} {{.CreatedSince}} {{.Digest}}'

Chạy lại bản trước (theo tag sha, hoặc chắc chắn hơn theo digest `registry.francophiles.com.vn/dherp@sha256:…`):

    docker stop dherp_app && docker rm dherp_app
    docker run -d --name dherp_app --restart always --network pgnet --env-file /home/deploy_dherp/app/.env -p 127.0.0.1:3004:3000 registry.francophiles.com.vn/dherp:<SHA_TRUOC>

**Giới hạn**: migration chỉ tiến, không có down. Rollback app chỉ an toàn khi migration của bản mới tương thích ngược với
code cũ (thêm cột/bảng). Nếu migration đã đổi/xoá cấu trúc → khôi phục DB từ backup. Trước bản deploy có migration rủi ro,
backup thủ công:

    docker exec postgres_dherp pg_dump -U dherp_user -d dherp_db -Fc -f /tmp/dherp_before.dump
    docker cp postgres_dherp:/tmp/dherp_before.dump /home/deploy_dherp/dherp_$(date +%F_%H%M).dump

Sửa lỗi bằng commit mới (revert) rồi push `main` vẫn là cách ưu tiên — rollback tay chỉ để cầm máu.

## 9. Xoay secret

Sau mọi thay đổi `.env` (app) → **tạo lại container** (mục 7), không `docker restart`. Thay đổi `.env.migrate` không
cần đụng container app — lần deploy sau (hoặc lệnh `docker run --rm … --env-file .env.migrate` tay) tự đọc bản mới.

- `AUTH_SECRET` (`.env`): sinh mới, sửa `.env`, tạo lại container. Mọi phiên đăng nhập bị vô hiệu (đăng nhập lại).
- Mật khẩu `app_rw` (`.env`): `ALTER ROLE app_rw PASSWORD '<NEW>';` (psql bằng `dherp_user`) → sửa `DATABASE_URL` → tạo lại
  container.
- Mật khẩu `dherp_user` (`.env.migrate`): `ALTER ROLE dherp_user PASSWORD '<NEW>';` → sửa `MIGRATE_DATABASE_URL` trong
  `.env.migrate`. Không cần tạo lại app. (`POSTGRES_PASSWORD` của container DB chỉ có tác dụng lúc khởi tạo dữ liệu lần
  đầu, đổi nó không đổi mật khẩu.)
- Registry: đổi htpasswd trên registry → cập nhật secret `REGISTRY_PASS` → `docker login registry.francophiles.com.vn` lại
  bằng `deploy_dherp`.
- SSH key: sinh key mới (mục 2), thay dòng cũ trong `authorized_keys`, cập nhật `VPS_SSH_KEY`.
- Nếu secret đã lộ (commit, chat, ảnh chụp): xoay **toàn bộ** các mục trên.

## 10. Gỡ `BOOTSTRAP_ADMIN_PASSWORD` sau lần đăng nhập đầu

Sau khi `admin` đăng nhập lần đầu và đã **đổi mật khẩu** (hệ thống bắt buộc), xoá biến khỏi `.env.migrate`:

    sed -i -E '/^BOOTSTRAP_ADMIN_(PASSWORD|EMAIL)=/d' /home/deploy_dherp/app/.env.migrate
    grep -cE '^BOOTSTRAP_ADMIN_(PASSWORD|EMAIL)=' /home/deploy_dherp/app/.env.migrate

Kỳ vọng `0`. **Không cần tạo lại container app**: biến này chỉ đưa vào container migrator (`--rm`, tự xoá sau mỗi lần
chạy), chưa từng nằm trong `dherp_app`. Kiểm: `docker exec dherp_app printenv BOOTSTRAP_ADMIN_PASSWORD` không in gì.
(Seed chỉ tạo admin khi bảng `users` trống, nên sau khi xoá biến các lần deploy sau không tạo thêm tài khoản.)

## 11. Giới hạn của audit append-only (cần biết)

- `app_rw` (container app): bị REVOKE `UPDATE/DELETE/TRUNCATE` trên `audit_log` → "permission denied".
- Trigger `audit_log_no_update_delete` / `audit_log_no_truncate` chặn cả owner khi sửa **dữ liệu** (DML).
- Nhưng **DDL vượt được**: `dherp_user` là owner (và với image postgres chính thức, `POSTGRES_USER` là **superuser**) nên
  có thể `ALTER TABLE audit_log DISABLE TRIGGER …`, `DROP TRIGGER`, `DROP TABLE`. Append-only chống lỗi ứng dụng và người
  dùng app, KHÔNG chống người nắm mật khẩu owner/SSH root. Vì vậy: `MIGRATE_DATABASE_URL` là secret mức cao nhất; chỉ người
  vận hành giữ; backup định kỳ ra ngoài VPS nếu cần bằng chứng không sửa được.
- Vì thế `MIGRATE_DATABASE_URL` chỉ nằm trong `.env.migrate` (chỉ container migrator `--rm` đọc), KHÔNG trong `.env` của
  app: chiếm được tiến trình app chỉ có quyền `app_rw`. Seed chạy bằng owner (cùng container migrator).

## 12. Xác minh

Làm hết [VERIFY.md](VERIFY.md). Build pass / Actions xanh KHÔNG phải bằng chứng.

## 13. Đăng nhập Google (tuỳ chọn — thay D-1: Credentials + Google)

Đăng nhập tên/mật khẩu **luôn còn** (admin khởi tạo, dự phòng). Google chỉ bật khi `.env` có ĐỦ `GOOGLE_CLIENT_ID` và
`GOOGLE_CLIENT_SECRET`; thiếu 1 trong 2 → app chạy y như trước, nút Google không hiện. Quy tắc: [docs/conventions/auth.md](../conventions/auth.md).

**Tạo OAuth client** (Google Cloud Console → APIs & Services):

1. *OAuth consent screen*: loại **Internal** nếu mọi người dùng thuộc cùng Google Workspace; nếu dùng Gmail cá nhân → **External**,
   rồi **Publish app** (ở chế độ Testing chỉ tài khoản trong danh sách test user đăng nhập được). Scope: `openid`, `email`, `profile`.
2. *Credentials → Create credentials → OAuth client ID*, loại **Web application**:
   - **Authorized JavaScript origins**: `https://dherp.sheetapp.store`
   - **Authorized redirect URIs** (đúng từng ký tự, không `/` thừa): `https://dherp.sheetapp.store/api/auth/callback/google`
3. Chép Client ID + Client secret vào `/home/deploy_dherp/app/.env` (KHÔNG vào `.env.migrate`, KHÔNG commit, KHÔNG dán chat):

       GOOGLE_CLIENT_ID=<CLIENT_ID>
       GOOGLE_CLIENT_SECRET=<CLIENT_SECRET>

4. **Tạo lại container** (mục 7) — `docker restart` không nạp lại `.env`. `NEXTAUTH_URL` phải đúng
   `https://dherp.sheetapp.store` (redirect URI suy ra từ biến này).

**Cấp quyền cho người dùng — không có tự đăng ký**: quản trị viên (quyền `user.manage`) mở *Hệ thống → Người dùng →*
chi tiết người dùng → phần **Đăng nhập Google** → nhập email Google của họ (hoặc nhập ngay khi tạo người dùng). Người đó bấm
"Đăng nhập bằng Google" và vào đúng tài khoản đó, với đúng nhóm quyền của tài khoản. Tài khoản Google không khớp email nào,
email chưa được Google xác minh, hoặc tài khoản bị khoá → quay lại `/login` với thông báo "Tài khoản Google này chưa được cấp
quyền vào hệ thống. Liên hệ quản trị viên." Gỡ email (để trống) = thu hồi đăng nhập Google của người đó. Gỡ HOẶC đổi sang email khác đều cắt phiên Google đang mở ở
thao tác kế tiếp (so `emailChangedAt` với lúc đăng nhập Google); lưu lại đúng email cũ không cắt.

**Admin đầu tiên**: đặt `BOOTSTRAP_ADMIN_EMAIL=<email Google của chủ hệ thống>` trong `.env.migrate` CÙNG LÚC với
`BOOTSTRAP_ADMIN_PASSWORD`, **trước** lần deploy tạo `admin`. Biến chỉ được đọc khi seed TẠO `admin` (bảng `users` trống):
nếu `admin` đã tồn tại, seed bỏ qua — không gán, không khôi phục email mà quản trị viên đã gỡ. Sau lần deploy đầu **xoá dòng
này** (cùng lúc với mục 10). Admin đã có mà chưa có email → gán trên giao diện (phần "Đăng nhập Google").

**Mật khẩu tạm có hạn 72 giờ** (`TEMP_PASSWORD_TTL_HOURS`): mật khẩu khởi tạo của `admin`, mật khẩu tạm khi tạo người dùng và
khi "Cấp lại mật khẩu" hết hạn nếu chưa đổi — đăng nhập bằng nó báo "Tên đăng nhập hoặc mật khẩu không đúng" như sai mật
khẩu. Người dùng thường: quản trị viên bấm "Cấp lại mật khẩu" (đặt lại hạn). Đổi mật khẩu thành công → hết ràng buộc hạn.

**Cứu hộ `admin`** (Google không dùng được VÀ mật khẩu tạm đã hết hạn / không ai khác có `user.manage`) — chạy bằng
`deploy_dherp` trên VPS, mật khẩu KHÔNG vào lịch sử shell, KHÔNG in ra log, KHÔNG nằm trên dòng lệnh:

    read -rs NEW_ADMIN_PASSWORD && export NEW_ADMIN_PASSWORD
    docker run --rm --network pgnet --env-file /home/deploy_dherp/app/.env.migrate -e NEW_ADMIN_PASSWORD registry.francophiles.com.vn/dherp:migrate npx tsx scripts/admin-reset.ts
    unset NEW_ADMIN_PASSWORD

(`-e NEW_ADMIN_PASSWORD` không kèm giá trị = lấy từ môi trường hiện tại.) Kỳ vọng dòng
`Đã đặt mật khẩu tạm mới cho 'admin' (bắt đổi ở lần đăng nhập đầu, hết hạn sau 72 giờ).` Script đặt mật khẩu mới (phải đủ
mạnh: ≥ 8 ký tự, có chữ và số, không chứa tên đăng nhập), `mustChangePassword = true`, hạn 72 giờ, ghi nhật ký
`user.reset_password` (người thực hiện: Hệ thống, `via: admin:reset`); KHÔNG đổi khoá, email, vai trò. Tài khoản khác:
thêm `-e ADMIN_USERNAME=<tên>`. Đăng nhập ngay và đổi mật khẩu. Máy dev: `NEW_ADMIN_PASSWORD=… npm run admin:reset`.
Không dùng `UPDATE users SET "passwordHash"=…` tay (dễ sai băm/chuẩn hoá, không có nhật ký).

**Bắt đổi mật khẩu**: chỉ áp cho phiên đăng nhập bằng mật khẩu. Phiên Google dùng app bình thường dù tài khoản còn cờ
"Chờ đổi mật khẩu" (danh tính do Google chứng minh; họ có thể không biết mật khẩu tạm — mật khẩu tạm đó tự hết hạn sau 72 giờ).

**Rủi ro đã chấp nhận**: người có `user.manage` gán được email Google của mình cho tài khoản NGANG quyền (không cao hơn) rồi
đăng nhập vào đó — cùng mức năng lực với "Cấp lại mật khẩu" cho tài khoản đó. Mọi lần đổi email đều có nhật ký
`user.set_email` (email cũ/mới, người thực hiện). Rà định kỳ Nhật ký thao tác với hành động này.

**Xoay `GOOGLE_CLIENT_SECRET`**: Console → client → *Add secret* → sửa `.env` → tạo lại container → xoá secret cũ trên Console.
Phiên đang đăng nhập không bị ảnh hưởng (JWT chỉ giữ id user). Tắt Google: xoá 2 dòng khỏi `.env` rồi tạo lại container.

**Lỗi thường gặp**: `redirect_uri_mismatch` → URI ở bước 2 sai (http/https, `www`, `/` cuối). Về `/login` với "sự cố cấu
hình" → thiếu/sai `NEXTAUTH_URL` hoặc `AUTH_SECRET`. "Chưa được cấp quyền" dù đã nhập email → kiểm email đúng tài khoản Google
(chữ hoa/thường không quan trọng), tài khoản không bị khoá, và consent screen đã Publish (External).

## 14. Sao lưu hằng đêm + diễn tập khôi phục (plan 05 · D9)

**Làm TRƯỚC khi nhập dữ liệu thật.** Hai script nằm trong repo: `scripts/backup.sh` (pg_dump -Fc, giữ 14 ngày, kiểm file, đẩy
bản ngoài máy chủ, cảnh báo khi lỗi) và `scripts/restore-drill.sh` (nạp bản mới nhất vào DB tạm, so số dòng, xoá DB tạm; **không
đụng `dherp_db`**). Chỉ dùng `docker exec` vào `postgres_dherp` nên không cần mật khẩu; AI không cần SSH — bạn tự làm bằng Termius.

**1. Đưa script lên VPS** (đăng nhập `deploy_dherp`; nếu `docker ps` báo thiếu quyền thì cần thêm user vào nhóm `docker` — báo lại):

    mkdir -p ~/bin ~/backups && chmod 700 ~/backups
    # từ máy dev có repo:  scp scripts/backup.sh scripts/restore-drill.sh deploy_dherp@<VPS>:~/bin/
    chmod +x ~/bin/backup.sh ~/bin/restore-drill.sh
    ~/bin/backup.sh          # chạy thử: phải in "xong: …" và tạo ~/backups/dherp_<ngày>.dump

**2. Bản ngoài máy chủ (bắt buộc)** — sao lưu chỉ nằm trên cùng VPS thì mất máy là mất hết. Chọn một, đặt vào file cấu hình
(mode 600, không commit):

    cat > ~/.backup.env <<'X'
    export OFFSITE_CMD='rclone copy "$BACKUP_FILE" gdrive:dherp-backup'   # hoặc: scp "$BACKUP_FILE" user@may-khac:/duong/dan/
    export ALERT_URL='https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>'   # tuỳ chọn: nhận tin khi lỗi
    X
    chmod 600 ~/.backup.env

(`rclone` cấu hình một lần bằng `rclone config` với Google Drive của xưởng; file dump chứa dữ liệu khách nên đặt thư mục Drive
riêng tư.) Không có `ALERT_URL` thì lỗi vẫn ghi vào `~/backups/FAILED` — xem mục 4.

**3. Cron hằng đêm 01:30** (`crontab -e`):

    30 1 * * * set -a; . $HOME/.backup.env; set +a; $HOME/bin/backup.sh >> $HOME/backups/backup.log 2>&1

**4. Kiểm tra hằng tuần** (30 giây): `ls -lt ~/backups | head -3` (phải có file trong 24 giờ qua), `ls ~/backups/FAILED` (không được tồn tại), `tail -5 ~/backups/backup.log`.

**5. Diễn tập khôi phục — mỗi tháng một lần và ngay trước go-live:**

    ~/bin/restore-drill.sh        # cuối cùng phải in "ĐẠT"; bảng nào "THIẾU/RỖNG/NHIỀU hơn" là có vấn đề

Bản sao lưu cũ hơn DB thật nên số dòng sao lưu ≤ số dòng thật là bình thường. Khôi phục THẬT (chỉ khi mất dữ liệu): dừng app,
`pg_restore --clean --if-exists -d dherp_db` từ file `.dump` bằng `dherp_user`, chạy lại `migrate deploy`, bật app — làm cùng
người có kinh nghiệm, đừng làm một mình lần đầu.
