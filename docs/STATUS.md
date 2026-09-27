# TRẠNG THÁI DỰ ÁN — đọc file này ĐẦU TIÊN ở mỗi phiên làm việc

> Cập nhật lần cuối: **2026-09-27** (Task 1–7 của plan 03a đã deploy CI xanh theo user xác nhận; Task 8 hoàn thành code, chờ CI/deploy). Người cập nhật: Codex. Khi làm xong việc gì → sửa file này
> (chuyển mục giữa các phần 4/5/6/7), commit cùng thay đổi.
> Không có secret trong file này. Secret thật chỉ nằm ở VPS (`/home/deploy_dherp/app/.env*`) và GitHub Secrets.

## 0. Cách đọc & dùng

1. Đọc mục 1–3 (bối cảnh, quy tắc, hạ tầng), rồi 4–7 (đã xong / đang làm / sẽ làm / chờ duyệt).
2. Chi tiết kỹ thuật: mục 10 (bản đồ tài liệu). Spec nguồn: `../MASTER_SPEC_TRIEN_KHAI_v2.md` (thư mục cha của repo) — spec là
   thẩm quyền cao nhất, plan chỉ là lập luận từ spec.
3. Việc kế tiếp theo lộ trình: mục 6. **Việc nào nằm ở mục 7 (cần user duyệt) thì KHÔNG tự làm**, hỏi user.
4. Ngôn ngữ giao tiếp với user: tiếng Việt, ngắn gọn (user đặt chế độ "caveman": bỏ văn thừa; code/commit viết bình thường).

## 1. Dự án là gì

Phần mềm quản lý **Xưởng Tôn Đặng Hương**: đơn hàng → kho FIFO → giao hàng → kế toán → sản xuất → kết sổ theo kỳ. 100% dùng trên máy
tính. Stack: Next.js 15.5 (App Router) · React 19 · TypeScript · Tailwind 3.4 (token `crm-design`) · Prisma 6.19 (schema nhiều
file `prisma/schema/`) · PostgreSQL 15 · next-auth v4 (Credentials + Google) · Vitest 5 · Docker · Caddy · GitHub Actions.
UI theo skill `crm-design` (trang chi tiết full-page, không split panel). Hạ tầng theo skill `setup-project`.

**Trạng thái một dòng:** GĐ0 (nền tảng) + GĐ1a (engine FIFO) xong và **đã deploy chạy thật** tại https://dherp.sheetapp.store;
chưa có màn nghiệp vụ nào trong code. Plan 03 (GĐ1b) đã viết đủ 03a/03b/03c — CHƯA thực thi; plan 04–07 chưa viết.

## 2. Quy tắc bất di bất dịch (đọc kỹ)

**Với user / process**
- **Push `main` = deploy lên VPS đang chạy dự án thật.** Luôn hỏi user trước khi push/merge vào `main`. Push nhánh khác thì được.
- **VPS có dự án khác đang chạy thật** (`crm`, `lms`, `bldemo`, WordPress, `postgres-shared`, `pgadmin`, registry). Chỉ **đọc** để
  tham khảo. KHÔNG sửa/xoá/khởi động lại/đổi mật khẩu/đổi cấu hình của chúng nếu user chưa cho phép RÕ RÀNG cho đúng hành động đó
  (đã có bài học: sửa repo `lms` trong registry bị chặn vì user chưa nói rõ). Không tự đổi mật khẩu registry, không sửa `htpasswd`.
- Không tự đặt SLUG/DOMAIN/PORT…; dùng đúng giá trị ở mục 3. Không commit secret (`.env`, `.env.local`, `.env.migrate`,
  `.env.*.local` đã ignore; `.env.test` là giá trị bỏ đi, commit được). Nếu lỡ lộ secret → xoay toàn bộ.
- VPS: đưa lệnh trần, mỗi lần 1–2 lệnh, giải thích viết trước/sau khối lệnh. `docker restart` KHÔNG nạp lại `.env` → phải tạo lại
  container (chạy lại workflow Deploy). Không tuyên bố "xong" khi chưa mở trang thật / chạy thật.
- Skill trong `superpowers` không tự kích hoạt trừ khi user gọi/yêu cầu. UI CRM/ERP → bắt buộc `crm-design`; deploy VPS → bắt buộc
  `setup-project`. Thực thi plan theo kiểu subagent-driven (mỗi task 1 implementer + reviewer, sổ ledger, review cuối) là cách user đã chọn.
- Commit có dòng cuối: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

**Kỹ thuật**
- Engine FIFO: sửa engine, không sửa oracle `tests/inventory/reference.ts` để che lỗi. Mọi module nghiệp vụ chỉ gọi engine qua
  barrel `src/server/inventory/index.ts`.
- Không chạy 2 tiến trình vitest cùng lúc (dùng chung DB test `dh_pgtest`, cổng **5434**; cổng 5433 là của dự án khác trên máy dev).
- Windows + Git Bash: hook RTK nuốt output vitest → dùng `rtk proxy npx vitest run <file>`, `rtk proxy npm test`,
  `rtk proxy npm run lint`. Write/Edit đổi `\uXXXX` thành ký tự thật. Heredoc Bash lớn hay lỗi → dùng tool Write.
- Tiền/số lượng chỉ dùng Decimal; thời điểm chứng từ theo ICT (`docTimestamp`).
- Mọi bảng chứng từ mới bắt buộc có `periodId/createdBy/createdAt` (có test DMMF rà).

## 3. Hạ tầng thật (không có secret)

| Mục | Giá trị |
|---|---|
| SLUG hạ tầng | `dherp` (chữ thường ở mọi nơi hạ tầng) |
| Domain | `dherp.sheetapp.store` (DNS đã trỏ, cert Let's Encrypt) |
| VPS | `194.233.87.152` (Ubuntu 24.04, Docker 29). SSH: `root` bằng key riêng `~/.ssh/id_ed25519_dherp_claude` (trên máy dev của user) |
| Port app | `3004` (bind `127.0.0.1:3004→3000`); 3001 = crm, 3003 = bldemo |
| GitHub | https://github.com/nhuonggh/FRC_VPS_Danghuong (private). Nhánh làm việc: `feat/gd0-foundation`; `main` = bản đang deploy |
| Registry chung | `registry.francophiles.com.vn` (htpasswd, user chung `admin`; secret `REGISTRY_*` đã đặt trong GitHub) |
| User deploy | `deploy_dherp` (nhóm docker); thư mục `/home/deploy_dherp/app/` có `.env` (app) và `.env.migrate` (migrator), đều mode 600 |
| Container | `dherp_app` (restart always, mạng `pgnet`), `postgres_dherp` (postgres:15, 1 GB, dữ liệu `/opt/postgres_dherp`, DB `dherp_db`, owner `dherp_user`, role app `app_rw`) |
| Caddy | chạy dạng **container** `caddy`; file site `/opt/caddy/sites/dherp.caddy` = `dherp.sheetapp.store { reverse_proxy dherp_app:3000 }`; reload: `docker exec caddy caddy validate --config /etc/caddy/Caddyfile` rồi `docker exec caddy caddy reload --config /etc/caddy/Caddyfile` |
| CI/CD | `.github/workflows/deploy.yml`: push `main` → test (khoảng 15–20 phút, DB thật) → build 2 image (target `runner`, `migrator`; `provenance:false`, `sbom:false`) → push registry → SSH deploy: pull → migrate → seed → thay container → health probe. Có bước chờ ngoài cửa sổ GC registry |
| Env | `.env` (app): `NODE_ENV, DATABASE_URL (app_rw), AUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET`. `.env.migrate`: `MIGRATE_DATABASE_URL (owner), BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_EMAIL`. App KHÔNG được giữ biến của migrator (workflow từ chối deploy nếu có) |

Quy ước VPS dùng chung (bám theo): mỗi dự án = `deploy_<slug>`, `<slug>_app`, `postgres_<slug>`, `/opt/caddy/sites/<slug>.caddy`, mạng `pgnet`.

**Registry chung — bài học 2026-09-27** (chi tiết: `docs/infra/REGISTRY-GC.md`, `docs/infra/RUNBOOK.md` mục 3):
- Cron GC `--delete-untagged` (do user thêm 26/09) xoá manifest con của image buildx → hỏng tag `crm`/`lms`; registry còn cache blob
  trong RAM khiến push bỏ qua upload. Đã: tắt dòng cron (backup `/root/crontab.backup.20260927-035037`), restart registry một lần
  (user đồng ý), đẩy lại `crm:latest`/`crm:migrate` (backup `/root/registry-repo-crm-backup-20260927-035337.tgz`).
- Nếu gặp `manifest unknown`/`blob unknown` với repo `dherp`: xoá đúng thư mục repo `dherp` trong
  `/opt/registry/data/docker/registry/v2/repositories/`, (nếu vẫn "Layer already exists" thì cần restart registry — hỏi user), chạy lại workflow.

## 4. ĐÃ HOÀN THÀNH

| # | Hạng mục | Bằng chứng / ghi chú |
|---|---|---|
| 1 | Bộ plan 00 (master), 01a, 01b, 01c, 02 (chi tiết) | `docs/superpowers/plans/` |
| 2 | **GĐ0a** — scaffold, Prisma schema trụ nền + migration (CHECK, audit append-only + trigger, `app_rw` grants), test harness, phân quyền (catalog/guard/scope/redact), audit, idempotency, seed | 126 file / 1473 test xanh, lint/typecheck/build sạch |
| 3 | **GĐ0b** — auth Credentials (bcryptjs), token UI/Tailwind/theme/format/time, App Shell + `app.config` (81 màn), khung danh sách (DataTable, phân trang dính đáy, StatCard, EmptyState), lớp truy vấn danh sách (URL params, tìm không dấu, `QuickTimeFilter` 10 mốc ICT, Export Excel) | |
| 4 | **GĐ0c** — DetailPage/NewPage/Toast/ConfirmDialog/Combobox, màn Người dùng, Nhóm quyền, Nhật ký thao tác (export tối đa 10.000 dòng), đăng nhập/đổi mật khẩu, trang chủ, health, lỗi/404 | |
| 5 | **Engine FIFO (plan 02, 9 task)** — `replayProduct` một thuật toán, `flush`, `withInventoryTx`, cổng ghi (`postReceipt/postIssue/removeDocument/updateLayerCost`), khoá `seq` ổn định trên `stock_ledger`, đơn treo/nhập bù, sửa/hủy/khôi phục giữa chuỗi, giá vốn phụ thuộc chéo (trả hàng, tôn xốp BOM, thành phẩm SX), trả NCC, tính lại chạy nền (worker + job), owners fail-closed, khoá kỳ `FOR SHARE`, barrel, hiệu năng (2.000 dòng ≈ 1 s), oracle độc lập + property test | `docs/engine-fifo.md` (hợp đồng, truy vết spec 3.7, 8 giả định khách) |
| 6 | Review toàn nhánh (opus) + 1 đợt sửa: owner registry, khoá kỳ, README, seed ICT, IP audit… | 0 Critical |
| 7 | **Google sign-in** (user yêu cầu 2026-09-26; thay D-1) + email người dùng, mật khẩu tạm hết hạn 72h, đổi email cắt phiên Google, `npm run admin:reset` | review bảo mật 2 vòng, đạt. `docs/conventions/auth.md` |
| 8 | **Hạ tầng VPS DHERP** (user, DB, `.env`/`.env.migrate`, GitHub Secrets, Caddy, cert) + Dockerfile/deploy.yml/RUNBOOK/VERIFY | build + chạy thử image cục bộ; migrate + seed 2 lần idempotent |
| 9 | **Deploy đầu tiên thành công** 2026-09-27 (CI run `36286414314`) | `/api/health` 200; DB seed: 50 quyền, 5 vai trò, 1 kỳ mở, user `admin`; `/login` 200 có nút Google; Google chấp nhận redirect URI; các site khác không bị ảnh hưởng |
| 10 | Xử lý sự cố registry chung (xem mục 3): tắt cron GC, restart registry, sửa lại tag `crm` | crm_app/lms_app và site của họ không bị gián đoạn; dữ liệu crm nguyên vẹn (DB, uploads) |
| 11 | User chốt các mục cũ (2026-09-27): #1, #2, #3 đóng; #5 (nhánh/merge chỉ khi user duyệt) xác nhận; #4 duyệt bắt đầu plan 03; #6 (backup) chưa cần; #7 (Caddy header + rate limit + Origin) đồng ý | đã ghi vào mục 7 |
| 12 | **Plan 03a** viết xong (Task 1–8, ~6.000 dòng, TDD đủ code + test): migration `catalog_foundation` (Vehicle, Driver, Route, ExpenseType, ProcessingType, `isActive`, `Product.isCoil`), Catalog Settings (7 danh mục nhỏ, một file cấu hình `CATALOG_SECTIONS`), khung Import Excel dùng lại (`parseViNumber`, xem trước/ghi/file lỗi/mẫu), KH & NCC (mã, tìm không dấu, phạm vi "khách của mình", import), sản phẩm + đơn vị quy đổi (`convertToBase`, import 1.300 SP) | Đã commit `7ba722c`, merge `main` `d09a4b6`; chưa thực thi |
| 13 | **Plan 03b** viết xong (Task 9–15, ~4.900 dòng): schema nhập hàng + nhập không NCC + field nhạy cảm mới (`purchaseAmount`, `freightCost`…), cầu nối `withIdempotentInventoryTx`, phiếu nhập hàng, nhập kho không NCC, báo cáo/giao diện kho | Đã commit `7ba722c`, merge `main` `d09a4b6`; chưa thực thi |
| 14 | **Plan 03c** viết xong (Task 16–19): BOM có phiên bản + `resolveBom`, cấu hình công ty và mẫu in có redaction secret, trang chủ theo quyền/dữ liệu thật, quality gate và rà chéo 03a–03c | Đã commit `7ba722c`, merge `main` `d09a4b6`; chưa thực thi |
| 16 | **GĐ1b / Plan 03a Task 1** — schema danh mục nền đã thực thi | commit `6ea147a`, CI deploy xanh `36294966806`: migration `catalog_foundation`, CHECK DB, factories, test DB/invariant, typecheck/lint |
| 17 | **GĐ1b / Plan 03a Task 2** — Catalog Settings backend đã thực thi | commit `cdb4032`, CI deploy xanh `36295568250`: 8 section data-driven, zod, CRUD/audit, 409, query/search/options, test/typecheck/lint |
| 18 | **GĐ1b / Plan 03a Task 5** — backend Khách hàng/NCC | Mã KH/NCC tự sinh có khoá transaction, schema/CRUD/audit/idempotency, phạm vi “khách của mình”, tìm không dấu, export Excel và ImportSpec dùng Task 4; không có `view_all` tự gán người tạo, có `view_all` giữ chưa phân công; test service/query/schema/import, typecheck/lint và CI/deploy xanh |
| 19 | **GĐ1b / Plan 03a Task 4–5 + cập nhật kế hoạch** — deploy đã xác nhận | CI/CD xanh do user xác nhận: `113364b`, `4445761`, `ec9fc92`, `4958808`, `af0be47`. Task 1–5 đủ điều kiện chuyển sang Task 6. |
| 20 | **GĐ1b / Plan 03a Task 6** — API và giao diện Khách hàng/NCC | CI/deploy xanh do user xác nhận: 6 route trang, API create/section update/search/export/import/template; danh sách PC/mobile, tạo mới idempotent, detail theo section/audit, scope quyền và mở menu. |
| 15 | Master plan đã cập nhật | Gom D-11…D-22 và tách roadmap 03 thành 03a/03b/03c |

## 5. ĐANG HOÀN THÀNH

| Hạng mục | Tình trạng | Bước tiếp |
|---|---|---|
| Deploy Task 1–6 và tài liệu kế hoạch | **CI/CD xanh** theo user xác nhận | `main` đã có giao diện KH/NCC cùng addendum quỹ hậu kiểm; đang triển khai Task 7 |
| **Việc #7 đã duyệt** — header bảo mật Caddy + rate limit đăng nhập + kiểm `Origin` | CHƯA làm (chỉ mới duyệt) | làm trên nhánh riêng, không push `main` khi chưa hỏi (mục 6 nợ #2) |
| **GĐ1b / Plan 03a Task 3** — Catalog Settings API và giao diện | **CI/CD xanh** | 8 danh mục: API CRUD/toggle/export, mini-sidebar, bảng kebab, search/phân trang, tạo mới/sửa; bố cục full-width và KPI grid đã chỉnh theo góp ý 27/09. |
| **GĐ1b / Plan 03a Task 4** — Khung Import Excel dùng lại | **CI/CD xanh** (`113364b`) | `parseViNumber`, đọc `.xlsx` ≤ 5.000 dòng/2 MB, preview/ghi idempotent/audit, file mẫu/dòng bị loại, Dialog + menu Nhập/Xuất; test parser/reader xanh. |
| **GĐ1b / Plan 03a Task 5** — Backend Khách hàng/NCC | **CI/CD xanh** (`ec9fc92`, `4958808`) | Mã KH/NCC tự sinh an toàn khi tạo đồng thời; CRUD theo section/audit/idempotency; thiếu `view_all` tự gán người tạo, có `view_all` giữ chưa phân công; scope “khách của mình”; tìm không dấu, Excel export và ImportSpec D1. |
| **GĐ1b / Plan 03a Task 6** — API và giao diện Khách hàng/NCC | **CI/CD xanh** (`51640a3`, user xác nhận) | Danh sách/tìm/lọc/phân trang/import-export; tạo mới; detail sửa từng section; API và menu đã mở cho Khách hàng/NCC. |
| **GĐ1b / Plan 03a Task 7** — Backend sản phẩm | **CI/CD xanh** (`492d5de`, user xác nhận) | Đơn vị/quy đổi D-12 dùng Decimal, định mức tồn, tìm không dấu, export và import D2. |
| **GĐ1b / Plan 03a Task 8** — API và giao diện Sản phẩm | Hoàn thành code, chờ CI/deploy | API create/section/search/export/import; danh sách/tạo mới/chi tiết theo section; menu đã mở. Typecheck/lint và 8 test sản phẩm xanh. |

## 6. CHƯA HOÀN THÀNH / SẼ HOÀN THÀNH (theo thứ tự)

**Nợ vận hành ngay (nhỏ, làm trước khi giao khách):**
1. ~~Sao lưu `pg_dump` hằng đêm~~ — **user: chưa cần (2026-09-27)**; hoãn, nhắc lại trước khi nhập dữ liệu thật/go-live (task D9 plan 05).
2. **Đã duyệt, chưa làm:** chống dò mật khẩu đăng nhập (rate limit trong app; Caddy nếu module hỗ trợ), header bảo mật (X-Frame-Options / CSP
   `frame-ancestors`, nosniff, Referrer-Policy) chỉ trong `dherp.caddy` của dự án này, kiểm `Origin` cho request không phải GET tới `/api/*`.
   Sửa file trong repo `docs/infra/caddy/dherp.caddy` + áp dụng trên VPS (`caddy validate` → `reload`); không đụng site khác.
3. ~~Sửa tag `lms`~~ và ~~Google client secret~~ — user đã đóng #1, #2, #3 (2026-09-27); không còn việc của AI.

**Lộ trình sản phẩm** (chi tiết + interface + test từng task: `docs/superpowers/plans/2026-09-24-00-master-plan.md` mục 5):

| Thứ tự | Plan | Nội dung | Điều kiện vào |
|---|---|---|---|
| 1 | **03 — GĐ1b**, tách 3 file: **03a** (Task 1–8), **03b** (Task 9–15), **03c** (Task 16–19) — ĐÃ VIẾT ĐỦ | Task 1–7 deploy xanh; Task 8 hoàn thành code chờ CI; còn toàn bộ 03b/03c | user đã duyệt plan; CI Task 8 xanh sẽ đóng 03a |
| 2 | 04 — GĐ1c (chưa viết) | Bán hàng (`registerCostOwner('SALE', …)` bắt buộc — hiện mọi SALE bị chặn), đơn 2 trục trạng thái, phiếu giao, sửa/hủy/khôi phục, báo giá/cọc, trả hàng, công nợ, tự trừ NVL tôn xốp | plan 03 xong |
| 3 | 05 — GĐ2 (chưa viết) | Thu/chi, quỹ, chiết khấu tích lũy, chuyến giao + đối soát, 9 mẫu in (Apps Script), số đầu kỳ, chuyển dữ liệu D1–D4, backup, chạy thử/đào tạo | plan 04 xong |
| 4 | 06 — GĐ3 (chưa viết) | Sản xuất phụ kiện, gia công thuê, kiểm kho, báo cáo 67–73 | song song được |
| 5 | 07 — GĐ4 (chưa viết) | Kết sổ (khoá `FOR UPDATE` dòng `periods` ĐẦU TIÊN; chặn khi còn cờ/job tính lại; chặn khi còn dòng treo), tra cứu kỳ cũ, kiểm thử toàn bộ, diễn tập khôi phục, bàn giao | plan 05/06 xong |

**Bàn giao phiên kế tiếp — thứ tự đề nghị:**
1. Ghi kết quả CI/deploy của `113364b`, `4445761`, `ec9fc92` và commit sửa quy tắc owner kế tiếp vào mục 4/5; nếu đỏ thì xử lý đúng log trước khi làm chức năng mới.
2. Ghi kết quả CI/deploy **Task 8**; nếu xanh, đóng plan 03a và mở Task 9 (nhập hàng, thuộc plan 03b).
3. Plan 03b/03c vẫn chưa thực thi; GĐ2 quỹ hậu kiểm chỉ mở sau Plan 04 và các quyết định nghiệp vụ còn treo.

**Hợp đồng bắt buộc của engine cho plan 03+** (đủ ở `docs/engine-fifo.md` §0/§3/§5/§6/§8):
- Mỗi dòng nghiệp vụ lưu `at` + `seq` cùng dòng; sửa chứng từ không đổi ngày phải dùng lại `at`, và truyền lại `seq` đã lưu khi khôi phục.
- Đăng ký owner (`sale_lines.unit_cost_fifo/is_provisional`…) ở điểm trung tâm `src/server/inventory/owners-register.ts`; thiếu owner ⇒ engine ném lỗi (fail-closed).
- Module tự kiểm số lượng trả ≤ số lượng bán; tự tuần tự hoá việc sửa cùng một dòng chứng từ (khoá hàng chứng từ).
- Ánh xạ `EngineBusyError` (deadlock sau 3 lần retry) thành phản hồi "bận, thử lại".
- Đơn treo (bán âm kho): chỉ nhập mua/đầu kỳ/kiểm kê mới bù; trả hàng/thành phẩm SX KHÔNG bù đơn treo cũ (giả định cần khách xác nhận).

**Nợ kỹ thuật đã ghi nhận (không chặn):** ledger chi tiết ở `.superpowers/sdd/*/progress.md` (thư mục **git-ignored, chỉ trên máy dev**). Tóm tắt:
- Phiên đăng nhập: đổi/reset mật khẩu chưa cắt phiên đang mở (tối đa 12 giờ); trùng vài mili-giây khi đổi email; CHECK `mustChangePassword ⇒ tempPasswordExpiresAt` chưa có; `admin:reset` chưa tự mở khoá.
- Worker tính lại: thiếu vài mã lỗi tạm thời (P2037, 57P03, 53300), `attempts` không reset khi merge, backoff chưa theo từng job, giữ 1 kết nối pool tối đa 10 phút.
- Engine: kiểm tra `seq` tường minh không nằm trong transaction; `registerCostOwner` còn export ở barrel (nên có lint `no-restricted-imports`); `useNoopCostOwners` cần reset cờ `registered` khi có owner thật.
- `npm audit --omit=dev`: 7 lỗ hổng (0 critical, 4 high, 3 moderate), đều không chạm production runtime (build-time hoặc CLI migrator); cần nâng major mới hết.
- `next/font/google` cần mạng lúc build; nhiều màn UI chưa kiểm tra tay trên trình duyệt thật; hai bước docker cục bộ đã thay bằng kiểm chứng ở mục 4 #8.
- Registry chung: repo `crm`/`lms` còn hàng nghìn link layer mồ côi (vô hại sau khi tắt GC); tag `lms` chưa sửa.

## 7. CẦN USER DUYỆT / LÀM (không tự làm)

| # | Việc | Ai làm | Khuyến nghị / ghi chú |
|---|---|---|---|
| — | **Đã chốt 2026-09-27 (giữ để tra cứu):** #1 đăng nhập lần đầu, #2 Google secret, #3 tag `lms` → user đóng, không còn việc. #4 bắt đầu plan 03 → **đã duyệt**. #5 nhánh/merge chỉ khi user duyệt → **xác nhận** (áp dụng cho mọi việc dưới đây). #6 backup → **chưa cần** (hoãn; nhắc trước go-live/nhập dữ liệu thật, hiện DB dherp chưa có backup). #7 rate limit + header Caddy + kiểm Origin → **đồng ý**, chỉ sửa `dherp.caddy` của dự án này | user | AI làm #7 trên nhánh riêng (mục 5); mọi push `main` vẫn hỏi trước |
| A | **Đã duyệt 2026-09-27:** rà plan 03 hoàn tất và chọn thực thi **subagent-driven** (mỗi task implementer + reviewer độc lập) | user | Có thể bắt đầu Task 1 khi mở đợt code; merge/push `main` vẫn hỏi riêng |
| 8 | Xác nhận với khách: **D-4** xuất kho FIFO lúc xác nhận đơn (không phải lúc giao); **D-5** responsive theo cơ chế crm-design nhưng chỉ nghiệm thu trên PC | user/khách | Đang áp dụng D-4, D-5 |
| 9 | Xác nhận với khách (giả định nghiệp vụ, `docs/engine-fifo.md` §8): (1) trả hàng và thành phẩm SX không bù đơn treo cũ (đơn treo chờ nhập mua/đầu kỳ/kiểm kê; đóng kỳ bị chặn khi còn dòng treo → cần "kiểm kho điều chỉnh"); (2) lớp phụ thuộc không sớm hơn nguồn; (3) cùng thời điểm: nhập thường trước, rồi xuất + lớp phụ thuộc theo thứ tự ghi; (4) giá tạm tính theo kỳ; (5) quyền Giám đốc có thể bị thu hẹp bởi người có `role.manage` + `user.manage` (spec 6.6); (6) xuất Excel nhật ký tối đa 10.000 dòng; (7) quyền mặc định từng vai trò (Kế toán, Bán hàng, Thủ kho); (8) người có `user.manage` có thể gán email Google cho đồng nghiệp ngang quyền (chấp nhận, có audit) | user/khách | |
| 10 | Chấp nhận/không 7 lỗ hổng `npm audit` còn lại (không chạm production) | user | Khuyến nghị chấp nhận, theo dõi khi nâng Next/Prisma |
| 11 | Chính sách GC registry sau này (cron đã tắt): chạy tay khi đĩa đầy, có `--dry-run`, ngoài giờ deploy; hoặc đề xuất chủ registry dùng GC thường (không `--delete-untagged`) | user (chủ registry) | Đĩa VPS còn 78 GB, không gấp |
| 13 | **Đã xác nhận mặc định cho plan 03b (2026-09-27):** cước không vào công nợ NCC; người lập phiếu nhập cần `purchase_price.view`; nhập không NCC dùng giá nhập gần nhất; XNT dùng giá trị sổ sách; `isCoil` và chiều hệ số quy đổi theo D-12 | user/khách | Giữ `TODO: confirm` tại các điểm cần bảng định mức/dữ liệu thật; thay đổi sau này phải cập nhật plan và test |
| 14 | Cho phép xoá DB dev cũ `dh_dev` trong container local `postgres_dh_local` (`.env` dev trỏ `dh_dev_b`) | user | Chỉ máy dev, không ảnh hưởng VPS |
| 15 | **Đã duyệt bổ sung phạm vi Plan 05:** quỹ tiền mặt chung hậu kiểm (3 kế toán lập trước; thủ quỹ kiểm tra/trả lại/chốt sau), công nợ cập nhật ngay và tách đã/chưa kiểm tra | user | Chi tiết tại `docs/superpowers/plans/2026-09-27-05-gd2-cash-review-requirements.md`; deploy Task 4–5 đã xanh. Bốn lựa chọn về sửa phiếu/chốt quỹ/chênh lệch/quyền sửa sau kiểm tra vẫn cần xác nhận trước khi viết plan kỹ thuật GĐ2. |

## 8. Quyết định khoá & rulings (tóm tắt)

Bảng đầy đủ D-1…D-22: `docs/superpowers/plans/2026-09-24-00-master-plan.md` mục 1. Thay đổi so với bản gốc:
- **D-1**: Credentials **+ Google** (user yêu cầu). Google chỉ cho tài khoản đã có email khớp, email đã xác minh, chưa khoá; không tự tạo tài khoản;
  phiên Google không bị bắt đổi mật khẩu; mật khẩu tạm hết hạn 72 giờ; đổi/xoá email cắt phiên Google.
- **D-7**: thứ tự FIFO là `(at, class, seq)` — đã thêm cột `stock_ledger.seq` (sequence riêng, UNIQUE) thay vì `(at, id)`; class 0 = nhập thường,
  class 1 = xuất + lớp phụ thuộc (trả hàng, thành phẩm SX). Lớp phụ thuộc không bao giờ bù đơn treo.
- Hạ tầng: SLUG chữ thường; Caddy là container; không cần sudoers/systemctl; DB app dùng role `app_rw` tách `.env` (app) và `.env.migrate`
  (chủ DB + mật khẩu admin khởi tạo) vì owner là superuser.
- `/m/[module]` không có quyền → 404 (nhất quán với catch-all).

## 9. Kiểm tra sức khoẻ nhanh (khi bắt đầu phiên)

```
gh run list -R nhuonggh/FRC_VPS_Danghuong --limit 3
curl -s https://dherp.sheetapp.store/api/health          # {"status":"ok","db":true,...}
ssh -i ~/.ssh/id_ed25519_dherp_claude root@194.233.87.152 'docker ps --filter name=dherp'
```
Dev cục bộ: `docker compose up -d pgtest` (DB test cổng 5434), `npm run lint`, `npm run typecheck`, `rtk proxy npm test` (khoảng 8–10 phút,
126 file / 1473 test), `npm run build`. Lệnh khác: README.

## 10. Bản đồ tài liệu

| Cần gì | Đọc |
|---|---|
| Spec nguồn | `../MASTER_SPEC_TRIEN_KHAI_v2.md` |
| Kế hoạch tổng + quyết định D-1…D-22 + lộ trình task GĐ1–GĐ4 | `docs/superpowers/plans/2026-09-24-00-master-plan.md` |
| Plan đã thực thi | `…-01a…`, `…-01b…`, `…-01c…`, `…-02-gd1a-fifo-engine.md` (cùng thư mục) |
| Plan đã viết, CHƯA thực thi (GĐ1b) | `…-03a-gd1b-catalog-partners-products.md` (Task 1–8), `…-03b-gd1b-purchase-stock.md` (Task 9–15), `…-03c-gd1b-bom-company-home.md` (Task 16–19) — đã commit/merge `main`, chưa code |
| Engine FIFO: hợp đồng, truy vết spec 3.7, giả định khách, khoá | `docs/engine-fifo.md` |
| Auth (Credentials + Google) | `docs/conventions/auth.md`, `docs/infra/RUNBOOK.md` mục 13 |
| Hạ tầng: runbook as-built, checklist xác minh, giá trị, Caddy, sự cố registry | `docs/infra/{RUNBOOK,VERIFY,INPUTS,REGISTRY-GC}.md`, `docs/infra/caddy/dherp.caddy` |
| Quy ước danh sách/UI | `docs/conventions/` |
| Ledger thực thi (rulings, minors hoãn) | `.superpowers/sdd/*/progress.md` — chỉ trên máy dev, git-ignored |
| Skill bắt buộc | `crm-design` (UI), `setup-project` (hạ tầng/deploy) — ở `~/.claude/skills/` của user |
