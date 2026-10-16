# =============================================================================
# Dockerfile multi-stage — Next.js 15 (standalone) + Prisma 6 — khuôn skill setup-project
# =============================================================================
# - Stage `runner` đặt CUỐI CÙNG có chủ ý (pitfalls mục 1): quên `--target` vẫn ra image app.
#   Dù vậy MỌI chỗ build (compose, workflow, lệnh tay) đều ghi rõ `target`.
# - Node 22 (alpine): khớp môi trường dev/test (Node 22) và CI; Next 15.5 / Prisma 6.19 / Vitest 5 đều hỗ trợ.
# - Prisma client được `generate` BÊN TRONG image (alpine, openssl 3) → engine native = linux-musl-openssl-3.0.x,
#   không cần khai `binaryTargets` trong schema.
# =============================================================================

# ---- Stage 1: deps — cài đủ dependencies (kể cả dev: prisma CLI, tsx cho seed) ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---- Stage 2: build — generate Prisma client + build Next standalone ----
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Stage 3: migrator — `prisma migrate deploy` (CMD mặc định) + `npx prisma db seed` ----
# KHÔNG FROM deps: node_modules đầy đủ ~1.4 GB (next, swc, typescript, eslint, vitest...). Migrator chỉ cần
# 4 gói, cài ĐÚNG phiên bản khoá trong package-lock.json (prisma CLI và @prisma/client phải trùng phiên bản).
# Đặt TRƯỚC runner để runner vẫn là stage cuối.
FROM node:22-alpine AS migrator
# Nhãn dự án: deploy chỉ dọn image mang nhãn này (không đụng image của dự án khác trên VPS)
LABEL project=dherp
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV CHECKPOINT_DISABLE=1
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package-lock.json /tmp/package-lock.json
RUN v() { node -p "require('/tmp/package-lock.json').packages['node_modules/$1'].version"; } \
 && echo '{"name":"dherp-migrator","private":true}' > package.json \
 && npm install --no-audit --no-fund --save-exact \
      "prisma@$(v prisma)" "@prisma/client@$(v @prisma/client)" "tsx@$(v tsx)" "bcryptjs@$(v bcryptjs)" \
 && npm cache clean --force \
 && rm /tmp/package-lock.json
# prisma.config.ts: schema = prisma/schema (thư mục), migrations = prisma/migrations, seed = "tsx prisma/seed.ts"
COPY prisma.config.ts ./
COPY prisma ./prisma
# Đúng các file seed import (đường dẫn tương đối, KHÔNG alias "@/"; kiểm lại khi seed-lib.ts đổi import):
#   prisma/seed-lib.ts → src/lib/permissions/catalog.ts, src/lib/time.ts, src/server/auth/password.ts
#   src/server/auth/password.ts → src/server/auth/normalize.ts (+ bcryptjs, node:crypto)
#   prisma/seed-customer.ts → src/lib/search.ts, src/server/auth/password.ts (+ prisma/data/customer-seed.json, đã nằm trong COPY prisma)
#   (seed-lib còn dùng normalizeEmail/looksLikeEmail/isPrintableAscii/tempPasswordExpiry — cùng 2 file trên)
COPY src/lib/permissions/catalog.ts ./src/lib/permissions/catalog.ts
COPY src/lib/time.ts src/lib/search.ts ./src/lib/
COPY src/server/auth/password.ts src/server/auth/normalize.ts ./src/server/auth/
COPY src/server/products/capabilities.ts ./src/server/products/capabilities.ts
# Cứu hộ admin (RUNBOOK mục 13): npx tsx scripts/admin-reset.ts → prisma/admin-reset-lib.ts (cùng các file auth ở trên)
COPY scripts/admin-reset.ts ./scripts/admin-reset.ts
RUN npx prisma generate
# Không phải root (user `node` có sẵn trong image chính thức; chỉ cần ĐỌC /app lúc chạy)
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- Stage 4 (CUỐI): runner — image app chạy thật, non-root ----
FROM node:22-alpine AS runner
LABEL project=dherp
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache openssl \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# Standalone output: server.js tự chứa + node_modules đã rút gọn (gồm Prisma client + engine musl)
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
