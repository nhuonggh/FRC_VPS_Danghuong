# GĐ2 — Tiền, quỹ hậu kiểm, chiết khấu tích lũy, chuyến giao, in, số đầu kỳ, chuyển dữ liệu, sao lưu (Plan 05)

> **Executor:** subagent-driven hoặc tuần tự (mỗi task: implement → tự review → test → smoke trình duyệt). Không chạy hai Vitest cùng lúc; DB test cổng 5434. UI theo skill `crm-erp-design-system`. Mọi migration chạm DB thật ⇒ **merge `main` chỉ khi user duyệt**.
>
> Đọc trước: master plan (Global Constraints, D-1…D-30), `docs/superpowers/plans/2026-09-27-05-gd2-cash-review-requirements.md` (yêu cầu quỹ hậu kiểm đã duyệt), `docs/engine-fifo.md` §0, §2, §3, §4, §8; spec `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md` mục 2.7, 4.1, 5, 6.2, 6.3, 6.10–6.11, M6, M9, Mẫu in; `docs/infra/DATA-REQUEST.md`.

**Điều kiện vào:** plan 04 đã vào `main` và deploy xanh (**đã đạt 30/09/2026**, run 43). Plan này dựa vào: `postPartnerLedger` (cửa duy nhất ghi `partner_ledger`), bảng `receipts` (đang chỉ dùng loại `COC`), `discount_ledger` (đã có `settleMethod`, `isReconciled`), `delivery_notes` (công nợ ghi khi giao), `opening_*` (bảng đã có, chưa có màn), `goods_returns`.

**Mục tiêu:** đủ công cụ để **chạy song song** với phần mềm cũ: thu/chi và quỹ tiền mặt chung có hậu kiểm của thủ quỹ, chiết khấu tích lũy tất toán được, xếp chuyến → nhập kết quả giao → đối soát lái xe, 9 mẫu in, nhập số đầu kỳ, chuyển dữ liệu D1–D4, sao lưu hằng đêm, chạy thử và đào tạo.

**Ngoài phạm vi (plan 06/07):** lệnh sản xuất phụ kiện, tiêu hao thực tế, gia công thuê, kiểm kho, báo cáo 67–73 (plan 06); kết sổ cuối kỳ và tra cứu kỳ cũ (plan 07).

## Global Constraints

Kế thừa master + D-11…D-30. Bổ sung:

- **D-31 (mọi dòng tiền qua cửa duy nhất):** ghi `cash_ledger` chỉ qua `src/server/cash/ledger.ts` (`postCashLedger`, `removeCashLedger`), đúng mô hình `postPartnerLedger` của plan 04; test kiến trúc quét `src/` cấm `cashLedger.create/update/delete` ở nơi khác. Số dư quỹ = đầu kỳ + Σ(vào − ra) **tính khi đọc**, không cột số dư chạy.
- **D-32 (phiếu thu/chi = một chứng từ, một transaction):** tạo/sửa/hủy phiếu ghi cùng lúc: `receipts`/`payments`, `cash_ledger`, `partner_ledger` (nếu có đối tác), `audit_log`, trạng thái hậu kiểm. Lệnh tạo có `Idempotency-Key`. Phiếu thu hiện có (loại `COC` từ plan 04) được **backfill** `cash_ledger` bằng migration data một lần (an toàn chạy lại).
- **D-33 (hậu kiểm không chặn nghiệp vụ):** trạng thái `PENDING_REVIEW → REVIEWED | RETURNED`; sổ quỹ và công nợ **ghi ngay**; màn hiển thị 3 số: vận hành (gồm chờ kiểm), đã kiểm tra, chờ kiểm tra. Phiếu `REVIEWED` khoá sửa/xoá trực tiếp; thay đổi = phiếu điều chỉnh có lý do, liên kết chứng từ gốc, sinh dòng sổ đảo/điều chỉnh (không sửa dòng đã kiểm).
- **D-34 (quyền tách theo yêu cầu đã duyệt):** thêm `cash.transaction.create`, `cash.transaction.edit_pending`, `cash.review`, `cash.adjust.request`, `cash.adjust.approve`, `cash.close`, `cash.close.reopen`. `receipt.manage`/`payment.manage` cũ **giữ và ánh xạ tương thích** (người đang có quyền cũ nhận các quyền mới tương ứng qua migration cấp một lần, chỉ THÊM). Kế toán không có `cash.review`; Thủ quỹ có.
- **D-35 (tiền của chuyến là quỹ tạm):** tiền lái xe thu chưa vào quỹ chính cho tới khi thủ quỹ xác nhận nhận (spec 6.2). `trip_orders` ghi tiền mặt/CK/ghi nợ từng đơn; khi **đối soát khớp** mới sinh phiếu thu vào quỹ (`PENDING_REVIEW` theo D-33), CK vào tài khoản ngân hàng (đối chiếu tay với sao kê).
- **D-36 (giao qua chuyến không xuất kho lần hai):** đơn đã xuất kho lúc tạo (D-25). Nhập kết quả giao tạo `delivery_notes` cho phần thực giao (công nợ ghi khi giao — D-26). Phần **không giao được** vẫn nằm ở đơn (chờ giao lại/hủy/trả); không tự nhập lại kho. Nếu người bán quyết định trả về kho ⇒ dùng đúng luồng **trả theo đơn** (plan 04 C6) để giá vốn nhập lại khớp dòng bán gốc.
- **D-37 (chiết khấu tích lũy):** tất toán `CASH` = phiếu chi `TAT_TOAN_CK` + `discount_ledger.amountOut`; `OFFSET` = trừ vào công nợ (`partner_ledger` credit) + `amountOut`; cờ `is_reconciled` do giám đốc/kế toán trưởng hậu kiểm. Số dư âm (đã tất toán rồi hủy/trả) ⇒ cảnh báo, xử lý bằng điều chỉnh công nợ (plan 04 C7).
- **D-38 (in qua Apps Script, secret trong body):** webhook URL + secret theo từng mẫu (secret mã hoá, chỉ hiện `hasSecret`), data contract JSON chuẩn hoá và versioned, timeout 12 s, UI không khóa màn hình, `print_files` UNIQUE(doc_type, doc_id) — in lại xoá file cũ. Không log/audit/export secret hay dữ liệu in đầy đủ. Không có phương án in dự phòng (rủi ro đã chấp nhận, spec 5.5).
- **D-39 (số đầu kỳ đi qua engine):** K1/K4 tạo lớp `OPENING` bằng `postReceipt` trong `withInventoryTx` (mỗi mã một lô, giá vốn nhập tay); K2/K3/chiết khấu ghi `opening_debt`/`opening_cash`/`opening_discount`. Chỉ nhập được khi kỳ mở **chưa có** chứng từ (hoặc có cờ "khởi tạo" do giám đốc) và có xác nhận 2 bước; sửa sau đó = phiếu điều chỉnh, không sửa lặng lẽ.
- **D-40 (chuyển dữ liệu là dry-run trước):** mọi import D1–D4 có bước xem trước (số dòng hợp lệ / lỗi / mã trùng), tải file lỗi, rồi mới ghi; chạy lại idempotent (khoá theo mã); mã trùng/ngừng bán lọc ra file riêng để khách xác nhận (spec 6.11).

## Quyết định mặc định (user cho dùng khuyến nghị — vẫn báo lại khách, xem `docs/infra/DATA-REQUEST.md` mục E)

| # | Câu hỏi | Mặc định | Lý do |
|---|---|---|---|
| 1 | `RETURNED`: sửa phiếu gốc hay lập phiên bản mới | **Sửa phiếu gốc rồi gửi lại**, giữ lịch sử trả lại/gửi lại | Ít thao tác cho kế toán; dấu vết nằm ở `cash_review_events` |
| 2 | Chốt quỹ theo | **Thủ quỹ tự chọn mốc** (mặc định gợi ý cuối ngày) | Xưởng chưa có ca cố định |
| 3 | Chốt có chênh lệch | **Cho chốt kèm lý do bắt buộc**, chênh lệch lưu để truy | Không chặn công việc; vẫn truy được |
| 4 | Sau `REVIEWED` | **Chỉ phiếu điều chỉnh** (yêu cầu → thủ quỹ duyệt) | Đúng yêu cầu "không xoá dấu vết" |
| 5 | Nhập kết quả giao | **Nhập cả tiền mặt lẫn CK** (mục 40) | Đã chốt trong spec 6.2 |
| 6 | Cước vận chuyển vào giá vốn | Đã làm ở plan 03 (phân bổ theo giá trị) | — |
| 7 | Backup | `pg_dump` hằng đêm giữ 14 ngày + bản ngoài máy chủ (rclone/scp), khôi phục thử ra DB tạm | Nhắc lại trước go-live (STATUS mục 5 #1) |

## Review Focus

1. Ghi tiền + công nợ + trạng thái + audit cùng transaction; `Idempotency-Key` chống bấm đúp; thủ quỹ hai người bấm "kiểm tra" đồng thời chỉ một thắng. → D1
2. Số dư quỹ = đầu kỳ + phát sinh, khớp tổng theo từng tài khoản; ba chỉ số vận hành/đã kiểm/chờ kiểm cộng đúng; phiếu `REVIEWED` không sửa được, điều chỉnh sinh dòng đảo. → D1
3. Không đường nào ghi `cash_ledger`/`partner_ledger` ngoài cửa duy nhất; hủy chứng từ đảo về 0. → D1–D5
4. Hủy đơn/trả hàng có chiết khấu tích lũy: đảo đúng tỷ lệ; đã tất toán ⇒ số dư âm + cảnh báo. → D3
5. Chuyến: chênh lệch ≠ 0 bắt buộc lý do; chỉ khi khớp mới chuyển thủ quỹ; tiền chuyến không vào quỹ trước khi xác nhận. → D4/D5
6. In: secret không lộ (DTO, log, audit, export, lỗi); timeout 12 s; in lại xoá file cũ. → D6
7. Số đầu kỳ: tồn = Σ lớp `OPENING`; engine ≡ oracle sau nhập; sai kỳ/đã có chứng từ bị chặn. → D7
8. Chuyển dữ liệu: dry-run không ghi; chạy lại không nhân đôi; lỗi báo theo dòng. → D8
9. Không lộ giá vốn/lãi/giá nhập/tiền quỹ cho người thiếu quyền; phạm vi "khách của mình". → mọi task

## Cấu trúc file

| Tạo mới | Trách nhiệm |
|---|---|
| `prisma/schema/cash.prisma` + migrations `cash_vouchers` (D1), `trips` (D4), `print` (D6) | `Payment`, mở rộng `Receipt` (`reviewStatus`, `tripId`, `voucherNo`), `CashReviewEvent`, `CashClose`, `CashAdjustment`, `OperatingExpense`, `Trip`, `TripOrder`, `TripSettlement`, `PrintTemplate`, `PrintFile`; CHECK số liệu/trạng thái |
| `src/server/cash/{ledger,vouchers,review,close,queries,schemas}.ts` | cửa ghi quỹ, phiếu thu/chi, hậu kiểm, chốt quỹ, sổ quỹ/sổ NH |
| `src/server/discount/{settle,reconcile,queries}.ts` | tất toán/hậu kiểm chiết khấu tích lũy |
| `src/server/trips/{service,results,settlement,queries}.ts` | xếp chuyến, nhập kết quả, đối soát, hàng không giao được |
| `src/server/print/{contract,webhook,service}.ts`, `src/server/print/contracts/*.ts` | 9 data contract + gọi Apps Script |
| `src/server/opening/{stock,debt,cash,discount}.ts` | số đầu kỳ (K1–K4 + chiết khấu) |
| `src/server/migration/{parse,dryrun,commit}.ts`, `scripts/backup.sh`, `scripts/restore-drill.sh` | chuyển dữ liệu, sao lưu |
| `src/app/api/{cash,payments,receipts,trips,discount,print,opening,migration}/**`, `src/app/(app)/{accounting,delivery,period}/**`, `src/components/{cash,trips,print,opening}/**` | route mỏng + màn hình |
| `tests/{cash,discount,trips,print,opening,migration}/**` | DB/service/API/UI/đồng thời/hiệu năng |

| Sửa | Ghi chú |
|---|---|
| `src/server/debt/ledger.ts` | mở rộng `LedgerDocType` (`PAYMENT`, `TRIP`…) |
| `src/server/deposits/service.ts` | phiếu cọc ghi `cash_ledger` qua cửa mới + trạng thái hậu kiểm |
| `src/lib/permissions/catalog.ts`, `prisma/migrations/*grant*` | quyền `cash.*` (D-34), `SENSITIVE_FIELDS` cho số quỹ |
| `src/config/app.config.ts` | bỏ `planned` từng màn khi task xong |
| `docs/{STATUS.md,infra/RUNBOOK.md}`, master plan | cập nhật khi đóng 05 |

---

### Task D1 — Phiếu thu/chi, quỹ chung hậu kiểm, sổ quỹ, chốt quỹ (mã 56–61)
- [x] Schema + migration `cash_vouchers`: `payments`, mở rộng `receipts` (loại `THU_NO|COC|KHAC`, `reviewStatus`), `cash_review_events` (mọi lần gửi/kiểm/trả lại: ai, khi nào, lý do), `cash_adjustments`, `cash_closes`; CHECK (`amount > 0`, trạng thái hợp lệ). Backfill `cash_ledger` cho các phiếu cọc đã có.
- [x] `postCashLedger` / `removeCashLedger` (D-31) + test kiến trúc; `receipts`/`payments` qua `withIdempotency` + `postPartnerLedger` (thu: khách credit; chi trả NCC: NCC debit; chi phí/khác: không đối tác).
- [x] Lập/sửa (khi `PENDING_REVIEW`/`RETURNED`)/hủy phiếu thu (56,57) và phiếu chi (58,59): số phiếu `PT`/`PC`, đối tác tuỳ chọn, gắn đơn (thu nợ theo đơn), quỹ/tài khoản, ngày, ghi chú.
- [x] Hậu kiểm: `review` / `return` (lý do bắt buộc) có khoá đồng thời (`SELECT … FOR UPDATE` trên phiếu) + audit; danh sách chờ kiểm tra riêng (đơn hàng, thu, chi, cộng/trừ nợ, chiết khấu, điều chỉnh) lọc ngày/người/loại/khách/trạng thái.
- [x] Điều chỉnh sau `REVIEWED`: yêu cầu (`cash.adjust.request`) → duyệt (`cash.adjust.approve`) → dòng sổ đảo + dòng mới, liên kết phiếu gốc.
- [x] Sổ quỹ tiền mặt (60) và sổ tiền gửi NH (61): đầu kỳ + phát sinh, 3 chỉ số vận hành/đã kiểm/chờ kiểm, xuất Excel. Chốt quỹ: tiền đầu + thu − chi tại mốc, nhập tiền thực, chênh lệch + lý do, lưu snapshot (không thay `period.close`).
- [x] 🧪: số dư = đầu kỳ + phát sinh; **[R]** hai thủ quỹ kiểm cùng phiếu; **[R]** bấm 2 lần tạo phiếu; sửa phiếu `REVIEWED` bị chặn, điều chỉnh sinh dòng đảo; hủy phiếu đảo về 0 cả quỹ lẫn công nợ; thiếu quyền `cash.review` bị chặn ở server.

### Task D2 — Chi phí hoạt động (mã 66)
- [x] `operating_expenses` gắn phiếu chi loại `CHI_PHI` (D-32): loại chi phí, số tiền, ngày, ghi chú; danh sách + tổng theo loại/tháng; xuất Excel.
- [x] 🧪: mỗi khoản chi phí ↔ đúng một phiếu chi; hủy chi phí hủy phiếu; không tính vào công nợ.

### Task D3 — Chiết khấu tích lũy: sổ, tất toán, hậu kiểm (mã 31, 64)
- [x] Tab **Sổ chiết khấu tích lũy & tất toán** trong màn 64: số dư từng khách (đầu kỳ + vào − ra), chi tiết theo dòng đơn.
- [x] Tất toán `CASH` (phiếu chi `TAT_TOAN_CK`) và `OFFSET` (D-37); không tất toán quá số dư; hậu kiểm `is_reconciled` (quyền `discount.reconcile`, `discount.settle`).
- [x] Đảo khi hủy đơn/trả hàng đã có ở plan 04; bổ sung **cảnh báo số dư âm**.
- [x] 🧪: hủy đơn có chiết khấu đảo đúng tỷ lệ; đã tất toán rồi hủy ⇒ số dư âm + cảnh báo; OFFSET giảm công nợ đúng; hậu kiểm khoá sửa.

### Task D4 — Xếp chuyến, phiếu giao, danh sách chuyến (mã 38, 39)
- [x] Schema `trips`, `trip_orders`; trạng thái `PLANNED → ON_ROAD → RETURNED → SETTLED → CONFIRMED`.
- [x] Xếp chuyến: gom đơn còn hàng phải giao theo tuyến, gán xe + lái + phụ (chống trùng xe/lái cùng thời điểm), in **phiếu giao nhận (M3)**; danh sách chuyến lọc trạng thái/ngày/xe.
- [x] 🧪: một đơn nằm nhiều chuyến khi giao nhiều lần nhưng không vượt SL còn lại; huỷ chuyến trả đơn về chưa xếp.

### Task D5 — Nhập kết quả giao, đối soát lái xe, hàng không giao được (mã 40–42)
- [x] Nhập kết quả từng đơn: `GIAO_DU | GHI_NO | HEN_TRA | KHONG_GIAO | GIAO_MOT_PHAN` + tiền mặt + CK + phần ghi nợ + ngày hẹn; giao một phần nhập SL thực giao. Sinh `delivery_notes` (D-36) và công nợ; kiểm hạn mức nợ (`allow_credit`, `debtLimit`).
- [x] Đối soát (41): `phải thu − tiền mặt − CK − ghi nợ = chênh lệch`; ≠ 0 bắt buộc lý do; khớp mới chuyển thủ quỹ; thủ quỹ xác nhận ⇒ sinh phiếu thu vào quỹ (D-35).
- [x] Hàng không giao được (42): danh sách + giao cho người bán xử lý (giao lại / hủy đơn / trả về kho bằng trả theo đơn).
- [x] 🧪: tổng tiền chuyến = Σ đơn; chênh lệch bắt lý do; **gia công thuê không trừ tôn cuộn** (chỉ kiểm cấu hình, làm thật ở plan 06-E3); xác nhận hai lần idempotent.

### Task D6 — 9 mẫu in qua Apps Script (M1–M9)
- [x] `print_templates` (URL + secret mã hoá + tiêu đề/người ký/SĐT/QR/ghi chú chân phiếu, bật/tắt) — màn Công ty & mẫu in đã có, nối vào.
- [x] 9 data contract JSON (hóa đơn bán hàng, báo giá, phiếu giao nhận, phiếu thu, phiếu chi, lệnh SX, đối chiếu công nợ, phiếu nhập, phiếu kiểm kho): công ty (theo `show_company_info`), khách, dòng hàng, **chiết khấu theo dòng + tổng chiết khấu**, đã thu, còn phải trả. Contract có `version`.
- [x] Gọi webhook: secret trong body, timeout 12 s, `print_files` UNIQUE(doc_type, doc_id), in lại xoá file cũ; UI "đang tạo bản in" không khoá màn hình; nút In ở từng chứng từ (đơn, báo giá, phiếu giao, thu, chi, nhập, đối chiếu).
- [x] Tài liệu hướng dẫn tạo Apps Script + Google Doc template (`<<placeholder>>`), kèm script mẫu `docs/infra/print/apps-script.gs`.
- [x] 🧪: mock webhook — timeout, lỗi, in lại xoá file cũ, secret không xuất hiện trong log/audit/DTO/lỗi.

### Task D7 — Màn số đầu kỳ (mã K1–K4 + chiết khấu)
- [x] `/period/opening-stock` (K1), `/period/opening-materials` (K4): nhập Excel (nhập tay từng dòng: chưa làm) (mã, SL, giá vốn) ⇒ lớp `OPENING` qua engine (D-39), mỗi mã một lô; xem trước, xác nhận 2 bước.
- [x] `/period/opening-debt` (K2, cả khách lẫn NCC, dấu +/−), `/period/opening-cash` (K3, quỹ + từng TK NH), số dư chiết khấu tích lũy.
- [x] Chặn khi đã có chứng từ trong kỳ (trừ cờ khởi tạo của giám đốc); audit từng dòng.
- [x] 🧪: tồn sau nhập = Σ lớp `OPENING`; bán ngay sau nhập dùng đúng giá vốn lô; engine ≡ oracle; công nợ/quỹ đầu kỳ vào đúng số dư.

### Task D8 — Chuyển dữ liệu D1–D4
- [x] Dry-run + màn duyệt cho: khách (D1), NCC, sản phẩm (D2, mã trùng/ngừng bán ra file riêng), công nợ (D3), tồn kho (D4): báo cáo lỗi theo dòng, tải file lỗi, ghi thật chỉ khi user bấm xác nhận (D-40).
- [x] Tái dùng bộ import Excel danh mục đã có (KH/NCC/SP); thêm đọc file export mẫu của phần mềm Niềm Tin khi khách gửi (ánh xạ cột theo file thật) — **chờ khách gửi mẫu**.
- [x] 🧪: chạy lại không nhân đôi; mã trùng bị lọc; số Việt Nam `1.234,5`; 5.000 dòng ≤ 30 s.

### Task D9 — Sao lưu hằng đêm (T3)
- [x] `scripts/backup.sh` (`pg_dump -Fc`, giữ 14 ngày, bản ngoài máy chủ) + cron VPS + cảnh báo khi thất bại; `scripts/restore-drill.sh` khôi phục ra DB tạm và kiểm số dòng các bảng chính.
- [x] Tài liệu vào `docs/infra/RUNBOOK.md`. Việc trên VPS **user làm** theo hướng dẫn từng bước (không cấp SSH cho AI).

### Task D10 — Chạy thử, đào tạo đợt 1, chạy song song (T6, T7)
- [ ] Kịch bản chạy thử theo vai trò (bán hàng, kế toán, thủ kho, thủ quỹ, giám đốc); tài liệu hướng dẫn ngắn có ảnh chụp.
- [ ] **Cổng vào chạy song song:** đủ D1–D4 thật, có trả hàng + tự trừ NVL, sao lưu hằng đêm đang chạy, quyền từng vai trò đã kiểm, 9 mẫu in chạy được với Google của xưởng.
- [ ] Dữ liệu thật 1.300 SP + 1.000 đơn: danh sách/trang chính ≤ 3 s; rà chéo 04↔05; cập nhật STATUS/master/`db_schema.sql`; **merge `main` chờ user duyệt**.

## Thứ tự & phụ thuộc

`D1 → D2, D3` (cần cửa ghi quỹ) · `D4 → D5` (chuyến trước kết quả) · `D6` độc lập, làm sau D1/D4 để có chứng từ để in · `D7 → D8` (D8 ghi vào bảng của D7) · `D9` độc lập (nên xong trước khi nhập dữ liệu thật) · `D10` cuối. Khuyến nghị: **D7+D8 làm sớm** để khách nhập dữ liệu thật càng sớm càng tốt, rồi D1 → D3 → D4/D5 → D6.

## Definition of Done 05

- Mã 40–42, 56–61, 66, M1–M9, K1–K4, D1–D4, T3, T6, T7 truy được; route guard và quyền áp server-side.
- Sổ quỹ/công nợ: số dư tính khi đọc, cân, đảo được; không đường ghi ngoài cửa duy nhất; hậu kiểm không chặn bán hàng.
- In: secret không rò; timeout/lỗi rõ ràng; in lại dọn file.
- Số đầu kỳ đi qua engine; chuyển dữ liệu dry-run + idempotent.
- Sao lưu chạy và khôi phục thử thành công.
- List/detail theo route riêng, deep link, search/filter/export, token/a11y/dark-light, ≤ 3 s.
- Lint, typecheck, test, build xanh; rà chéo 04↔05 có ledger reviewer.
