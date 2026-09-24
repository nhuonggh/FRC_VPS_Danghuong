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
- **Trần số dòng (ví dụ Nhật ký thao tác, mã 5):** export có thể đặt trần (`MAX_EXPORT_ROWS` = 50.000 dòng MỚI NHẤT, `src/server/audit/export.ts`). Vượt trần → file có dòng ghi chú cuối "Chỉ xuất N dòng mới nhất … hãy thu hẹp bộ lọc", header `X-Export-Truncated: 1`, và trang hiện cảnh báo cạnh nút Xuất Excel khi tổng > trần. Export nhật ký luôn theo thời gian giảm dần (bỏ qua `sort`) để "N dòng mới nhất" đúng nghĩa. Xuất 50.000 dòng có payload JSON mất ~10 giây (ExcelJS) — chỉ dùng cho nhật ký, không copy trần này cho bảng khác mà không đo.
- **Hiệu năng danh sách lớn:** index sẵn có `(at)` đủ cho phân trang offset 50.000 dòng ≤ 60 ms (đo trong `tests/audit/perf.test.ts`); danh sách lớn lọc bằng `groupBy` ở DB thay vì `distinct` (Prisma xử lý `distinct` trong bộ nhớ). Chỉ chuyển keyset khi test perf vượt ngưỡng.
