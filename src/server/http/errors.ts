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

export class UnauthorizedError extends DomainError {
  constructor() {
    super("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}
