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

**Chưa cấu hình deploy** (chưa có Dockerfile / GitHub Actions / Caddy; service `app` trong `docker-compose.yml` là chỗ
giữ chỗ). Xem plan `docs/superpowers/plans/2026-09-24-01a-gd0-infra-schema.md` **Task 2** — bước đầu là thu thập
`docs/infra/INPUTS.md` (tên miền, VPS, registry…) trước khi viết bất kỳ file deploy nào.

### Trước khi go-live (chưa làm — cổng chặn của chủ dự án)

- **Giới hạn tần suất đăng nhập** (chống dò mật khẩu): ở Caddy (rate limit) hoặc trong app.
- **Header bảo mật** ở Caddy: `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`, cùng các header cơ bản khác.
- Tuỳ chọn: **kiểm `Origin`** cho mọi request không phải GET tới `/api/*` (phòng CSRF bổ sung cho cookie SameSite).
- IP trong nhật ký lấy từ hop đầu `X-Forwarded-For`: chỉ đáng tin khi app đứng sau Caddy (Caddy ghi đè header này) —
  không mở cổng app trực tiếp ra Internet.
- Chủ dòng giá vốn đơn bán (`SALE`) phải được đăng ký ở `src/server/inventory/owners-register.ts` trước khi ghi đơn bán
  thật (xem `docs/engine-fifo.md` §0).
