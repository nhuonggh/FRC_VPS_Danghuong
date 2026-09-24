/** Chuẩn hoá để tìm không dấu: NFD bỏ dấu, đ→d, lowercase, gộp khoảng trắng. Dùng cho MỌI đường ghi `searchText`. */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prisma `contains` KHÔNG tự escape ký tự đại diện của LIKE (đã kiểm chứng trên Postgres thật): người dùng gõ "%"
 * sẽ khớp mọi dòng, "_" khớp 1 ký tự bất kỳ. Escape bằng "\" (ký tự escape mặc định của LIKE trong Postgres).
 */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Điều kiện Prisma cho cột `searchText`: mỗi từ khoá phải có mặt (AND), không phụ thuộc thứ tự. Rỗng → `{}` (không lọc). */
export function searchTextWhere(q: string | undefined): { AND: { searchText: { contains: string } }[] } | Record<string, never> {
  const terms = normalizeSearch(q ?? "").split(" ").filter(Boolean);
  if (terms.length === 0) return {};
  return { AND: terms.map((t) => ({ searchText: { contains: escapeLike(t) } })) };
}
