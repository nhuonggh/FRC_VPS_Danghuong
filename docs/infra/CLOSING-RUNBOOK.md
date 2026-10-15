# Kết sổ cuối kỳ — sổ tay vận hành & bàn giao (Plan 07 · F4)

Dành cho Giám đốc / người vận hành. Quy tắc gốc: spec 4.2–4.4. Kỹ thuật: `docs/engine-fifo.md` dòng 16, `docs/superpowers/plans/2026-10-02-07-f0-cross-period-matrix.md`.

## 1. Kết sổ là gì (và không là gì)

- **Là:** đóng kỳ đang mở, mở kỳ mới, **chuyển tiếp** số cuối kỳ thành số đầu kỳ mới: tồn kho **giữ nguyên từng lô** (không đổi giá vốn), công nợ từng đối tác, số dư từng quỹ/ngân hàng, chiết khấu tích lũy. Đơn nháp và báo giá chưa chốt được mang sang kỳ mới.
- **Không là:** không xoá/gộp dữ liệu, không mở lại được. Kỳ đã đóng **chỉ đọc**: không sửa/hủy chứng từ. Sai sót cũ sửa bằng chứng từ MỚI ở kỳ mới (điều chỉnh công nợ, điều chỉnh quỹ, kiểm kho, trả hàng…).
- **Vẫn làm được sau kết sổ với chứng từ kỳ cũ:** giao nốt đơn chưa giao đủ (phiếu giao, chuyến, tiền lái xe thu), thu cọc/thu nợ theo đơn cũ, trả hàng theo đơn cũ (giá vốn của dòng bán gốc), hậu kiểm phiếu thu/chi/tất toán. Chứng từ mới đều mang **kỳ mới**.

## 2. Quy trình cuối tháng (mặc định: kết theo tháng)

1. **Trước ngày kết:** giao xong chuyến đang chạy, đối soát lái xe, thủ quỹ xác nhận tiền; chốt hoặc hủy phiếu kiểm kho nháp; kế toán sửa phiếu bị thủ quỹ trả lại; thủ quỹ duyệt/từ chối yêu cầu điều chỉnh đang chờ.
2. Mở **Kỳ & số đầu kỳ → Kết sổ cuối kỳ** (`/period/close`, quyền `period.close` — chỉ Giám đốc). Trang liệt kê:
   - **Chặn** (đỏ): đơn bán còn thiếu tồn, chuyến chưa xác nhận hoàn tất, phiếu kiểm kho nháp, giá vốn đang tính lại, phiếu thu/chi bị trả lại, yêu cầu điều chỉnh chờ duyệt. Còn mục nào thì **không kết sổ được**; bấm dòng để tới chứng từ cần xử lý.
   - **Cảnh báo** (vàng): đơn nháp / báo giá chưa chốt (sẽ mang sang), đơn chưa giao đủ, cọc gắn đơn chưa giao đủ, tất toán chiết khấu và phiếu thu/chi chưa hậu kiểm. Không chặn, nhưng nên xem.
3. **Sao lưu DB** (mục 3 bên dưới) — bắt buộc, bản sao lưu phải trong 24 giờ.
4. **Bước 1 — xem trước:** kiểm các số "Tồn kho chuyển sang / Phải thu / Phải trả / Quỹ" khớp với sổ sách bạn nắm. Đây chính là số đầu kỳ mới.
5. **Bước 2 — xác nhận:** bấm "Kết sổ …", nhập giờ sao lưu, (tuỳ chọn) đặt tên kỳ mới, **gõ lại đúng tên kỳ**, tick xác nhận → Kết sổ. Hệ thống làm trong MỘT giao dịch: lỗi ở bất kỳ bước nào thì hoàn tác toàn bộ (kỳ cũ vẫn mở).
6. Sau khi kết: vào **Kỳ & số đầu kỳ → Tra cứu kỳ**, xem kỳ vừa đóng — "Cuối kỳ" của kỳ cũ phải bằng "Đầu kỳ" của kỳ mới.
7. Báo nhân viên: từ giờ chứng từ mới nằm ở kỳ mới; chứng từ ngày trước ngày mở kỳ mới bị từ chối.

**Hai người bấm cùng lúc / bấm đôi:** chỉ một người thành công; người sau nhận "Kỳ này đã được kết sổ".
**Thời gian:** ~3 giây với 1.300 sản phẩm × 3 lô + 30.000 dòng sổ (đo trên máy dev). Nên kết ngoài giờ làm việc vì các giao dịch kho khác phải chờ.

## 3. Sao lưu trước khi kết (làm tay trên VPS)

Ứng dụng chạy trong container nên không tự chụp backup được. Trên VPS, user `deploy_dherp`:

    ~/bin/backup.sh          # in "xong: …" và tạo ~/backups/dherp_<ngày>.dump (RUNBOOK mục 14)

Nhập vào ô "Thời điểm sao lưu" giờ của file vừa tạo (`ls -l ~/backups | head -3`). Hệ thống từ chối nếu quá 24 giờ hoặc ở tương lai, và ghi giờ này vào nhật ký `period.close`. Nên đẩy bản sao ra ngoài VPS (OFFSITE_CMD, RUNBOOK mục 14).

## 4. Diễn tập trên bản sao DB — BẮT BUỘC trước lần kết sổ thật đầu tiên

Mục đích: chứng minh trên **dữ liệu thật** số trước = số sau, và biết thời gian kết. Chỉ người dùng (chủ dự án) xác nhận "đạt" mới được kết sổ thật.

1. Khôi phục bản sao lưu mới nhất vào DB tạm có tên chứa `drill`/`copy`/`restore` (không đụng `dherp_db`). `scripts/restore-drill.sh` làm bước này và tự xoá DB tạm — để giữ DB cho diễn tập, chạy `pg_restore` thủ công vào `dherp_close_drill` (cùng cách script dùng).
2. Chạy **xem trước** (không ghi): `DATABASE_URL=postgresql://…/dherp_close_drill npx tsx scripts/close-rehearsal.ts --confirm-db dherp_close_drill --user <giamdoc>` → in checklist và số sẽ chuyển.
3. Chạy **thật trên bản sao**: thêm `--commit`. Script chụp số liệu bằng các hàm báo cáo của ứng dụng (tồn từng mã, công nợ từng đối tác, từng quỹ, chiết khấu) trước và sau, in `ĐẠT` hoặc danh sách chỉ tiêu lệch. Thoát 0 = đạt.
4. Gửi kết quả cho chủ dự án; đối chiếu vài số tay (tổng tồn, công nợ vài khách lớn, số dư quỹ). Chỉ khi chủ dự án xác nhận mới kết sổ thật.
5. Xoá DB tạm: `DROP DATABASE dherp_close_drill;`

Script từ chối chạy nếu tên DB là `dherp_db`, nếu tên không giống bản sao (trừ khi `--force-name`), hoặc nếu `--confirm-db` không khớp.

## 5. Sự cố & khôi phục

| Tình huống | Xử lý |
|---|---|
| Kết sổ báo lỗi / "Kiểm tra sau kết sổ thất bại" | Đã hoàn tác tự động: kỳ cũ vẫn mở, không có kỳ mới, không có số đầu kỳ mồ côi. Chụp màn hình lỗi, báo người hỗ trợ. **Không** sửa DB tay. |
| Trang kết sổ treo / mất mạng giữa chừng | Mở lại `/period/close`: nếu kỳ cũ đã đóng và kỳ mới đã mở thì đã xong (xem Tra cứu kỳ); nếu vẫn mở thì chưa gì thay đổi, làm lại từ bước 2. |
| Kết sổ xong mới phát hiện thiếu/sai số liệu cũ | KHÔNG mở lại kỳ. Lập chứng từ điều chỉnh ở kỳ mới (điều chỉnh công nợ, điều chỉnh/chốt quỹ, kiểm kho, phiếu thu/chi). |
| Kết sổ nhầm kỳ / sai ngày | Khôi phục từ backup ngay trước khi kết (RUNBOOK mục 8 & 14) — mất mọi chứng từ lập SAU backup đó; cân nhắc kỹ, hỏi người hỗ trợ trước. |
| Có yêu cầu giao nốt đơn kỳ cũ | Làm bình thường (phiếu giao / chuyến) — chứng từ thuộc kỳ mới. |
| Phiếu thu/chi kỳ cũ bị thủ quỹ "trả lại" sau kết sổ | Bị chặn có chủ đích (sẽ kẹt không sửa được). Hậu kiểm thì được; nếu sai số tiền thì lập phiếu điều chỉnh ở kỳ mới. |

## 6. Nhật ký & kiểm tra

- Mỗi lần kết sổ ghi `period.close` trong **Hệ thống → Nhật ký thao tác**: người kết, kỳ cũ/mới, số lô/đối tác/quỹ mang sang, số cảnh báo lúc kết, tên kỳ gõ xác nhận, giờ sao lưu khai báo.
- Test tự động giữ các bất biến: `tests/period/close*.test.ts`, `cross-period-*.test.ts`, `history.test.ts` (chạy trong CI mỗi lần deploy).

## 7. Bàn giao & bí mật cần xoay (T8)

Danh sách việc khi bàn giao mã nguồn + quyền quản trị cho chủ dự án (chi tiết lệnh: RUNBOOK mục 9 "Xoay secret"):

- [ ] GitHub: chuyển quyền chủ repo `nhuonggh/FRC_VPS_Danghuong`; xoay GitHub Secrets (`REGISTRY_*`, SSH key deploy, `NEXTAUTH`/`AUTH_SECRET`).
- [ ] VPS: key SSH riêng (`id_ed25519_dherp_claude`) — xoá khỏi `authorized_keys` của root sau bàn giao; thêm key của người nhận.
- [ ] `.env` / `.env.migrate` trên VPS: xoay `AUTH_SECRET`, mật khẩu `app_rw` và owner DB; gỡ `BOOTSTRAP_ADMIN_PASSWORD` (RUNBOOK mục 10).
- [ ] Google OAuth: xoay Client Secret; kiểm redirect URI.
- [ ] Registry chung: mật khẩu `admin` thuộc chủ VPS — không phải của dự án; chỉ báo, không tự đổi.
- [ ] Tài khoản người dùng: đặt lại mật khẩu tạm; rà quyền vai trò Kế toán/Thủ quỹ (không ai ngoài Giám đốc có `period.close`).
- [ ] Backup ngoài VPS đã chạy ≥ 1 tuần và `restore-drill.sh` đạt (RUNBOOK mục 14).
- [ ] Diễn tập kết sổ (mục 4) đã được chủ dự án xác nhận ĐẠT trước khi kết sổ thật lần đầu.
