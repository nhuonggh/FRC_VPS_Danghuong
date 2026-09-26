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

`/home/deploy_dherp/app/.env.migrate` — image migrator: `migrate deploy` + `db seed` (mẫu: `.env.migrate.example`):

| Khoá | Giá trị |
|---|---|
| `MIGRATE_DATABASE_URL` | `postgresql://dherp_user:<OWNER_PASSWORD>@postgres_dherp:5432/dherp_db` |
| `BOOTSTRAP_ADMIN_PASSWORD` | mật khẩu đăng nhập đầu của `admin` — **xoá sau lần đăng nhập đầu** (mục 10) |

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

    sed -i '/^BOOTSTRAP_ADMIN_PASSWORD=/d' /home/deploy_dherp/app/.env.migrate
    grep -c '^BOOTSTRAP_ADMIN_PASSWORD=' /home/deploy_dherp/app/.env.migrate

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
