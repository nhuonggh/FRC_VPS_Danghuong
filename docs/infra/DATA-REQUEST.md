# Danh sách dữ liệu & xác nhận cần khách cung cấp (đưa dữ liệu thật vào hệ thống)

Cập nhật 30/09/2026. Cột **Nhập bằng** cho biết hệ thống đã sẵn sàng nhận dữ liệu chưa. "Import Excel" = đã có màn hình (Danh mục → nút Import, tải file mẫu). "Màn số đầu kỳ" = làm ở Plan 05 (D7) — khách cứ chuẩn bị file, nhập sau.

## A. Danh mục nền (cần trước tiên)
| # | Dữ liệu | Cột cần có | Nhập bằng |
|---|---|---|---|
| A1 | **Người dùng** | Họ tên, tên đăng nhập, **email Google** (nếu đăng nhập Google), vị trí (Giám đốc / Kế toán / Thủ kho / Thủ quỹ / Bán hàng). Số người từng vị trí | Màn Người dùng (nhập tay) |
| A2 | **Thông tin công ty** | Tên, địa chỉ, SĐT, MST, logo, ảnh QR thanh toán, người ký, ghi chú chân phiếu | Màn Công ty & mẫu in |
| A3 | **Nhóm khách/NCC** | Ví dụ: Khách lẻ, Thợ, Đại lý, NCC… | Cài đặt danh mục |
| A4 | **Kho** (nếu >1), **xe** (biển số), **lái xe / phụ xe**, **tuyến giao** | Tên/biển số | Cài đặt danh mục |
| A5 | **Quỹ tiền mặt + từng tài khoản ngân hàng** | Tên, số TK, ngân hàng | Cài đặt danh mục |
| A6 | **Loại chi phí** (lương, dầu, điện, sửa xe…) | Tên | Cài đặt danh mục |
| A7 | **Kiểu gia công** (tôn xốp, 1 lớp, 6 sóng, 11 sóng…) | Tên | Cài đặt danh mục |

## B. Dữ liệu chuyển từ phần mềm cũ (D1–D4) — không chuyển lịch sử giao dịch
| # | Dữ liệu | Cột cần có | Nhập bằng |
|---|---|---|---|
| B1 | **Khách hàng** (D1) | Mã, Tên, Nhóm, SĐT, Địa chỉ, Hạn mức nợ, Cho ghi nợ (Có/Không), Người phụ trách (tên đăng nhập), Ghi chú | Import Excel ✅ |
| B2 | **Nhà cung cấp** | Như B1 | Import Excel ✅ |
| B3 | **Sản phẩm ~1.300 mã** (D2) | Mã, Tên, Loại (Hàng hóa/NVL/Thành phẩm/Phụ kiện), Đơn vị gốc, Định mức tồn, Đơn vị quy đổi + Hệ số (vd kg/md = 2,4), Tôn cuộn (Có/Không), Ngừng bán, Ghi chú. **Danh sách mã trùng / ngừng bán tách file riêng để khách xác nhận trước** | Import Excel ✅ |
| B4 | **Định mức (BOM) thật** từng loại tôn xốp | Sản phẩm, kiểu gia công, từng NVL + số lượng/đơn vị (giấy bạc m/m², POLY/ISO kg/md theo độ dày & mùa), ngày hiệu lực | Màn Định mức (nhập tay) ✅ |

## C. Số đầu kỳ — chốt tại MỘT ngày chuyển (ghi rõ ngày)
| # | Dữ liệu | Cột cần có | Nhập bằng |
|---|---|---|---|
| C1 | **Tồn kho hàng hóa** (K1/D4) | Mã SP, số lượng (đơn vị gốc), **giá vốn** (phần mềm cũ không có lô: mỗi mã 1 lô, giá vốn khách cung cấp hoặc giá nhập gần nhất) | Màn số đầu kỳ (Plan 05) |
| C2 | **Tồn NVL** (K4) | Mã NVL, số lượng, giá vốn | Màn số đầu kỳ |
| C3 | **Công nợ khách hàng** (K2/D3) | Mã khách, số tiền khách đang nợ (+) | Màn số đầu kỳ |
| C4 | **Công nợ nhà cung cấp** (K2/D3) | Mã NCC, số tiền mình đang nợ (−) — *khách cần trả lời có chuyển phần này không* | Màn số đầu kỳ |
| C5 | **Số dư quỹ đầu kỳ** (K3) | Tiền mặt + từng tài khoản ngân hàng | Màn số đầu kỳ |
| C6 | **Chiết khấu tích lũy còn nợ khách** | Mã khách, số tiền | Màn số đầu kỳ |
| C7 | **Tiền cọc / công nợ ngược** (nếu có) | Mã khách, số tiền | Màn số đầu kỳ |

## D. Mẫu in & Google
| # | Dữ liệu | Ghi chú |
|---|---|---|
| D1 | **Bản in thật 9 mẫu**: hóa đơn bán hàng, báo giá, phiếu giao nhận, phiếu thu, phiếu chi, lệnh sản xuất, đối chiếu công nợ, phiếu nhập hàng, phiếu kiểm kho | Ảnh chụp/PDF mẫu đang dùng |
| D2 | **Tài khoản Google của xưởng** (Drive + Apps Script) để chạy in | Chuyển từ tài khoản thử sang tài khoản xưởng khi go-live |
| D3 | Đồng ý: dữ liệu in đi qua Google | Thêm vào tài liệu bảo mật |
| D4 | **File export mẫu từ phần mềm Niềm Tin** (vài chục dòng mỗi loại, dữ liệu thật đã che nếu cần) | Để đánh giá chuyển dữ liệu D1–D4 trước khi khách gửi bản đầy đủ |

## E. Xác nhận nghiệp vụ (hệ thống đang dùng mặc định, khách chỉ cần nói "đúng" hoặc "đổi")
| # | Câu hỏi | Mặc định đang dùng |
|---|---|---|
| E1 | Cước vận chuyển nhập hàng có cộng vào giá vốn không? | Có, phân bổ theo giá trị dòng hàng |
| E2 | Hàng khách trả lỗi: nhập chung mã hay tách mã "hàng lỗi"? | Nhập chung mã |
| E3 | Kết sổ cuối kỳ: giữ nguyên từng lô hay gộp 1 lô bình quân? | Giữ nguyên từng lô |
| E4 | Công nợ ghi khi nào: lúc tạo đơn hay lúc giao? | Lúc giao |
| E5 | Xuất kho lúc nào: tạo đơn hay xác nhận đơn? | Lúc tạo/xác nhận đơn (không phải lúc giao) |
| E6 | Ai được sửa giá bán tay? | Chỉ vai trò được cấp quyền "Sửa giá bán" (mặc định Giám đốc, Kế toán, Bán hàng) |
| E7 | Hàng trả về có "lấp" đơn đang treo (bán âm kho) trước đó không? | Không — đơn treo chỉ được bù bởi nhập mua/đầu kỳ/kiểm kê |
| E8 | Quỹ tiền mặt: phiếu bị thủ quỹ **trả lại** thì kế toán sửa phiếu gốc rồi gửi lại, hay lập phiếu điều chỉnh mới? | Sửa phiếu gốc rồi gửi lại (còn lịch sử) |
| E9 | Chốt quỹ theo ngày, theo ca, hay thủ quỹ tự chọn mốc? | Thủ quỹ tự chọn mốc |
| E10 | Chốt quỹ có chênh lệch: cho chốt kèm lý do hay phải xử lý hết? | Cho chốt kèm lý do bắt buộc |
| E11 | Phiếu đã kiểm tra: thủ quỹ sửa trực tiếp hay chỉ lập/duyệt phiếu điều chỉnh? | Chỉ điều chỉnh (giữ dấu vết) |
| E12 | Nhập kết quả giao: nhập cả tiền mặt lái xe thu và tiền khách chuyển khoản? | Có, nhập cả hai; CK đối chiếu tay với sao kê |
| E13 | Quyền mặc định từng vị trí (Kế toán / Thủ kho / Thủ quỹ / Bán hàng) | Theo bảng quyền hiện tại, Giám đốc chỉnh được trong Nhóm quyền |
