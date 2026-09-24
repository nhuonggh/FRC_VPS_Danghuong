/** Việt Nam là UTC+7 quanh năm (không DST) → dùng độ lệch cố định, không phụ thuộc ICU/timezone của máy chủ. */
export const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface IctParts {
  y: number;
  m: number; // 0–11
  d: number;
  dow: number; // 0 = Thứ Hai … 6 = Chủ nhật
  hh: number;
  mm: number;
}

export function toIct(date: Date): IctParts {
  const t = new Date(date.getTime() + ICT_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    d: t.getUTCDate(),
    dow: (t.getUTCDay() + 6) % 7,
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
  };
}

/** 00:00 ICT của (y, m, d) — m 0–11; m và d được phép tràn (Date.UTC tự chuẩn hoá). */
export function ictStartOfDay(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d) - ICT_OFFSET_MS);
}
