# Đặng Hương CRM (`danghuong-app`)

Hệ thống quản lý bán hàng – kho – công nợ cho **Xưởng tôn Đặng Hương**: danh mục, người dùng/vai trò/phân quyền,
nhật ký thao tác (audit, append-only), kỳ kế toán và **engine kho FIFO** (giá vốn theo lớp, đơn treo âm kho, tính lại
chuỗi khi sửa/hủy chứng từ, tính lại chạy nền). Đặc tả: `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md`.

## Công nghệ

Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 + PostgreSQL 15 · next-auth v4 (đăng nhập tài khoản/mật
khẩu, bcrypt) · TanStack Query · react-hook-form + zod · Tailwind CSS 3 · Vitest (+ Testing Library) chạy trên DB
PostgreSQL thật.

## Scripts (`package.json`)

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy dev server (http://localhost:3000) |
| `npm run build` / `npm start` | Build / chạy bản production |
| `npm run lint` | ESLint (`next lint`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Toàn bộ test (`vitest run`) — cần DB test (dưới) |
| `npm run test:watch` | Vitest chế độ theo dõi |
| `npm run db:migrate` | `prisma migrate dev` (tạo/áp migration trên DB dev) |
| `npm run db:deploy` | `prisma migrate deploy` (áp migration, không tạo mới) |
| `npm run db:seed` | `prisma db seed` → `prisma/seed.ts` (quyền, vai trò mẫu, công ty, kỳ đầu; admin nếu có `BOOTSTRAP_ADMIN_PASSWORD`) |
| `npm run db:schema` | Sinh lại `db/db_schema.sql` từ các migration (chạy sau mỗi lần đổi schema) |

## Chạy máy dev

```bash
npm ci
docker compose up -d postgres      # PostgreSQL dev: localhost:5432, DB dh_dev
# tạo .env (xem "File môi trường"), rồi:
npm run db:deploy && npm run db:seed
npm run dev
```

## Test

Test chạy trên **DB PostgreSQL riêng** (container `dh_pgtest`, cổng **5434**, DB `dh_test`, dữ liệu trên RAM):

```bash
docker compose up -d pgtest
npm test                                   # hoặc: npx vitest run tests/inventory
```

- `tests/global-setup.ts` **xoá sạch schema `public`** rồi `prisma migrate deploy` mỗi lần chạy; `tests/helpers/
  assert-test-db.ts` chặn nếu URL không trỏ DB test.
- Các file test dùng chung một DB (`fileParallelism: false`): **không chạy hai tiến trình vitest cùng lúc**.
- Test hiệu năng (`tests/inventory/performance.test.ts`) chỉ kiểm cứng số câu lệnh SQL; ngưỡng thời gian chỉ kiểm khi
  đặt `PERF_STRICT=1`.

## File môi trường

- **`.env` — KHÔNG commit** (đã trong `.gitignore`, cùng `.env.local`, `.env.*.local`). Biến dùng: `DATABASE_URL`,
  `MIGRATE_DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, tuỳ chọn `BOOTSTRAP_ADMIN_PASSWORD` (seed admin lần đầu),
  `RECOMPUTE_WORKER=off` (tắt worker tính lại nền).
- **`.env.test` — được commit, chỉ chứa giá trị bỏ đi** (DB test cục bộ cổng 5434, secret giả). Không bao giờ đặt
  secret thật vào đây.

## Tài liệu

- `docs/spec/` — đặc tả tổng; `docs/superpowers/plans/` — kế hoạch từng giai đoạn (00 master, 01a/b/c GĐ0, 02 engine FIFO).
- `docs/engine-fifo.md` — API công khai `@/server/inventory`, thứ tự sự kiện, hợp đồng cho module nghiệp vụ (plan 03+),
  khoá/đồng thời, tính lại nền, checklist kết sổ (K5).
- `docs/conventions/` — quy ước màn danh sách, phân quyền, dữ liệu nhạy cảm.
- `db/db_schema.sql` — schema sinh tự động (`npm run db:schema`).

## Triển khai

Tự động khi push `main` (`.github/workflows/deploy.yml`): test → build 2 image (`Dockerfile`: target `runner` =
`node server.js`, target `migrator` = `prisma migrate deploy` / `prisma db seed`) → đẩy lên registry riêng → SSH vào VPS:
migrate + seed → thay container `dherp_app` → kiểm `/api/health`. Tên miền `https://dherp.sheetapp.store` (Caddy).

Tài liệu hạ tầng (`docs/infra/`):

- [`INPUTS.md`](docs/infra/INPUTS.md) — giá trị thật (slug `dherp`, domain, cổng, registry, repo) — không có secret.
- [`RUNBOOK.md`](docs/infra/RUNBOOK.md) — những gì đã cấp phát trên VPS và cách làm lại; tạo lại container, rollback,
  xoay secret, gỡ `BOOTSTRAP_ADMIN_PASSWORD` sau lần đăng nhập đầu.
- [`VERIFY.md`](docs/infra/VERIFY.md) — checklist xác minh sau deploy.
- [`caddy/dherp.caddy`](docs/infra/caddy/dherp.caddy) — bản tham chiếu site Caddy.

Mẫu biến môi trường production: `.env.example`.

### Đã có

- Image non-root, runner chỉ chứa bản standalone; cổng app chỉ publish `127.0.0.1:3004`, ra ngoài qua Caddy (HTTPS).
- App chạy bằng role `app_rw` (không sửa/xoá được `audit_log`); migrate bằng owner; migrate + seed chạy trước khi thay
  container (lỗi thì bản cũ vẫn chạy); probe sức khoẻ sau deploy; tag image theo git sha để rollback.

### Trước khi go-live (còn lại — cổng chặn của chủ dự án)

- Làm hết [`docs/infra/VERIFY.md`](docs/infra/VERIFY.md) sau lần deploy đầu, gồm **gỡ `BOOTSTRAP_ADMIN_PASSWORD`** khỏi
  `.env` trên VPS và tạo lại container.
- **Giới hạn tần suất đăng nhập** (chống dò mật khẩu): ở Caddy (rate limit) hoặc trong app.
- **Header bảo mật** ở Caddy: `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`, cùng các header cơ bản khác
  (site file hiện chỉ có `reverse_proxy`).
- **Backup DB định kỳ** ra ngoài VPS (hiện chỉ có lệnh `pg_dump` thủ công trong RUNBOOK mục 8).
- Tuỳ chọn: **kiểm `Origin`** cho mọi request không phải GET tới `/api/*` (phòng CSRF bổ sung cho cookie SameSite).
- IP trong nhật ký lấy từ hop đầu `X-Forwarded-For`: chỉ đáng tin khi app đứng sau Caddy (Caddy ghi đè header này) —
  không mở cổng app trực tiếp ra Internet.
- Chủ dòng giá vốn đơn bán (`SALE`) phải được đăng ký ở `src/server/inventory/owners-register.ts` trước khi ghi đơn bán
  thật (xem `docs/engine-fifo.md` §0).
