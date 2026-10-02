# Nạp dữ liệu khách (seed) — hướng dẫn

Script `scripts/seed-customer-data.ts` nạp bảng nhập của khách + file xuất phần mềm cũ vào DB **qua đúng các bộ nhập Excel của hệ thống** (cùng luật kiểm tra, audit `import.*`, idempotency). Chạy lại nhiều lần không nhân đôi; mục đã có thì bỏ qua.

## Nạp gì / không nạp gì

| Nhóm | Nguồn | Ghi chú |
|---|---|---|
| 8 danh mục (nhóm KH, kho, xe, lái/phụ xe, tuyến, loại thu chi, ngân hàng & quỹ, kiểu gia công) | bảng nhập | Kiểu gia công: hợp bảng khách + tên chỉ có ở phần mềm cũ; Tỷ lệ/Tỷ lệ trừ kho/ĐVT vào Ghi chú |
| Công ty | bảng nhập | Chỉ ghi nếu tên công ty còn là mặc định (`--force-company` để ghi đè) |
| Người dùng | bảng nhập | Cần "Vị trí" khớp tên nhóm quyền; thiếu thì bỏ qua. Mật khẩu tạm ghi vào file `--passwords-out` |
| Khách hàng, NCC | bảng nhập | SĐT bị Excel mất số 0 đầu được thêm lại |
| Sản phẩm | bảng nhập + phần mềm cũ | Trùng tên ⇒ giữ dòng bảng nhập; mã cũ đổi cho hợp lệ (`--code-map` ghi bảng đổi); giá cũ + kiểu gia công cũ vào Ghi chú; loại mặc định "Hàng hóa" |
| Số đầu kỳ (tồn, công nợ, quỹ, chiết khấu) | — | KHÔNG nạp: cần Ngày chốt. Nhập bằng Kỳ & số đầu kỳ / Hệ thống → Chuyển dữ liệu |
| Định mức (BOM) | — | Khách chưa điền |

## Lệnh

```bash
# Xem trước (không ghi gì) — DB lấy từ DATABASE_URL hoặc .env
npx tsx scripts/seed-customer-data.ts --intake "<bảng nhập>.xlsx" --legacy "<DSSanPham>.xls" [--as <tài khoản quản trị, mặc định admin>]

# Ghi thật: phải gõ lại đúng tên DB
npx tsx scripts/seed-customer-data.ts --intake … --legacy … --commit --confirm-db <tên DB> \
  --passwords-out mat-khau-tam.txt --code-map doi-ma.txt
```

Nạp lên VPS: mở tunnel SSH tới Postgres (không công khai cổng) rồi chạy với `DATABASE_URL` của `app_rw`/owner trỏ vào tunnel; hoặc dùng màn **Nhập Excel** từng mục. **Backup + restore drill (RUNBOOK §14) phải xong trước.** Xoá file mật khẩu tạm sau khi giao.

## Bảng bổ sung gửi khách

`npx tsx scripts/build-customer-supplement.ts --intake … --legacy … --out "<file>.xlsx"` — sinh file 13 trang (điền sẵn mã/tên từ dữ liệu đã nhận): xác nhận chung, phân loại sản phẩm, khách hàng, NCC, tồn kho, công nợ, quỹ, chiết khấu, định mức (BOM), giá công gia công thuê, người dùng, mẫu in.
