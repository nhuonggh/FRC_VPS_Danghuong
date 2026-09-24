/** Chuẩn hoá để tìm không dấu: NFD bỏ dấu, đ→d, lowercase, gộp khoảng trắng. */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
