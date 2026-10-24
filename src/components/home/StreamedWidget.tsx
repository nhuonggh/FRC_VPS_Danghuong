import { prisma } from "@/lib/prisma";
import { loadWidget } from "@/server/home/queries";
import type { WidgetSpec } from "@/server/home/types";
import { WidgetCard } from "./WidgetCard";

/** Tự chạy truy vấn của MỘT widget (bọc trong <Suspense>): widget chậm không chặn phần còn lại của trang chủ. */
export async function StreamedWidget({ spec }: { spec: WidgetSpec }) {
  const state = await loadWidget(prisma, spec);
  return <WidgetCard spec={spec} state={state} />;
}
