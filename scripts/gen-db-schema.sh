#!/usr/bin/env bash
# Sinh db/db_schema.sql (đầu vào cho skill crm-design: "thiết kế bám DB schema thật").
# Nối mọi migration theo thứ tự tên thư mục (bản replay trung thực, gồm cả SQL thô).
# Chạy được trên Git Bash (Windows) và Linux; luôn ghi LF, chạy từ bất kỳ thư mục nào.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p db
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
{
  echo "-- FILE SINH TỰ ĐỘNG bằng scripts/gen-db-schema.sh — KHÔNG sửa tay."
  echo "-- Nguồn sự thật: prisma/schema/*.prisma + prisma/migrations/*/migration.sql"
  for f in $(LC_ALL=C ls prisma/migrations/*/migration.sql | sort); do
    echo
    echo "-- >>> $f"
    tr -d '\r' < "$f"
  done
} > "$tmp"
cp "$tmp" db/db_schema.sql
echo "Đã ghi db/db_schema.sql ($(wc -l < db/db_schema.sql | tr -d ' ') dòng)"
