import { Download } from "lucide-react";

/**
 * Nút Export Excel: trỏ tới route handler xuất file của module. `href` phải dựng bằng `buildExportHref(path, params)`
 * để xuất ĐÚNG tập đang lọc (q/filter/sort/thời gian), không kèm phân trang.
 */
export function ExportButton({ href }: { href: string }) {
  return (
    <a href={href} download className="flex h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover">
      <Download size={16} aria-hidden /> Xuất Excel
    </a>
  );
}
