import { DomainError } from "@/server/http/errors";

export class PeriodClosedError extends DomainError {
  constructor() {
    super("Chứng từ thuộc kỳ đã kết sổ, không sửa/hủy được.", 409, "PERIOD_CLOSED");
    this.name = "PeriodClosedError";
  }
}

export class DocDateBeforePeriodError extends DomainError {
  constructor() {
    super("Ngày chứng từ trước ngày mở kỳ hiện tại, không ghi vào kỳ này được.", 409, "DOC_DATE_BEFORE_PERIOD");
    this.name = "DocDateBeforePeriodError";
  }
}

export class InvalidQuantityError extends DomainError {
  constructor() {
    super("Số lượng phải lớn hơn 0.", 400, "INVALID_QTY");
    this.name = "InvalidQuantityError";
  }
}

export class InvalidCostError extends DomainError {
  constructor() {
    super("Giá vốn không được âm.", 400, "INVALID_COST");
    this.name = "InvalidCostError";
  }
}

export class InvalidCostRefError extends DomainError {
  constructor() {
    super("Số lượng của dòng chứng từ gốc (để tính giá vốn) phải lớn hơn 0.", 400, "INVALID_COST_REF");
    this.name = "InvalidCostRefError";
  }
}

export class DerivedLayerCostError extends DomainError {
  constructor() {
    super("Giá vốn lớp trả hàng/thành phẩm do hệ thống tính theo chứng từ gốc, không sửa tay được.", 409, "DERIVED_LAYER_COST");
    this.name = "DerivedLayerCostError";
  }
}

export class DerivedLayerDateError extends DomainError {
  constructor() {
    super("Chứng từ nhập theo giá chứng từ gốc (trả hàng/thành phẩm) phải có thời điểm KHÔNG TRƯỚC chứng từ gốc.", 409, "DERIVED_LAYER_DATE");
    this.name = "DerivedLayerDateError";
  }
}

export class DerivedLayerOrderError extends DomainError {
  constructor() {
    super("Chứng từ gốc phải được ghi TRƯỚC chứng từ nhập theo giá của nó (trả hàng/thành phẩm).", 409, "DERIVED_LAYER_ORDER");
    this.name = "DerivedLayerOrderError";
  }
}

export class InvalidCostRefTypeError extends DomainError {
  constructor() {
    super("Chứng từ gốc để tính giá vốn phải là chứng từ XUẤT kho (bán, dùng NVL…).", 400, "INVALID_COST_REF_TYPE");
    this.name = "InvalidCostRefTypeError";
  }
}

export class InvalidDocDateError extends DomainError {
  constructor(message: string) {
    super(message, 400, "INVALID_DOC_DATE");
    this.name = "InvalidDocDateError";
  }
}

export class ProductRecomputingError extends DomainError {
  constructor() {
    super("Mã hàng đang được tính lại giá vốn, vui lòng thử lại sau ít phút.", 409, "PRODUCT_RECOMPUTING");
    this.name = "ProductRecomputingError";
  }
}

/**
 * Giao dịch kho bị Postgres hủy vì deadlock và đã hết lượt tự chạy lại (retryOnDeadlock) — tranh chấp tạm thời giữa
 * các giao dịch cùng đụng NVL dùng chung, KHÔNG phải lỗi dữ liệu. Người dùng / worker chỉ cần thử lại. Lỗi gốc ở `cause`.
 */
export class EngineBusyError extends DomainError {
  constructor(cause?: unknown) {
    super("Kho đang bận xử lý giao dịch khác trên cùng mã hàng, vui lòng thử lại sau giây lát.", 409, "INVENTORY_BUSY");
    this.name = "EngineBusyError";
    if (cause !== undefined) this.cause = cause;
  }
}

export class DependentDocumentsError extends DomainError {
  constructor() {
    super(
      "Không hủy/sửa được: đã có chứng từ (trả hàng, thành phẩm sản xuất) dựa trên giá vốn của chứng từ này. Hãy xử lý chứng từ đó trước.",
      409,
      "DEPENDENT_DOCUMENTS",
    );
    this.name = "DependentDocumentsError";
  }
}

// Lỗi lập trình / dữ liệu hỏng: KHÔNG phải DomainError → route trả 500 chung, log đầy đủ.
export class ProductNotLockedError extends Error {
  constructor(public readonly productId: number) {
    super(`Mã hàng ${productId} chưa được khoá — phải liệt kê trong 'products' của withInventoryTx.`);
    this.name = "ProductNotLockedError";
  }
}

export class ReplayTooLargeError extends Error {
  constructor(
    public readonly productId: number,
    public readonly eventCount: number,
  ) {
    super(`Tính lại mã hàng ${productId} chạm ${eventCount} sự kiện — vượt ngưỡng đồng bộ.`);
    this.name = "ReplayTooLargeError";
  }
}

export class EngineInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineInvariantError";
  }
}
