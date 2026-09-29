# GĐ1c — Bán hàng, giao nhiều lần, sửa/hủy/khôi phục, báo giá/cọc, trả hàng, công nợ (Plan 04)

> **Executor:** subagent-driven (mỗi task một implementer + reviewer độc lập, ledger `.superpowers/sdd/04/progress.md`). Không chạy hai Vitest cùng lúc; DB test cổng 5434. Mọi phần UI theo skill `crm-design`.
>
> Đọc trước: master plan (Global Constraints, D-1…D-22), `docs/engine-fifo.md` **§0, §2 (chủ dòng fail-closed), §3 (at+seq), §4 (giá vốn phụ thuộc chéo), §8 (giả định khách)**, spec `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md` mục 2.5, 2.7, 3.2–3.7, 6.1–6.3, 6.7–6.9, M5/M7. Plan này chạy **sau khi 03a/03b/03c đã merge `main`** (cần `resolveBom`, sản phẩm/quy đổi, khách hàng, kho, `withIdempotentInventoryTx`).

**Mục tiêu:** đưa vào sử dụng thật luồng bán hàng: lập đơn xuất kho FIFO (đơn treo khi thiếu tồn), theo dõi hai trục trạng thái, giao nhiều lần, sửa/hủy/khôi phục đúng chuỗi giá vốn, báo giá và cọc, trả hàng (theo đơn / theo SP / trả NCC) và **sổ công nợ duy nhất** `partner_ledger`.

**Ngoài phạm vi (plan 05+):** phiếu thu/chi và sổ quỹ, chuyến giao và đối soát lái xe, tất toán chiết khấu tích lũy (chỉ GHI `discount_ledger` phần phát sinh/đảo), mẫu in, lệnh sản xuất phụ kiện, gia công thuê (54/55), kết sổ.

## Global Constraints

Kế thừa master + D-11…D-22. Bổ sung:

- **D-23 (bán qua engine, chủ dòng bắt buộc):** trước khi ghi `SALE` đầu tiên phải có `src/server/sales/cost-owner.ts` (`UPDATE sale_order_lines SET unit_cost_fifo = unitCostOf(snap.totalCost, qty), is_provisional = snap.qtyProvisional > 0`) và thêm `["SALE", saleLineCostOwner]` vào `COST_OWNER_REGISTRATIONS` (`owners-register.ts`). Test `tests/inventory/owners.test.ts` phải cập nhật có chủ ý. Không gọi `registerCostOwner` ở chỗ khác.
- **D-24 (`docLineId` = id dòng bán, `at`+`seq` lưu cùng dòng):** mỗi `sale_order_lines` có `at`, `seq` (BigInt?). Dòng có BOM: mỗi NVL một `postIssue` cùng `docLineId`, seq riêng theo mã (bảng phụ `sale_line_issues(orderLineId, productId, seq)` hoặc cột JSON có kiểm tra — chốt ở Task C1, không lưu một seq cho nhiều mã). Sửa = `removeDocument` + ghi lại trong CÙNG `withInventoryTx`; khôi phục = ghi lại với `at` + `seq` đã lưu.
- **D-25 (xuất kho lúc tạo/xác nhận đơn — D-4):** tạo đơn (không phải nháp) xuất kho ngay theo FIFO tại `docTimestamp(orderDate)`. Đơn nháp/báo giá không đụng kho. Phiếu giao (C3) chỉ ghi nhận số lượng đã giao, **không** xuất kho lần hai.
- **D-26 (công nợ ghi khi GIAO, không khi tạo đơn — TODO xác nhận khách):** `partner_ledger` ghi `debit` = giá trị hàng đã giao (theo dòng phiếu giao, sau `discount_now`, trừ cọc). Hủy phiếu giao/đơn ghi dòng đảo (credit) cùng `docType`. Số dư **luôn tính khi đọc** (Σ debit − Σ credit + đầu kỳ), không lưu cột số dư (spec 1.3, test DMMF).
- **D-27 (chiết khấu):** `discount_now` giảm tiền phải thu; `discount_accum` KHÔNG giảm tiền phải thu, ghi `discount_ledger.amountIn` theo dòng. Lãi dòng = (giá bán − `unit_cost_fifo`) × SL − `discount_now` − `discount_accum`; dòng treo (`is_provisional`) **không tính lãi** (hiển thị "chưa đủ tồn"). Hủy/trả đảo `amountOut` theo tỷ lệ SL; phần đã tất toán → số dư âm + cảnh báo (tất toán thật ở plan 05-D3).
- **D-28 (quyền dữ liệu nhạy cảm):** thêm `salePrice`, `discountNow`, `discountAccum`, `lineProfit`… vào `SENSITIVE_FIELDS` (`sale_price.view` / `profit.view` / `cost.view`); DTO đi qua `redactDeep`; export và audit cũng redaction. Người bán chỉ thấy khách `owner_user_id` của mình (phạm vi ở tầng query).
- **D-29 (không sửa/hủy khi dính tiền hoặc kỳ khoá):** hủy đơn bị chặn nếu có phiếu thu/cọc chưa xử lý hoặc còn công nợ (34b); kỳ đã đóng khoá cứng (`PeriodClosedError`); xoá hẳn chỉ cho đơn chưa phát sinh (34c) — FK `RESTRICT` là lớp chặn thứ hai.
- **D-30 (trả hàng không vượt bán):** module tự kiểm Σ SL trả ≤ SL bán gốc (engine không kiểm — `engine-fifo.md` §3); tự khoá hàng dòng bán gốc khi trả/sửa để tuần tự hoá.

## Review Focus

1. Bán nhiều dòng cùng mã, hai người bán cùng mã đồng thời, bán âm rồi nhập bù: giá vốn/`is_provisional` trên dòng bán khớp oracle; bấm hai lần chỉ tạo một đơn (Idempotency-Key). → C1
2. Tôn xốp: giá dòng = tổng vốn NVL theo BOM **đúng phiên bản theo `orderDate`**; sửa BOM sau đó không đổi đơn cũ. → C1/C8
3. Sửa/hủy/khôi phục giữa chuỗi: mọi đơn phía sau đổi giá vốn đúng, `seq` giữ vị trí, đơn có trả hàng ⇒ gỡ lớp phụ thuộc trước (`DependentDocumentsError` được xử lý thành thông báo tiếng Việt). → C4
4. Hai trục trạng thái độc lập; ngày giao tự dời tính theo ICT, `original_delivery_date` giữ nguyên. → C2
5. Công nợ: số dư = đầu kỳ + phát sinh; mọi chứng từ đảo được; gộp/chuyển nợ cân (Σ = 0). → C7
6. Thiếu `cost.view`/`profit.view`/`sale_price.view` ⇒ DTO, export, audit, lỗi, log đều không lộ giá vốn/lãi. → mọi task
7. Không chạm kỳ đã đóng; không N+1 (danh sách 1.000 đơn ≤ 3 s). → C2, C7

## Cấu trúc file

| Tạo mới | Trách nhiệm |
|---|---|
| `prisma/schema/sales.prisma` + migration `sales_returns` | `SaleOrder/SaleOrderLine/SaleLineIssue`, `DeliveryNote/DeliveryLine`, `Quote/QuoteLine`, `Receipt`(chỉ loại `COC` cho 04), `Return/ReturnLine`, `DebtAdjustment`, `DebtTransfer`; enum trạng thái; FK bổ sung cho `discount_ledger.orderLineId`; CHECK |
| `src/server/sales/{schemas,codes,service,queries,cost-owner,status,pricing}.ts` | tạo/sửa/hủy/khôi phục/xoá đơn; trạng thái; giá gần nhất |
| `src/server/delivery/*`, `src/server/quotes/*`, `src/server/deposits/*` | phiếu giao, báo giá, cọc |
| `src/server/returns/{service,queries,cost}.ts` | trả theo đơn / SP / NCC, `resolveReturnCostByProduct` |
| `src/server/debt/{ledger,queries,service}.ts` | `postPartnerLedger`, `partnerBalance`, điều chỉnh, gộp/chuyển |
| `src/server/jobs/advance-delivery-dates.ts` | job đầu ngày dời ngày giao |
| `src/app/api/{orders,delivery-notes,quotes,deposits,returns,debt}/**`, `src/app/(app)/{sales,returns,accounting}/**`, `src/components/{sales,returns,debt}/**` | route mỏng + màn hình |
| `tests/{sales,delivery,quotes,returns,debt}/**` | DB/service/API/UI/hiệu năng/đồng thời |

| Sửa | Ghi chú |
|---|---|
| `src/server/inventory/owners-register.ts`, `tests/inventory/owners.test.ts` | đăng ký chủ dòng SALE (D-23) |
| `src/lib/permissions/catalog.ts` | bổ sung `SENSITIVE_FIELDS` (D-28); các mã `order.*`, `quote.manage`, `deposit.manage`, `return.manage`, `debt.*` **đã có** |
| `src/config/app.config.ts` | bỏ `planned` của từng màn khi task giao xong |
| `docs/{STATUS.md,db_schema.sql}`, master plan | cập nhật khi đóng 04 |

---

### Task C1 — Schema bán hàng + màn hình bán hàng (mã 31)

**Đầu ra:** migration `sales_returns`; `createSaleOrder`; màn `/sales/orders/new`.

- [ ] **Test DB đỏ trước:** unique `code`; CHECK `qty > 0`, `price >= 0`, `discount_now/accum >= 0`, `discount_now + discount_accum <= qty × price`; FK RESTRICT; `discount_ledger.orderLineId` FK; DMMF invariants (`periodId/createdBy/createdAt` cho `SaleOrder`, `Return`, `DeliveryNote`, `Quote`, `Receipt`, `DebtAdjustment`, `DebtTransfer`; thêm tên vào `TRANSACTIONAL_MODELS`).
- [ ] Model: enum `DeliveryStatus` (NEW, WAITING_STOCK, READY, LOADED, DELIVERING, DELIVERED, PARTIAL, FAILED), `PaymentStatus` (UNPAID, DEPOSITED, PARTIAL, PAID, DEBT, PROMISED, OVERPAID) — hai trục độc lập (spec 6.1); `SaleOrderLine` có `at`, `seq`, `qtyBase`, `unitCostFifo`, `isProvisional`, `processingTypeId`, `bomVersionId` (snapshot — D-20 03c). Chốt cách lưu `seq` nhiều NVL (D-24).
- [ ] **Chủ dòng SALE** (D-23) + cập nhật test owners.
- [ ] `createSaleOrder(actor, input, key)` = `withIdempotentInventoryTx`: khoá dòng, lập mã `DH…`, quy đổi đơn vị (`convertToBase`), dòng có `processingTypeId` → `resolveBom(product, processingType, orderDate)` rồi `postIssue` từng NVL; ghi `at`/`seq`/`bomVersionId`; ghi `discount_ledger` phần `discount_accum`; audit (không giá vốn); ánh xạ `EngineBusyError`, `ProductRecomputingError`, `PeriodClosedError`.
- [ ] Truy vấn giá: tồn hiện tại, **giá bán gần nhất của khách này** và **của bất kỳ khách**, giá nhập gần nhất (chỉ khi `purchase_price.view`) — một truy vấn cho cả trang, không N+1.
- [ ] Quyền `order.edit_price` (xem bảng quyết định #4): catalog + seed vai trò + kiểm ở service.
- [ ] UI `/sales/orders/new`: form nhiều dòng (combobox SP, đơn vị, SL, giá sửa tay, chiết khấu trừ ngay + tích lũy theo dòng, kiểu gia công), cột tồn/giá gợi ý ẩn theo quyền, cảnh báo "sẽ thành đơn treo" khi thiếu tồn, giữ dữ liệu khi 409/lỗi, phím tắt.
- [ ] 🧪 (spec 3.7): tạo đơn nhiều dòng cùng mã; bán xuyên nhiều lớp (case 3.2 → 20.444,44); bán âm → `isProvisional` rồi nhập bù ở phiếu nhập (test cross-module); hai người bán cùng mã đồng thời; bấm hai lần; tôn xốp cộng vốn NVL đúng phiên bản BOM; thiếu quyền giá không thấy giá vốn/lãi ở DTO.

### Task C2 — Danh sách đơn (2 trục), ngày giao tự dời, chi tiết đơn, DS đơn chưa đủ tồn (mã 32, 33, 29)

- [ ] `advanceExpectedDeliveryDates(now)`: đơn chưa giao xong và `expected < hôm nay (ICT)` → `expected = hôm nay`, giữ `original_delivery_date`; idempotent (chạy hai lần cùng ngày không đổi); kích hoạt bằng job đầu ngày (worker hiện có hoặc route cron có secret) — **quyết định cơ chế ở đầu task**, test với ranh giới 23:59/00:00 ICT.
- [ ] Danh sách: lọc theo hai trục, khách, khoảng ngày (`QuickTimeFilter`), tìm không dấu, phạm vi "khách của mình", phân trang server, export Excel; số ngày trễ = `hôm nay − original_delivery_date`.
- [ ] Chi tiết đơn full-page (tab Thông tin / Dòng hàng / Giao hàng / Lịch sử): lịch sử dựng từ `audit_log` (đã redaction); dòng hiện giá vốn/lãi chỉ khi có quyền, dòng treo ghi "chưa đủ tồn".
- [ ] "Đơn chưa đủ tồn" (29): dòng `is_provisional`, sắp theo thời gian, liên kết tới phiếu nhập/tồn.
- [ ] 🧪: đơn trễ đúng số ngày (ICT); danh sách 1.000 đơn ≤ 3 s; người bán chỉ thấy đơn của khách mình.

### Task C3 — Phiếu xuất/giao nhiều lần (mã 37)

- [ ] `createDeliveryNote(order, lines)`: ghi số lượng giao theo dòng (≤ SL còn lại), cập nhật trục giao hàng (PARTIAL/DELIVERED), **ghi `partner_ledger` debit theo D-26** (giá trị dòng giao sau `discount_now`, trừ cọc đã gắn đơn); không xuất kho lần hai (D-25).
- [ ] Hủy phiếu giao đảo công nợ; không hủy khi dòng đã được trả hàng.
- [ ] UI `/sales/delivery-notes` (+ tạo từ chi tiết đơn), in dùng chung sau (plan 05).
- [ ] 🧪: giao 2 lần đủ SL; giao vượt bị chặn; công nợ đúng từng lần; hủy phiếu đảo đúng.

### Task C4 — Sửa đơn, hủy, khôi phục, xoá hẳn (mã 34, 34a, 34b, 34c)

- [ ] `editSaleOrder`: chỉ kỳ mở; trong MỘT `withInventoryTx`: `productsOfDocument` → gỡ lớp phụ thuộc nếu có → `removeDocument` → ghi lại (truyền lại `at`; seq tự dùng lại) → đồng bộ `discount_ledger`; đơn đã có phiếu giao/trả: chỉ cho sửa phần không làm SL < đã giao/trả.
- [ ] `cancelSaleOrder`: chặn nếu còn dính tiền (D-29/34b) với thông báo chỉ rõ phiếu thu/công nợ; hoàn kho (`removeDocument`), đảo `partner_ledger` + `discount_ledger`, cờ `isCancelled`, lưu `seq` để khôi phục.
- [ ] `restoreSaleOrder`: kỳ mở; ghi lại với `at` + `seq` đã lưu (thiếu tồn → đơn treo); tính lại công nợ/chiết khấu.
- [ ] `deleteDraftOrder` (34c): chỉ đơn chưa phát sinh; danh sách "Đơn đã xoá" (34) + khôi phục.
- [ ] 🧪 (spec 3.7, **[R]**): sửa/hủy/khôi phục đơn giữa chuỗi — giá vốn các đơn sau khớp `reference.ts`; đơn kỳ đóng bị chặn; hủy đơn có chiết khấu tích lũy đảo đúng tỷ lệ; hai người sửa cùng đơn → một 409; hủy đơn dính cọc bị chặn.

### Task C5 — Báo giá → đơn; tiền cọc (mã 35, 36)

- [ ] `Quote` DRAFT→SENT→CONVERTED/CANCELLED; `convertQuote` tạo **đơn nháp** (không xuất kho) copy dòng; báo giá không đụng kho (test không có `stock_ledger`).
- [ ] Cọc: `Receipt` loại `COC` gắn đơn (chỉ ghi phiếu + cập nhật trục thanh toán DEPOSITED; **sổ quỹ ở plan 05-D1** — ghi rõ ranh giới, không tạo `cash_ledger` giả). Khi giao, cọc tự trừ vào tiền phải thu; hủy đơn có cọc → 34b (hoàn/chuyển cọc là hành động rõ ràng).
- [ ] UI `/sales/quotes`, `/sales/deposits`.

### Task C6 — Trả hàng (mã 43–48)

- [ ] `resolveReturnCostByProduct(customer, product)`: vốn của lần bán gần nhất cho khách đó, không có → giá nhập gần nhất; giá trừ công nợ = giá bán gần nhất cho khách (sửa tay được).
- [ ] Trả theo đơn: `postReceipt({ docType: "RETURN_IN", costRef: { docType: "SALE", docLineId, qty } })` (vốn theo dòng bán gốc); trả theo SP: lớp thường không `costRef`; trả NCC: `postIssue("RETURN_SUPPLIER")`, công nợ phải trả giảm theo giá thỏa thuận (mặc định giá nhập gần nhất từ NCC).
- [ ] D-30: kiểm Σ trả ≤ SL bán (có khoá hàng), ghi `partner_ledger` credit, đảo `discount_ledger` theo tỷ lệ; hủy/sửa phiếu trả.
- [ ] 6 màn: tạo + danh sách × 3 loại.
- [ ] 🧪: trả theo đơn đúng giá vốn cũ (và tự cập nhật khi giá gốc đổi); trả theo SP không có đơn; trả NCC; trả vượt SL bị chặn; hàng trả không lấp đơn treo cũ (giả định 1 §8).

### Task C7 — Sổ công nợ (mã 62–65)

- [ ] `postPartnerLedger` là cửa duy nhất ghi `partner_ledger` (module khác gọi qua đây); `partnerBalance(partner, asOf)` = đầu kỳ + Σ(debit − credit) **tính khi đọc**; chi tiết từng chứng từ + đối chiếu tổng.
- [ ] `DebtAdjustment` (lý do HANG_LOI/BEP_MOP/CHIET_KHAU/KHAC) và `DebtTransfer` (gộp/chuyển): transaction, audit, `debt.adjust`; Σ hai vế cân; không gộp khi đối tác đã `mergedInto`.
- [ ] UI: tổng hợp công nợ (lọc, xếp hạng, export), chi tiết khách/NCC, điều chỉnh, gộp/chuyển; số dư tách khách/NCC.
- [ ] 🧪: số dư = đầu kỳ + phát sinh; mọi chứng từ đảo về 0 khi hủy; gộp nợ cân; 1.000 khách ≤ 3 s.

### Task C8 — Tự trừ NVL theo định mức khi bán tôn xốp (mã 15)

- [ ] Hoàn tất đường BOM trong C1 thành module `issueByBom`: kiểu gia công bán ra (tôn xốp/1 lớp/6 sóng/11 sóng) → NVL theo phiên bản BOM hiệu lực tại `orderDate`; hiển thị chi tiết NVL đã trừ trong chi tiết đơn (chỉ người có `cost.view` thấy giá).
- [ ] **Không** làm gia công thuê (plan 06-E3): tôn của khách không nhập kho, không trừ tôn cuộn — chỉ ghi chú ranh giới trong code và docs.
- [ ] 🧪: BOM đổi ngày 01/10 không đổi đơn 30/09; thiếu một NVL → đơn treo; hủy đơn hoàn đủ NVL.

### Đóng plan 04

- [ ] Chạy theo thứ tự: `npm run lint`; `npm run typecheck`; `npm test`; `npm run build`. Mở trang thật (đăng nhập, lập đơn, giao, sửa, hủy, khôi phục, trả hàng), desktop, dark/light, dữ liệu 1.300 SP + 1.000 đơn: danh sách/trang bán hàng ≤ 3 s.
- [ ] Rà chéo 03 ↔ 04: barrel engine, `docLineId` duy nhất theo `docType`, mọi đường ghi `SALE` đi qua `withIdempotentInventoryTx`, không còn `planned` sai, quyền server-side, audit không rò giá.
- [ ] Cập nhật STATUS/master/`db_schema.sql`; **merge `main` chờ user duyệt** (migration chạm DB thật).

## Quyết định mặc định đã chốt (29/09, user cho dùng khuyến nghị) — vẫn nên báo lại khách

| # | Câu hỏi | Chốt | Vì sao / cách đổi sau |
|---|---|---|---|
| 1 | Xuất kho FIFO lúc nào (D-4) | **Lúc xác nhận đơn** | Tồn kho phản ánh hàng đã hứa cho khách; khớp thiết kế engine (đơn treo). Không làm tuỳ chọn: đổi thời điểm xuất làm đổi thứ tự FIFO của cả chuỗi, không phải công tắc rẻ |
| 2 | Công nợ ghi khi nào (D-26) | **Khi giao** (theo phiếu giao) | Khớp spec 6.2 (công nợ sinh cùng kết quả giao). Toàn bộ ghi sổ đi qua `postPartnerLedger` nên nếu khách muốn "khi tạo đơn" thì đổi tập trung một chỗ + di trú, không phải công tắc chạy song song (hai chế độ ⇒ số dư lệch khi đổi giữa chừng) |
| 3 | Hàng khách trả lỗi | **Nhập chung mã** | Mặc định của spec (mục 11 #3). Tách mã "hàng lỗi" cần danh mục ánh xạ mã — làm sau nếu khách cần |
| 4 | Sửa giá bán tay | **Cho sửa, có audit — điều khiển bằng QUYỀN mới `order.edit_price`** | Giám đốc tự bật/tắt theo vai trò trong màn Nhóm quyền (đúng tinh thần "khách tự chỉnh được sau", không cần màn cài đặt riêng). Mặc định gán cho Giám đốc, Kế toán, Bán hàng; thiếu quyền ⇒ ô giá khoá, dùng giá gần nhất |
| 5 | Mã đơn | **Liên tục** `DH000001` (như phiếu nhập) | Mã duy nhất, không phụ thuộc kỳ |
| 6 | 8 giả định engine (`docs/engine-fifo.md` §8) | **Giữ mặc định** | Đã áp dụng từ GĐ1a; nêu trong buổi giao cho khách, đặc biệt #1 (hàng trả không lấp đơn treo cũ ⇒ cần "kiểm kho điều chỉnh") |

Bổ sung vào Task C1: thêm mã quyền `order.edit_price` vào `catalog.ts`, seed vai trò (Giám đốc/Kế toán/Bán hàng), form khoá ô giá khi thiếu quyền, server từ chối giá khác giá gợi ý khi thiếu quyền (không chỉ ẩn ở UI) + test.

## Definition of Done 04

- Mã 15, 29, 31–37, 43–48, 62–65 truy được; route guard và quyền áp server-side; phạm vi "khách của mình".
- Bộ test spec 3.7 phần bán/trả/sửa/hủy/khôi phục xanh (kể cả đồng thời và giữa chuỗi); engine ≡ oracle sau mọi thao tác.
- Không đường nào ghi `SALE` mà thiếu chủ dòng; không rò giá vốn/lãi/giá nhập qua DTO, export, audit, lỗi, log.
- Công nợ: số dư tính khi đọc, cân, đảo được; không cột số dư chạy.
- List/detail theo route riêng, deep link, search/filter/export, token/a11y/dark-light, ≤ 3 s.
- Lint, typecheck, test, build xanh; rà chéo 03↔04 có ledger reviewer.
