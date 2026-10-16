/** Thành tiền dòng = SL × đơn giá, làm tròn 2 số rồi LÀM TRÒN LÊN nghìn đồng (356.400 → 357.000). Chiết khấu trừ sau. */
export const roundUpThousand = (v: number) => Math.ceil(Math.round((v + Number.EPSILON) * 100) / 100 / 1000 - 1e-9) * 1000;
export const grossAmount = (qty: number, price: number) => roundUpThousand(qty * price);
