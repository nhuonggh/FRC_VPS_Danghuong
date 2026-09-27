# Giá trị hạ tầng thật (KHÔNG chứa secret)

Nguồn: chủ dự án xác nhận ngày 2026-09-26. Mọi file deploy (Dockerfile, `.github/workflows/deploy.yml`,
`docs/infra/*`) dùng đúng các giá trị này — đổi ở đây thì phải đổi đồng bộ ở mọi nơi.

| Khoá | Giá trị | Ghi chú |
|---|---|---|
| SLUG | `dherp` | chữ thường, khớp MỌI nơi: user `deploy_dherp`, container `dherp_app` / `postgres_dherp`, DB `dherp_db`, owner `dherp_user`, image `dherp`, file caddy `dherp.caddy` |
| DOMAIN | `dherp.sheetapp.store` | DNS đã trỏ về VPS? ☑ có (A → 194.233.87.152) |
| APP_PORT | `3004` | publish `127.0.0.1:3004:3000` (chỉ loopback; Caddy đi vào bằng tên container trên `pgnet`) |
| OWNER/REPO | `nhuonggh/FRC_VPS_Danghuong` | GitHub; deploy khi push `main` |
| VPS_IP | `194.233.87.152` | |
| REGISTRY | (không dùng) | registry chung hỏng dữ liệu → image đi qua scp + docker load (RUNBOOK mục 3) |

Tên suy ra (không phải secret):

| Thành phần | Giá trị |
|---|---|
| User Linux deploy | `deploy_dherp` (nhóm `docker`), env app `/home/deploy_dherp/app/.env` + env migrator `/home/deploy_dherp/app/.env.migrate` (cả hai mode 600) |
| Container app | `dherp_app` (restart always, network `pgnet`) |
| Container DB | `postgres_dherp` (postgres:15, giới hạn RAM 1g, restart unless-stopped, network `pgnet`, dữ liệu `/opt/postgres_dherp`) |
| Database / owner | `dherp_db` / `dherp_user` |
| Role ứng dụng | `app_rw` (LOGIN, chỉ `GRANT CONNECT`; migration cấp phần còn lại) |
| Image | `dherp:<git-sha>` và `dherp:migrate-<git-sha>` (chỉ local trên VPS) |
| Caddy | container `caddy`, site file host `/opt/caddy/sites/dherp.caddy` (trong container: `/etc/caddy/sites/`) |
