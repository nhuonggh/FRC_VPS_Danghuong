export class DomainError extends Error {
  constructor(message: string, public readonly status = 409, public readonly code?: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, public readonly fields?: Record<string, string>) {
    super(message, 400, "VALIDATION");
    this.name = "ValidationError";
  }
}

/** 409 gắn với field cụ thể (vd email đã dùng) — phản hồi kèm `fields` để form báo lỗi ngay tại ô. */
export class FieldConflictError extends DomainError {
  constructor(message: string, public readonly fields: Record<string, string>) {
    super(message, 409, "CONFLICT");
    this.name = "FieldConflictError";
  }
}

export class UnauthorizedError extends DomainError {
  constructor() {
    super("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}
