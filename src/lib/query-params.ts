import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "./pagination";
import { parseYmd, resolveTimeRange, TIME_PRESETS, type TimePreset, type TimeRange } from "./time-presets";

export interface ListParams {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
  timePreset?: TimePreset;
  timeStart?: string;
  timeEnd?: string;
  filters: Record<string, string[]>;
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Trang tối đa: (1.000.000 − 1) × 100 dòng/trang vẫn nằm trong Int32 của `skip` (Prisma). */
export const MAX_PAGE = 1_000_000;
/** Độ dài tối đa của ô tìm kiếm (chặn URL/điều kiện AND phình to). */
export const MAX_QUERY_LENGTH = 200;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PRESETS = new Set<string>(TIME_PRESETS.map((p) => p.value));
// '-tên' = giảm dần. Chỉ là bước lọc rác đầu vào; danh sách cột được phép thật sự do sortToOrderBy quyết định.
const SORT_RE = /^-?[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const isPageSize = (n: number) => (PAGE_SIZES as readonly number[]).includes(n);
const parsePage = (raw: string | undefined) => {
  if (raw === undefined || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  return n >= 1 && n <= MAX_PAGE ? n : 1;
};

/** Chuẩn query-param của crm-design (global-rules.md mục 5). Giá trị rác → mặc định; key filter phải khai báo. */
export function parseListParams(sp: SearchParams, filterKeys: readonly string[] = []): ListParams {
  const sizeRaw = first(sp.pageSize);
  const sizeNum = sizeRaw !== undefined && /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : NaN;
  const out: ListParams = {
    page: parsePage(first(sp.page)),
    pageSize: isPageSize(sizeNum) ? sizeNum : DEFAULT_PAGE_SIZE,
    filters: {},
  };
  const sort = first(sp.sort)?.trim();
  if (sort && SORT_RE.test(sort)) out.sort = sort;
  const q = first(sp.q)?.trim().slice(0, MAX_QUERY_LENGTH).trim();
  if (q) out.q = q;
  const preset = first(sp.timePreset);
  if (preset && PRESETS.has(preset)) out.timePreset = preset as TimePreset;
  const ts = first(sp.timeStart);
  const te = first(sp.timeEnd);
  if (parseYmd(ts)) out.timeStart = ts;
  if (parseYmd(te)) out.timeEnd = te;
  for (const key of filterKeys) {
    if (!Object.prototype.hasOwnProperty.call(sp, key)) continue;
    const raw = sp[key];
    if (raw === undefined) continue;
    const values = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    if (values.length) out.filters[key] = values;
  }
  return out;
}

export interface ListPatch {
  page?: number;
  pageSize?: number;
  sort?: string | undefined;
  q?: string | undefined;
  timePreset?: TimePreset | undefined;
  timeStart?: string | undefined;
  timeEnd?: string | undefined;
  /** Gộp theo từng key; mảng rỗng = bỏ bộ lọc đó. */
  filters?: Record<string, string[]>;
}

/**
 * Dựng URL giữ nguyên query hiện tại + patch. Bỏ khoá = mặc định.
 * Đổi lọc/tìm/sort/thời gian/cỡ trang → LUÔN về trang 1 (trừ khi patch chỉ định `page` tường minh).
 * `pageSize` ngoài tập cho phép bị bỏ qua; `page` < 1 hoặc không phải số → 1.
 */
export function buildListHref(basePath: string, current: ListParams, patch: ListPatch): string {
  const has = (k: keyof ListPatch) => Object.prototype.hasOwnProperty.call(patch, k);
  const next: ListParams = { ...current, filters: { ...current.filters } };
  let resetPage = false;

  if (has("sort")) { next.sort = patch.sort; resetPage = true; }
  if (has("q")) { next.q = patch.q; resetPage = true; }
  if (has("timePreset")) { next.timePreset = patch.timePreset; resetPage = true; }
  if (has("timeStart")) { next.timeStart = patch.timeStart; resetPage = true; }
  if (has("timeEnd")) { next.timeEnd = patch.timeEnd; resetPage = true; }
  if (patch.filters) {
    for (const [k, v] of Object.entries(patch.filters)) {
      if (v.length) next.filters[k] = v; else delete next.filters[k];
    }
    resetPage = true;
  }
  if (patch.pageSize !== undefined && isPageSize(patch.pageSize)) {
    next.pageSize = patch.pageSize;
    resetPage = true;
  }
  if (patch.page !== undefined) next.page = Number.isFinite(patch.page) ? Math.max(1, Math.floor(patch.page)) : 1;
  else if (resetPage) next.page = 1;

  const qs = new URLSearchParams();
  if (next.q) qs.set("q", next.q);
  for (const [k, v] of Object.entries(next.filters)) qs.set(k, v.join(","));
  if (next.sort) qs.set("sort", next.sort);
  if (next.timePreset) qs.set("timePreset", next.timePreset);
  if (next.timeStart) qs.set("timeStart", next.timeStart);
  if (next.timeEnd) qs.set("timeEnd", next.timeEnd);
  if (next.pageSize !== DEFAULT_PAGE_SIZE) qs.set("pageSize", String(next.pageSize));
  if (next.page > 1) qs.set("page", String(next.page));
  const s = qs.toString(); // dấu phẩy được mã hoá thành %2C
  const join = basePath.includes("?") ? "&" : "?";
  return s ? `${basePath}${join}${s}` : basePath;
}

/**
 * HỢP ĐỒNG EXPORT: nút Xuất Excel trỏ tới route handler của module với ĐÚNG q/filter/sort/thời gian đang xem
 * (bỏ page/pageSize — xuất toàn bộ tập đã lọc). Route handler đọc lại bằng `parseListParams` cùng `filterKeys` và
 * dựng where-clause bằng đúng hàm của trang danh sách (`searchTextWhere`, `listTimeRange` + `timeRangeWhere`).
 */
export function buildExportHref(exportPath: string, params: ListParams): string {
  return buildListHref(exportPath, { ...params, page: 1, pageSize: DEFAULT_PAGE_SIZE }, {});
}

/** Khoảng thời gian đang chọn của trang danh sách; chưa chọn hoặc `custom` không hợp lệ → null (KHÔNG lọc thời gian). */
export function listTimeRange(params: ListParams, now: Date = new Date()): TimeRange | null {
  if (!params.timePreset) return null;
  return resolveTimeRange(params.timePreset, now, { start: params.timeStart, end: params.timeEnd });
}

/** '-name' → { name: 'desc' }; chỉ cột trong `allowed` (chặn sort theo cột nhạy cảm/không tồn tại). */
export function sortToOrderBy<F extends Record<string, "asc" | "desc">>(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: F,
): Record<string, "asc" | "desc"> {
  if (!sort) return fallback;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  return allowed.includes(key) ? { [key]: desc ? "desc" : "asc" } : fallback;
}
