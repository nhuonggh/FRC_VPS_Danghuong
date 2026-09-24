import type { PermissionCode } from "./catalog";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(public readonly code: string) {
    super(`Bạn không có quyền thực hiện thao tác này (${code}).`);
    this.name = "ForbiddenError";
  }
}

/** Mặc định từ chối: chỉ true khi tập quyền chứa đúng mã này. */
export function can(perms: ReadonlySet<string>, code: PermissionCode): boolean {
  return perms.has(code);
}

export function assertCan(perms: ReadonlySet<string>, code: PermissionCode): void {
  if (!can(perms, code)) throw new ForbiddenError(code);
}
