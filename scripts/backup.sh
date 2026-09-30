#!/usr/bin/env bash
# Sao lưu hằng đêm DB dherp_db (pg_dump -Fc) — chạy trên VPS bằng cron của user deploy_dherp.
# Thành công: file $BACKUP_DIR/dherp_YYYY-MM-DD_HHMM.dump (+ .sha256), xoá bản cũ hơn $KEEP_DAYS ngày,
#             tuỳ chọn đẩy bản ngoài máy chủ (OFFSITE_CMD). Thất bại: ghi $BACKUP_DIR/FAILED, gửi cảnh báo (ALERT_URL), thoát mã ≠ 0.
# Không in/ghi mật khẩu. Mặc định chạy pg_dump BÊN TRONG container postgres_dherp (socket cục bộ, không cần mật khẩu).
# PG_DIRECT=1 (test/chạy ngoài container): dùng pg_dump/pg_restore trên máy với biến PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/deploy_dherp/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
CONTAINER="${CONTAINER:-postgres_dherp}"
DB_USER="${DB_USER:-dherp_user}"
DB_NAME="${DB_NAME:-dherp_db}"
OFFSITE_CMD="${OFFSITE_CMD:-}"   # vd: rclone copy "$BACKUP_FILE" remote:dherp-backup   ($BACKUP_FILE, $BACKUP_DIR được export)
ALERT_URL="${ALERT_URL:-}"       # webhook nhận POST văn bản khi lỗi (Telegram/Slack/…); bỏ trống = chỉ ghi file FAILED

log() { echo "[$(date '+%F %T')] $*"; }
pgrun() { if [ -n "${PG_DIRECT:-}" ]; then "$@"; else docker exec -i "$CONTAINER" "$@"; fi; }
dump_cmd() { if [ -n "${PG_DIRECT:-}" ]; then pg_dump -Fc; else docker exec -i "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc; fi; }
list_cmd() { if [ -n "${PG_DIRECT:-}" ]; then pg_restore -l; else docker exec -i "$CONTAINER" pg_restore -l; fi; }

fail() {
  local msg="$1"
  log "LỖI: $msg"
  mkdir -p "$BACKUP_DIR" 2>/dev/null && echo "$(date '+%F %T') $msg" > "$BACKUP_DIR/FAILED"
  if [ -n "$ALERT_URL" ]; then curl -fsS -m 15 -X POST --data-urlencode "text=DHERP backup THẤT BẠI: $msg" "$ALERT_URL" >/dev/null 2>&1 || log "không gửi được cảnh báo"; fi
  rm -f "${TMP_FILE:-}" "${ERR_FILE:-}" 2>/dev/null
  exit 1
}

mkdir -p "$BACKUP_DIR" || fail "không tạo được thư mục $BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null
STAMP="$(date '+%Y-%m-%d_%H%M')"
BACKUP_FILE="$BACKUP_DIR/dherp_${STAMP}.dump"
TMP_FILE="$BACKUP_FILE.part"
ERR_FILE="$BACKUP_FILE.err"

log "bắt đầu sao lưu → $BACKUP_FILE"
# stderr của pg_dump giữ lại (cắt 400 ký tự) để biết vì sao lỗi — thông báo của Postgres không chứa mật khẩu
dump_cmd > "$TMP_FILE" 2> "$ERR_FILE" || fail "pg_dump lỗi: $(head -c 400 "$ERR_FILE" | tr '\n' ' ')"
rm -f "$ERR_FILE"
[ -s "$TMP_FILE" ] || fail "file sao lưu rỗng"
# Kiểm định dạng: pg_restore đọc được mục lục và có bảng dữ liệu
TOC="$(list_cmd < "$TMP_FILE" 2>/dev/null)" || fail "file sao lưu không đọc được bằng pg_restore"
echo "$TOC" | grep -q "TABLE DATA" || fail "file sao lưu không có dữ liệu bảng"
mv "$TMP_FILE" "$BACKUP_FILE" || fail "không đổi tên file sao lưu"
chmod 600 "$BACKUP_FILE"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$BACKUP_FILE")" > "$(basename "$BACKUP_FILE").sha256" )
rm -f "$BACKUP_DIR/FAILED"
log "xong: $(du -h "$BACKUP_FILE" | cut -f1)"

# Xoá bản cũ (chỉ file do script này tạo)
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'dherp_*.dump' -o -name 'dherp_*.dump.sha256' \) -mtime "+$KEEP_DAYS" -print -delete | sed 's/^/đã xoá bản cũ: /'

# Bản ngoài máy chủ (bắt buộc nên có: sao lưu chỉ trên cùng VPS không chống được mất máy)
if [ -n "$OFFSITE_CMD" ]; then
  export BACKUP_FILE BACKUP_DIR
  bash -c "$OFFSITE_CMD" || fail "đẩy bản ngoài máy chủ lỗi (OFFSITE_CMD)"
  log "đã đẩy bản ngoài máy chủ"
else
  log "CẢNH BÁO: chưa cấu hình OFFSITE_CMD — chưa có bản ngoài máy chủ"
fi
