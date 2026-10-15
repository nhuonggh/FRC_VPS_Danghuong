# Chạy thử, đào tạo, chạy song song (plan 05 · D10)

Tài liệu cho **buổi làm việc với khách**. Ngôn ngữ đơn giản, mỗi kịch bản ≤ 15 phút. Ghi kết quả “Đạt / Không đạt + ghi chú” vào cột cuối rồi gửi lại.

## A. Cổng vào chạy song song (phải đủ mới bắt đầu nhập thật hằng ngày)

| # | Điều kiện | Ai làm | Tình trạng (cập nhật `STATUS.md`) |
|---|---|---|---|
| 1 | Tính năng D1–D4 chạy được trên bản thật (thu/chi + quỹ hậu kiểm, chi phí, chiết khấu tích lũy, chuyến giao) | AI (đã code) — **cần user duyệt merge `main`** | Code xong trên nhánh, chưa deploy |
| 2 | Trả hàng + bán tôn xốp tự trừ NVL theo định mức | AI (plan 04 đã deploy) | Đã deploy |
| 3 | **Sao lưu hằng đêm đang chạy** và diễn tập khôi phục “ĐẠT” | User (theo `RUNBOOK.md` mục 14) | Chờ user |
| 4 | Nhóm quyền từng vai trò đã kiểm (bảng mục B.0) | User + khách | Chờ |
| 5 | 9 mẫu in chạy với Google của xưởng (`docs/infra/print/README.md`) | Khách gửi mẫu + tài khoản Google; AI/User cấu hình | Chờ khách |
| 6 | Danh mục nền + khách + NCC + sản phẩm + định mức thật đã nhập (`Hệ thống → Chuyển dữ liệu`, làm lần lượt 1→5) | Khách gửi file (`DATA-REQUEST.md`) | Chờ khách |
| 7 | **Số đầu kỳ** đã nhập tại một ngày chốt (tồn + giá vốn, NVL, công nợ, quỹ, chiết khấu) và đối chiếu khớp sổ cũ | Khách + kế toán | Chờ khách |
| 8 | Hiệu năng: 1.300 sản phẩm + 1.000 đơn — danh sách/trang chính ≤ 3 giây | AI (test tự động, xem `tests/**/perf.test.ts`) | Đã có test |
| 9 | Đã báo khách 4 điểm ngầm định (mục E của `DATA-REQUEST.md`) và khách đồng ý hoặc đổi | User | Chờ |

**Không** chạy song song nếu thiếu mục 3, 6, 7.

## B. Kịch bản chạy thử theo vai trò

### B.0 Kiểm quyền trước (Giám đốc, 5 phút)
Hệ thống → Nhóm quyền. Mặc định: **Kế toán** lập phiếu/sửa phiếu chưa kiểm/yêu cầu điều chỉnh, tất toán chiết khấu, đối soát lái xe — *không* kiểm tra phiếu, *không* chốt quỹ, *không* xác nhận nhận tiền chuyến. **Thủ quỹ** kiểm tra/trả lại phiếu, duyệt điều chỉnh, chốt quỹ, xác nhận nhận tiền chuyến, đối soát. Việc **hủy chốt quỹ** chỉ Giám đốc. Tài khoản Kế toán/Thủ quỹ đã có sẵn trên bản thật giữ quyền cũ — mở nhóm và chỉnh cho đúng bảng này.

### B.1 Bán hàng
| Bước | Làm | Kết quả mong đợi |
|---|---|---|
| 1 | Bán hàng → Báo giá → lập báo giá cho một khách, “Gửi”, “Chuyển thành đơn” | Có **đơn nháp** (chưa trừ kho) |
| 2 | Mở đơn nháp → “Xác nhận đơn” | Kho trừ theo giá vốn lô; đơn chính thức |
| 3 | Đơn tôn xốp chọn kiểu gia công | Hiện NVL đã trừ + định mức đã dùng |
| 4 | Thu tiền cọc trên đơn | Trạng thái “Đã cọc”; công nợ khách giảm |
| 5 | **In hóa đơn** | Google Doc có chiết khấu theo dòng, đã thu, còn phải trả |
| 6 | Tạo phiếu trả hàng theo đơn | Kho nhập lại đúng giá vốn dòng bán gốc, công nợ giảm |

### B.2 Kế toán
| Bước | Làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kế toán → Phiếu thu → thu nợ một khách (gắn đơn) | Phiếu “Chờ kiểm tra”; công nợ giảm **ngay** |
| 2 | Phiếu chi trả NCC; Chi phí hoạt động (điện, lương) | Sổ quỹ ra ngay; chi phí không đụng công nợ |
| 3 | Sửa phiếu vừa lập khi chưa được kiểm | Sửa được, sổ quỹ/công nợ tính lại |
| 4 | Tất toán chiết khấu tích lũy một khách (chi tiền hoặc trừ nợ) | Số dư chiết khấu giảm; không cho quá số dư |
| 5 | Sau khi thủ quỹ kiểm: thử sửa phiếu | Bị chặn → “Yêu cầu điều chỉnh” (đổi tiền/quỹ hoặc hủy) |

### B.3 Thủ quỹ
| Bước | Làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kế toán → **Chờ kiểm tra quỹ** → Kiểm tra / Trả lại (có lý do) | Phiếu “Đã kiểm tra” khoá sửa; phiếu bị trả lại về kế toán sửa rồi gửi lại |
| 2 | Duyệt / từ chối một yêu cầu điều chỉnh | Duyệt sinh dòng đảo + dòng mới trong sổ quỹ; phiếu gốc còn nguyên vết |
| 3 | Sổ quỹ tiền mặt / sổ tiền gửi ngân hàng | 3 số: vận hành = đã kiểm + chờ kiểm |
| 4 | **Chốt quỹ** cuối ngày với tiền đếm thực | Lệch tiền → bắt buộc ghi lý do; vẫn chốt được, lưu lại chênh lệch |
| 5 | Chuyến giao đã đối soát → “Xác nhận đã nhận tiền” | Sinh phiếu thu vào quỹ/tài khoản NH (chờ kiểm); công nợ không đổi |

### B.4 Thủ kho / giao hàng
| Bước | Làm | Kết quả mong đợi |
|---|---|---|
| 1 | Giao hàng → **Xếp chuyến**: chọn xe, lái, phụ, các đơn theo thứ tự | Chống trùng xe/lái cùng ngày; đơn nằm một chuyến đang chạy |
| 2 | **In phiếu giao nhận** của chuyến | Google Doc |
| 3 | “Xuất phát”, sau chuyến: **Nhập kết quả** từng điểm (Giao đủ / Giao đủ, ghi nợ / Giao, hẹn trả / Giao một phần / Không giao được) | Có phiếu giao; công nợ đúng phần thực giao; tiền lái xe thu chưa vào quỹ |
| 4 | Đối soát lái xe (kế toán/thủ quỹ) | Lệch tiền → bắt buộc lý do |
| 5 | Hàng không giao được → “Giao lại” / “Trả về kho” / “Đã xử lý” | Đơn rời danh sách khi đã giao hết |

### B.5 Giám đốc
Xem: công nợ tổng hợp (cảnh báo chiết khấu âm), chiết khấu tích lũy, báo cáo tồn/XNT, lịch sử thao tác. Thử **hủy chốt quỹ** (chỉ Giám đốc).

## C. Chạy song song (2–4 tuần)
1. Chọn **ngày chốt số đầu kỳ** (thường cuối tháng), nhập số đầu kỳ (Kỳ & số đầu kỳ) — chỉ nhập được khi kỳ chưa có chứng từ; xong mới phát sinh chứng từ thật.
2. Nhập song song mọi giao dịch ở phần mềm cũ và ở DHERP.
3. **Mỗi cuối ngày đối chiếu 3 số** (khớp mới qua ngày): (a) tiền mặt + từng tài khoản NH (Sổ quỹ ↔ sổ cũ), (b) công nợ tổng phải thu/phải trả (Công nợ tổng hợp), (c) giá trị và số lượng tồn 10 mã chủ lực (Tồn kho).
4. Lệch → ghi vào bảng lỗi (mã chứng từ, số cũ, số mới, nguyên nhân) và sửa bằng **điều chỉnh** (không sửa lặng lẽ).
5. Sau ≥ 10 ngày liền không lệch → bàn giao dùng chính thức.

## D. Đào tạo đợt 1 (2 giờ, cả xưởng)
1. (15’) Đăng nhập, đổi mật khẩu, nhóm quyền của từng người. 2. (30’) Bán hàng: báo giá → đơn → cọc → in. 3. (30’) Thu/chi + thủ quỹ kiểm + chốt quỹ. 4. (30’) Xếp chuyến → kết quả giao → đối soát. 5. (15’) Hỏi đáp, ghi nhận điểm khó dùng.

## E. Nếu phải quay lại phần mềm cũ
Dữ liệu DHERP giữ nguyên (không xoá). Ngừng nhập ở DHERP, tiếp tục ở phần mềm cũ; khi sẵn sàng lại thì nhập bù các chứng từ thiếu theo ngày. Trước mọi thay đổi lớn: sao lưu tay (`RUNBOOK.md` mục 8, 14).
