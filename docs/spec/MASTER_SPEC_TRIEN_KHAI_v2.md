# MASTER SPEC — PHẦN MỀM QUẢN LÝ XƯỞNG TÔN ĐẶNG HƯƠNG
### Tài liệu triển khai cho AI/lập trình viên bám sát khi build — bản 2

> **Cách dùng:** Đây là nguồn sự thật duy nhất để xây hệ thống. Đọc trọn Phần 0–4 trước khi viết dòng code đầu tiên.
> **Quy tắc phạm vi:** chỉ làm những hạng mục có mã trong file Phạm vi bản cuối (1–73, 34a/b/c, K1–K5, M1–M9, D1–D4, T1–T8). **Hạng mục nào không có trong file đó thì không làm.** Mỗi màn hình ở Phần 7 ghi kèm mã phạm vi; code không truy được về một mã thì không viết.
> Chỗ ghi **CHỜ KHÁCH** thì dùng mặc định đã nêu và đánh dấu `// TODO: confirm` trong code.
> **Phiên bản:** 2 — 24/09/2026 (đối chiếu file Pham_Vi.xlsx). **Ngôn ngữ:** tiếng Việt. **Tiền tệ:** VND.

---

## PHẦN 0 — TÓM TẮT ĐIỀU HÀNH

Web app quản lý đơn hàng – kho – sản xuất – kế toán cho xưởng kinh doanh và gia công tôn/thép, thay thế phần mềm cũ (Niềm Tin).

| Chỉ số | Giá trị |
|---|---|
| Đơn hàng | 65 đơn/ngày, cao điểm 75 |
| Khách | ~100 khách + ~100 thợ + khách lẻ (cao điểm 25/ngày) |
| Sản phẩm | ~1.300 mã |
| Kho / chi nhánh | 1 kho (thực tế 2 kho cạnh nhau, quản lý như 1) / 1 chi nhánh |
| Xe / lái xe | 8 xe / 14 lái + phụ |
| Thủ quỹ | 2 (cô Thảo, chị Yến) |
| Thiết bị | 100% máy tính — KHÔNG app điện thoại |
| Giá vốn | **FIFO (nhập trước xuất trước)** |
| Chu kỳ dữ liệu | **Kết sổ cuối kỳ do giám đốc bấm** |
| Phạm vi | 81 màn hình · 9 mẫu in · 4 nhóm chuyển dữ liệu · 8 hạng mục bảo mật/triển khai |
| Khối lượng | **241 – 361 ngày công** (chưa gồm dự phòng — xem 8.3) |
| Đội đề xuất | 2 người: 6–9 tháng · 3 người: 4,5–6,5 tháng |

**Pain point số 1 của khách (tiêu chí nghiệm thu ngầm):** phần mềm cũ *"chậm, có lúc lỗi không làm được phải viết tay để đi giao hàng"*. Hệ thống mới PHẢI nhanh (≤ 3 giây mỗi màn hình) và thao tác tạo đơn → in phiếu giao phải ổn định. Việc in đi qua Google nên cần internet và phụ thuộc Google (Phần 5.5); khách đã đồng ý cách in này.

**Ba trụ nền tảng — làm đúng từ migration đầu tiên, sai là đập đi làm lại:**
1. Engine kho **FIFO theo lớp lô** (cost layers) kèm bảng ghi lại lớp nào bị ăn bao nhiêu.
2. Khái niệm **"kỳ" (period)** gắn vào mọi giao dịch.
3. **Phân quyền động** + ẩn dữ liệu nhạy cảm ở tầng server.

---

## PHẦN 1 — KIẾN TRÚC & CÔNG NGHỆ

### 1.1 Stack
| Lớp | Công nghệ |
|---|---|
| Frontend | Next.js 15 (App Router) + React + TypeScript |
| UI | Tailwind + shadcn/ui (tham chiếu skill `crm-erp-design-system`) |
| State/Data | TanStack Query + Zustand |
| Form/Validate | react-hook-form + zod |
| Backend | Next.js server actions / API routes |
| ORM | Prisma (raw SQL cho khóa hàng/advisory lock trong engine FIFO) |
| CSDL | **PostgreSQL** (bắt buộc — transaction, row-lock, ghi đồng thời) |
| Auth | next-auth (Credentials) + bcrypt |
| Hạ tầng | Docker + Caddy (HTTPS — T1) + GitHub Actions, VPS riêng (skill `setup-project`/`vps-setup`) |
| Sao lưu | pg_dump hằng đêm + bản sao ngoài máy chủ (T3) |
| In ấn | Google Apps Script + Google Doc template qua webhook (Phần 5) |

### 1.2 Bảy nguyên tắc kiến trúc BẤT BIẾN
1. **Sổ kho tách khỏi đơn hàng.** `stock_ledger` ghi mọi phát sinh nhập/xuất, mỗi dòng trỏ về chứng từ gốc (`doc_type` + `doc_id`). Đơn hàng KHÔNG sửa tồn trực tiếp.
2. **Mọi giao dịch mang `period_id`** từ migration đầu tiên.
3. **Giá vốn = lớp lô FIFO** (`cost_layers` + `cost_consumptions`), không phải tồn gộp.
4. **Mọi thao tác ghi tiền/kho chạy trong 1 transaction** — thành công trọn vẹn hoặc rollback.
5. **Ẩn dữ liệu nhạy cảm ở tầng server** — giá vốn/lợi nhuận/giá nhập không rời server nếu tài khoản không có quyền (T2).
6. **Audit log append-only**, chặn ở tầng DB (Phần 2.1).
7. **Hiệu năng là hợp đồng** — danh sách phân trang server-side, index đúng, ≤ 3 giây. Thời gian chờ Google trả PDF không tính vào mốc 3 giây (Phần 5).

### 1.3 Quy tắc số dư
KHÔNG lưu cột số dư chạy (`running_qty`, `balance`) trong các sổ. Số dư kho, quỹ, công nợ, chiết khấu tích lũy **tính khi đọc** = số đầu kỳ + tổng phát sinh (có index theo `period_id, product_id/partner_id/cash_account_id, at`). Lý do: sửa/hủy chứng từ giữa chuỗi sẽ làm sai mọi số dư lưu sẵn phía sau. Nếu cần tăng tốc thì dùng bảng tổng hợp theo ngày, tính lại được.

---

## PHẦN 2 — MÔ HÌNH DỮ LIỆU

> Prisma schema mô tả rút gọn. Tiền = Decimal(18,2), số lượng = Decimal(18,3). Mọi bảng giao dịch có `period_id`, `created_by`, `created_at`.

### 2.1 Hệ thống & phân quyền (mục 1–7)
```
users(id, username, password_hash, full_name, is_locked, created_at)
roles(id, name)                                    -- Giám đốc, Kế toán, Thủ kho, Thủ quỹ, Bán hàng
permissions(id, code)                              -- vd: order.create, order.cancel, cost.view, period.close
role_permissions(role_id, permission_id)
user_roles(user_id, role_id)
audit_log(id, user_id, action, entity, entity_id, before_json, after_json, at)
    -- APPEND-ONLY: app dùng DB role chỉ có INSERT/SELECT trên bảng này (REVOKE UPDATE, DELETE),
    -- thêm trigger chặn UPDATE/DELETE. Admin phần mềm cũng không xóa được (mục 5).
company_settings(id, name, address, phone, tax_code, logo, bank_info, ...)   -- mục 6
```

### 2.2 Danh mục nền (mục 8–18)
```
partner_groups(id, name)                           -- NCC, Thợ, Khách lẻ, ... (mục 8)
partners(id, code, name, group_id, is_customer, is_supplier, owner_user_id,
         debt_limit, allow_credit, phone, address, note, merged_into_id)
    -- owner_user_id: người bán phụ trách (cho quyền "chỉ thấy khách của mình")
    -- merged_into_id: sau khi gộp mã (mục 65)
products(id, code, name, kind[HANG|NVL|THANH_PHAM|PHU_KIEN], base_unit,
         min_stock, is_active, note)
product_units(id, product_id, unit, factor)        -- quy đổi; factor mặc định (vd kg/md) — mục 12
processing_types(id, name)                         -- kiểu gia công: tôn xốp, 1 lớp, 6 sóng, 11 sóng — mục 13
boms(id, product_id, processing_type_id, valid_from, is_active)
bom_lines(id, bom_id, material_product_id, qty_per_unit, note)   -- sửa được theo mùa/độ dày — mục 51
warehouses(id, name)
vehicles(id, plate)
drivers(id, name, is_assistant)
routes(id, name)
cash_accounts(id, type[CASH|BANK], name, bank_no)
expense_types(id, name)                            -- lương, dầu, điện, sửa xe...
print_templates(id, doc_type, name, webhook_url, secret, is_active,
                title, signer_name, phone, qr_image, show_company_info, footer_note)   -- Phần 5
print_files(id, doc_type, doc_id, drive_file_id, created_at)   -- UNIQUE(doc_type, doc_id)
```

### 2.3 Kỳ & số đầu kỳ (K1–K5)
```
periods(id, name, status[OPEN|CLOSED], opened_at, closed_at, closed_by)
opening_stock(id, period_id, product_id, qty, unit_cost, layer_seq)   -- K1, K4 (NVL cũng là product)
opening_debt(id, period_id, partner_id, amount)    -- K2: (+) khách nợ mình, (−) mình nợ NCC/khách
opening_cash(id, period_id, cash_account_id, amount)                   -- K3
opening_discount(id, period_id, partner_id, amount)                    -- số dư chiết khấu tích lũy chưa tất toán
```
Ràng buộc: luôn có đúng 1 dòng `periods.status = OPEN` (partial unique index).

### 2.4 Engine kho FIFO (LÕI)
```
cost_layers(id, period_id, product_id, source_doc_type, source_doc_id,
            qty_in, qty_remaining, unit_cost, seq, created_at)
    -- source_doc_type: OPENING | PURCHASE | ADJ_IN | RETURN_IN | PRODUCTION
cost_consumptions(id, layer_id, doc_type, doc_line_id, qty, unit_cost)
    -- mỗi lần xuất ghi rõ ăn lớp nào bao nhiêu → hoàn lớp chính xác khi sửa/hủy
stock_ledger(id, period_id, product_id, doc_type, doc_id, doc_line_id,
             qty_in, qty_out, unit_cost_out, at)
```

### 2.5 Mua – bán – giao – trả (mục 19–48)
```
purchases(id, period_id, partner_id, date, freight_cost, total, note)
purchase_lines(id, purchase_id, product_id, qty, unit, factor_used, qty_base,
               unit_price, allocated_freight, roll_info)
    -- factor_used: hệ số kg/md thực tế lần nhập này (sửa được theo lần nhập)
    -- roll_info: ghi chú cuộn (số cuộn, quy cách) CHỈ để tra cứu — mục 30; không quản tồn theo cuộn (X6)

stock_adjustments(id, period_id, type[IN_NO_SUPPLIER|LOSS|WRITE_OFF|STOCKTAKE],
                  date, stocktake_id, note)
stock_adjustment_lines(id, adjustment_id, product_id, qty, unit_cost)
    -- IN_NO_SUPPLIER = mục 21 "nhập kho đầu kỳ": hàng lệch/dư, không NCC, không sinh công nợ

quotes(id, period_id, code, partner_id, date, status[DRAFT|SENT|CONVERTED|CANCELLED],
       converted_order_id)                                          -- mục 35
quote_lines(id, quote_id, product_id, qty, unit, price, note)

sale_orders(id, period_id, code, partner_id, quote_id, delivery_status, payment_status,
            order_date, expected_delivery_date, original_delivery_date,
            order_discount, is_cancelled, cancelled_at, cancelled_by, cancel_reason)
sale_order_lines(id, order_id, product_id, qty, unit, qty_base, price,
                 discount_now,          -- chiết khấu trừ ngay trên đơn (giảm tiền phải thu)
                 discount_accum,        -- chiết khấu tích lũy (KHÔNG giảm tiền phải thu) — 6.3
                 unit_cost_fifo, is_provisional, processing_type_id)

delivery_notes(id, period_id, order_id, date, warehouse_id)          -- mục 37 giao nhiều lần
delivery_lines(id, delivery_note_id, order_line_id, product_id, qty)

trips(id, period_id, route_id, vehicle_id, driver_id, assistant_id, date,
      status[PLANNED|ON_ROAD|RETURNED|SETTLED|CONFIRMED])
trip_orders(trip_id, order_id, result, cash_collected, bank_collected, debt_amount,
            promised_date, note, handed_to_user_id)
    -- result: GIAO_DU | GHI_NO | HEN_TRA | KHONG_GIAO | GIAO_MOT_PHAN (mục 40)
    -- handed_to_user_id: người bán nhận xử lý hàng không giao được (mục 42)
trip_settlements(id, trip_id, total_due, cash, bank, debt, diff,
                 settled_by, settled_at, cashier_user_id, cashier_confirmed_at)   -- mục 41

returns(id, period_id, type[ORDER|PRODUCT|SUPPLIER], partner_id, order_id, date, note)
return_lines(id, return_id, product_id, qty, unit_cost, amount, order_line_id)
    -- unit_cost: giá vốn nhập lại kho (3.4); amount: giá trị trừ công nợ
```

### 2.6 Sản xuất – gia công – kiểm kho (mục 26–28, 49–55)
```
production_orders(id, period_id, product_id, qty, date, status[NEW|DONE])  -- CHỈ phụ kiện
production_consumption(id, production_order_id, material_product_id, qty)

processing_jobs(id, period_id, partner_id, processing_type_id, date,
                qty, labor_amount, material_amount, note)             -- gia công thuê (mục 54)
processing_job_lines(id, job_id, material_product_id, qty, unit_cost)   -- chỉ NVL của xưởng

stocktakes(id, period_id, date, status[DRAFT|DONE], note)             -- mục 26, 27
stocktake_lines(id, stocktake_id, product_id, system_qty, actual_qty, diff)
```

### 2.7 Kế toán – công nợ – quỹ – chiết khấu (mục 56–66)
```
receipts(id, period_id, code, partner_id, type[THU_NO|COC|KHAC], order_id, trip_id,
         amount, cash_account_id, date, note)                         -- phiếu thu, tiền cọc (mục 36)
payments(id, period_id, code, partner_id, type[TRA_NCC|CHI_PHI|TAT_TOAN_CK|KHAC],
         expense_type_id, amount, cash_account_id, date, note)       -- phiếu chi
cash_ledger(id, period_id, cash_account_id, amount_in, amount_out, doc_type, doc_id, at)

partner_ledger(id, period_id, partner_id, debit, credit, doc_type, doc_id, at)
    -- SỔ CÔNG NỢ DUY NHẤT (khách & NCC). Đơn giao, phiếu thu, phiếu chi, nhập hàng,
    -- trả hàng, điều chỉnh, gộp nợ đều sinh dòng ở đây. Không có bảng debts riêng.
debt_adjustments(id, period_id, partner_id, amount,
                 reason_type[HANG_LOI|BEP_MOP|CHIET_KHAU|KHAC], note)   -- mục 64
debt_transfers(id, period_id, from_partner_id, to_partner_id, amount, note)   -- mục 65
operating_expenses(id, period_id, expense_type_id, amount, payment_id, note, date)   -- mục 66

discount_ledger(id, period_id, partner_id, order_line_id, amount_in, amount_out,
                settle_method[CASH|OFFSET], doc_type, doc_id,
                is_reconciled, reconciled_by, reconciled_at, at)
    -- sổ chiết khấu tích lũy: mỗi dòng đơn cộng amount_in; tất toán/đảo trừ amount_out
```

---

## PHẦN 3 — ENGINE GIÁ VỐN FIFO (đặc tả chi tiết + test)

**Quy tắc:** nhập trước xuất trước. Giá vốn chỉ đổi khi NHẬP, không đổi khi bán.

### 3.0 Ghi đồng thời
Mọi thao tác nhập/xuất một mã hàng lấy `pg_advisory_xact_lock(product_id)` trong transaction, **luôn khóa theo thứ tự product_id tăng dần** (đơn nhiều dòng, BOM nhiều NVL) để không deadlock. Hai người bán cùng một mã cùng lúc sẽ xếp hàng, không ăn trùng lớp.

### 3.1 Nhập
Tạo `cost_layer`: `qty_in = qty_remaining = SL nhập (đơn vị gốc)`; `unit_cost = (tiền hàng + allocated_freight) / SL`; `seq` tăng theo thời gian chứng từ.
*(CHỜ KHÁCH: cước vận chuyển có cộng vào giá vốn không. Mặc định: CÓ, phân bổ theo **giá trị** dòng hàng — vì một phiếu có thể trộn kg và md. Nếu cước nhập sau phiếu hàng thì cập nhật lớp và tính lại chuỗi như 3.5.)*

### 3.2 Xuất (bán / tiêu hao BOM / sản xuất / hao hụt / trả NCC)
Duyệt các lớp `qty_remaining > 0` theo `seq` tăng → trừ dần đến đủ SL (một lần xuất có thể ăn nhiều lớp) → ghi từng phần vào `cost_consumptions` → `unit_cost_out` = bình quân trọng số, lưu vào `sale_order_lines.unit_cost_fifo` và `stock_ledger`.

**Test case chuẩn (của khách):** Nhập 100@20.000 → bán 30 (vốn 20.000, còn 70@20.000) → nhập 100@22.000 → bán 90 = 70@20.000 + 20@22.000. `unit_cost_out` = (70×20.000 + 20×22.000)/90 = 20.444,44. Còn tồn 80@22.000.

### 3.3 Bán âm kho (đơn treo — mục 29)
Không đủ lớp: vẫn cho xuất phần thiếu, `unit_cost_out` tạm = giá nhập gần nhất, `is_provisional = true`, đơn vào **"Danh sách đơn chưa đủ tồn"**, chưa tính lãi. Khi nhập bù → tạo lớp → khớp các đơn treo theo thứ tự thời gian → tính lại `unit_cost_fifo` + lãi → gỡ cờ.

### 3.4 Trả hàng (mục 43–48, 42)
- **Trả theo đơn (43) & hàng không giao được (42):** nhập lại kho tạo **lớp mới** với `unit_cost` = `unit_cost_fifo` của dòng bán gốc.
- **Trả theo sản phẩm (45)** — khách không nhớ đơn: `unit_cost` = giá vốn của lần bán gần nhất mã đó cho khách đó; không có thì lấy giá nhập gần nhất. Giá trị trừ công nợ = giá bán gần nhất cho khách đó (sửa tay được).
- **Trả NCC (47):** xuất kho theo FIFO như 3.2; công nợ phải trả giảm theo giá trả thỏa thuận (nhập tay, mặc định = giá nhập gần nhất từ NCC đó).
- *(CHỜ KHÁCH: hàng trả lỗi nhập chung mã hay tách mã "hàng lỗi" — mặc định nhập chung.)*

### 3.5 Sửa / hủy / khôi phục đơn
- **Kỳ đang mở:** cho sửa → hoàn lớp theo `cost_consumptions` → **tính lại chuỗi từ điểm sửa trở đi, theo từng mã hàng bị ảnh hưởng** → cập nhật `unit_cost_fifo`, lãi dòng, giá vốn thành phẩm tôn xốp, đơn treo. Chạy trong transaction, ghi audit.
  - Giá vốn trên dòng bán được "lưu cứng" theo nghĩa: là số chính thức để báo cáo và trả hàng; **chỉ engine** được ghi đè khi tính lại chuỗi trong kỳ đang mở. Sau kết sổ thì bất biến.
  - Nếu một lần tính lại chạm quá ~2.000 dòng: chạy nền theo từng mã, đánh dấu mã "đang tính lại" (chặn xuất mã đó đến khi xong). Khuyến nghị khách kết sổ hằng tháng để giữ chuỗi ngắn — là khuyến nghị, không ép.
- **Kỳ đã kết sổ:** KHÓA CỨNG, không sửa/hủy (X7).

### 3.6 Giá vốn hàng gia công bán ra / gia công thuê (mục 13, 49, 51, 54)
- Bán tôn xốp / 1 lớp / 6 sóng / 11 sóng → đọc BOM đang hiệu lực theo `processing_type` → xuất từng NVL (tôn cuộn, giấy bạc, POLY, ISO) theo FIFO của chính NVL → cộng lại thành giá vốn dòng bán. Không lập lệnh sản xuất.
- **Gia công thuê (54):** tôn của khách **không nhập kho**, không trừ tôn cuộn.
  - Tôn 1 lớp: chỉ tính tiền công, không xuất kho.
  - Tôn xốp: tiền công + NVL xưởng bỏ ra (giấy bạc, POLY, ISO) — xuất NVL theo BOM, FIFO.
- Phụ kiện (nóc, sườn, sối, máng): lập lệnh sản xuất → xuất NVL (FIFO) → nhập thành phẩm tạo lớp với `unit_cost` = tổng giá vốn NVL / SL.

### 3.7 Bộ test bắt buộc (viết TRƯỚC khi làm UI)
Nhập-bán 1 lớp · bán xuyên nhiều lớp (case 3.2) · bán âm rồi nhập bù · 2 người bán cùng mã đồng thời · trả theo đơn đúng giá vốn cũ · trả theo SP không có đơn · trả NCC · sửa đơn giữa chuỗi · hủy đơn giữa chuỗi · khôi phục đơn đã hủy · cước nhập sau phiếu hàng · tôn xốp cộng vốn NVL · gia công thuê tôn xốp không trừ tôn cuộn · lệnh SX phụ kiện · hủy đơn có chiết khấu tích lũy · kết sổ mang lô sang kỳ mới.

---

## PHẦN 4 — KẾT SỔ CUỐI KỲ & SỐ ĐẦU KỲ (K1–K5)

**Nguyên tắc:** kỳ = khoảng giữa hai lần kết sổ. Luôn có đúng 1 kỳ OPEN. Chỉ **giám đốc** bấm kết sổ.

### 4.1 Số đầu kỳ
Tồn kho + giá vốn theo lô (K1) · công nợ khách & NCC (K2) · số dư quỹ tiền mặt + từng TK ngân hàng (K3) · tồn NVL + giá vốn (K4) · số dư chiết khấu tích lũy từng khách. Hai đường vào: **nhập tay khi khởi tạo** (từ dữ liệu chuyển D1–D4) + **tự sinh khi kết sổ**.

### 4.2 Điều kiện được kết sổ — màn hình hiện checklist, còn mục đỏ thì nút Kết sổ bị khóa
| Kiểm tra | Xử lý |
|---|---|
| Còn đơn `is_provisional` (âm kho chưa nhập bù) | **Chặn.** Phải nhập bù hoặc kiểm kho điều chỉnh trước |
| Còn chuyến chưa đối soát / thủ quỹ chưa xác nhận | **Chặn** |
| Còn phiếu kiểm kho DRAFT | **Chặn** |
| Đơn nháp chưa xuất kho | Cảnh báo — được mang sang kỳ mới (đổi `period_id`) |
| Tiền cọc chưa dùng | Cảnh báo — chuyển tiếp trong số dư công nợ (−) của khách |
| Chiết khấu tích lũy chưa đối chiếu (`is_reconciled = false`) | Cảnh báo — chuyển tiếp vào `opening_discount` |

### 4.3 Luồng kết sổ (1 transaction, xác nhận 2 bước)
1. Chốt số cuối kỳ: tồn + lớp giá còn lại, công nợ, số dư quỹ, số dư chiết khấu tích lũy.
2. Sinh `opening_*` cho kỳ mới = số cuối kỳ (**chuyển tiếp, KHÔNG về 0**).
3. Lô tồn cuối kỳ → lớp `OPENING` của kỳ mới. *(CHỜ KHÁCH: giữ nguyên từng lô hay gộp 1 lô bình quân — mặc định giữ nguyên từng lô.)*
4. Kỳ cũ → CLOSED; tạo kỳ mới OPEN.
5. Diễn tập trên bản sao DB trước lần kết sổ thật đầu tiên.

### 4.4 Quy tắc xuyên kỳ
- "Khóa cứng" = **không sửa/hủy chứng từ thuộc kỳ đã đóng**. Vẫn được **tạo chứng từ mới ở kỳ đang mở** liên quan đến đơn kỳ cũ: giao nốt, thu nợ, trả hàng (trả theo đơn kỳ cũ lấy giá vốn dòng bán gốc, chứng từ trả mang `period_id` kỳ mới).
- Dữ liệu kỳ cũ giữ nguyên, chỉ đọc; có màn "tra cứu kỳ cũ". Màn làm việc lọc mặc định kỳ đang mở.
- **Giữ toàn bộ danh mục** (khách, 1.300 SP, NCC, định mức, phân quyền). Chỉ giao dịch bắt đầu trống. Không xóa gì.

---

## PHẦN 5 — HỆ THỐNG IN ẤN (M1–M9, mục 6)

**Chốt:** Google Apps Script + Google Doc template, placeholder `<<name>>`, `<<address>>`… Kế toán tự sửa mẫu trên Google Doc. Khách đã đồng ý dữ liệu in đi qua Google.

### 5.1 Kiến trúc webhook cắm-rút
- Mỗi mẫu (`print_templates`) có **webhook URL + secret riêng**, cấu hình trong app. Mẫu nào không dùng thì tắt `is_active` (mục 6).
- App gửi **data contract** JSON → Apps Script verify secret → mở template → thay placeholder → xuất PDF → trả link.
- **Secret gửi trong body JSON** (Apps Script `doPost` không đọc được request header).
- Đổi engine in sau này chỉ cần đổi URL, không đụng lõi.

### 5.2 Data contract
Chuẩn hóa JSON cho từng loại phiếu TRƯỚC khi code: thông tin công ty (kèm cờ `show_company_info`), tiêu đề, người lập, SĐT, ảnh QR, ghi chú cuối phiếu (khách tự chỉnh trong app — M1–M9), khách, dòng hàng, tổng, **chiết khấu theo dòng + tổng chiết khấu**, đã thu, còn phải trả.

### 5.3 Dọn file tạm — giữ 1 bản theo từng chứng từ
`print_files` lưu `drive_file_id` theo chứng từ. In lại: tạo PDF mới → xóa file cũ nếu còn → cập nhật id. PDF là bản tạm, in lại thì sinh lại từ dữ liệu server.

### 5.4 Thời gian chờ
Timeout gọi webhook **12 giây** (Apps Script tạo PDF thường 4–10 giây, lần đầu có thể lâu hơn). UI hiện trạng thái "đang tạo bản in", không khóa màn hình. Hết thời gian thì báo lỗi rõ ràng và cho bấm in lại.

### 5.5 Rủi ro đã chấp nhận
In cần internet và Google hoạt động. Phạm vi **không có** phương án in dự phòng khi Google lỗi hoặc mất mạng.

### 5.6 Checklist đã chốt
Secret theo webhook · quota nội bộ không vướng · dọn file theo chứng từ · go-live chuyển Drive sang tài khoản Google của xưởng (user tự setup).

---

## PHẦN 6 — QUY TẮC NGHIỆP VỤ

### 6.1 Trạng thái đơn hàng — HAI TRỤC ĐỘC LẬP (mục 32)
- **Giao hàng:** Mới tạo → Chờ hàng → Sẵn hàng → Đã xếp xe → Đang giao → Đã giao / Giao một phần / Không giao được
- **Thanh toán:** Chưa thu → Đã cọc → Thu một phần → Đã thanh toán → Nợ ghi sổ → Hẹn đơn sau trả → Dư tiền
- **Ngày dự kiến giao:** chưa giao trong ngày → job đầu ngày tự đẩy sang hôm nay, giữ `original_delivery_date` để hiện số ngày trễ.

### 6.2 Luồng giao hàng & tiền (mục 38–42)
```
Tạo đơn → chuẩn bị hàng → xếp chuyến (gom theo tuyến, gán xe + lái + phụ) → in phiếu giao
→ lái xe giao, thu tiền mặt / khách CK vào TK công ty
→ lái xe về → kế toán nhập kết quả từng đơn → đối soát chuyến
→ khớp → thủ quỹ (cô Thảo/chị Yến) xác nhận nhận tiền
```
- **Nhập kết quả giao (mục 40 — trả lời câu "Chưa rõ" của khách):** kế toán nhập **cả trạng thái lẫn số tiền** cho từng đơn: kết quả (giao đủ / ghi nợ / hẹn trả / không giao được / giao một phần) + tiền mặt lái xe thu + tiền khách chuyển khoản + phần ghi nợ + ngày hẹn trả. Giao một phần thì nhập SL thực giao từng dòng. Tiền CK đối chiếu tay với sao kê (X8).
- Khi lưu kết quả: sinh `receipts` (tiền mặt vào quỹ tạm của chuyến, CK vào TK ngân hàng), `partner_ledger`, và dòng nhập lại kho cho phần không giao.
- **Đối soát chuyến (41):** tổng phải thu − tiền mặt − CK − ghi nợ = chênh lệch. Chênh lệch = 0 mới cho chuyển thủ quỹ xác nhận; khác 0 phải ghi lý do.
- **Hàng không giao được (42):** nhập lại kho theo 3.4, gán người bán (anh Giáp) xử lý tiếp.
- Khách có `allow_credit` được ghi nợ trong hạn mức; không có thì lái xe gọi về hỏi.

### 6.3 Chiết khấu (mục 31, 64)
Hai kiểu, hai cột riêng trên dòng đơn:
1. **Trừ ngay (`discount_now`)** — giảm tiền phải thu của đơn.
2. **Tích lũy trả sau (`discount_accum`)** — nhập TAY theo từng dòng; **KHÔNG trừ tiền phải thu** (khách trả đủ). Cộng vào `discount_ledger` của khách (công nợ ngược).
- Lãi dòng = (giá bán − `unit_cost_fifo`) × SL − `discount_now` − `discount_accum` (trừ vào lãi NGAY).
- Tất toán: kế toán bán hàng tự làm — chi tiền mặt (phiếu chi `TAT_TOAN_CK`) HOẶC trừ vào đơn sau/công nợ (`OFFSET`, sinh dòng `partner_ledger`). Giám đốc/kế toán trưởng **hậu kiểm** qua cờ `is_reconciled`.
- **Hủy đơn / trả hàng có chiết khấu tích lũy:** tự sinh dòng `amount_out` đảo phần chiết khấu tương ứng (theo tỷ lệ SL trả). Nếu phần đó đã tất toán thì số dư chiết khấu âm → hiện cảnh báo cho kế toán xử lý bằng điều chỉnh công nợ (64).
- Mẫu in: cột chiết khấu riêng từng dòng + dòng "Tổng chiết khấu" ở chân phiếu.

### 6.4 Quy đổi đơn vị (mục 12)
Mỗi SP có đơn vị gốc (thường md) + hệ số quy đổi mặc định. Lúc nhập hàng sửa được hệ số thực tế của lần nhập (`purchase_lines.factor_used`). Ví dụ 3.000 kg ÷ 2,4 = 1.250 md. Sổ kho và FIFO luôn tính theo đơn vị gốc.

### 6.5 Định mức & tiêu hao thực tế (mục 51–53)
- BOM sửa được bất cứ lúc nào; mỗi lần sửa tạo phiên bản mới (`valid_from`), đơn cũ giữ phiên bản đã dùng.
- **Tiêu hao thực tế (52)** lấy từ kiểm kho: thực dùng = tồn đầu + nhập − tồn kiểm kho thực tế.
- **Đối chiếu (53)** cuối kỳ: đã trừ theo định mức X phi ↔ thực tế Y phi → chênh lệch. Chênh lệch ghi nhận bằng phiếu điều chỉnh hao hụt.
- NVL: tôn cuộn, giấy bạc, POLY (210 kg/phi), ISO (250 kg/phi). *(CHỜ KHÁCH: bảng định mức thật — trong lúc chờ dùng định mức tạm, sửa lại được.)*

### 6.6 Phân quyền mẫu (mục 3 — khách tự chỉnh được sau)
| Vai trò | Xem/làm | Ẩn |
|---|---|---|
| Giám đốc | Toàn bộ + kết sổ | — |
| Kế toán | Đơn, thu chi, công nợ, giá vốn | Kết sổ, tạo tài khoản |
| Thủ kho | Kho, nhập xuất, kiểm kho | Giá nhập, giá bán, lãi |
| Thủ quỹ | Sổ quỹ, thu chi | Giá nhập, lãi |
| Bán hàng | Khách mình phụ trách (`owner_user_id`), tạo đơn | Giá vốn, lãi lỗ |

Quyền "chỉ khách của mình" là phạm vi dữ liệu, áp ở tầng query server.

### 6.7 Xóa / hủy / khôi phục đơn (mục 34, 34a, 34b, 34c)
- **Xóa hẳn (34c)** chỉ cho đơn CHƯA phát sinh (nháp/trùng): chưa xuất kho, chưa có tiền/công nợ, chưa vào chuyến, không có chứng từ con, không thuộc kỳ đã khóa. FK `RESTRICT` ở DB là lớp chặn thứ hai.
- **Chặn khi còn dính tiền (34b):** đơn có phiếu thu hoặc còn công nợ → phải xử lý tiền trước (hoàn/chuyển cọc, điều chỉnh công nợ) mới cho hủy.
- **Hủy đơn đã phát sinh (34a):** hoàn kho hàng và NVL (hoàn lớp theo `cost_consumptions` + tính lại chuỗi), đảo công nợ và chiết khấu tích lũy, đơn chuyển vào "Danh sách đơn đã xóa", có audit.
- **Khôi phục (34):** đơn đã hủy trong kỳ đang mở khôi phục được → xuất kho lại theo FIFO tại vị trí thời gian gốc (tính lại chuỗi); thiếu tồn thì thành đơn treo (3.3). Đơn kỳ đã khóa không khôi phục.

### 6.8 Tiền cọc (mục 36)
Cọc của khách lạ và hàng đặt riêng: phiếu thu loại `COC` gắn đơn. Khi giao, cọc tự trừ vào tiền phải thu. Hủy đơn có cọc → áp 34b (hoàn cọc bằng phiếu chi hoặc giữ làm số dư cho khách).

### 6.9 Báo giá (mục 35)
Lập báo giá, in (M2), khi chốt bấm "Chuyển thành đơn" → sinh đơn nháp với dòng hàng từ báo giá, báo giá sang `CONVERTED`. Báo giá không đụng kho.

### 6.10 Nhập kho đầu kỳ / nhập không NCC (mục 21) — khác K1
Phiếu nhập cho hàng lệch, dư không theo NCC: tạo lớp FIFO với `unit_cost` nhập tay (mặc định giá nhập gần nhất), **không sinh công nợ**. K1 là số đầu kỳ khi khởi tạo/kết sổ; mục 21 là chứng từ phát sinh trong kỳ.

### 6.11 Chuyển dữ liệu (D1–D4)
Chỉ chuyển 4 nhóm, **không chuyển lịch sử giao dịch** của phần mềm cũ:
- D1 Danh sách khách hàng.
- D2 Danh mục ~1.300 SP — mã trùng/ngừng bán lọc ra file riêng để khách xác nhận trước.
- D3 Công nợ tại ngày chuyển — **cả công nợ khách và công nợ nhà cung cấp** (trả lời câu "Chưa rõ" của khách) → vào `opening_debt`.
- D4 Tồn kho tại ngày chuyển → vào `opening_stock`. Phần mềm cũ không có lô FIFO nên mỗi mã vào 1 lô đầu kỳ, giá = giá vốn khách cung cấp (hoặc giá nhập gần nhất).
- Số dư quỹ (K3) và chiết khấu tích lũy còn nợ khách (nếu có) nhập tay trên màn số đầu kỳ.

---

## PHẦN 7 — DANH MỤC MÀN HÌNH THEO MÃ PHẠM VI (81 màn hình + 9 mẫu in)

### M1. Hệ thống & phân quyền (7)
**1** Đăng nhập, đổi/cấp lại mật khẩu · **2** Quản lý người dùng · **3** Cấu hình nhóm quyền (động, tới từng chức năng + phạm vi dữ liệu) · **4** Khóa/mở khóa tài khoản · **5** Nhật ký thao tác (số cũ/số mới, ghi cả admin, không xóa được) · **6** Cấu hình & thông tin công ty + bật/tắt mẫu in · **7** Trang chủ (số liệu trong ngày).

### M2. Danh mục nền (11)
**8** Nhóm KH (NCC, thợ, khách lẻ…) · **9** Danh sách KH (hạn mức + cờ ghi nợ + người phụ trách) · **10** Danh sách NCC · **11** Danh mục SP · **12** Đơn vị tính & quy đổi · **13** Kiểu gia công (công thức NVL → thành phẩm) · **14** Kho · **15** Xe & lái xe · **16** Tuyến giao hàng · **17** Loại thu chi · **18** Ngân hàng.

### M3. Nhập hàng (3)
**19** Lập phiếu nhập (quy đổi, sinh lô FIFO, cộng kho, sinh công nợ phải trả, phân bổ cước, ghi chú cuộn) · **20** Danh sách phiếu nhập (xem/tìm/sửa — sửa kích hoạt tính lại chuỗi) · **21** Nhập kho đầu kỳ / nhập không NCC (6.10).

### M4. Quản lý kho (9)
**22** Sổ kho/thẻ kho chi tiết · **23** Tồn kho hiện tại · **24** Báo cáo XNT (kèm giá) · **25** Định mức tồn + cảnh báo · **26** Lập phiếu kiểm kho · **27** Danh sách kiểm kho · **28** Điều chỉnh hao hụt/xuất hủy (cắt lỗi ~1%/tháng) · **29** Danh sách đơn chưa đủ tồn · **30** Tra cứu thông tin cuộn = tra các dòng nhập tôn cuộn: ngày nhập, NCC, loại tôn, KL, ghi chú cuộn (chỉ tra cứu, không tồn theo cuộn).

### M5. Bán hàng (10)
**31** Màn hình bán hàng (tồn + giá bán gần nhất của khách này & khách bất kỳ + giá nhập gần nhất nếu có quyền, sửa giá tay, chiết khấu trừ ngay + tích lũy theo dòng) · **32** Danh sách đơn (2 trục trạng thái, ngày giao tự dời) · **33** Chi tiết đơn (ai tạo, lịch sử sửa từ audit) · **34** Danh sách đơn đã xóa + khôi phục · **34a** Hủy đơn tự hoàn kho · **34b** Chặn hủy khi còn dính tiền · **34c** Chỉ xóa hẳn đơn nháp/trùng · **35** Lập báo giá → chuyển đơn · **36** Quản lý tiền cọc · **37** Phiếu xuất kho/giao nhiều lần.

### M6. Giao hàng & đối soát lái xe (5)
**38** Xếp chuyến, điều xe, in phiếu giao · **39** Danh sách chuyến · **40** Nhập kết quả giao (trạng thái + tiền mặt + CK + ghi nợ) · **41** Đối soát tiền theo lái xe → thủ quỹ xác nhận · **42** Xử lý hàng không giao được.

### M7. Trả hàng (6)
**43** Trả theo đơn · **44** DS trả theo đơn · **45** Trả theo SP · **46** DS trả theo SP · **47** Trả NCC · **48** DS trả NCC.

### M8. Sản xuất & gia công (7)
**49** Lập lệnh SX (chỉ phụ kiện) · **50** DS lệnh SX · **51** Khai báo định mức NVL (có phiên bản) · **52** Ghi nhận tiêu hao thực tế (từ kiểm kho) · **53** Đối chiếu định mức/thực tế · **54** Đơn gia công thuê · **55** DS gia công thuê.

### M9. Kế toán, công nợ & quỹ (11)
**56** Lập phiếu thu · **57** DS phiếu thu · **58** Lập phiếu chi · **59** DS phiếu chi · **60** Sổ quỹ tiền mặt · **61** Sổ tiền gửi NH · **62** Công nợ tổng hợp (lọc KH/nhóm; có cột số dư chiết khấu tích lũy) · **63** Chi tiết phát sinh công nợ · **64** Điều chỉnh công nợ (hàng lỗi, bẹp, móp, chiết khấu) + tab **Sổ chiết khấu tích lũy & tất toán** · **65** Gộp/chuyển công nợ · **66** Ghi nhận chi phí hoạt động.

> Sổ chiết khấu tích lũy không có dòng riêng trong file Phạm vi; đặt làm tab của mục 64 và dựa trên mục 31 ("có chiết khấu"). Cần bổ sung 1 dòng vào file Phạm vi trước khi ký (Phần 11).

### M10. Báo cáo quản trị (7)
**67** Lãi từng đơn (lãi âm bôi đỏ) · **68** Lãi lỗ toàn xưởng theo kỳ (DT − giá vốn − chiết khấu tích lũy − chi phí) · **69** Bán hàng theo KH · **70** Bán hàng theo nhóm KH · **71** Xuất kho theo đơn · **72** Báo cáo sản xuất · **73** Đối chiếu công nợ.

### M11. Số đầu kỳ & kết sổ (5)
**K1** Tồn kho đầu kỳ (+giá vốn lô) · **K2** Công nợ đầu kỳ (KH & NCC) · **K3** Số dư quỹ đầu kỳ · **K4** Tồn NVL đầu kỳ · **K5** Kết sổ cuối kỳ (checklist 4.2, chỉ giám đốc) + tra cứu kỳ cũ.

### Mẫu in (9)
**M1** Hóa đơn bán hàng · **M2** Báo giá · **M3** Phiếu giao nhận · **M4** Phiếu thu · **M5** Phiếu chi · **M6** Lệnh sản xuất · **M7** Đối chiếu công nợ · **M8** Phiếu nhập hàng · **M9** Phiếu kiểm kho.

### Chuyển dữ liệu (4) & Bảo mật – triển khai (8)
**D1–D4** theo 6.11. **T1** HTTPS (Caddy) · **T2** ẩn dữ liệu nhạy cảm ở server · **T3** sao lưu hằng đêm + bản ngoài · **T4** diễn tập khôi phục thật trước bàn giao · **T5** cài máy chủ, tên miền · **T6** đào tạo theo nhóm (kế toán, thủ kho, thủ quỹ, bán hàng, quản lý) · **T7** chạy song song phần mềm cũ 2–4 tuần · **T8** bàn giao mã nguồn, tài khoản quản trị máy chủ + phần mềm, tên miền, tài liệu vận hành.

---

## PHẦN 8 — KHỐI LƯỢNG (ngày công)

> 1 ngày công = 1 lập trình viên fullstack quen stack, gồm backend + UI + tự test. Chưa gồm QA độc lập.

### 8.1 Chi tiết theo hạng mục
| # | Hạng mục | Mã phạm vi | Ngày công | GĐ |
|---|---|---|---|---|
| 1 | Hạ tầng: Docker, VPS, CI/CD, Caddy HTTPS, tên miền | T1, T5 | 3 – 5 | 0 |
| 2 | Đăng nhập + phân quyền động + ẩn cột server-side | 1–4, T2 | 8 – 12 | 0 |
| 3 | Khung UI: layout, bảng, lọc, phân trang server, xuất Excel | — | 10 – 15 | 0 |
| 4 | Nhật ký thao tác append-only (chặn ở DB) | 5 | 3 – 4 | 0 |
| 5 | Danh mục: KH, nhóm, NCC, SP, đơn vị quy đổi, kiểu gia công, kho, xe, tuyến, thu chi, NH, cấu hình công ty, trang chủ | 6–18 | 15 – 23 | 1 |
| 6 | **Engine FIFO**: lớp lô + consumptions + khóa đồng thời + bán âm/đơn treo + hoàn lớp + tính lại chuỗi (kể cả chạy nền) + test tự động | 29 | 25 – 35 | 1 |
| 7 | Nhập hàng, DS nhập, nhập không NCC, phân bổ cước | 19–21 | 6 – 9 | 1 |
| 8 | Sổ kho, tồn hiện tại, XNT, định mức tồn, tra cứu cuộn | 22–25, 30 | 6 – 8 | 1 |
| 9 | Màn hình bán hàng (tồn, giá gần nhất, 2 kiểu chiết khấu) | 31 | 10 – 14 | 1 |
| 10 | DS đơn 2 trục + ngày giao tự dời + chi tiết đơn | 32, 33 | 6 – 9 | 1 |
| 11 | Giao nhiều lần (phiếu xuất) | 37 | 5 – 7 | 1 |
| 12 | Hủy/xóa/khôi phục đơn + tiền cọc + báo giá → đơn | 34–36 | 6 – 9 | 1 |
| 13 | Công nợ: sổ `partner_ledger`, tổng hợp, chi tiết, điều chỉnh, gộp | 62–65 | 8 – 11 | 1 |
| 14 | Trả hàng theo đơn / SP / NCC + DS | 43–48 | 6 – 9 | 1 |
| 15 | Định mức có phiên bản + tự trừ NVL khi bán (định mức tạm) | 13, 51 | 6 – 8 | 1 |
| 16 | Phiếu thu/chi, sổ quỹ TM, sổ NH, luồng thủ quỹ | 56–61 | 8 – 11 | 2 |
| 17 | Chi phí hoạt động | 66 | 3 – 4 | 2 |
| 18 | Chiết khấu tích lũy: sổ + tất toán + hậu kiểm + đảo khi hủy/trả | 31, 64 | 3 – 5 | 2 |
| 19 | Xếp chuyến, phiếu giao, DS chuyến | 38, 39 | 6 – 8 | 2 |
| 20 | Nhập kết quả giao + đối soát lái xe + hàng không giao | 40–42 | 6 – 8 | 2 |
| 21 | 9 mẫu in qua Apps Script + data contract + secret + dọn file | M1–M9 | 6 – 10 | 2 |
| 22 | Màn hình số đầu kỳ (tồn, NVL, công nợ, quỹ, chiết khấu) | K1–K4 | 5 – 8 | 2 |
| 23 | Chuyển dữ liệu 4 nhóm (phụ thuộc độ bẩn dữ liệu) | D1–D4 | 8 – 20 | 2 |
| 24 | Sao lưu tự động + bản sao ngoài | T3 | 2 – 4 | 2 |
| 25 | Chạy thử, đào tạo đợt 1, hỗ trợ chạy song song | T6, T7 | 10 – 14 | 2 |
| 26 | Lệnh SX phụ kiện + DS + tiêu hao | 49, 50 | 5 – 7 | 3 |
| 27 | Tiêu hao thực tế + đối chiếu định mức | 52, 53 | 2 – 3 | 3 |
| 28 | Gia công thuê + DS | 54, 55 | 3 – 5 | 3 |
| 29 | Kiểm kho + DS + điều chỉnh hao hụt | 26–28 | 4 – 6 | 3 |
| 30 | Báo cáo: lãi đơn, lãi lỗ kỳ, theo KH/nhóm, xuất kho theo đơn, SX, đối chiếu công nợ | 67–73 | 13 – 20 | 3 |
| 31 | Engine kết sổ + checklist điều kiện + quy tắc xuyên kỳ | K5 | 7 – 11 | 4 |
| 32 | Lưu trữ + tra cứu kỳ cũ + chọn kỳ làm việc | K5 | 5 – 8 | 4 |
| 33 | Kiểm thử toàn bộ, diễn tập khôi phục, đào tạo đợt 2, go-live | T4, T6 | 20 – 28 | 4 |
| 34 | Tài liệu vận hành + bàn giao mã nguồn & quyền quản trị | T8 | 2 – 3 | 4 |
| | **TỔNG** | | **241 – 361** | |

### 8.2 Tổng theo giai đoạn
| GĐ | Ngày công |
|---|---|
| 0 | 24 – 36 |
| 1 | 99 – 142 |
| 2 | 57 – 92 |
| 3 | 27 – 41 |
| 4 | 34 – 50 |
| **Tổng** | **241 – 361** |

### 8.3 Dự phòng (nội bộ, ghi tách riêng)
Dự án có FIFO kèm tính lại chuỗi và dữ liệu cũ chưa rõ độ bẩn → dự phòng **15%: +36 – 54 ngày công** (tổng có dự phòng 277 – 415). Có đưa dự phòng vào báo giá hay không do anh/chị quyết.

Nhân sự: engine FIFO (#6) là đường găng — bán hàng, trả hàng, BOM, sản xuất đều chờ nó. **2 người: 6–9 tháng · 3 người: 4,5–6,5 tháng** (chưa gồm dự phòng).

---

## PHẦN 9 — PHÂN GIAI ĐOẠN

| GĐ | Nội dung | Ngày công | Kết quả bàn giao |
|---|---|---|---|
| **0** | Hạ tầng + schema đầy đủ (period_id, lớp lô, consumptions, partner_ledger) + đăng nhập/phân quyền + khung UI + audit | 24 – 36 | Đăng nhập, phân quyền chạy, khung dữ liệu dùng lại được |
| **1** | Danh mục + **engine FIFO + test** + nhập hàng + kho + bán hàng + đơn 2 trục + hủy/khôi phục + cọc + báo giá + công nợ + **trả hàng** + **tự trừ NVL theo định mức tạm** | 99 – 142 | Bán, nhập, trả, tồn, công nợ đúng; giá vốn từng đơn đúng kể cả tôn xốp |
| **2** | Thu/chi + quỹ + thủ quỹ + giao hàng & đối soát + chiết khấu tích lũy + 9 mẫu in + **số đầu kỳ + chuyển dữ liệu D1–D4** + sao lưu + chạy thử | 57 – 92 | Có đủ số đầu kỳ thật → **chạy song song 2–4 tuần (T7)** |
| **3** | Lệnh SX phụ kiện + tiêu hao thực tế + đối chiếu định mức + gia công thuê + kiểm kho + báo cáo | 27 – 41 | Kiểm soát sản xuất, biết lãi thật (làm trong lúc chạy song song) |
| **4** | Engine kết sổ + lưu trữ + kiểm thử toàn bộ + diễn tập khôi phục + đào tạo + bàn giao | 34 – 50 | Go-live chính thức, bàn giao T8 |

**Thứ tự bắt buộc trong GĐ1:** engine FIFO + bộ test 3.7 TRƯỚC, rồi mới nhập/bán. Sổ kho tách khỏi đơn ngay từ đầu.
**Điều kiện vào chạy song song (cuối GĐ2):** đã nhập đủ số đầu kỳ từ D1–D4, đã có trả hàng và tự trừ NVL, sao lưu hằng đêm đang chạy.

---

## PHẦN 10 — RỦI RO & KIỂM SOÁT

| Rủi ro | Mức | Kiểm soát |
|---|---|---|
| Engine FIFO sai → mọi báo cáo lãi sai | Rất cao | Test tự động trước; làm sớm GĐ1; review đủ case 3.7 |
| Sửa đơn cũ → tính lại chuỗi dài, chậm | Cao | Tính lại theo từng mã; chạy nền khi vượt ngưỡng; khuyến nghị kết sổ hằng tháng |
| Ghi đồng thời cùng mã | Cao | Advisory lock theo product_id, khóa theo thứ tự (3.0); test đồng thời |
| Kết sổ sai → lệch cả kỳ | Cao | Checklist 4.2; transaction toàn phần; diễn tập trên bản sao |
| Hiệu năng chậm (pain point khách) | Cao | Index đúng; phân trang server; không lưu số dư chạy; cam kết ≤ 3s |
| Dữ liệu cũ bẩn | Cao | Xin file export sớm; lọc mã trùng cho khách duyệt; trần công chuyển dữ liệu |
| Định mức tôn xốp chưa có số chuẩn | TB | Định mức tạm có phiên bản + đối chiếu thực tế |
| In phụ thuộc Google/internet | TB | Rủi ro đã chấp nhận (5.5); timeout 12s + báo lỗi rõ + in lại |

---

## PHẦN 11 — CÒN CHỜ KHÁCH (dùng mặc định, đánh dấu TODO)

1. Bảng định mức thật từng loại tôn xốp (giấy bạc theo m/m²; POLY/ISO kg/md theo độ dày & mùa).
2. Cước vận chuyển có cộng vào giá vốn lô nhập không? *(mặc định: CÓ, phân bổ theo giá trị)*
3. Hàng trả lỗi: nhập chung hay tách mã "hàng lỗi"? *(mặc định: nhập chung)*
4. Kết sổ + FIFO: giữ nguyên từng lô hay gộp 1 lô bình quân? *(mặc định: giữ nguyên lô)*
5. Bản in thật 9 mẫu; file export từ Niềm Tin (đánh giá chuyển dữ liệu); giá vốn tồn kho tại ngày chuyển (D4).
6. Số người dùng cụ thể từng vị trí (kế toán, thủ kho, thủ quỹ, bán hàng).
7. **Bổ sung 1 dòng "Chiết khấu tích lũy trả sau" vào file Phạm vi** trước khi ký (hiện chỉ dựa vào mục 31 và 64).
8. Gửi lại khách câu trả lời cho 2 mục "Chưa rõ": mục 40 (nhập cả tiền mặt và CK — 6.2) và D3 (có chuyển công nợ NCC — 6.11).
9. Thêm dòng "dữ liệu in xử lý qua Google theo thỏa thuận" vào tài liệu bảo mật gửi khách.

---

## PHẦN 12 — NGOÀI PHẠM VI

**Quy tắc chung:** chức năng nào không có mã trong Phần 7 thì không làm; phát sinh thì ký phụ lục.

Đã ghi rõ trong file Phạm vi (X1–X11): hóa đơn đỏ/VAT (xuất riêng bên MISA) · app điện thoại cho lái xe · chuyển kho/nhiều chi nhánh · xuất nhập thẳng · trả hàng đích danh theo cuộn · tồn kho & giá vốn theo cuộn vật lý · duyệt yêu cầu khi sửa/xóa (trừ đơn đã kết sổ thì khóa) · nối tự động ngân hàng · Zalo/SMS · chấm công/tính lương (chỉ ghi lương là khoản chi) · sổ sách kế toán theo chuẩn.

Không có trong file Phạm vi nên không làm: in dự phòng khi Google lỗi/mất mạng · in hàng loạt · chuyển lịch sử giao dịch từ phần mềm cũ · cung cấp máy chủ/tên miền/máy tính (T5 chỉ là cài đặt).

---

## PHẦN 13 — DEFINITION OF DONE (mỗi màn hình)

- Truy được về một mã phạm vi ở Phần 7.
- Chạy đúng nghiệp vụ trên **dữ liệu thật** của khách.
- Phân quyền áp đúng — dữ liệu nhạy cảm ẩn ở **tầng server**, kể cả phạm vi "khách của mình".
- Validate đầu vào bằng zod, báo lỗi rõ ràng tiếng Việt.
- Tải **≤ 3 giây** với dữ liệu một kỳ (không tính thời gian Google tạo PDF).
- Thao tác ghi tiền/kho có **transaction + audit log**.
- Mọi giao dịch gắn đúng `period_id`; chứng từ kỳ đã kết sổ bị chặn sửa/hủy.
- Giao diện cho máy tính; xuất Excel nơi cần.

---

## PHỤ LỤC — THAY ĐỔI SO VỚI BẢN 24/09 (bản 1)

- Chỉ giữ nội dung đặc tả; bỏ các nội dung thảo luận chốt phạm vi không cần cho việc build.
- Gắn mã phạm vi cho từng màn hình và từng dòng khối lượng; bỏ mọi thứ không có trong file Phạm vi (in dự phòng Playwright, in hàng loạt).
- Trả lời 2 mục "Chưa rõ" của khách: mục 40, D3.
- Bỏ câu hỏi "Kiểm kho/Báo giá/Bán theo nhóm có cần không" — khách đã Đồng ý.
- Sửa gia công thuê: không trừ tôn cuộn của khách (đúng quyết định đã chốt).
- Làm rõ mục 21 (nhập không NCC) khác K1; mục 30 (tra cứu cuộn) chỉ là tra dòng nhập.
- Thêm: khôi phục đơn đã hủy (34), báo giá → đơn (35), tiền cọc (36), cấu hình nội dung mẫu in (M1–M9), bàn giao T8.
- Schema: thêm `cost_consumptions`, `partner_ledger` (thay `debts`), `opening_discount`, `is_provisional`, `discount_now`, `owner_user_id`, `print_files`, bảng báo giá/kiểm kho/gia công thuê/điều chỉnh kho/đối soát chuyến; bỏ cột số dư chạy; audit chặn ở DB.
- Engine: khóa đồng thời, trả theo SP không có đơn, trả NCC, tính lại chuỗi có ngưỡng chạy nền, cước phân bổ theo giá trị.
- Kết sổ: checklist điều kiện + quy tắc xuyên kỳ.
- In: secret trong body, timeout 12s, bỏ cam kết in khi mất mạng.
- Khối lượng: engine FIFO 25–35; tổng 241–361; phân giai đoạn lại để có số đầu kỳ, chuyển dữ liệu, trả hàng, tự trừ NVL trước khi chạy song song; dự phòng tách riêng.

---
*Hết. Mọi thay đổi phạm vi ngoài tài liệu này phải qua phiếu yêu cầu thay đổi và cập nhật lại Master Spec.*
