#!/usr/bin/env bash
# Diễn tập khôi phục: nạp bản sao lưu MỚI NHẤT (hoặc file chỉ định) vào DB TẠM, so số dòng các bảng chính với DB thật, rồi xoá DB tạm.
# KHÔNG đụng dherp_db. Dùng: scripts/restore-drill.sh [đường-dẫn-file.dump]
# Thoát 0 = khôi phục được và các bảng chính khớp/ít hơn DB thật (bản sao lưu cũ hơn); ≠ 0 = có vấn đề.
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/deploy_dherp/backups}"
CONTAINER="${CONTAINER:-postgres_dherp}"
DB_USER="${DB_USER:-dherp_user}"
DB_NAME="${DB_NAME:-dherp_db}"
DRILL_DB="${DRILL_DB:-dherp_restore_drill}"
TABLES="${TABLES:-users roles role_permissions partners products periods stock_ledger cost_layers partner_ledger cash_ledger sale_orders sale_order_lines purchases audit_log}"

log() { echo "[$(date '+%F %T')] $*"; }
psql_live() { if [ -n "${PG_DIRECT:-}" ]; then psql -X -A -t -d "$DB_NAME" "$@"; else docker exec -i "$CONTAINER" psql -X -A -t -U "$DB_USER" -d "$DB_NAME" "$@"; fi; }
psql_drill() { if [ -n "${PG_DIRECT:-}" ]; then psql -X -A -t -d "$DRILL_DB" "$@"; else docker exec -i "$CONTAINER" psql -X -A -t -U "$DB_USER" -d "$DRILL_DB" "$@"; fi; }
psql_admin() { if [ -n "${PG_DIRECT:-}" ]; then psql -X -A -t -d postgres "$@"; else docker exec -i "$CONTAINER" psql -X -A -t -U "$DB_USER" -d postgres "$@"; fi; }
restore_cmd() { if [ -n "${PG_DIRECT:-}" ]; then pg_restore --no-owner --no-privileges -d "$DRILL_DB"; else docker exec -i "$CONTAINER" pg_restore --no-owner --no-privileges -U "$DB_USER" -d "$DRILL_DB"; fi; }

FILE="${1:-}"
[ -n "$FILE" ] || FILE="$(ls -1t "$BACKUP_DIR"/dherp_*.dump 2>/dev/null | head -1)"
[ -n "$FILE" ] && [ -s "$FILE" ] || { log "LỖI: không tìm thấy file sao lưu"; exit 2; }
if [ -f "$FILE.sha256" ]; then ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" >/dev/null ) || { log "LỖI: sai checksum $FILE"; exit 3; }; fi
[ "$DRILL_DB" != "$DB_NAME" ] || { log "LỖI: DRILL_DB trùng DB thật"; exit 2; }
log "diễn tập với $FILE"

cleanup() { psql_admin -c "DROP DATABASE IF EXISTS \"$DRILL_DB\"" >/dev/null 2>&1; }
trap cleanup EXIT
cleanup
psql_admin -c "CREATE DATABASE \"$DRILL_DB\"" >/dev/null || { log "LỖI: không tạo được DB tạm"; exit 4; }
restore_cmd < "$FILE" 2>/tmp/dherp_restore.err || { log "CẢNH BÁO: pg_restore báo lỗi (xem /tmp/dherp_restore.err)"; }

status=0
printf '%-22s %12s %12s\n' "bảng" "sao lưu" "DB thật"
for t in $TABLES; do
  r="$(psql_drill -c "SELECT count(*) FROM \"$t\"" 2>/dev/null | tr -d '[:space:]')"
  l="$(psql_live -c "SELECT count(*) FROM \"$t\"" 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$r" ] || [ -z "$l" ]; then printf '%-22s %12s %12s  ← THIẾU BẢNG\n' "$t" "${r:--}" "${l:--}"; status=5; continue; fi
  note=""
  if [ "$r" -gt "$l" ]; then note="  ← sao lưu NHIỀU hơn DB thật (bất thường)"; status=6; fi
  if [ "$l" -gt 0 ] && [ "$r" -eq 0 ]; then note="  ← sao lưu RỖNG trong khi DB thật có dữ liệu"; status=7; fi
  printf '%-22s %12s %12s%s\n' "$t" "$r" "$l" "$note"
done
m_r="$(psql_drill -c 'SELECT count(*) FROM _prisma_migrations' 2>/dev/null | tr -d '[:space:]')"
m_l="$(psql_live -c 'SELECT count(*) FROM _prisma_migrations' 2>/dev/null | tr -d '[:space:]')"
log "migration: sao lưu=$m_r, DB thật=$m_l"
[ "$status" -eq 0 ] && log "ĐẠT: khôi phục được, số dòng hợp lý" || log "KHÔNG ĐẠT (mã $status)"
exit "$status"
