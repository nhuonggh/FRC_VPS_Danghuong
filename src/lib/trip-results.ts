import type { TripStatus } from "@prisma/client";
import { TRIP_STATUS_LABEL } from "@/server/trips/schemas";

export const RESULT_TRIP_TABS: { key: string; label: string; statuses: TripStatus[]; tone: "info" | "warning" | "success" | "danger" }[] = [
  { key: "all", label: "Tất cả", statuses: [], tone: "info" },
  { key: "planned", label: "Đã xếp", statuses: ["PLANNED"], tone: "info" },
  { key: "going", label: "Đang giao", statuses: ["ON_ROAD"], tone: "warning" },
  { key: "done", label: "Hoàn tất kết quả", statuses: ["RETURNED", "SETTLED", "CONFIRMED"], tone: "success" },
  { key: "void", label: "Đã hủy", statuses: ["CANCELLED"], tone: "danger" },
];
export const RESULT_STATUS_TONE = { PLANNED: "info", ON_ROAD: "warning", RETURNED: "success", SETTLED: "success", CONFIRMED: "success", CANCELLED: "danger" } as const;
export function resultTripLabel(status: TripStatus) {
  return status === "ON_ROAD" ? "Đang giao" : status === "RETURNED" ? "Hoàn tất kết quả" : TRIP_STATUS_LABEL[status];
}
