# GĐ0a — Hạ tầng, schema trụ nền, phân quyền server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng repo Next.js chạy được trong Docker theo khuôn `setup-project`, CSDL PostgreSQL với đủ "trụ nền" (kỳ, lớp lô FIFO, sổ cái, phân quyền, audit append-only, idempotency), và lớp phân quyền/audit/idempotency phía server — tất cả có test tự động.

**Architecture:** 1 project Next.js 15 → image `runner` (standalone) + image `migrator` (chạy `prisma migrate deploy` + seed trước khi swap container). Prisma multi-file schema ở `prisma/schema/`, các ràng buộc Prisma không mô hình được (CHECK, trigger audit append-only, GRANT theo role) nằm trong migration SQL thô đầu tiên. Test tích hợp chạy trên Postgres thật (container `pgtest`, cổng 5434) vì engine FIFO cần advisory lock/transaction thật.

**Tech Stack:** Next.js 15, TypeScript, Prisma 6, PostgreSQL 15, Vitest, Docker, GitHub Actions, Caddy.

**Spec:** `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md` (Phần 1, 2.1, 2.3, 2.4, 6.6, 7-M1, T1, T2, T5). Master plan: `2026-09-24-00-master-plan.md` (Global Constraints + quyết định D-1…D-10 áp dụng nguyên văn).

## Global Constraints

Chép từ master plan — áp cho mọi task ở đây:

- Kiểu số: tiền `Decimal(18,2)`, số lượng `Decimal(18,3)`, giá vốn đơn vị `Decimal(18,4)`, hệ số quy đổi `Decimal(18,6)`.
- KHÔNG có cột số dư chạy (`running_*`, `balance*`) ở bất kỳ bảng nào.
- Bảng Prisma `PascalCase` + `@@map("snake_case")`; cột `camelCase`; SQL thô quote `"periodId"`.
- Dockerfile: `deps → build → migrator → runner (CUỐI)`; MỌI nơi build ghi `target:` rõ; `output: "standalone"`.
- Secret thật chỉ ở `.env` trên VPS + GitHub Secrets. `.env`, `.env.local`, `.env.*.local` nằm trong `.gitignore` + `.dockerignore`.
- Auth = Credentials (D-1). 2 DB role (D-2): `MIGRATE_DATABASE_URL` (owner) vs `DATABASE_URL` (`app_rw`).
- Mỗi task kết thúc bằng: `npm run lint && npm run typecheck && npm test` xanh (từ Task 3 trở đi có DB) rồi commit.

## Review Focus (phần thuộc plan này)

- Bấm 2 lần / retry khi tạo chứng từ → chỉ 1 bản ghi (Task 5, `withIdempotency`).
- Chạm thẳng DB bằng role ứng dụng hoặc chủ sở hữu vẫn không sửa/xoá được `audit_log` (Task 3).
- Người dùng không có quyền không nhận được field nhạy cảm dù DTO lồng nhiều tầng, kể cả mảng dòng hàng (Task 5, `redactDeep`).
- Bảng chứng từ mới quên `periodId/createdBy/createdAt` hoặc thêm cột số dư chạy → test rà DMMF đỏ (Task 4).

---

## File Structure (plan này tạo)

| File | Trách nhiệm |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | tooling, script chuẩn |
| `.gitignore`, `.dockerignore`, `.env.example`, `.env.test` | ignore secret; mẫu env; env test (giá trị bỏ đi) |
| `Dockerfile`, `docker-compose.yml`, `next.config.ts` | khuôn `setup-project` |
| `.github/workflows/deploy.yml` | CI test → build → migrate → seed → swap container |
| `docs/infra/{INPUTS,RUNBOOK,VERIFY}.md`, `docs/infra/caddy/<SLUG>.caddy` | giá trị hạ tầng thật, runbook, checklist xác minh |
| `prisma/schema/{base,system,master,period,inventory,ledger}.prisma` | schema theo miền |
| `prisma/migrations/<ts>_foundation/migration.sql` | DDL sinh tự động + SQL thô (CHECK, trigger, GRANT) |
| `prisma/seed-lib.ts`, `prisma/seed.ts` | seed idempotent (quyền, vai trò, công ty, kỳ, admin khởi tạo) |
| `tests/global-setup.ts`, `tests/setup-env.ts`, `tests/helpers/{db,factories}.ts` | hạ tầng test |
| `tests/db/foundation.test.ts`, `tests/schema/invariants.test.ts` | test ràng buộc DB + DMMF |
| `src/lib/prisma.ts` | Prisma client singleton |
| `src/lib/permissions/{catalog,guard,scope,redact}.ts` | danh mục quyền, kiểm quyền, phạm vi dữ liệu, ẩn field |
| `src/server/audit/write.ts` | `writeAudit` |
| `src/server/idempotency/with-idempotency.ts` | `withIdempotency` |
| `scripts/gen-db-schema.sh` | sinh `db/db_schema.sql` cho `crm-design` |

---

### Task 1: Scaffold repo, tooling, test harness cơ bản

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts` (bản tạm), `vitest.config.ts`, `.gitignore`, `.dockerignore`
- Create: `src/lib/version.ts`, `tests/smoke.test.ts`
- Create: `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md` (bản sao)

**Interfaces:**
- Produces: script `npm run lint | typecheck | test | db:migrate | db:deploy | db:seed | db:schema`; alias `@/*` → `src/*`; export `APP_NAME` từ `@/lib/version`.

- [ ] **Step 1: Khởi tạo git và chép spec vào repo**

```bash
cd DH_Crm
git init -b main
mkdir -p docs/spec
cp ../MASTER_SPEC_TRIEN_KHAI_v2.md docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md
```

- [ ] **Step 2: Tạo app Next.js 15 (không Tailwind — cài Tailwind 3.4 ở GĐ0b Task 7 để khớp `tailwind.config` của `crm-design`)**

```bash
npx create-next-app@15 . --ts --eslint --app --src-dir --import-alias "@/*" --use-npm --no-tailwind --no-turbopack --yes
```
Expected: sinh `src/app`, `package.json`, `tsconfig.json`, `eslint.config.mjs`. Nếu CLI phàn nàn thư mục không rỗng do `docs/`, chạy lại với `--yes` hoặc tạm chuyển `docs/` ra ngoài rồi chuyển lại.

- [ ] **Step 3: Cài phụ thuộc runtime và dev**

```bash
npm i next-auth@4 @prisma/client@6 bcryptjs zod@3 @tanstack/react-query@5 zustand@5 react-hook-form @hookform/resolvers lucide-react clsx exceljs
npm i -D prisma@6 @types/bcryptjs vitest vite-tsconfig-paths dotenv tsx
```
Kiểm tra phiên bản thật đã cài (skill `setup-project`: luôn đối chiếu, đừng tin trí nhớ):

Run: `npm ls next react next-auth prisma @prisma/client tailwindcss 2>/dev/null | head -20`
Expected: `next@15.x`, `react@19.x`, `next-auth@4.24.x`, `prisma@6.x` (từ 6.7 trở lên vì cần multi-file schema GA). Nếu `prisma < 6.7`: `npm i -D prisma@^6.7 && npm i @prisma/client@^6.7`.

- [ ] **Step 4: Sửa `package.json` — script và cấu hình prisma**

Thêm/ghi đè các khoá sau (giữ nguyên phần còn lại create-next-app sinh ra):

```json
{
  "name": "danghuong-app",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:seed": "prisma db seed",
    "db:schema": "bash scripts/gen-db-schema.sh"
  },
  "prisma": {
    "schema": "prisma/schema",
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 5: `.gitignore` và `.dockerignore` (chống lộ secret ngay từ commit đầu — pitfalls mục 6)**

`.gitignore` (thêm vào cuối bản create-next-app sinh ra nếu thiếu):
```
node_modules/
.next/
.env
.env.local
.env.*.local
*.pem
npm-debug.log*
coverage/
```
`.dockerignore`:
```
node_modules
.next
.git
.github
.env
.env.local
.env.*.local
docker-compose.yml
README.md
*.md
docs
tests
```
Lưu ý: `.env.test` KHÔNG bị ignore (chỉ chứa giá trị bỏ đi cho DB test cục bộ) nhưng vì `.dockerignore` không liệt kê nó nên nó vào build context — chấp nhận được; đã có `tests` bị loại và image runner không copy `.env*`.

- [ ] **Step 6: Viết test smoke (kiểm alias `@/` và vitest hoạt động)**

`src/lib/version.ts`:
```ts
export const APP_NAME = "Xưởng tôn Đặng Hương";
```
`tests/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/version";

describe("smoke", () => {
  it("alias @/ hoạt động", () => {
    expect(APP_NAME).toBe("Xưởng tôn Đặng Hương");
  });
});
```
`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    fileParallelism: false, // các file test dùng chung 1 DB thật
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```
(`globalSetup`/`setupFiles` thêm ở Task 3 khi đã có schema.)

- [ ] **Step 7: Chạy để xác nhận**

Run: `npm test`
Expected: `1 passed`.
Run: `npm run typecheck && npm run lint`
Expected: không lỗi.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 15 + vitest + spec vào repo"
```

---

### Task 2: Hạ tầng Docker / CI / Caddy / env theo `setup-project`

**Files:**
- Create: `docs/infra/INPUTS.md`, `docs/infra/RUNBOOK.md`, `docs/infra/VERIFY.md`, `docs/infra/caddy/<SLUG>.caddy`
- Create: `Dockerfile`, `docker-compose.yml`, `.env.example`, `.env.test`, `.github/workflows/deploy.yml`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: giá trị thật `SLUG`, `DOMAIN`, `APP_PORT`, `OWNER/REPO` (master plan mục 3).
- Produces: image target `runner` (CMD `node server.js`) và `migrator` (CMD `npx prisma migrate deploy`); workflow deploy; runbook VPS.

> **CẤM viết file deploy khi chưa có INPUTS.** Bước 1 là cổng chặn.

- [ ] **Step 1: Cổng đầu vào — hỏi người dùng và ghi `docs/infra/INPUTS.md`**

Hỏi người dùng đúng 4 giá trị + 2 giá trị phụ, KHÔNG tự đặt:

```markdown
# Giá trị hạ tầng thật (KHÔNG chứa secret)

| Khoá | Giá trị | Ghi chú |
|---|---|---|
| SLUG | ______ | khớp MỌI nơi (container, user deploy, file caddy, image registry) |
| DOMAIN | ______ | DNS đã trỏ về VPS? ☐ có ☐ chưa |
| APP_PORT | ______ | port đang TRỐNG trên VPS (đã kiểm `ss -ltn`) |
| OWNER/REPO | ______ | repo GitHub |
| VPS_IP | ______ | |
| REGISTRY | ______ | domain registry riêng có sẵn |
```
Nếu chưa đủ → DỪNG task này, báo người dùng còn thiếu gì. (Các Task 3–5 không cần INPUTS, có thể làm trước.)

Sau khi có giá trị, dùng biến shell cho các bước dưới (thay bằng giá trị thật):
```bash
SLUG=...; DOMAIN=...; APP_PORT=...; OWNER_REPO=...
```

- [ ] **Step 2: `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // BẮT BUỘC cho Dockerfile stage runner (.next/standalone). Thiếu → không có server.js.
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 3: `Dockerfile` (khuôn `setup-project`, `runner` ở CUỐI; migrator có thêm phần seed)**

```dockerfile
# ---- Stage 1: deps ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ---- Stage 2: build ----
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Stage 3: migrator — migrate deploy + seed (FROM deps cho nhẹ) ----
FROM deps AS migrator
WORKDIR /app
COPY prisma ./prisma
# seed đọc danh mục quyền (file thuần dữ liệu, không alias @/)
COPY src/lib/permissions/catalog.ts ./src/lib/permissions/catalog.ts
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- Stage 4 (CUỐI): runner — image app chạy thật, non-root ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache openssl \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```
Nếu `create-next-app` không sinh thư mục `public/`, tạo `mkdir -p public && touch public/.gitkeep` (Dockerfile `COPY --from=build /app/public` sẽ lỗi nếu thiếu).

- [ ] **Step 4: `docker-compose.yml` — dev + DB test (CHỈ dev local)**

```yaml
services:
  postgres:
    image: postgres:15
    container_name: postgres_${SLUG:-dh}_local
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: dev_only_change_me
      POSTGRES_DB: dh_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  # DB dành riêng cho test (xoá sạch mỗi lần chạy, nằm trên RAM)
  pgtest:
    image: postgres:15
    container_name: dh_pgtest
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: dh_test
    ports:
      - "5434:5432"
    tmpfs:
      - /var/lib/postgresql/data

  app:
    build:
      context: .
      target: runner # LUÔN ghi rõ target (pitfalls mục 1)
    container_name: ${SLUG:-dh}_app_local
    profiles: ["full"]
    depends_on:
      - postgres
    env_file:
      - .env.local
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

- [ ] **Step 5: `.env.example` (mẫu, giá trị GIẢ; đủ mọi biến code đọc — pitfalls mục 4)**

```bash
NODE_ENV=production

# --- Database ---
# host = TÊN CONTAINER postgres (cùng network pgnet), KHÔNG phải localhost.
# Mật khẩu chứa @ : / # ? % phải percent-encode (@→%40 :→%3A /→%2F #→%23 ?→%3F %→%25);
# tốt nhất sinh mật khẩu không có ký tự đặc biệt: openssl rand -base64 24 | tr -d '/+=@:#?%'
# App chạy bằng role app_rw (không UPDATE/DELETE được audit_log):
DATABASE_URL=postgresql://app_rw:CHANGE_ME@postgres___SLUG__:5432/__SLUG___db
# Migrator chạy bằng owner (tạo bảng/trigger):
MIGRATE_DATABASE_URL=postgresql://__SLUG___user:CHANGE_ME@postgres___SLUG__:5432/__SLUG___db

# --- next-auth v4 ---
# AUTH_SECRET: openssl rand -base64 32 (code đọc ĐÚNG tên này: secret: process.env.AUTH_SECRET)
AUTH_SECRET=CHANGE_ME_run_openssl_rand_base64_32
# URL công khai thật (https). Thiếu → "There is a problem with the server configuration".
NEXTAUTH_URL=https://CHANGE_ME.example.com

# --- Khởi tạo lần đầu (seed): tạo tài khoản 'admin' vai trò Giám đốc nếu bảng users trống ---
# Bỏ trống → không tạo. Sau lần đăng nhập đầu, hệ thống bắt đổi mật khẩu.
BOOTSTRAP_ADMIN_PASSWORD=
```
Bỏ hẳn `GOOGLE_CLIENT_ID/SECRET` (D-1). Thay `__SLUG__` bằng slug thật:
```bash
sed -i "s/__SLUG__/$SLUG/g" .env.example
```
`.env.test` (commit được, giá trị bỏ đi):
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/dh_test
MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/dh_test
AUTH_SECRET=test-only-secret
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 6: `.github/workflows/deploy.yml`**

Thay `<SLUG>` bằng slug thật. Job `test` chạy TRƯỚC (gate), rồi mới build/deploy. Bước migrate rồi seed chạy TRƯỚC khi swap container (fail thì container cũ vẫn chạy).

```yaml
name: Deploy

on:
  push:
    branches: [main]

env:
  SLUG: <SLUG>
  IMAGE_NAME: ${{ secrets.REGISTRY_URL }}/<SLUG>
  APP_PORT: ${{ secrets.APP_PORT }}

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: dh_test
        ports:
          - 5434:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Log in to private registry
        uses: docker/login-action@v3
        with:
          registry: ${{ secrets.REGISTRY_URL }}
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASS }}

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build & push app image
        uses: docker/build-push-action@v6
        with:
          context: .
          target: runner
          push: true
          tags: ${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build & push migrate image
        uses: docker/build-push-action@v6
        with:
          context: .
          target: migrator
          push: true
          tags: ${{ env.IMAGE_NAME }}:migrate
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          envs: IMAGE_NAME,APP_PORT,SLUG
          script: |
            set -e
            ENV_FILE="/home/${{ secrets.VPS_USER }}/app/.env"

            echo "==> Login registry"
            echo "${{ secrets.REGISTRY_PASS }}" | docker login ${{ secrets.REGISTRY_URL }} \
              -u "${{ secrets.REGISTRY_USER }}" --password-stdin

            echo "==> Pull images"
            docker pull "$IMAGE_NAME:latest"
            docker pull "$IMAGE_NAME:migrate"

            echo "==> Migrate TRƯỚC (fail thì container cũ vẫn chạy)"
            docker run --rm --network pgnet --env-file "$ENV_FILE" "$IMAGE_NAME:migrate"

            echo "==> Seed (idempotent: quyền, vai trò, công ty, kỳ, admin khởi tạo)"
            docker run --rm --network pgnet --env-file "$ENV_FILE" "$IMAGE_NAME:migrate" npx prisma db seed

            echo "==> Swap app container"
            docker stop "${SLUG}_app" 2>/dev/null || true
            docker rm   "${SLUG}_app" 2>/dev/null || true
            docker run -d \
              --name "${SLUG}_app" \
              --restart always \
              --network pgnet \
              --env-file "$ENV_FILE" \
              -p "127.0.0.1:${APP_PORT}:3000" \
              "$IMAGE_NAME:latest"

            echo "==> Prune old images"
            docker image prune -f
```

- [ ] **Step 7: Caddy site + RUNBOOK + VERIFY**

`docs/infra/caddy/<SLUG>.caddy` (bản tham chiếu; file thật ở `/etc/caddy/conf.d/<SLUG>.caddy` trên VPS):
```
<DOMAIN> {
    reverse_proxy 127.0.0.1:<APP_PORT>
}
```
`docs/infra/RUNBOOK.md` — chép runbook `setup-project` (10 bước) đã thay giá trị thật; KHÁC bản gốc ở 3 điểm: (a) Bước 1 thêm tạo role `app_rw`; (b) `.env` có 2 URL; (c) bỏ Bước 7 Google. Khối lệnh chỉ chứa lệnh trần (giải thích viết trước/sau), mỗi lần 1–2 lệnh:

```markdown
# Runbook cấp phát trên VPS (làm 1 lần)

Giá trị: xem docs/infra/INPUTS.md. KHÔNG dán secret vào file này.

## Bước 1 — Database
Sinh 2 mật khẩu (chủ sở hữu, role ứng dụng), lưu vào trình quản lý mật khẩu:
    openssl rand -base64 24 | tr -d '/+=@:#?%'
Tạo DB:
    mkdir -p /opt/postgres_<SLUG>
    docker run -d --name postgres_<SLUG> --restart always -e POSTGRES_USER=<SLUG>_user -e POSTGRES_PASSWORD=<OWNER_PASSWORD> -e POSTGRES_DB=<SLUG>_db -v /opt/postgres_<SLUG>:/var/lib/postgresql/data postgres:15
    docker network connect pgnet postgres_<SLUG>
Tạo role ứng dụng TRƯỚC lần deploy đầu (migration GRANT cho role này nếu nó đã tồn tại):
    docker exec -it postgres_<SLUG> psql -U <SLUG>_user -d <SLUG>_db
Trong psql:
    CREATE ROLE app_rw LOGIN PASSWORD '<APP_PASSWORD>';
    GRANT CONNECT ON DATABASE <SLUG>_db TO app_rw;
    \q

## Bước 2 — User deploy + SSH key   (giữ nguyên setup-project runbook Bước 2)
## Bước 3 — Quyền reload Caddy      (giữ nguyên Bước 3)
## Bước 4 — Thư mục + .env production
Tạo /home/deploy_<SLUG>/app/.env theo .env.example. DATABASE_URL dùng user app_rw; MIGRATE_DATABASE_URL dùng <SLUG>_user. Kiểm đúng tên biến code đọc:
    grep -E "^(AUTH_SECRET|NEXTAUTH_URL|DATABASE_URL|MIGRATE_DATABASE_URL)=" /home/deploy_<SLUG>/app/.env
## Bước 5 — Caddy   (giữ nguyên Bước 5, dùng docs/infra/caddy/<SLUG>.caddy)
## Bước 6 — pgAdmin (tuỳ chọn)
## Bước 7 — (BỎ) Google OAuth: dự án dùng đăng nhập username/mật khẩu (D-1)
## Bước 8 — GitHub Secrets + deploy lần đầu (giữ nguyên Bước 8: VPS_SSH_KEY, VPS_HOST, VPS_USER, APP_PORT, REGISTRY_URL, REGISTRY_USER, REGISTRY_PASS)
## Bước 9 — Migration lần đầu: workflow tự chạy stage migrator + seed → bỏ qua
## Bước 10 — Xác minh: làm theo docs/infra/VERIFY.md
```
`docs/infra/VERIFY.md` — checklist `verification-checklist.md` đã đổi phần Auth:
```markdown
# Xác minh trước khi báo "hoạt động OK"
Build pass / deploy xanh KHÔNG phải bằng chứng. Phải mở trang thật, đăng nhập thật, tạo bản ghi thật.

## Hạ tầng
- [ ] docker ps: <SLUG>_app đang Up, đúng image, đúng port
- [ ] docker logs --tail 50 <SLUG>_app: không lỗi lặp (NO_SECRET, ECONNREFUSED, P1001)
- [ ] https://<DOMAIN> mở được, cert hợp lệ
- [ ] Postgres chạy, join network pgnet
## Database
- [ ] \dt: đủ bảng như prisma/schema
- [ ] Bảng permissions/roles có dữ liệu (seed chạy), có đúng 1 dòng periods.isOpen = true
- [ ] Đăng nhập psql bằng app_rw: UPDATE audit_log ... → "permission denied"
## Auth (Credentials)
- [ ] Đăng nhập admin bằng BOOTSTRAP_ADMIN_PASSWORD trên trình duyệt THẬT; bị bắt đổi mật khẩu
- [ ] Đăng xuất, đăng nhập lại bằng mật khẩu mới — vào được
- [ ] Tài khoản bị khoá không đăng nhập được
## CRUD
- [ ] Tạo 1 người dùng qua UI; reload còn; sửa; khoá/mở khoá
- [ ] Mỗi thao tác trên xuất hiện trong Nhật ký thao tác (số cũ/số mới)
## CI/CD
- [ ] Push thay đổi nhỏ lên main → Actions xanh (test + build + deploy); app vẫn phản hồi
## Bảo mật
- [ ] git log --all -- .env  → rỗng; grep secret trong repo → không có
- [ ] BOOTSTRAP_ADMIN_PASSWORD đã xoá khỏi .env trên VPS sau lần đăng nhập đầu
```

- [ ] **Step 8: Kiểm tra tĩnh (chưa build image — Task 3 mới có schema để `prisma generate`)**

Run: `docker compose config > /dev/null && echo compose-ok`
Expected: `compose-ok`.
Run: `grep -n "target:" .github/workflows/deploy.yml docker-compose.yml`
Expected: có `target: runner` ở compose, `target: runner` và `target: migrator` ở workflow — KHÔNG có chỗ build nào thiếu `target`.
Run: `grep -n "^FROM" Dockerfile`
Expected: thứ tự `deps, build, deps AS migrator, runner` — `runner` là dòng FROM CUỐI CÙNG.
Run: `grep -c "__SLUG__\|CHANGE_ME_run\|<SLUG>" .github/workflows/deploy.yml`
Expected: `0` (đã thay hết placeholder trong workflow). `.env.example` được phép còn `CHANGE_ME`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "infra: Dockerfile, compose, CI/CD, runbook theo setup-project"
```

---

### Task 3: Schema trụ nền + migration + ràng buộc DB thô + test hạ tầng DB

**Files:**
- Create: `prisma/schema/base.prisma`, `system.prisma`, `master.prisma`, `period.prisma`, `inventory.prisma`, `ledger.prisma`
- Create: `prisma/migrations/<ts>_foundation/migration.sql` (sinh rồi bổ sung SQL thô)
- Create: `tests/global-setup.ts`, `tests/setup-env.ts`, `tests/helpers/db.ts`, `tests/db/foundation.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces (dùng ở mọi plan sau): model Prisma `User, Role, Permission, RolePermission, UserRole, AuditLog, CompanySetting, IdempotencyKey, PartnerGroup, Partner, Product, ProductUnit, Warehouse, CashAccount, Period, OpeningStock, OpeningDebt, OpeningCash, OpeningDiscount, StockLedger, CostLayer, CostConsumption, PartnerLedger, CashLedger, DiscountLedger`; enum `StockDocType`; helper test `prisma`, `resetDb()`.

- [ ] **Step 1: Bật DB dev + DB test**

```bash
docker compose up -d postgres pgtest
```
Tạo `.env` (KHÔNG commit) cho dev:
```bash
DATABASE_URL=postgresql://postgres:dev_only_change_me@localhost:5432/dh_dev
MIGRATE_DATABASE_URL=postgresql://postgres:dev_only_change_me@localhost:5432/dh_dev
AUTH_SECRET=dev-only-secret
NEXTAUTH_URL=http://localhost:3000
```
Run: `docker compose ps`
Expected: `postgres` và `dh_pgtest` đều `running`.

- [ ] **Step 2: `prisma/schema/base.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  // Migrate luôn dùng owner (tạo bảng/trigger); app chạy bằng role app_rw (D-2)
  directUrl = env("MIGRATE_DATABASE_URL")
}
```

- [ ] **Step 3: `prisma/schema/system.prisma` (spec 2.1)**

```prisma
model User {
  id                 Int      @id @default(autoincrement())
  username           String   @unique
  passwordHash       String
  fullName           String
  isLocked           Boolean  @default(false)
  mustChangePassword Boolean  @default(false)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  roles         UserRole[]
  ownedPartners Partner[]  @relation("PartnerOwner")

  @@map("users")
}

model Role {
  id          Int     @id @default(autoincrement())
  name        String  @unique
  description String?
  isSystem    Boolean @default(false)

  permissions RolePermission[]
  users       UserRole[]

  @@map("roles")
}

model Permission {
  id          Int     @id @default(autoincrement())
  code        String  @unique // vd: order.create, cost.view, period.close
  label       String
  groupName   String
  isSensitive Boolean @default(false)

  roles RolePermission[]

  @@map("permissions")
}

model RolePermission {
  roleId       Int
  permissionId Int
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
  @@map("role_permissions")
}

model UserRole {
  userId Int
  roleId Int
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   Role @relation(fields: [roleId], references: [id], onDelete: Restrict)

  @@id([userId, roleId])
  @@map("user_roles")
}

// APPEND-ONLY: chặn ở DB bằng REVOKE cho app_rw + trigger (migration SQL thô).
// userId KHÔNG có FK để dòng audit tồn tại độc lập với vòng đời user.
model AuditLog {
  id         Int      @id @default(autoincrement())
  userId     Int?
  action     String
  entity     String
  entityId   String?
  beforeJson Json?
  afterJson  Json?
  ip         String?
  at         DateTime @default(now())

  @@index([entity, entityId])
  @@index([userId, at])
  @@index([at])
  @@map("audit_log")
}

// Bảng 1 dòng (id = 1) — mục 6
model CompanySetting {
  id       Int     @id @default(1)
  name     String
  address  String?
  phone    String?
  taxCode  String?
  logo     String?
  bankInfo Json?

  @@map("company_settings")
}

// D-10: 1 khoá = 1 lần thực thi. Dòng chỉ tồn tại sau khi transaction của lần đầu commit.
model IdempotencyKey {
  userId       Int
  scope        String
  key          String
  responseJson Json?
  createdAt    DateTime @default(now())

  @@id([userId, scope, key])
  @@index([createdAt])
  @@map("idempotency_keys")
}
```

- [ ] **Step 4: `prisma/schema/master.prisma` (spec 2.2 — chỉ các danh mục mà bảng trụ nền cần FK tới)**

```prisma
enum ProductKind {
  HANG
  NVL
  THANH_PHAM
  PHU_KIEN

  @@map("product_kind")
}

enum CashType {
  CASH
  BANK

  @@map("cash_type")
}

model PartnerGroup {
  id   Int    @id @default(autoincrement())
  name String @unique

  partners Partner[]

  @@map("partner_groups")
}

model Partner {
  id           Int      @id @default(autoincrement())
  code         String   @unique
  name         String
  searchText   String   @default("") // D-9: chuẩn hoá không dấu để tìm kiếm
  groupId      Int
  isCustomer   Boolean  @default(true)
  isSupplier   Boolean  @default(false)
  ownerUserId  Int? // người bán phụ trách → quyền "chỉ khách của mình"
  debtLimit    Decimal  @default(0) @db.Decimal(18, 2)
  allowCredit  Boolean  @default(false)
  phone        String?
  address      String?
  note         String?
  isActive     Boolean  @default(true)
  mergedIntoId Int? // sau khi gộp mã (mục 65)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  group         PartnerGroup      @relation(fields: [groupId], references: [id], onDelete: Restrict)
  owner         User?             @relation("PartnerOwner", fields: [ownerUserId], references: [id], onDelete: SetNull)
  mergedInto    Partner?          @relation("PartnerMerge", fields: [mergedIntoId], references: [id], onDelete: Restrict)
  mergedFrom    Partner[]         @relation("PartnerMerge")
  openingDebts  OpeningDebt[]
  openingDisc   OpeningDiscount[]
  partnerLedger PartnerLedger[]
  discountLedger DiscountLedger[]

  @@index([groupId])
  @@index([ownerUserId])
  @@index([searchText])
  @@map("partners")
}

model Product {
  id          Int         @id @default(autoincrement())
  code        String      @unique
  name        String
  searchText  String      @default("")
  kind        ProductKind @default(HANG)
  baseUnit    String // đơn vị gốc (thường md); sổ kho & FIFO luôn tính theo đơn vị này
  minStock    Decimal     @default(0) @db.Decimal(18, 3)
  isActive    Boolean     @default(true)
  recomputing Boolean     @default(false) // engine đang tính lại chuỗi nền → chặn xuất mã này
  note        String?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  units        ProductUnit[]
  openingStock OpeningStock[]
  layers       CostLayer[]
  ledger       StockLedger[]

  @@index([searchText])
  @@index([kind])
  @@map("products")
}

model ProductUnit {
  id        Int     @id @default(autoincrement())
  productId Int
  unit      String
  factor    Decimal @db.Decimal(18, 6) // 1 unit = factor × baseUnit (mặc định; sửa được theo từng lần nhập)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, unit])
  @@map("product_units")
}

model Warehouse {
  id   Int    @id @default(autoincrement())
  name String @unique

  @@map("warehouses")
}

model CashAccount {
  id       Int      @id @default(autoincrement())
  type     CashType
  name     String   @unique
  bankNo   String?
  isActive Boolean  @default(true)

  openingCash OpeningCash[]
  ledger      CashLedger[]

  @@map("cash_accounts")
}
```

- [ ] **Step 5: `prisma/schema/period.prisma` (spec 2.3, D-7 bỏ `layer_seq`)**

```prisma
enum PeriodStatus {
  OPEN
  CLOSED

  @@map("period_status")
}

// isOpen = true khi OPEN, NULL khi CLOSED → @unique cho phép nhiều NULL nhưng chỉ MỘT true
// (tương đương partial unique index mà Prisma không mô hình được). CHECK ở migration SQL thô
// giữ isOpen luôn khớp status.
model Period {
  id        Int          @id @default(autoincrement())
  name      String
  status    PeriodStatus @default(OPEN)
  isOpen    Boolean?     @unique
  openedAt  DateTime     @default(now())
  closedAt  DateTime?
  closedBy  Int?

  openingStock    OpeningStock[]
  openingDebt     OpeningDebt[]
  openingCash     OpeningCash[]
  openingDiscount OpeningDiscount[]
  layers          CostLayer[]
  ledger          StockLedger[]
  partnerLedger   PartnerLedger[]
  cashLedger      CashLedger[]
  discountLedger  DiscountLedger[]

  @@map("periods")
}

// K1, K4 — mỗi dòng = 1 lô đầu kỳ (NVL cũng là product)
model OpeningStock {
  id        Int     @id @default(autoincrement())
  periodId  Int
  productId Int
  qty       Decimal @db.Decimal(18, 3)
  unitCost  Decimal @db.Decimal(18, 4)

  period  Period  @relation(fields: [periodId], references: [id], onDelete: Restrict)
  product Product @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@index([periodId, productId])
  @@map("opening_stock")
}

// K2: (+) khách nợ mình, (−) mình nợ NCC/khách
model OpeningDebt {
  id        Int     @id @default(autoincrement())
  periodId  Int
  partnerId Int
  amount    Decimal @db.Decimal(18, 2)

  period  Period  @relation(fields: [periodId], references: [id], onDelete: Restrict)
  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Restrict)

  @@unique([periodId, partnerId])
  @@map("opening_debt")
}

// K3
model OpeningCash {
  id            Int     @id @default(autoincrement())
  periodId      Int
  cashAccountId Int
  amount        Decimal @db.Decimal(18, 2)

  period      Period      @relation(fields: [periodId], references: [id], onDelete: Restrict)
  cashAccount CashAccount @relation(fields: [cashAccountId], references: [id], onDelete: Restrict)

  @@unique([periodId, cashAccountId])
  @@map("opening_cash")
}

// số dư chiết khấu tích lũy chưa tất toán
model OpeningDiscount {
  id        Int     @id @default(autoincrement())
  periodId  Int
  partnerId Int
  amount    Decimal @db.Decimal(18, 2)

  period  Period  @relation(fields: [periodId], references: [id], onDelete: Restrict)
  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Restrict)

  @@unique([periodId, partnerId])
  @@map("opening_discount")
}
```

- [ ] **Step 6: `prisma/schema/inventory.prisma` (spec 2.4 + D-7)**

```prisma
enum StockDocType {
  // nhập (tạo lớp)
  OPENING
  PURCHASE
  ADJ_IN
  RETURN_IN
  PRODUCTION_OUT
  STOCKTAKE_IN
  // xuất (ăn lớp)
  SALE
  ADJ_LOSS
  WRITE_OFF
  RETURN_SUPPLIER
  PRODUCTION_USE
  PROCESSING_USE
  STOCKTAKE_OUT

  @@map("stock_doc_type")
}

// Sổ kho: mỗi dòng = 1 phát sinh nhập HOẶC xuất của 1 mã hàng, trỏ về chứng từ gốc.
// KHÔNG có cột số dư chạy (spec 1.3).
model StockLedger {
  id             Int          @id @default(autoincrement())
  periodId       Int
  productId      Int
  docType        StockDocType
  docId          Int
  docLineId      Int
  qtyIn          Decimal      @default(0) @db.Decimal(18, 3)
  qtyOut         Decimal      @default(0) @db.Decimal(18, 3)
  unitCostOut    Decimal      @default(0) @db.Decimal(18, 4)
  qtyProvisional Decimal      @default(0) @db.Decimal(18, 3) // phần xuất chưa có lớp (bán âm kho — 3.3)
  at             DateTime
  createdBy      Int
  createdAt      DateTime     @default(now())

  period       Period            @relation(fields: [periodId], references: [id], onDelete: Restrict)
  product      Product           @relation(fields: [productId], references: [id], onDelete: Restrict)
  layer        CostLayer?
  consumptions CostConsumption[]

  @@index([periodId, productId, at])
  @@index([docType, docId])
  @@index([docType, docLineId])
  @@map("stock_ledger")
}

// Lớp lô FIFO. Thứ tự tiêu thụ = (at, id) — D-7 (không có cột seq).
model CostLayer {
  id            Int          @id @default(autoincrement())
  periodId      Int
  productId     Int
  sourceDocType StockDocType
  sourceDocId   Int
  sourceLineId  Int
  ledgerId      Int          @unique // dòng nhập tương ứng trong stock_ledger
  qtyIn         Decimal      @db.Decimal(18, 3)
  qtyRemaining  Decimal      @db.Decimal(18, 3)
  unitCost      Decimal      @db.Decimal(18, 4)
  at            DateTime
  // Lớp có giá vốn PHỤ THUỘC dòng khác (trả hàng = giá vốn dòng bán gốc; thành phẩm SX = tổng vốn NVL)
  costRefType   StockDocType?
  costRefId     Int?
  costRefQty    Decimal?     @db.Decimal(18, 3)
  createdAt     DateTime     @default(now())

  period       Period            @relation(fields: [periodId], references: [id], onDelete: Restrict)
  product      Product           @relation(fields: [productId], references: [id], onDelete: Restrict)
  ledger       StockLedger       @relation(fields: [ledgerId], references: [id], onDelete: Restrict)
  consumptions CostConsumption[]

  @@index([periodId, productId, at])
  @@index([costRefType, costRefId])
  @@map("cost_layers")
}

// Mỗi lần xuất ghi rõ ăn lớp nào bao nhiêu → hoàn lớp chính xác khi sửa/hủy.
model CostConsumption {
  id        Int          @id @default(autoincrement())
  layerId   Int
  ledgerId  Int // dòng xuất trong stock_ledger
  docType   StockDocType
  docLineId Int
  qty       Decimal      @db.Decimal(18, 3)
  unitCost  Decimal      @db.Decimal(18, 4)

  layer  CostLayer   @relation(fields: [layerId], references: [id], onDelete: Restrict)
  ledger StockLedger @relation(fields: [ledgerId], references: [id], onDelete: Restrict)

  @@index([layerId])
  @@index([ledgerId])
  @@index([docType, docLineId])
  @@map("cost_consumptions")
}
```

- [ ] **Step 7: `prisma/schema/ledger.prisma` (spec 2.7 — 3 sổ cái, không số dư chạy)**

```prisma
enum DiscountSettleMethod {
  CASH
  OFFSET

  @@map("discount_settle_method")
}

// SỔ CÔNG NỢ DUY NHẤT (khách & NCC). Quy ước: số dư = Σ(debit − credit); dương = đối tác nợ mình.
// Đơn giao/nhập hàng/thu/chi/trả hàng/điều chỉnh/gộp nợ đều sinh dòng ở đây; không có bảng debts riêng.
model PartnerLedger {
  id        Int      @id @default(autoincrement())
  periodId  Int
  partnerId Int
  debit     Decimal  @default(0) @db.Decimal(18, 2)
  credit    Decimal  @default(0) @db.Decimal(18, 2)
  docType   String
  docId     Int
  at        DateTime
  createdBy Int
  createdAt DateTime @default(now())

  period  Period  @relation(fields: [periodId], references: [id], onDelete: Restrict)
  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Restrict)

  @@index([periodId, partnerId, at])
  @@index([docType, docId])
  @@map("partner_ledger")
}

model CashLedger {
  id            Int      @id @default(autoincrement())
  periodId      Int
  cashAccountId Int
  amountIn      Decimal  @default(0) @db.Decimal(18, 2)
  amountOut     Decimal  @default(0) @db.Decimal(18, 2)
  docType       String
  docId         Int
  at            DateTime
  createdBy     Int
  createdAt     DateTime @default(now())

  period      Period      @relation(fields: [periodId], references: [id], onDelete: Restrict)
  cashAccount CashAccount @relation(fields: [cashAccountId], references: [id], onDelete: Restrict)

  @@index([periodId, cashAccountId, at])
  @@index([docType, docId])
  @@map("cash_ledger")
}

// Sổ chiết khấu tích lũy: mỗi dòng đơn cộng amountIn; tất toán/đảo trừ amountOut.
// orderLineId chưa có FK — bảng sale_order_lines do GĐ1c thêm và bổ sung FK ở migration đó.
model DiscountLedger {
  id           Int                   @id @default(autoincrement())
  periodId     Int
  partnerId    Int
  orderLineId  Int?
  amountIn     Decimal               @default(0) @db.Decimal(18, 2)
  amountOut    Decimal               @default(0) @db.Decimal(18, 2)
  settleMethod DiscountSettleMethod?
  docType      String
  docId        Int
  isReconciled Boolean               @default(false)
  reconciledBy Int?
  reconciledAt DateTime?
  at           DateTime
  createdBy    Int
  createdAt    DateTime              @default(now())

  period  Period  @relation(fields: [periodId], references: [id], onDelete: Restrict)
  partner Partner @relation(fields: [partnerId], references: [id], onDelete: Restrict)

  @@index([periodId, partnerId, at])
  @@index([docType, docId])
  @@map("discount_ledger")
}
```

- [ ] **Step 8: Kiểm tra schema hợp lệ**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema is valid`.
Nếu lỗi "Argument ... schema folder": xác nhận `package.json` có `"prisma": {"schema": "prisma/schema"}` và Prisma ≥ 6.7.

- [ ] **Step 9: Sinh migration (chưa áp SQL thô)**

Run: `npx prisma migrate dev --create-only --name foundation`
Expected: tạo `prisma/migrations/<timestamp>_foundation/migration.sql`, KHÔNG áp vào DB.

- [ ] **Step 10: Viết hạ tầng test DB**

`tests/setup-env.ts`:
```ts
import { config } from "dotenv";

// Không override biến đã có (CI truyền env trực tiếp)
config({ path: ".env.test" });
```
`tests/global-setup.ts` — reset DB test về sạch, tạo role `app_rw`, áp migration (kiểm chứng luôn migration chạy từ đầu):
```ts
import { execSync } from "node:child_process";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

export default async function setup() {
  config({ path: ".env.test" });
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("Thiếu MIGRATE_DATABASE_URL cho test");
  const dbName = new URL(url).pathname.slice(1);
  // Chốt an toàn: không bao giờ DROP SCHEMA trên DB không phải DB test
  if (!dbName.endsWith("_test")) {
    throw new Error(`Từ chối reset DB "${dbName}" (tên phải kết thúc bằng _test)`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await prisma.$executeRawUnsafe("CREATE SCHEMA public");
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
          CREATE ROLE app_rw LOGIN PASSWORD 'app_rw_test';
        END IF;
      END $$;
    `);
  } finally {
    await prisma.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env },
  });
}
```
`tests/helpers/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** Xoá sạch dữ liệu mọi bảng (trừ _prisma_migrations), reset id. */
export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$transaction([
    prisma.$executeRawUnsafe("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_truncate"),
    prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`),
    prisma.$executeRawUnsafe("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_truncate"),
  ]);
}
```
Sửa `vitest.config.ts` thêm `globalSetup: ["tests/global-setup.ts"]` và `setupFiles: ["tests/setup-env.ts"]` vào `test`.

- [ ] **Step 11: Viết test ràng buộc DB (sẽ ĐỎ vì migration chưa có SQL thô)**

`tests/db/foundation.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

async function seedBasics() {
  const period = await prisma.period.create({
    data: { name: "K1", status: "OPEN", isOpen: true },
  });
  const product = await prisma.product.create({
    data: { code: "SP1", name: "Tôn 0.45", baseUnit: "md" },
  });
  return { period, product };
}

describe("kỳ (periods)", () => {
  it("chỉ cho đúng 1 kỳ OPEN", async () => {
    await prisma.period.create({ data: { name: "K1", status: "OPEN", isOpen: true } });
    await expect(
      prisma.period.create({ data: { name: "K2", status: "OPEN", isOpen: true } }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("cho phép nhiều kỳ CLOSED", async () => {
    await prisma.period.create({ data: { name: "K1", status: "CLOSED", isOpen: null } });
    await prisma.period.create({ data: { name: "K2", status: "CLOSED", isOpen: null } });
    expect(await prisma.period.count()).toBe(2);
  });

  it("isOpen không được lệch status", async () => {
    await expect(
      prisma.period.create({ data: { name: "K1", status: "CLOSED", isOpen: true } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.period.create({ data: { name: "K2", status: "OPEN", isOpen: null } }),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("audit_log append-only", () => {
  it("chủ sở hữu DB cũng không UPDATE được (trigger)", async () => {
    const row = await prisma.auditLog.create({ data: { action: "a", entity: "e" } });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: "b" } }),
    ).rejects.toThrow(/append-only/);
  });

  it("chủ sở hữu DB cũng không DELETE được (trigger)", async () => {
    const row = await prisma.auditLog.create({ data: { action: "a", entity: "e" } });
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it("không TRUNCATE được (trigger)", async () => {
    await expect(prisma.$executeRawUnsafe("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
  });

  it("role app_rw: INSERT/SELECT được, UPDATE/DELETE bị từ chối quyền", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(`INSERT INTO audit_log (action, entity) VALUES ('a', 'e')`);
      const rows = await tx.$queryRawUnsafe<{ id: number }[]>("SELECT id FROM audit_log");
      expect(rows.length).toBe(1);
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
        await tx.$executeRawUnsafe("UPDATE audit_log SET action = 'x'");
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
        await tx.$executeRawUnsafe("DELETE FROM audit_log");
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("role app_rw đọc/ghi được bảng nghiệp vụ", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(`INSERT INTO warehouses (name) VALUES ('Kho 1')`);
      await tx.$executeRawUnsafe(`UPDATE warehouses SET name = 'Kho A'`);
    });
  });
});

describe("ràng buộc engine kho", () => {
  it("cost_layers: qtyRemaining ∈ [0, qtyIn], qtyIn > 0", async () => {
    const { period, product } = await seedBasics();
    const ledger = await prisma.stockLedger.create({
      data: {
        periodId: period.id, productId: product.id, docType: "PURCHASE", docId: 1, docLineId: 1,
        qtyIn: 10, at: new Date(), createdBy: 1,
      },
    });
    const base = {
      periodId: period.id, productId: product.id, sourceDocType: "PURCHASE" as const,
      sourceDocId: 1, sourceLineId: 1, ledgerId: ledger.id, unitCost: 100, at: new Date(),
    };
    await expect(
      prisma.costLayer.create({ data: { ...base, qtyIn: 10, qtyRemaining: 11 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.costLayer.create({ data: { ...base, qtyIn: 10, qtyRemaining: -1 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.costLayer.create({ data: { ...base, qtyIn: 0, qtyRemaining: 0 } }),
    ).rejects.toThrow(/check constraint/i);
    await prisma.costLayer.create({ data: { ...base, qtyIn: 10, qtyRemaining: 10 } });
  });

  it("stock_ledger: đúng một chiều nhập HOẶC xuất; qtyProvisional ≤ qtyOut", async () => {
    const { period, product } = await seedBasics();
    const base = {
      periodId: period.id, productId: product.id, docType: "SALE" as const,
      docId: 1, docLineId: 1, at: new Date(), createdBy: 1,
    };
    await expect(
      prisma.stockLedger.create({ data: { ...base, qtyIn: 1, qtyOut: 1 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.stockLedger.create({ data: { ...base, qtyIn: 0, qtyOut: 0 } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      prisma.stockLedger.create({ data: { ...base, qtyOut: 5, qtyProvisional: 6 } }),
    ).rejects.toThrow(/check constraint/i);
    await prisma.stockLedger.create({ data: { ...base, qtyOut: 5, qtyProvisional: 5 } });
  });

  it("cost_consumptions: qty > 0", async () => {
    const { period, product } = await seedBasics();
    const inLedger = await prisma.stockLedger.create({
      data: { periodId: period.id, productId: product.id, docType: "PURCHASE", docId: 1, docLineId: 1, qtyIn: 10, at: new Date(), createdBy: 1 },
    });
    const outLedger = await prisma.stockLedger.create({
      data: { periodId: period.id, productId: product.id, docType: "SALE", docId: 1, docLineId: 1, qtyOut: 1, at: new Date(), createdBy: 1 },
    });
    const layer = await prisma.costLayer.create({
      data: { periodId: period.id, productId: product.id, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId: inLedger.id, qtyIn: 10, qtyRemaining: 10, unitCost: 1, at: new Date() },
    });
    await expect(
      prisma.costConsumption.create({
        data: { layerId: layer.id, ledgerId: outLedger.id, docType: "SALE", docLineId: 1, qty: 0, unitCost: 1 },
      }),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe("idempotency_keys", () => {
  it("trùng (userId, scope, key) bị từ chối", async () => {
    await prisma.idempotencyKey.create({ data: { userId: 1, scope: "order.create", key: "k1" } });
    await expect(
      prisma.idempotencyKey.create({ data: { userId: 1, scope: "order.create", key: "k1" } }),
    ).rejects.toThrow(/Unique constraint/i);
    await prisma.idempotencyKey.create({ data: { userId: 1, scope: "order.create", key: "k2" } });
  });
});
```

- [ ] **Step 12: Chạy test, xác nhận ĐỎ đúng chỗ**

Run: `npm test -- tests/db/foundation.test.ts`
Expected: migration áp thành công (global-setup), test FAIL ở: `isOpen không được lệch status`, 5 test `audit_log …`, 3 test `ràng buộc engine kho` (chưa có CHECK/trigger/GRANT). `chỉ cho đúng 1 kỳ OPEN`, `nhiều kỳ CLOSED`, `idempotency_keys` PASS (do `@unique`/`@@id`).
Nếu global-setup báo "Can't reach database server at localhost:5434": `docker compose up -d pgtest` rồi thử lại.

- [ ] **Step 13: Bổ sung SQL thô vào cuối `prisma/migrations/<ts>_foundation/migration.sql`**

Thêm (giữ nguyên phần Prisma đã sinh ở trên):
```sql
-- ============================================================================
-- SQL THÔ — những ràng buộc Prisma không mô hình được
-- ============================================================================

-- 1. Kỳ: isOpen khớp status (true ⇔ OPEN, NULL ⇔ CLOSED). Cùng với UNIQUE(isOpen) → đúng 1 kỳ OPEN.
ALTER TABLE periods ADD CONSTRAINT periods_open_flag_chk
  CHECK ((status = 'OPEN' AND "isOpen" IS TRUE) OR (status = 'CLOSED' AND "isOpen" IS NULL));

-- 2. Engine kho
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_qty_chk
  CHECK ("qtyIn" > 0 AND "qtyRemaining" >= 0 AND "qtyRemaining" <= "qtyIn");

ALTER TABLE cost_consumptions ADD CONSTRAINT cost_consumptions_qty_chk
  CHECK (qty > 0);

ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_qty_chk
  CHECK ("qtyIn" >= 0 AND "qtyOut" >= 0
         AND (("qtyIn" > 0) <> ("qtyOut" > 0))
         AND "qtyProvisional" >= 0 AND "qtyProvisional" <= "qtyOut");

-- 3. audit_log APPEND-ONLY: trigger chặn cả chủ sở hữu DB
CREATE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log là append-only: không được % dữ liệu', TG_OP
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();

-- 4. Role ứng dụng app_rw (D-2): tạo role ở runbook (chứa mật khẩu nên không nằm trong migration).
--    Nếu role đã tồn tại thì cấp quyền; audit_log chỉ INSERT/SELECT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT USAGE ON SCHEMA public TO app_rw;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_rw;
    -- bảng/sequence tạo ở các migration sau tự có quyền cho app_rw
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
  END IF;
END $$;
```

- [ ] **Step 14: Chạy lại test — phải XANH**

Run: `npm test -- tests/db/foundation.test.ts`
Expected: tất cả PASS.

- [ ] **Step 15: Xác nhận Prisma không đòi tạo migration "sửa drift"**

Run: `npx prisma migrate dev`
Expected: `Already in sync, no schema change or pending migration was found.` (áp migration `foundation` lên DB dev, không sinh migration mới).
Nếu Prisma đề nghị tạo migration mới liên quan CHECK/trigger/GRANT → dừng và xem lại: các thứ đó KHÔNG được xuất hiện trong diff. Nếu đề nghị DROP constraint nào do bước 13 tạo → báo người dùng trước khi tiếp tục (không tự chấp nhận).

- [ ] **Step 16: Kiểm tra image (pitfalls mục 1) — bây giờ đã có schema để `prisma generate`**

Run: `docker build -q -t dh-app-test --target runner . && docker inspect --format '{{json .Config.Cmd}}' dh-app-test`
Expected: `["node","server.js"]`. Nếu ra `["npx","prisma","migrate","deploy"]` → sai thứ tự stage, sửa Dockerfile.
Run: `docker build -q -t dh-migrate-test --target migrator . && docker inspect --format '{{json .Config.Cmd}}' dh-migrate-test`
Expected: `["npx","prisma","migrate","deploy"]`.
Run (dev DB đang chạy, cùng network host):
`docker run --rm --network host -e DATABASE_URL=$DATABASE_URL -e MIGRATE_DATABASE_URL=$MIGRATE_DATABASE_URL dh-migrate-test` (trên Windows/Docker Desktop dùng host `host.docker.internal` thay `localhost` trong 2 URL)
Expected: `No pending migrations to apply.`

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "feat(db): schema trụ nền (kỳ, lớp lô FIFO, sổ cái, phân quyền, audit append-only) + test ràng buộc"
```

---

### Task 4: Prisma client, factories, test bất biến schema, `db_schema.sql`

**Files:**
- Create: `src/lib/prisma.ts`, `tests/helpers/factories.ts`, `tests/schema/invariants.test.ts`, `scripts/gen-db-schema.sh`, `db/db_schema.sql`

**Interfaces:**
- Produces: `prisma` singleton (`@/lib/prisma`); factories `makeUser, makePeriod, makeProduct, makePartnerGroup, makePartner, makeCashAccount` (`tests/helpers/factories`); `db/db_schema.sql` (đầu vào của skill `crm-design`).

- [ ] **Step 1: Viết test bất biến (sẽ đỏ nếu schema vi phạm)**

`tests/schema/invariants.test.ts`:
```ts
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

const models = Prisma.dmmf.datamodel.models;
const byName = (name: string) => {
  const m = models.find((x) => x.name === name);
  if (!m) throw new Error(`Không thấy model ${name}`);
  return m;
};

// Bảng CHỨNG TỪ/SỔ CÁI: bắt buộc periodId + createdBy + createdAt (D-3).
// GĐ sau thêm bảng chứng từ mới → thêm tên vào danh sách này.
export const TRANSACTIONAL_MODELS = ["StockLedger", "PartnerLedger", "CashLedger", "DiscountLedger"];

describe("bất biến schema", () => {
  it.each(TRANSACTIONAL_MODELS)("%s có periodId, createdBy, createdAt", (name) => {
    const fields = byName(name).fields.map((f) => f.name);
    expect(fields).toEqual(expect.arrayContaining(["periodId", "createdBy", "createdAt"]));
  });

  it("KHÔNG có cột số dư chạy ở bất kỳ bảng nào (spec 1.3)", () => {
    const banned = /^(running|balance|runningQty|runningBalance)/i;
    for (const m of models) {
      for (const f of m.fields) {
        expect(f.name, `${m.name}.${f.name}`).not.toMatch(banned);
      }
    }
  });

  it("mọi cột Decimal khai báo @db.Decimal với độ chính xác chuẩn", () => {
    const allowed = new Set(["18,2", "18,3", "18,4", "18,6"]);
    for (const m of models) {
      for (const f of m.fields) {
        if (f.type !== "Decimal") continue;
        const native = (f as unknown as { nativeType?: [string, string[]] }).nativeType;
        expect(native, `${m.name}.${f.name} thiếu @db.Decimal`).toBeTruthy();
        expect(allowed.has(native![1].join(",")), `${m.name}.${f.name} → ${native![1]}`).toBe(true);
      }
    }
  });

});
```
Nếu `Prisma.dmmf` là `undefined` ở Prisma phiên bản đang cài: thay bằng `import { getDMMF } from "@prisma/internals"` (cài dev) và `const { datamodel } = await getDMMF({ datamodelPath: "prisma/schema" })`; giữ nguyên các assertion.

- [ ] **Step 2: Chạy, xác nhận đỏ/xanh**

Run: `npm test -- tests/schema/invariants.test.ts`
Expected: PASS hết (schema Task 3 đã đúng). Cố ý kiểm tra test có "răng": tạm thêm `runningQty Decimal @db.Decimal(18,3)` vào `StockLedger`, chạy `npx prisma generate && npm test -- tests/schema` → phải ĐỎ; rồi gỡ bỏ dòng đó và `npx prisma generate` lại.

- [ ] **Step 3: `src/lib/prisma.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: `tests/helpers/factories.ts`**

```ts
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

let n = 0;
const next = () => ++n;

export async function makeUser(over: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  const i = next();
  return prisma.user.create({
    data: { username: `user${i}`, passwordHash: "x", fullName: `Người dùng ${i}`, ...over },
  });
}

export async function makePeriod(over: Partial<Prisma.PeriodUncheckedCreateInput> = {}) {
  return prisma.period.create({
    data: { name: `Kỳ ${next()}`, status: "OPEN", isOpen: true, ...over },
  });
}

export async function makeProduct(over: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
  const i = next();
  return prisma.product.create({
    data: { code: `SP${i}`, name: `Sản phẩm ${i}`, searchText: `san pham ${i}`, baseUnit: "md", ...over },
  });
}

export async function makePartnerGroup(name = `Nhóm ${next()}`) {
  return prisma.partnerGroup.create({ data: { name } });
}

export async function makePartner(over: Partial<Prisma.PartnerUncheckedCreateInput> = {}) {
  const i = next();
  const groupId = over.groupId ?? (await makePartnerGroup()).id;
  return prisma.partner.create({
    data: { code: `KH${i}`, name: `Khách ${i}`, searchText: `khach ${i}`, ...over, groupId },
  });
}

export async function makeCashAccount(over: Partial<Prisma.CashAccountUncheckedCreateInput> = {}) {
  return prisma.cashAccount.create({
    data: { type: "CASH", name: `Quỹ ${next()}`, ...over },
  });
}
```

- [ ] **Step 5: `scripts/gen-db-schema.sh` — sinh `db/db_schema.sql` bằng cách nối mọi migration theo thứ tự (bản replay trung thực, gồm cả SQL thô)**

```bash
#!/usr/bin/env bash
# Sinh db/db_schema.sql (đầu vào cho skill crm-design: "thiết kế bám DB schema thật").
set -euo pipefail
mkdir -p db
{
  echo "-- FILE SINH TỰ ĐỘNG bằng scripts/gen-db-schema.sh — KHÔNG sửa tay."
  echo "-- Nguồn sự thật: prisma/schema/*.prisma + prisma/migrations/*/migration.sql"
  for f in prisma/migrations/*/migration.sql; do
    echo; echo "-- >>> $f"; cat "$f"
  done
} > db/db_schema.sql
echo "Đã ghi db/db_schema.sql ($(wc -l < db/db_schema.sql) dòng)"
```
Run: `bash scripts/gen-db-schema.sh`
Expected: `Đã ghi db/db_schema.sql (… dòng)`.
Quy ước: MỖI migration mới (mọi plan sau) chạy lại `npm run db:schema` và commit kèm.

- [ ] **Step 6: Chạy toàn bộ và commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: xanh.
```bash
git add -A
git commit -m "feat(db): prisma client, factories, test bất biến schema, db_schema.sql"
```

---

### Task 5: Phân quyền server, audit, idempotency, seed

**Files:**
- Create: `src/lib/permissions/{catalog,guard,scope,redact}.ts`
- Create: `src/server/audit/write.ts`, `src/server/idempotency/with-idempotency.ts`
- Create: `prisma/seed-lib.ts`, `prisma/seed.ts`
- Test: `tests/permissions/{catalog,guard,scope,redact}.test.ts`, `tests/audit/write.test.ts`, `tests/idempotency/with-idempotency.test.ts`, `tests/seed.test.ts`

**Interfaces:**
- Produces:
  - `PERMISSIONS`, `type PermissionCode`, `ROLE_DEFAULTS`, `SENSITIVE_FIELDS: Record<string, PermissionCode>` (`@/lib/permissions/catalog`, không import gì ngoài TypeScript — seed trong image migrator dùng file này)
  - `can(perms: ReadonlySet<string>, code: PermissionCode): boolean`, `assertCan(perms, code): void`, `class ForbiddenError` (`@/lib/permissions/guard`)
  - `interface Actor { userId: number; perms: ReadonlySet<string> }`, `partnerScopeWhere(actor): Prisma.PartnerWhereInput` (`@/lib/permissions/scope`)
  - `redactDeep<T>(value: T, perms: ReadonlySet<string>, sensitive?: Record<string, PermissionCode>): T` (`@/lib/permissions/redact`)
  - `writeAudit(db: Prisma.TransactionClient | PrismaClient, input: AuditInput): Promise<void>` (`@/server/audit/write`)
  - `withIdempotency<T>(prisma: PrismaClient, opts: {userId:number; scope:string; key:string}, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>` (`@/server/idempotency/with-idempotency`)
  - `seed(prisma: PrismaClient, opts?: {bootstrapAdminPassword?: string}): Promise<void>` (`prisma/seed-lib`)

- [ ] **Step 1: Test danh mục quyền (đỏ)**

`tests/permissions/catalog.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_DEFAULTS, resolveRolePermissions } from "@/lib/permissions/catalog";

const codes = new Set(PERMISSIONS.map((p) => p.code));

describe("danh mục quyền", () => {
  it("mã quyền là duy nhất và có nhãn tiếng Việt", () => {
    expect(codes.size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS) expect(p.label.length).toBeGreaterThan(0);
  });

  it("5 vai trò mặc định theo spec 6.6", () => {
    expect(Object.keys(ROLE_DEFAULTS).sort()).toEqual(
      ["Bán hàng", "Giám đốc", "Kế toán", "Thủ kho", "Thủ quỹ"].sort(),
    );
  });

  it("Giám đốc có mọi quyền, gồm kết sổ", () => {
    const perms = resolveRolePermissions("Giám đốc");
    expect(perms.size).toBe(PERMISSIONS.length);
    expect(perms.has("period.close")).toBe(true);
  });

  it("Kế toán: có giá vốn, KHÔNG kết sổ, KHÔNG tạo tài khoản", () => {
    const p = resolveRolePermissions("Kế toán");
    expect(p.has("cost.view")).toBe(true);
    expect(p.has("period.close")).toBe(false);
    expect(p.has("user.manage")).toBe(false);
    expect(p.has("role.manage")).toBe(false);
  });

  it("Thủ kho: KHÔNG thấy giá nhập, giá bán, lãi, giá vốn", () => {
    const p = resolveRolePermissions("Thủ kho");
    for (const c of ["purchase_price.view", "sale_price.view", "profit.view", "cost.view"]) {
      expect(p.has(c), c).toBe(false);
    }
    expect(p.has("stock.view")).toBe(true);
  });

  it("Thủ quỹ: KHÔNG thấy giá nhập, lãi", () => {
    const p = resolveRolePermissions("Thủ quỹ");
    expect(p.has("purchase_price.view")).toBe(false);
    expect(p.has("profit.view")).toBe(false);
    expect(p.has("receipt.manage")).toBe(true);
  });

  it("Bán hàng: KHÔNG thấy giá vốn/lãi và KHÔNG có partner.view_all (chỉ khách của mình)", () => {
    const p = resolveRolePermissions("Bán hàng");
    expect(p.has("cost.view")).toBe(false);
    expect(p.has("profit.view")).toBe(false);
    expect(p.has("partner.view_all")).toBe(false);
    expect(p.has("order.create")).toBe(true);
  });

  it("mọi mã trong ROLE_DEFAULTS tồn tại trong PERMISSIONS", () => {
    for (const role of Object.keys(ROLE_DEFAULTS)) {
      for (const c of resolveRolePermissions(role)) expect(codes.has(c), `${role}:${c}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Chạy → ĐỎ (chưa có file)**

Run: `npm test -- tests/permissions/catalog.test.ts`
Expected: FAIL `Cannot find module '@/lib/permissions/catalog'`.

- [ ] **Step 3: `src/lib/permissions/catalog.ts` (file THUẦN dữ liệu — không import gì, vì image migrator chạy seed từ file này)**

```ts
export interface PermissionDef {
  code: string;
  label: string;
  group: string;
  sensitive?: boolean;
}

// Nhóm 1 quyền = 1 khả năng có thể bật/tắt trong màn "Cấu hình nhóm quyền" (mục 3).
export const PERMISSIONS = [
  // Hệ thống
  { code: "user.view", label: "Xem người dùng", group: "Hệ thống" },
  { code: "user.manage", label: "Tạo/sửa/khoá tài khoản", group: "Hệ thống" },
  { code: "role.manage", label: "Cấu hình nhóm quyền", group: "Hệ thống" },
  { code: "audit.view", label: "Xem nhật ký thao tác", group: "Hệ thống" },
  { code: "company.manage", label: "Cấu hình công ty & mẫu in", group: "Hệ thống" },
  { code: "catalog.manage", label: "Quản lý danh mục nền", group: "Hệ thống" },
  { code: "period.close", label: "Kết sổ cuối kỳ", group: "Kỳ", sensitive: true },
  { code: "period.view_closed", label: "Tra cứu kỳ cũ", group: "Kỳ" },
  // Dữ liệu nhạy cảm — ẩn ở tầng server (T2)
  { code: "cost.view", label: "Xem giá vốn", group: "Dữ liệu nhạy cảm", sensitive: true },
  { code: "profit.view", label: "Xem lãi/lỗ", group: "Dữ liệu nhạy cảm", sensitive: true },
  { code: "purchase_price.view", label: "Xem giá nhập", group: "Dữ liệu nhạy cảm", sensitive: true },
  { code: "sale_price.view", label: "Xem giá bán", group: "Dữ liệu nhạy cảm", sensitive: true },
  // Đối tác & sản phẩm
  { code: "partner.view", label: "Xem khách hàng/NCC (thiếu partner.view_all = chỉ khách của mình)", group: "Đối tác" },
  { code: "partner.view_all", label: "Xem mọi khách hàng (phạm vi dữ liệu)", group: "Đối tác" },
  { code: "partner.manage", label: "Thêm/sửa khách hàng, NCC", group: "Đối tác" },
  { code: "product.view", label: "Xem sản phẩm", group: "Sản phẩm" },
  { code: "product.manage", label: "Thêm/sửa sản phẩm", group: "Sản phẩm" },
  // Nhập hàng & kho
  { code: "purchase.view", label: "Xem phiếu nhập", group: "Nhập hàng" },
  { code: "purchase.create", label: "Lập phiếu nhập", group: "Nhập hàng" },
  { code: "purchase.edit", label: "Sửa phiếu nhập", group: "Nhập hàng" },
  { code: "purchase.cancel", label: "Hủy phiếu nhập", group: "Nhập hàng" },
  { code: "stock.view", label: "Xem sổ kho, tồn kho", group: "Kho" },
  { code: "stocktake.manage", label: "Kiểm kho", group: "Kho" },
  { code: "stock_adjust.manage", label: "Điều chỉnh hao hụt / xuất hủy", group: "Kho" },
  // Bán hàng
  { code: "order.view", label: "Xem đơn hàng", group: "Bán hàng" },
  { code: "order.create", label: "Tạo đơn hàng", group: "Bán hàng" },
  { code: "order.edit", label: "Sửa đơn hàng", group: "Bán hàng" },
  { code: "order.cancel", label: "Hủy đơn hàng", group: "Bán hàng" },
  { code: "order.restore", label: "Khôi phục đơn đã hủy", group: "Bán hàng" },
  { code: "order.delete_draft", label: "Xóa hẳn đơn nháp/trùng", group: "Bán hàng" },
  { code: "quote.manage", label: "Báo giá", group: "Bán hàng" },
  { code: "deposit.manage", label: "Tiền cọc", group: "Bán hàng" },
  // Giao hàng
  { code: "trip.manage", label: "Xếp chuyến, nhập kết quả giao", group: "Giao hàng" },
  { code: "trip.settle", label: "Đối soát lái xe", group: "Giao hàng" },
  { code: "trip.confirm_cash", label: "Thủ quỹ xác nhận nhận tiền", group: "Giao hàng" },
  { code: "return.manage", label: "Trả hàng", group: "Trả hàng" },
  // Sản xuất
  { code: "production.manage", label: "Lệnh sản xuất phụ kiện", group: "Sản xuất" },
  { code: "processing.manage", label: "Gia công thuê", group: "Sản xuất" },
  { code: "bom.manage", label: "Định mức NVL", group: "Sản xuất" },
  // Kế toán
  { code: "receipt.manage", label: "Phiếu thu", group: "Kế toán" },
  { code: "payment.manage", label: "Phiếu chi", group: "Kế toán" },
  { code: "cashbook.view", label: "Sổ quỹ, sổ tiền gửi", group: "Kế toán" },
  { code: "debt.view", label: "Xem công nợ", group: "Kế toán" },
  { code: "debt.adjust", label: "Điều chỉnh/gộp công nợ", group: "Kế toán" },
  { code: "discount.settle", label: "Tất toán chiết khấu tích lũy", group: "Kế toán" },
  { code: "discount.reconcile", label: "Hậu kiểm chiết khấu tích lũy", group: "Kế toán" },
  { code: "expense.manage", label: "Chi phí hoạt động", group: "Kế toán" },
  // Báo cáo, in, dữ liệu
  { code: "report.view", label: "Xem báo cáo quản trị", group: "Báo cáo" },
  { code: "print.use", label: "In chứng từ", group: "In ấn" },
  { code: "data.import", label: "Nhập/chuyển dữ liệu", group: "Dữ liệu" },
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]["code"];

export const ALL_PERMISSION_CODES: readonly PermissionCode[] = PERMISSIONS.map((p) => p.code);

// Tên field trong DTO → quyền cần có để được thấy. Mỗi domain BỔ SUNG field của mình ở đây
// (plan module nào thêm field nhạy cảm thì thêm dòng vào bảng này + test ở module đó).
export const SENSITIVE_FIELDS: Record<string, PermissionCode> = {
  unitCostFifo: "cost.view",
  unitCostOut: "cost.view",
  costAmount: "cost.view",
  lineProfit: "profit.view",
  orderProfit: "profit.view",
  profit: "profit.view",
  purchasePrice: "purchase_price.view",
  lastPurchasePrice: "purchase_price.view",
};

type RoleSpec = "*" | { allow: readonly PermissionCode[] } | { except: readonly PermissionCode[] };

// Phân quyền MẪU (spec 6.6) — khách tự chỉnh được sau. `// TODO: confirm` với khách chi tiết từng vai trò.
export const ROLE_DEFAULTS: Record<string, RoleSpec> = {
  "Giám đốc": "*",
  "Kế toán": { except: ["period.close", "user.manage", "role.manage"] },
  "Thủ kho": {
    allow: ["product.view", "stock.view", "stocktake.manage", "stock_adjust.manage", "order.view", "print.use"],
  },
  "Thủ quỹ": {
    allow: [
      "partner.view", "partner.view_all", "cashbook.view", "receipt.manage", "payment.manage", "trip.confirm_cash",
      "debt.view", "order.view", "sale_price.view", "print.use",
    ],
  },
  "Bán hàng": {
    allow: [
      "partner.view", "product.view", "order.view", "order.create", "order.edit", "quote.manage", "deposit.manage",
      "sale_price.view", "stock.view", "return.manage", "print.use",
    ],
  },
};

export function resolveRolePermissions(role: string): Set<string> {
  const spec = ROLE_DEFAULTS[role];
  if (!spec) throw new Error(`Vai trò không có trong ROLE_DEFAULTS: ${role}`);
  if (spec === "*") return new Set<string>(ALL_PERMISSION_CODES);
  if ("allow" in spec) return new Set<string>(spec.allow);
  const banned = new Set<string>(spec.except);
  return new Set<string>(ALL_PERMISSION_CODES.filter((c) => !banned.has(c)));
}
```

- [ ] **Step 4: Chạy → XANH**

Run: `npm test -- tests/permissions/catalog.test.ts`
Expected: PASS (8 test).

- [ ] **Step 5: Test guard + scope + redact (đỏ)**

`tests/permissions/guard.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenError } from "@/lib/permissions/guard";

describe("guard", () => {
  const perms = new Set(["order.view"]);
  it("can()", () => {
    expect(can(perms, "order.view")).toBe(true);
    expect(can(perms, "order.cancel")).toBe(false);
  });
  it("assertCan ném ForbiddenError tiếng Việt", () => {
    expect(() => assertCan(perms, "order.cancel")).toThrow(ForbiddenError);
    expect(() => assertCan(perms, "order.cancel")).toThrow(/không có quyền/);
  });
});
```
`tests/permissions/scope.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makeUser } from "../helpers/factories";

beforeEach(resetDb);

describe("phạm vi dữ liệu khách hàng", () => {
  it("không có partner.view_all → chỉ thấy khách của mình (áp ở tầng query)", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makePartner({ code: "A1", ownerUserId: a.id });
    await makePartner({ code: "A2", ownerUserId: a.id });
    await makePartner({ code: "B1", ownerUserId: b.id });
    await makePartner({ code: "X1" }); // chưa có người phụ trách

    const own = await prisma.partner.findMany({
      where: partnerScopeWhere({ userId: a.id, perms: new Set(["order.view"]) }),
    });
    expect(own.map((p) => p.code).sort()).toEqual(["A1", "A2"]);
  });

  it("có partner.view_all → thấy tất cả", async () => {
    const a = await makeUser();
    await makePartner({ code: "A1", ownerUserId: a.id });
    await makePartner({ code: "X1" });
    const all = await prisma.partner.findMany({
      where: partnerScopeWhere({ userId: a.id, perms: new Set(["partner.view_all"]) }),
    });
    expect(all).toHaveLength(2);
  });
});
```
`tests/permissions/redact.test.ts`:
```ts
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { redactDeep } from "@/lib/permissions/redact";

const dto = () => ({
  id: 1,
  total: new Prisma.Decimal("1500000"),
  at: new Date("2026-09-24T00:00:00Z"),
  lines: [
    { id: 10, price: 100, unitCostFifo: new Prisma.Decimal("20444.4444"), lineProfit: 5 },
    { id: 11, price: 200, unitCostFifo: new Prisma.Decimal("1"), lineProfit: 6 },
  ],
  customer: { name: "A", lastPurchasePrice: 9 },
});

describe("redactDeep", () => {
  it("bỏ field nhạy cảm ở MỌI tầng (kể cả trong mảng dòng hàng) khi thiếu quyền", () => {
    const out = redactDeep(dto(), new Set<string>());
    expect(out.lines[0]).toEqual({ id: 10, price: 100 });
    expect(out.lines[1]).toEqual({ id: 11, price: 200 });
    expect(out.customer).toEqual({ name: "A" });
    expect("unitCostFifo" in out.lines[0]!).toBe(false); // bỏ KEY, không phải gán null
  });

  it("giữ field khi đủ quyền tương ứng, bỏ field thiếu quyền", () => {
    const out = redactDeep(dto(), new Set(["cost.view"]));
    expect(out.lines[0]!.unitCostFifo).toBeDefined();
    expect("lineProfit" in out.lines[0]!).toBe(false);
    expect("lastPurchasePrice" in out.customer).toBe(false);
  });

  it("không đụng Decimal/Date (không đi vào object không phải plain)", () => {
    const out = redactDeep(dto(), new Set<string>());
    expect(out.total).toBeInstanceOf(Prisma.Decimal);
    expect(out.at).toBeInstanceOf(Date);
  });

  it("không mutate đầu vào", () => {
    const input = dto();
    redactDeep(input, new Set<string>());
    expect(input.lines[0]!.unitCostFifo).toBeDefined();
  });

  it("nhận bảng field tuỳ biến", () => {
    const out = redactDeep({ a: 1, secret: 2 }, new Set<string>(), { secret: "cost.view" });
    expect(out).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 6: Chạy → ĐỎ**

Run: `npm test -- tests/permissions`
Expected: guard/scope/redact FAIL (thiếu module); catalog PASS.

- [ ] **Step 7: Cài đặt guard, scope, redact**

`src/lib/permissions/guard.ts`:
```ts
import type { PermissionCode } from "./catalog";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(public readonly code: string) {
    super(`Bạn không có quyền thực hiện thao tác này (${code}).`);
    this.name = "ForbiddenError";
  }
}

export function can(perms: ReadonlySet<string>, code: PermissionCode): boolean {
  return perms.has(code);
}

export function assertCan(perms: ReadonlySet<string>, code: PermissionCode): void {
  if (!can(perms, code)) throw new ForbiddenError(code);
}
```
`src/lib/permissions/scope.ts`:
```ts
import type { Prisma } from "@prisma/client";
import { can } from "./guard";

export interface Actor {
  userId: number;
  perms: ReadonlySet<string>;
}

/** Phạm vi dữ liệu khách hàng: thiếu partner.view_all → chỉ khách do mình phụ trách. */
export function partnerScopeWhere(actor: Actor): Prisma.PartnerWhereInput {
  return can(actor.perms, "partner.view_all") ? {} : { ownerUserId: actor.userId };
}
```
`src/lib/permissions/redact.ts`:
```ts
import { SENSITIVE_FIELDS, type PermissionCode } from "./catalog";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Trả bản sao đã BỎ key nhạy cảm ở mọi tầng (object thường + mảng).
 * Không đi vào Decimal/Date/class instance. Dùng ở cuối mọi hàm trả DTO ra client (T2).
 */
export function redactDeep<T>(
  value: T,
  perms: ReadonlySet<string>,
  sensitive: Record<string, PermissionCode> = SENSITIVE_FIELDS,
): T {
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, perms, sensitive)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const need = sensitive[k];
      if (need && !perms.has(need)) continue;
      out[k] = redactDeep(v, perms, sensitive);
    }
    return out as T;
  }
  return value;
}
```

- [ ] **Step 8: Chạy → XANH**

Run: `npm test -- tests/permissions`
Expected: tất cả PASS.

- [ ] **Step 9: Test audit + idempotency (đỏ)**

`tests/audit/write.test.ts`:
```ts
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { writeAudit } from "@/server/audit/write";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

describe("writeAudit", () => {
  it("ghi số cũ/số mới, chuẩn hoá Decimal và Date về JSON", async () => {
    await writeAudit(prisma, {
      userId: 7, action: "order.update", entity: "SaleOrder", entityId: 12,
      before: { total: new Prisma.Decimal("100.5"), at: new Date("2026-09-24T01:00:00Z") },
      after: { total: new Prisma.Decimal("200") },
    });
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.userId).toBe(7);
    expect(row.entityId).toBe("12");
    expect(row.beforeJson).toEqual({ total: "100.5", at: "2026-09-24T01:00:00.000Z" });
    expect(row.afterJson).toEqual({ total: "200" });
  });

  it("nằm trong transaction: rollback thì không còn dòng audit", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await writeAudit(tx, { userId: 1, action: "x", entity: "E" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await prisma.auditLog.count()).toBe(0);
  });
});
```
`tests/idempotency/with-idempotency.test.ts`:
```ts
import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

const opts = { userId: 1, scope: "order.create", key: "k-1" };

describe("withIdempotency", () => {
  it("chạy work đúng 1 lần; lần 2 cùng khoá trả kết quả lần 1", async () => {
    let calls = 0;
    const work = async (tx: Prisma.TransactionClient) => {
      calls++;
      const w = await tx.warehouse.create({ data: { name: `Kho ${calls}` } });
      return { warehouseId: w.id };
    };
    const first = await withIdempotency(prisma, opts, work);
    const second = await withIdempotency(prisma, opts, work);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(await prisma.warehouse.count()).toBe(1);
  });

  it("khác khoá → chạy lại", async () => {
    let calls = 0;
    const work = async () => ({ n: ++calls });
    await withIdempotency(prisma, opts, work);
    await withIdempotency(prisma, { ...opts, key: "k-2" }, work);
    expect(calls).toBe(2);
  });

  it("2 request ĐỒNG THỜI cùng khoá → chỉ 1 bản ghi (bấm 2 lần/retry mạng)", async () => {
    let calls = 0;
    const work = async (tx: Prisma.TransactionClient) => {
      calls++;
      await new Promise((r) => setTimeout(r, 200)); // giữ transaction mở đủ lâu để request 2 chen vào
      const w = await tx.warehouse.create({ data: { name: "Kho duy nhất" } });
      return { warehouseId: w.id };
    };
    const [a, b] = await Promise.all([
      withIdempotency(prisma, opts, work),
      withIdempotency(prisma, opts, work),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(await prisma.warehouse.count()).toBe(1);
  });

  it("work lỗi → rollback, khoá không bị giữ, thử lại được", async () => {
    await expect(
      withIdempotency(prisma, opts, async (tx) => {
        await tx.warehouse.create({ data: { name: "Kho lỗi" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.warehouse.count()).toBe(0);
    expect(await prisma.idempotencyKey.count()).toBe(0);
    const ok = await withIdempotency(prisma, opts, async () => ({ ok: true }));
    expect(ok).toEqual({ ok: true });
  });

  it("kết quả trả về luôn ở dạng JSON thuần (kể cả lần đầu)", async () => {
    const r = await withIdempotency(prisma, opts, async () => ({ at: new Date("2026-09-24T00:00:00Z") }));
    expect(r).toEqual({ at: "2026-09-24T00:00:00.000Z" });
  });
});
```

- [ ] **Step 10: Chạy → ĐỎ**

Run: `npm test -- tests/audit tests/idempotency`
Expected: FAIL thiếu module.

- [ ] **Step 11: Cài đặt audit + idempotency**

`src/server/audit/write.ts`:
```ts
import type { Prisma, PrismaClient } from "@prisma/client";

export interface AuditInput {
  userId: number | null;
  action: string; // vd "order.update"
  entity: string; // vd "SaleOrder"
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

// Decimal/Date đều có toJSON → round-trip JSON chuẩn hoá về giá trị thuần.
const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Ghi nhật ký thao tác. Truyền `tx` để nằm CÙNG transaction với thao tác nghiệp vụ. */
export async function writeAudit(
  db: Prisma.TransactionClient | PrismaClient,
  input: AuditInput,
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId == null ? null : String(input.entityId),
      beforeJson: toJson(input.before),
      afterJson: toJson(input.after),
      ip: input.ip ?? null,
    },
  });
}
```
`src/server/idempotency/with-idempotency.ts`:
```ts
import type { Prisma, PrismaClient } from "@prisma/client";

export interface IdempotencyOptions {
  userId: number;
  scope: string; // vd "order.create"
  key: string; // UUID sinh 1 lần khi mở form, KHÔNG sinh lại mỗi lần retry
}

/**
 * Chạy `work` đúng 1 lần cho mỗi (userId, scope, key).
 * Khoá và work nằm CÙNG 1 transaction: request đến sau bị chặn ở INSERT cho tới khi request đầu commit,
 * rồi đọc kết quả đã lưu; nếu request đầu lỗi (rollback) thì request sau tự chạy lại.
 * `work` phải trả giá trị JSON-hoá được (id, chuỗi, số) — kết quả luôn được chuẩn hoá qua JSON
 * để lần đầu và lần lặp trả cùng một dạng.
 */
export async function withIdempotency<T>(
  prisma: PrismaClient,
  opts: IdempotencyOptions,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO idempotency_keys ("userId", "scope", "key", "createdAt")
        VALUES (${opts.userId}, ${opts.scope}, ${opts.key}, now())
        ON CONFLICT DO NOTHING`;

      if (inserted === 0) {
        const row = await tx.idempotencyKey.findUniqueOrThrow({
          where: { userId_scope_key: { userId: opts.userId, scope: opts.scope, key: opts.key } },
        });
        return row.responseJson as T;
      }

      const raw = await work(tx);
      const result = (raw === undefined ? null : JSON.parse(JSON.stringify(raw))) as T;
      await tx.idempotencyKey.update({
        where: { userId_scope_key: { userId: opts.userId, scope: opts.scope, key: opts.key } },
        data: { responseJson: result as Prisma.InputJsonValue },
      });
      return result;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}
```

- [ ] **Step 12: Chạy → XANH**

Run: `npm test -- tests/audit tests/idempotency`
Expected: PASS hết, gồm test đồng thời.
Nếu test đồng thời đỏ với `calls = 2`: kiểm `INSERT ... ON CONFLICT DO NOTHING` ở READ COMMITTED (mặc định) — không đổi isolation level; nếu thấy `Transaction API error: Unable to start a transaction in the given time` thì tăng `maxWait`.

- [ ] **Step 13: Test seed (đỏ)**

`tests/seed.test.ts`:
```ts
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { seed } from "../prisma/seed-lib";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import { prisma, resetDb } from "./helpers/db";

beforeEach(resetDb);

describe("seed", () => {
  it("tạo quyền, 5 vai trò, công ty, đúng 1 kỳ OPEN", async () => {
    await seed(prisma);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
    expect((await prisma.role.findMany()).map((r) => r.name).sort()).toEqual(
      ["Bán hàng", "Giám đốc", "Kế toán", "Thủ kho", "Thủ quỹ"].sort(),
    );
    expect(await prisma.companySetting.count()).toBe(1);
    const open = await prisma.period.findMany({ where: { isOpen: true } });
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe("OPEN");
  });

  it("idempotent: chạy 2 lần không nhân đôi dữ liệu", async () => {
    await seed(prisma);
    await seed(prisma);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
    expect(await prisma.role.count()).toBe(5);
    expect(await prisma.period.count()).toBe(1);
  });

  it("KHÔNG ghi đè quyền khách đã chỉnh sau khi vai trò đã tồn tại", async () => {
    await seed(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ kho" } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } }); // khách bỏ hết quyền
    await seed(prisma);
    expect(await prisma.rolePermission.count({ where: { roleId: role.id } })).toBe(0);
  });

  it("vai trò Thủ kho không có quyền xem giá vốn trong DB", async () => {
    await seed(prisma);
    const rows = await prisma.rolePermission.findMany({
      where: { role: { name: "Thủ kho" }, permission: { code: "cost.view" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("tạo admin khởi tạo khi có mật khẩu và chưa có user; bắt đổi mật khẩu; không tạo lần 2", async () => {
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: "admin" },
      include: { roles: { include: { role: true } } },
    });
    expect(admin.mustChangePassword).toBe(true);
    expect(await bcrypt.compare("Mat-khau-tam-123", admin.passwordHash)).toBe(true);
    expect(admin.roles.map((r) => r.role.name)).toEqual(["Giám đốc"]);
    await seed(prisma, { bootstrapAdminPassword: "khac" });
    expect(await prisma.user.count()).toBe(1);
  });

  it("không có mật khẩu khởi tạo → không tạo user", async () => {
    await seed(prisma);
    expect(await prisma.user.count()).toBe(0);
  });
});
```

- [ ] **Step 14: Chạy → ĐỎ, rồi cài đặt seed**

Run: `npm test -- tests/seed.test.ts` → FAIL (thiếu `prisma/seed-lib`).

`prisma/seed-lib.ts` (import tương đối, không dùng alias `@/` — image migrator không có tsconfig paths):
```ts
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, ROLE_DEFAULTS, resolveRolePermissions } from "../src/lib/permissions/catalog";

export interface SeedOptions {
  bootstrapAdminPassword?: string;
}

const ADMIN_ROLE = "Giám đốc";

export async function seed(prisma: PrismaClient, opts: SeedOptions = {}): Promise<void> {
  // 1. Danh mục quyền: luôn đồng bộ theo code (thêm quyền mới ở bản sau tự vào DB)
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { label: p.label, groupName: p.group, isSensitive: "sensitive" in p ? Boolean(p.sensitive) : false },
      create: { code: p.code, label: p.label, groupName: p.group, isSensitive: "sensitive" in p ? Boolean(p.sensitive) : false },
    });
  }
  const permByCode = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));

  // 2. Vai trò mẫu: chỉ gán quyền mặc định khi vai trò MỚI tạo (không ghi đè phần khách đã chỉnh)
  for (const name of Object.keys(ROLE_DEFAULTS)) {
    const existing = await prisma.role.findUnique({ where: { name } });
    if (existing) continue;
    const role = await prisma.role.create({ data: { name, isSystem: true } });
    const ids = [...resolveRolePermissions(name)].map((c) => permByCode.get(c)!);
    await prisma.rolePermission.createMany({
      data: ids.map((permissionId) => ({ roleId: role.id, permissionId })),
    });
  }

  // 3. Công ty (bảng 1 dòng)
  await prisma.companySetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Xưởng tôn Đặng Hương" },
  });

  // 4. Kỳ đầu tiên (luôn có đúng 1 kỳ OPEN)
  if ((await prisma.period.count()) === 0) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    await prisma.period.create({
      data: { name: `Kỳ khởi tạo ${dd}/${mm}/${now.getFullYear()}`, status: "OPEN", isOpen: true },
    });
  }

  // 5. Admin khởi tạo (chỉ khi bảng users trống và có mật khẩu)
  if (opts.bootstrapAdminPassword && (await prisma.user.count()) === 0) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: ADMIN_ROLE } });
    await prisma.user.create({
      data: {
        username: "admin",
        fullName: "Quản trị hệ thống",
        passwordHash: await bcrypt.hash(opts.bootstrapAdminPassword, 10),
        mustChangePassword: true,
        roles: { create: { roleId: role.id } },
      },
    });
  }
}
```
`prisma/seed.ts`:
```ts
import { PrismaClient } from "@prisma/client";
import { seed } from "./seed-lib";

const prisma = new PrismaClient();

seed(prisma, { bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || undefined })
  .then(() => console.log("Seed xong"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 15: Chạy → XANH; xác nhận seed chạy được như CLI và trong image migrator**

Run: `npm test -- tests/seed.test.ts`
Expected: PASS.
Run: `npx prisma db seed` (trên DB dev)
Expected: `Seed xong`.
Run: `docker build -q -t dh-migrate-test --target migrator . && docker run --rm --network host -e DATABASE_URL=$DATABASE_URL -e MIGRATE_DATABASE_URL=$MIGRATE_DATABASE_URL dh-migrate-test npx prisma db seed` (Windows Docker Desktop: đổi `localhost` thành `host.docker.internal` trong 2 URL)
Expected: `Seed xong`. Nếu `Cannot find module '../src/lib/permissions/catalog'` → sửa `COPY` ở Dockerfile stage migrator.

- [ ] **Step 16: Chạy toàn bộ và commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: xanh.
```bash
git add -A
git commit -m "feat: phân quyền server (danh mục, guard, phạm vi, ẩn field), audit, idempotency, seed"
```

---

## Self-Review (GĐ0a)

**Spec coverage:** T1 (Caddy/HTTPS — Task 2 runbook + workflow), T5 (cài máy chủ, tên miền — Task 2 INPUTS + RUNBOOK), T2 (ẩn dữ liệu nhạy cảm — `redactDeep`, `partnerScopeWhere`, danh mục quyền; áp vào DTO thật ở từng module), nguyên tắc 2 (`periodId` — schema + test bất biến), 3 (`cost_layers/consumptions` — schema + CHECK), 6 (audit append-only — trigger + REVOKE + test), K1–K4 (bảng `opening_*` — schema), quyền động mục 3 (danh mục + seed; màn cấu hình ở GĐ0b). Chưa thuộc plan này: mã 1–5 màn hình (GĐ0b), engine (GĐ1a).
**Placeholder scan:** các `<SLUG>`, `<DOMAIN>`, `<APP_PORT>` là giá trị hạ tầng thật phải lấy từ `docs/infra/INPUTS.md` (Task 2 Step 1 là cổng chặn) — không phải placeholder thiếu nội dung. Không còn "TBD/TODO".
**Type consistency:** `PermissionCode` sinh từ `PERMISSIONS`; `resolveRolePermissions` dùng ở catalog test và seed; `Actor` dùng ở scope; `withIdempotency` và test đều dùng `Prisma.TransactionClient` cho tham số `tx`; `resolveRolePermissions` trả `Set<string>` để khớp `can(perms: ReadonlySet<string>)`.
**Review Focus:** bấm 2 lần (Task 5 test đồng thời) ✔; chặn audit ở mọi cấp (Task 3) ✔; ẩn field lồng nhau (Task 5) ✔; bảng chứng từ quên `periodId` (Task 4) ✔.
