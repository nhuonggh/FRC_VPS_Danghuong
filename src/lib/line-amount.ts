/**
 * Thành tiền dòng = SL × đơn giá, làm tròn 2 số rồi (nếu đơn bật làm tròn) LÀM TRÒN LÊN nghìn đồng (356.400 → 357.000).
 * Đơn tắt làm tròn: giữ SL × đơn giá (2 số thập phân). Chiết khấu trừ sau.
 */
export const roundUpThousand = (v: number) => Math.ceil(Math.round((v + Number.EPSILON) * 100) / 100 / 1000 - 1e-9) * 1000 || 0;
export const grossAmount = (qty: number, price: number, roundUp = true) =>
  roundUp ? roundUpThousand(qty * price) : Math.round((qty * price + Number.EPSILON) * 100) / 100;
