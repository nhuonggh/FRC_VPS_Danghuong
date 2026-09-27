# GĐ1b-c — BOM phiên bản, Cấu hình công ty, Trang chủ (Plan 03c)

> **Executor:** dùng quy trình subagent-driven: mỗi task một implementer, reviewer độc lập, ghi ledger vào `.superpowers/sdd/03c/progress.md`. Không chạy hai Vitest cùng lúc; DB test dùng cổng 5434.
>
> Đọc trước: master plan (Global Constraints + D-1…D-22), plan 03a (danh mục/sản phẩm), plan 03b (nhập hàng/kho), `docs/engine-fifo.md` §0/§3/§5/§8 và `docs/STATUS.md`. Plan này chạy sau khi 03a và 03b đã merge; chỉ mở các menu của chính nó khi task tương ứng hoàn thành.

**Mục tiêu:** hoàn tất GĐ1b bằng BOM có phiên bản theo ngày hiệu lực (mã 51), màn Cấu hình công ty & bật/tắt mẫu in (mã 6), và trang chủ có số liệu thật/đường dẫn nhanh theo quyền (mã 7). Không gọi Apps Script, không tạo PDF, không thực hiện tiêu hao hay sản xuất: các phần đó thuộc plan 04–06.

**Phạm vi 5F:** BOM là extension khớp nhóm Sản xuất `dinh-muc-nguyen-vat-lieu`; cấu hình là Hệ thống `thong-tin-cong-ty`. Nguồn ưu tiên vẫn là schema/spec Đặng Hương, không sao chép model của 5F.

## Global Constraints

Kế thừa toàn bộ Global Constraints master và D-11…D-18 của 03a/03b. Bổ sung:

- **D-19 (BOM bất biến theo phiên bản):** không UPDATE/DELETE BOM đã có hiệu lực hoặc đã được tham chiếu. Mỗi lưu thay đổi tạo `BomVersion` mới; phiên bản cũ giữ nguyên dòng. `validFrom` là ngày ICT, không chồng lấn cho cùng `(productId, processingTypeId)`; tạo phiên bản tương lai được, sửa/hủy phiên bản tương lai chưa dùng được bằng trạng thái, không xóa dữ liệu đã audit.
- **D-20 (chọn BOM):** `resolveBom(productId, processingTypeId, at)` chỉ trả phiên bản `ACTIVE` có `validFrom <= ngày ICT(at)`, mới nhất trước thời điểm đó; không có hoặc có hai phiên bản cùng ngày là DomainError rõ ràng. Nó trả snapshot DTO chỉ-đọc; plan 04 lưu `bomVersionId` vào dòng bán khi dùng, không dùng lại truy vấn động cho đơn cũ.
- **D-21 (mẫu in là cấu hình, secret không được đọc lại):** `print_templates` lưu webhook URL và secret riêng từng mẫu. API/DTO chỉ trả `hasSecret`; PATCH bỏ qua secret rỗng, secret mới được mã hóa bằng khóa cấu hình server trước khi ghi. GĐ2 mới giải mã để gửi body webhook; tuyệt đối không export/audit/log secret hay URL có query-secret.
- **D-22 (trang chủ đọc thuần):** số liệu là query riêng, theo kỳ mở và quyền actor; không bịa 0 khi query lỗi. Widget không có quyền hoặc feature chưa giao không xuất hiện; lỗi từng widget có retry và không làm hỏng lời chào/điều hướng.

## Review Focus

1. BOM đổi ngày 01/10 không làm đơn ngày 30/09 đổi định mức; `resolveBom` chọn đúng phiên bản theo ICT. Hai phiên bản cùng ngày bị DB/service chặn. → Task 16–17.
2. BOM không hợp lệ: sản phẩm thành phẩm/NVL sai loại theo policy, chính nó làm NVL, NVL trùng, số lượng `<= 0`, hoặc ProcessingType tắt → lỗi tiếng Việt, không ghi một phần. → Task 16–17.
3. Đồng thời: hai người lưu phiên bản kế tiếp cùng BOM/ngày; chỉ một thành công, bên kia 409 có kiểm soát. → Task 17.
4. Secret mẫu in không xuất hiện ở HTML, React props, API GET, Export, `audit_log`, hay toast; đổi URL/secret đều audit với giá trị đã redaction. → Task 18.
5. `company_settings` luôn đúng một hàng `id=1`; logo/chữ dữ liệu đầu vào an toàn, không tải URL tùy ý ở server. Cập nhật và đọc đồng thời không tạo hàng thứ hai/lost update. → Task 18.
6. Trang chủ: thiếu `stock.view` không biết tồn/giá trị; thiếu `purchase.view` không thấy phiếu nhập; widget tính chậm/lỗi chỉ hiện trạng thái lỗi cục bộ. URL/quick link chỉ trỏ feature đã bỏ `planned`. → Task 19.

## Cấu trúc file

| Tạo mới | Trách nhiệm |
|---|---|
| `prisma/schema/bom.prisma`, migration `bom_company_home` | BOM/version/line, `print_templates`, ràng buộc SQL |
| `src/server/bom/{schemas,service,queries,resolve}.ts` | tạo phiên bản, truy vấn/list/chi tiết, `resolveBom` |
| `src/server/company/{schemas,service,queries}.ts` | singleton công ty, template DTO redacted |
| `src/server/home/{queries,types}.ts` | dashboard query chỉ-đọc, scope theo actor |
| `src/app/api/{bom,company}/**` | route mỏng: actor → zod → service |
| `src/components/{bom,company,home}/*` | bảng/form/chi tiết/widget có state |
| `src/app/(app)/{production/bom,system/company}/**` | list/new/detail và form cấu hình |
| `tests/{bom,company,home}/**` | DB/service/API/UI/performance test |

| Sửa | Ghi chú |
|---|---|
| `prisma/schema/{master,system,period}.prisma` | relation ngược; không phá schema cũ |
| `src/config/app.config.ts` | bỏ `planned` ở `bom-list`, `company`, `home` khi từng task giao xong |
| `src/app/(app)/page.tsx` | thay landing placeholder bằng dashboard thật |
| `src/lib/permissions/catalog.ts`, seed quyền | chỉ bổ sung nếu `bom.view` cần tách khỏi `bom.manage`; không tự đổi quyền vai trò |
| `docs/{STATUS.md,db_schema.sql}` và master plan | cập nhật khi đóng 03c |

---

### Task 16 — Schema BOM/version, mẫu in và công ty (migration `bom_company_home`)

**Mã:** 6, 51. **Đầu ra:** `Bom`, `BomVersion`, `BomLine`, `PrintTemplate`; `CompanySetting` vẫn singleton `id=1`.

- [ ] Viết test DB đỏ: FK Product/ProcessingType, unique `(bomVersionId, materialProductId)`, CHECK `qtyPerUnit > 0`, unique `(productId, processingTypeId, validFrom)`, `print_templates.docType` enum/check, `isActive` và default an toàn.
- [ ] Tạo model: `Bom` là aggregate theo `(productId, processingTypeId)`; `BomVersion` có `versionNo`, `validFrom`, `status`, `createdBy/createdAt`; `BomLine` lưu `materialProductId`, `qtyPerUnit Decimal(18,3)`, `note`. Thêm `bomVersionId` nullable vào chỗ tham chiếu tương lai chỉ khi schema hiện có cần relation; không tạo sale-order placeholder.
- [ ] Tạo `PrintTemplate`: `docType`, `name`, `webhookUrl`, `secretCiphertext`, `isActive`, `title`, `signerName`, `phone`, `qrImage`, `showCompanyInfo`, `footerNote`, audit fields. Không tạo `print_files` (GĐ2 D6).
- [ ] SQL migration thêm index lookup `BomVersion(bomId,status,validFrom DESC)`, CHECK singleton công ty và migration seed/upsert hàng id=1 khi DB cũ rỗng. Các bảng chứng từ mới có `createdBy/createdAt`; BOM không có `periodId` vì là master/version reference, ghi rõ ngoại lệ trong checker.
- [ ] Sinh `db/db_schema.sql`, cập nhật factories; chạy riêng test migration/schema.

**Nghiệm thu:** migration lên/xuống môi trường test, concurrent insert cùng ngày bị unique violation được service đổi thành 409; không thể tạo BOM dòng vật liệu chính nó.

### Task 17 — BOM backend, API và UI phiên bản

**Interfaces:** `createBomVersion(actor,input,key?)`, `listBoms`, `getBom`, `resolveBom(productId, processingTypeId, at)`. `resolveBom` là hàm thuần truy vấn được plan 04 gọi qua barrel `src/server/bom/index.ts`.

- [ ] Test service trước: chọn đúng bản 01/09 hay 01/10 theo `toIct(at)`; ngày trước bản đầu tiên trả `BomNotFoundError`; ProcessingType inactive/thiếu quyền/bản draft không được resolve.
- [ ] Zod input giới hạn 1–100 dòng, Decimal dương 3 chữ số, mỗi NVL một lần; product đích là hàng cần BOM theo policy đã nêu trong plan, material phải active. `assertCan(actor.perms, "bom.manage")` ở service, không chỉ route.
- [ ] Lưu bằng transaction + khóa aggregate/dòng liên quan; tính `versionNo` theo DB, tạo version mới thay vì sửa. `writeAudit` chỉ lưu mã/tên/lineCount/version, không ghi dữ liệu giá nhạy cảm.
- [ ] Query list phân trang server, search không dấu qua Product; lọc ProcessingType/trạng thái; DTO detail có lịch sử phiên bản và lines nhưng không trả entity Prisma thô.
- [ ] Routes: GET list/detail dùng `bom.manage` (hoặc `bom.view` nếu catalog đã tách); POST tạo và POST phiên bản dùng Idempotency-Key khi form có retry; mọi lỗi validation/409 trả Problem Details tiếng Việt.
- [ ] UI: `/production/bom`, `/new`, `/[id]?tab=versions`; form multiline combobox tìm Product/ProcessingType, xử lý bàn phím, tổng dòng; detail full page, tab phiên bản; không cho sửa trực tiếp version đã hiệu lực. Bỏ `planned` của `bom-list` sau smoke test.
- [ ] Test UI: duplicate material/qty 0 không POST; 409 giữ form; user chỉ xem không thấy action; link deep-link mở đúng tab/version.

**Không làm ở Task 17:** tiêu hao, so sánh thực tế, backflush, production order, hay cập nhật tồn. Những nơi tiêu thụ BOM phải dùng `resolveBom` sau này và snapshot `bomVersionId`.

### Task 18 — Cấu hình công ty và mẫu in an toàn

- [ ] Test singleton/read/update trước: GET tự hồi phục hàng id=1 trong transaction seed chỉ khi chưa tồn tại; PATCH concurrent dùng `updatedAt`/version chống ghi đè mù; actor thiếu `company.manage` bị 403 trước DB write.
- [ ] `CompanySettingsSchema` validate name, address/phone/tax code, bankInfo JSON có cấu trúc rõ; logo/QR chỉ nhận đường dẫn upload hợp lệ hoặc HTTPS allowlist đã cấu hình, không server-fetch URL người dùng.
- [ ] DTO template luôn omit `secretCiphertext`, thay bằng `hasSecret`; redact URL query values khi audit. PATCH template rỗng không xóa secret; thay/xóa secret cần confirm explicit field (`replaceSecret`/`clearSecret`) và audit action riêng.
- [ ] UI `/system/company`: sections Thông tin công ty, Ngân hàng, Mẫu in. Mẫu inactive hiển thị rõ; icon-only action có aria-label/tooltip; Escape đóng dialog. Không hiện nút test webhook vì GĐ2 mới có transport.
- [ ] API/update chỉ service transaction + `writeAudit`; no-store response cho settings/template. Bỏ `planned` company sau kiểm tay bằng user có và không có quyền.
- [ ] Test redaction bằng JSON serialized response, audit query và render server component: không được có secret/plain cipher trong tất cả output.

### Task 19 — Trang chủ thật, quality gate và đóng GĐ1b

- [ ] Định nghĩa `HomeDashboardDTO`: quick links từ `buildNav` đã lọc quyền/feature, các stat rõ nguồn (`todayPurchaseCount`, `lowStockCount`, `pendingOrderCount`…) chỉ thêm khi nguồn query và quyền đã tồn tại. Không đưa doanh thu/lãi/số liệu chưa có chứng từ vào UI.
- [ ] Query theo kỳ open/ICT, server-side permissions trước query; `cost.view` mới thấy giá trị tồn. Query mỗi widget độc lập, có timeout/boundary hiển thị “Chưa tải được — Thử lại”, không fallback 0.
- [ ] Thay `page.tsx`: greeting + Quick access cards + widget được phép; trạng thái loading/empty/error; keyboard focus và touch target ≥44px. Không expose đường dẫn feature `planned`.
- [ ] Test home với ba actor: không quyền chỉ thấy landing rỗng; thủ kho thấy tồn số lượng không giá; manager thấy widget được cấp. Test widget reject không làm page reject; test link là từ `buildNav`.
- [ ] Chạy theo thứ tự: `rtk proxy npm run lint`; `rtk proxy npm run typecheck`; `rtk proxy npm test`; `rtk proxy npm run build`. Mở trang thật desktop, dark/light, dữ liệu 1.300 sản phẩm; đo trang chủ và danh sách BOM ≤3s theo DoD.
- [ ] Rà chéo 03a/03b/03c: imports/barrel (`convertToBase`, `searchProducts`, `resolveBom`), kiểu Decimal/ICT, permission names, migration order, file paths/app.config, không placeholder. Reviewer ký ledger và liệt kê finding đã sửa.
- [ ] Cập nhật STATUS/master/db schema. Commit riêng plan thực thi chỉ sau khi toàn bộ code/task xanh; merge/push main chờ user duyệt.

## Cần khách xác nhận

1. Bảng định mức NVL thật (tôn cuộn/giấy bạc/POLY/ISO) và policy sản phẩm nào được phép có BOM; trước đó chỉ dựng cấu trúc, không seed định mức tạm như dữ liệu thật.
2. Danh sách loại mẫu in, webhook URL/secret và nơi lưu logo/QR do khách cung cấp ở GĐ2; Task 18 chỉ cho phép cấu hình an toàn, không cần secret thật để test.

## Definition of Done 03c

- Truy được mã 6, 7, 51; route guard và permissions áp server-side.
- BOM version không sửa lịch sử, resolve theo ngày ICT, schema/transaction/audit/test đồng thời đủ.
- Secret không lộ qua DTO/audit/log/UI; công ty singleton.
- Trang chủ chỉ hiển thị dữ liệu thật theo quyền, có loading/empty/error, không số giả.
- List/detail theo route riêng, deep link, search/filter/export khi phù hợp, token/a11y/dark-light, ≤3s.
- Lint, typecheck, test và build xanh; rà chéo 03a/03b/03c có ledger reviewer.
