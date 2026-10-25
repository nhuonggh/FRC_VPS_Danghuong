/** Người ứng tiền trong ô chọn: người dùng hệ thống = id dương, lái xe/phụ xe (không có tài khoản) = id ÂM (−driverId). */
export const advancerFields = (opt: { value: number | string } | null): { advancedById: number | null; advancedByDriverId: number | null } => {
  const v = opt ? Number(opt.value) : 0;
  return { advancedById: v > 0 ? v : null, advancedByDriverId: v < 0 ? -v : null };
};
