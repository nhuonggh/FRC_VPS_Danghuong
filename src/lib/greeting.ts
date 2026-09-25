import { toIct } from "./time";

export type Greeting = "Chào buổi sáng" | "Chào buổi trưa" | "Chào buổi chiều" | "Chào buổi tối";

/**
 * Lời chào theo GIỜ VIỆT NAM (ICT), không phụ thuộc múi giờ máy chủ/trình duyệt.
 * 05–10h sáng, 11–12h trưa, 13–17h chiều, còn lại (18h → 4h59, gồm ca đêm) là tối.
 */
export function greeting(now: Date): Greeting {
  const h = toIct(now).hh;
  if (h >= 5 && h < 11) return "Chào buổi sáng";
  if (h >= 11 && h < 13) return "Chào buổi trưa";
  if (h >= 13 && h < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}
