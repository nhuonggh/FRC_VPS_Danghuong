# Mẫu trang danh sách (crm-design)

Server page lấy dữ liệu theo URL → client table nhận DTO đã lọc field theo quyền.

```tsx
// src/app/(app)/<module>/<function>/page.tsx
const FILTER_KEYS = ["status", "role"] as const;                                  // key filter phải khai báo
const actor = await requireActor("<perm>.view");
const params = parseListParams(await searchParams, FILTER_KEYS);
const range = listTimeRange(params);                                              // null = không lọc thời gian
const where = {
  ...searchTextWhere(params.q),                                                   // tìm không dấu, đã escape % _ \
  // ...filter theo params.filters
  ...(range ? { <dateField>: timeRangeWhere(range) } : {}),                       // nửa mở [gte, lt) theo ICT
};
const [rows, total] = await Promise.all([
  prisma.<model>.findMany({
    where,
    orderBy: sortToOrderBy(params.sort, ["fullName", "username"], { id: "desc" }), // chỉ cột cho phép
    skip: (params.page - 1) * params.pageSize,
    take: params.pageSize,
  }),
  prisma.<model>.count({ where }),
]);
return (
  <ListPageLayout title="…" actions={<>Thêm mới · Import (danh mục nền) · <ExportButton href={buildExportHref("/api/<module>/export", params)} /></>}
    stats={/* StatCard số đếm KHÔNG áp filter trạng thái đang chọn */}
    filters={<><SearchBox basePath="/path" params={params} /><QuickTimeFilter basePath="/path" params={params} /></>}
    footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize}
              buildHref={(patch) => buildListHref("/path", params, patch)} />}>
    {total === 0 ? <EmptyState … /> : <XxxTable rows={redactDeep(rows, actor.perms)} … />}
  </ListPageLayout>
);
```

## Quy tắc

- 3 loại empty state (chưa có dữ liệu / lọc không ra / lỗi); nút Thêm mới luôn hiện kể cả khi rỗng.
- Trang có cột ngày nghiệp vụ PHẢI có `QuickTimeFilter` (đủ 10 mốc) với where-clause đúng field ngày đó; bảng danh mục không có ngày nghiệp vụ thì không cần.
- Cột nhạy cảm bị loại ở server bằng `redactDeep`, không ẩn bằng CSS.
- Mọi link/nút đổi lọc, tìm, sort, cỡ trang dựng bằng `buildListHref` — nó tự về trang 1 khi lọc/sort/cỡ trang đổi. Không tự ghép query string.
- `searchText` của bản ghi PHẢI ghi bằng `normalizeSearch(...)` ở MỌI đường ghi (tạo, sửa, import, seed).

## Hợp đồng Export Excel

- Nút `ExportButton` nhận `href` dựng bằng `buildExportHref(exportPath, params)`: mang theo `q`, filter, `sort`, `timePreset/timeStart/timeEnd`; KHÔNG mang `page`/`pageSize` (xuất toàn bộ tập đã lọc).
- Route handler export phải: `requireActor("<perm>.export")` → `parseListParams(searchParams, FILTER_KEYS)` (cùng `FILTER_KEYS` với trang) → dựng `where` bằng ĐÚNG các hàm như trang danh sách (`searchTextWhere`, `listTimeRange` + `timeRangeWhere`, filter) → `redactDeep` theo quyền → `buildXlsx(...)` → `xlsxResponse(...)`. Export không được rộng hơn những gì người dùng thấy trên trang.
- Cột mã (mã hàng, mã vạch, SĐT, số chứng từ có số 0 đầu) khai báo `text: true` để lưu là chữ; cột số/tiền dùng `numFmt`. `buildXlsx` tự tiền tố dấu nháy cho ô chữ bắt đầu bằng `= + - @` (chống công thức tiêm nhiễm) và xoá ô cho `null`/`undefined` (không thành `0`).
- `timePreset=custom` thiếu ngày hoặc đảo ngược → `listTimeRange` trả `null` = không lọc thời gian (UI báo cho người dùng).
- **Trần số dòng (ví dụ Nhật ký thao tác, mã 5):** export đặt trần `MAX_EXPORT_ROWS` = **10.000** dòng MỚI NHẤT (`src/server/audit/export.ts`). App chạy 1 tiến trình Node: bản đầu (50.000 dòng, 1 `findMany` + workbook trong bộ nhớ) đo ~10 giây và làm nghẽn mọi request khác; hiện đọc DB theo lô 500 dòng bằng con trỏ, ghi bằng `buildXlsxBatched` (ExcelJS WorkbookWriter, stream) và `setImmediate` giữa các lô → 10.000 dòng ≈ 1,6 s, nhịp event loop trễ nhất ≈ 0,12 s (`tests/audit/perf.test.ts`). Vượt trần → dòng ghi chú GỘP Ô trên mọi cột ở cuối file ("Chỉ xuất 10.000 dòng mới nhất … hãy thu hẹp bộ lọc"), header `X-Export-Truncated: 1` + `X-Export-Max-Rows: 10000`, và trang hiện cảnh báo cạnh nút Xuất Excel khi tổng > trần. Export nhật ký luôn theo thời gian giảm dần (bỏ qua `sort`) để "N dòng mới nhất" đúng nghĩa. Bảng khác muốn xuất lớn: dùng `buildXlsxBatched` + đo trước, đừng copy trần này.
- **Hiệu năng danh sách lớn:** index sẵn có `(at)` đủ cho phân trang offset 50.000 dòng ≤ 60 ms (đo trong `tests/audit/perf.test.ts`); danh sách lớn lọc bằng `groupBy` ở DB thay vì `distinct` (Prisma xử lý `distinct` trong bộ nhớ). Chỉ chuyển keyset khi test perf vượt ngưỡng.
- **Chạy test với múi giờ khác (Windows):** Node trên Windows chỉ nhận tên múi giờ kiểu POSIX (`TZ=UTC`, `TZ=PST8PDT`); tên IANA như `America/Los_Angeles` bị bỏ qua và máy vẫn ở giờ Việt Nam (kiểm bằng `new Date(0).getTimezoneOffset()`: UTC → 0, PST8PDT → 480, tên IANA → -420). Logic ICT của app không dựa múi giờ máy, nên cần chứng minh bằng `TZ=UTC`/`TZ=PST8PDT`.
