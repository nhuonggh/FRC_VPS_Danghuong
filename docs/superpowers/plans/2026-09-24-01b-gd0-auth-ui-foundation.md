# GĐ0b — Đăng nhập, nền UI, khung bảng danh sách Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng đăng nhập được bằng tài khoản/mật khẩu, thấy khung ứng dụng chuẩn `crm-design` (token dark/light/hệ thống, sidebar 3 cấp sinh từ 1 nguồn config, bảng danh sách server-paginated), và có sẵn lớp truy vấn danh sách dùng lại cho mọi module (URL params, tìm không dấu, lọc thời gian theo giờ Việt Nam, xuất Excel).

**Architecture:** Auth = next-auth v4 Credentials, JWT chỉ giữ `userId`; quyền và trạng thái khoá đọc từ DB mỗi request (khoá tài khoản có hiệu lực ngay). UI theo `crm-design`: token CSS ở `src/styles/tokens.css` (chép nguyên từ skill) + override 1 file, Tailwind 3.4 map token, KHÔNG hex/`dark:` trong component (có test rà). Danh sách = server component lấy dữ liệu + client component bảng nhận DTO đã lọc quyền.

**Tech Stack:** Next.js 15, next-auth 4, Tailwind 3.4, Radix (dialog, dropdown), lucide-react, exceljs, Vitest + Testing Library (jsdom).

**Spec:** `docs/spec/MASTER_SPEC_TRIEN_KHAI_v2.md` (mục 1–4 Phần 7-M1, Phần 13). Master plan `2026-09-24-00-master-plan.md` (Global Constraints, D-1, D-5, D-6, D-9). Skill: `crm-design` (`theming.md`, `global-rules.md`, `navigation-*.md`, `view-table.md`, `buttons-and-cards.md`).

## Global Constraints

Chép từ master plan — áp cho mọi task ở đây:

- Token hoá toàn bộ: không hex hardcode, không `dark:` rời rạc, không tham chiếu `--gray-*` trong component (test rà ở Task 7).
- Số/tiền: phân cách nghìn `.`, thập phân `,`, `tabular-nums`, căn phải; ngày `dd/mm/yyyy`; ngày giờ `HH:mm dd/mm/yyyy`; **`null` → `—`, không bao giờ `0`**.
- Múi giờ `Asia/Ho_Chi_Minh` (UTC+7) cho mọi ranh giới ngày/tuần/tháng/quý/năm; tuần bắt đầu thứ Hai.
- Vùng cuộn duy nhất của trang là `.app-shell-main`; footer phân trang dính đáy bằng flex-fill.
- Breakpoint: `<768` mobile (Bottom Nav), `768–1023` tablet, `≥1024` PC (D-5: nghiệm thu trên máy tính, cơ chế mobile nằm sẵn trong component chung).
- Quyền: menu ẩn hẳn khi không có quyền; route guard 403; JWT không chứa quyền.
- Mỗi task kết thúc: `npm run lint && npm run typecheck && npm test` xanh rồi commit.

## Review Focus (phần thuộc plan này)

- Tìm `ton lanh` / `TÔN  LẠNH ` ra "Tôn lạnh màu 0.45" (Task 10 — `normalizeSearch` + test DB).
- Đơn 23:50 ICT ngày 30/09 thuộc "Hôm nay"/"Tháng này" của 30/09; 00:00 ICT 01/10 sang tháng mới; "Tuần này" bắt đầu thứ Hai (Task 10 — presets).
- Tài khoản bị khoá đang có phiên → request kế tiếp mất quyền ngay (Task 6 — `loadActor`).
- Thời gian phản hồi không lộ tên đăng nhập có tồn tại hay không (Task 6 — hash giả).
- Số `0` không bị hiển thị thành `—` và `null` không bị hiển thị thành `0` (Task 7 — `format`).

---

## File Structure (plan này tạo)

| File | Trách nhiệm |
|---|---|
| `src/server/auth/{password,credentials,actor,session}.ts` | băm/kiểm mật khẩu, xác thực, nạp `SessionActor`, lấy actor từ session |
| `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/middleware.ts`, `src/types/next-auth.d.ts` | next-auth v4 + chặn route chưa đăng nhập |
| `tailwind.config.ts`, `postcss.config.mjs`, `src/styles/tokens.css`, `design/app-override.css`, `src/app/globals.css`, `src/app/layout.tsx` | nền token + Tailwind + font + chống FOUC |
| `src/lib/{format,time,theme}.ts`, `src/components/shell/ThemeSwitch.tsx` | định dạng, múi giờ ICT, chuyển theme |
| `tests/design/no-hardcoded-colors.test.ts` | rà token discipline |
| `src/config/app.config.ts`, `src/lib/nav.ts`, `src/components/shell/*` | 1 nguồn Module→Category→Function → Sidebar/Landing/Breadcrumb/BottomNav |
| `design/PROJECT_BRIEF.md` | đầu vào `crm-design` cho các plan sau |
| `src/components/ui/{Badge,StatCard,EmptyState,PaginationFooter,DataTable,ListPageLayout,index}.tsx` | khung danh sách |
| `src/lib/{query-params,search,time-presets}.ts`, `src/components/ui/{QuickTimeFilter,ExportButton}.tsx`, `src/server/export/xlsx.ts` | lớp truy vấn danh sách |

---

### Task 6: Đăng nhập Credentials (lõi xác thực, chưa có giao diện)

**Files:**
- Create: `src/server/auth/password.ts`, `src/server/auth/credentials.ts`, `src/server/auth/actor.ts`, `src/server/auth/session.ts`
- Create: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/middleware.ts`, `src/types/next-auth.d.ts`
- Test: `tests/auth/password.test.ts`, `tests/auth/credentials.test.ts`, `tests/auth/actor.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@/lib/prisma`), `resolveRolePermissions` (dùng trong test qua `seed`).
- Produces:
  - `hashPassword(plain): Promise<string>`, `verifyPassword(plain, hash): Promise<boolean>`, `validatePasswordStrength(plain, username?): string | null`, `generateTempPassword(len?): string`
  - `verifyCredentials(prisma, username, password): Promise<{ok:true; user:{id:number; fullName:string}} | {ok:false; reason:"INVALID"|"LOCKED"}>`
  - `interface SessionActor { userId:number; username:string; fullName:string; perms: ReadonlySet<string>; mustChangePassword:boolean }`, `loadActor(prisma, userId): Promise<SessionActor|null>` (null nếu không tồn tại hoặc bị khoá)
  - `getActor(): Promise<SessionActor|null>`, `requireActor(perm?: PermissionCode): Promise<SessionActor>` (chưa đăng nhập → `redirect("/login")`; thiếu quyền → `redirect("/403")`)

- [ ] **Step 1: Test mật khẩu (đỏ)**

`tests/auth/password.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  generateTempPassword, hashPassword, validatePasswordStrength, verifyPassword,
} from "@/server/auth/password";

describe("password", () => {
  it("băm rồi kiểm đúng/sai", async () => {
    const h = await hashPassword("Abc12345");
    expect(h).not.toContain("Abc12345");
    expect(await verifyPassword("Abc12345", h)).toBe(true);
    expect(await verifyPassword("abc12345", h)).toBe(false);
  });

  it.each([
    ["Ab1", "Mật khẩu tối thiểu 8 ký tự."],
    ["abcdefgh", "Mật khẩu phải có cả chữ và số."],
    ["12345678", "Mật khẩu phải có cả chữ và số."],
    ["Nam12345", "Mật khẩu không được chứa tên đăng nhập."],
  ])("từ chối mật khẩu yếu %s", (pw, msg) => {
    expect(validatePasswordStrength(pw, "nam")).toBe(msg);
  });

  it("chấp nhận mật khẩu đủ mạnh", () => {
    expect(validatePasswordStrength("Xuong2026", "nam")).toBeNull();
  });

  it("mật khẩu tạm: đủ dài, có chữ + số, không ký tự dễ nhầm, mỗi lần khác nhau", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(12);
      expect(validatePasswordStrength(p)).toBeNull();
      expect(p).not.toMatch(/[0OIl1]/);
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });
});
```

- [ ] **Step 2: Chạy → đỏ; cài `password.ts`**

Run: `npm test -- tests/auth/password.test.ts` → FAIL thiếu module.

`src/server/auth/password.ts`:
```ts
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const COST = 10;

export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Trả thông báo lỗi tiếng Việt, hoặc null nếu hợp lệ. */
export function validatePasswordStrength(plain: string, username?: string): string | null {
  if (plain.length < 8) return "Mật khẩu tối thiểu 8 ký tự.";
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) return "Mật khẩu phải có cả chữ và số.";
  if (username && plain.toLowerCase().includes(username.toLowerCase())) {
    return "Mật khẩu không được chứa tên đăng nhập.";
  }
  return null;
}

// Bỏ ký tự dễ nhầm (0/O, 1/l/I) vì mật khẩu tạm được đọc qua điện thoại cho nhân viên
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generateTempPassword(len = 12): string {
  let out = "";
  do {
    out = Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  } while (validatePasswordStrength(out) !== null);
  return out;
}
```
Run: `npm test -- tests/auth/password.test.ts` → PASS.

- [ ] **Step 3: Test xác thực + actor (đỏ)**

`tests/auth/credentials.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { verifyCredentials } from "@/server/auth/credentials";
import { hashPassword } from "@/server/auth/password";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(resetDb);

describe("verifyCredentials", () => {
  it("đúng tài khoản + mật khẩu → ok", async () => {
    await makeUser({ username: "nam", fullName: "Nguyễn Nam", passwordHash: await hashPassword("Xuong2026") });
    const r = await verifyCredentials(prisma, "nam", "Xuong2026");
    expect(r).toEqual({ ok: true, user: { id: expect.any(Number), fullName: "Nguyễn Nam" } });
  });

  it("tên đăng nhập không phân biệt hoa thường, bỏ khoảng trắng đầu/cuối", async () => {
    await makeUser({ username: "nam", passwordHash: await hashPassword("Xuong2026") });
    expect((await verifyCredentials(prisma, "  NAM ", "Xuong2026")).ok).toBe(true);
  });

  it("sai mật khẩu hoặc không có tài khoản → INVALID (cùng một lý do)", async () => {
    await makeUser({ username: "nam", passwordHash: await hashPassword("Xuong2026") });
    expect(await verifyCredentials(prisma, "nam", "sai")).toEqual({ ok: false, reason: "INVALID" });
    expect(await verifyCredentials(prisma, "khong-co", "Xuong2026")).toEqual({ ok: false, reason: "INVALID" });
  });

  it("tài khoản bị khoá + đúng mật khẩu → LOCKED; sai mật khẩu vẫn INVALID (không lộ trạng thái)", async () => {
    await makeUser({ username: "nam", isLocked: true, passwordHash: await hashPassword("Xuong2026") });
    expect(await verifyCredentials(prisma, "nam", "Xuong2026")).toEqual({ ok: false, reason: "LOCKED" });
    expect(await verifyCredentials(prisma, "nam", "sai")).toEqual({ ok: false, reason: "INVALID" });
  });

  it("không có user vẫn tốn thời gian băm (không lộ tài khoản tồn tại qua độ trễ)", async () => {
    await makeUser({ username: "nam", passwordHash: await hashPassword("Xuong2026") });
    const t = async (u: string) => {
      const s = performance.now();
      await verifyCredentials(prisma, u, "Sai-mat-khau-1");
      return performance.now() - s;
    };
    await t("nam"); // khởi động nguội
    const known = await t("nam");
    const unknown = await t("khong-co");
    expect(unknown).toBeGreaterThan(known * 0.5); // cùng bậc độ lớn, không phản hồi tức thì
  });
});
```
`tests/auth/actor.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { loadActor } from "@/server/auth/actor";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(resetDb);

async function userWithRole(roleName: string, over = {}) {
  await seed(prisma);
  const u = await makeUser(over);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
  return u;
}

describe("loadActor", () => {
  it("gộp quyền từ vai trò", async () => {
    const u = await userWithRole("Thủ kho");
    const a = await loadActor(prisma, u.id);
    expect(a!.perms.has("stock.view")).toBe(true);
    expect(a!.perms.has("cost.view")).toBe(false);
  });

  it("gộp quyền của NHIỀU vai trò", async () => {
    const u = await userWithRole("Thủ kho");
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ quỹ" } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    const a = await loadActor(prisma, u.id);
    expect(a!.perms.has("stock.view")).toBe(true);
    expect(a!.perms.has("receipt.manage")).toBe(true);
  });

  it("khoá tài khoản có hiệu lực NGAY: phiên cũ không còn actor", async () => {
    const u = await userWithRole("Kế toán");
    expect(await loadActor(prisma, u.id)).not.toBeNull();
    await prisma.user.update({ where: { id: u.id }, data: { isLocked: true } });
    expect(await loadActor(prisma, u.id)).toBeNull();
  });

  it("admin đổi quyền vai trò → request kế tiếp thấy ngay (không cache trong JWT)", async () => {
    const u = await userWithRole("Thủ kho");
    const perm = await prisma.permission.findUniqueOrThrow({ where: { code: "cost.view" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ kho" } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    expect((await loadActor(prisma, u.id))!.perms.has("cost.view")).toBe(true);
  });

  it("user không tồn tại → null; mustChangePassword được phản ánh", async () => {
    expect(await loadActor(prisma, 99999)).toBeNull();
    const u = await userWithRole("Kế toán", { mustChangePassword: true });
    expect((await loadActor(prisma, u.id))!.mustChangePassword).toBe(true);
  });
});
```

- [ ] **Step 4: Chạy → đỏ; cài `credentials.ts`, `actor.ts`**

Run: `npm test -- tests/auth` → FAIL thiếu module.

`src/server/auth/credentials.ts`:
```ts
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { verifyPassword } from "./password";

export type CredentialResult =
  | { ok: true; user: { id: number; fullName: string } }
  | { ok: false; reason: "INVALID" | "LOCKED" };

// Hash giả để LUÔN tốn thời gian băm dù tài khoản không tồn tại
const DUMMY_HASH = bcrypt.hashSync("khong-ai-dung-mat-khau-nay", 10);

export async function verifyCredentials(
  prisma: PrismaClient,
  username: string,
  password: string,
): Promise<CredentialResult> {
  const user = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) return { ok: false, reason: "INVALID" };
  // Chỉ báo LOCKED khi đã đúng mật khẩu → kẻ đoán mật khẩu không biết tài khoản có tồn tại
  if (user.isLocked) return { ok: false, reason: "LOCKED" };
  return { ok: true, user: { id: user.id, fullName: user.fullName } };
}
```
`src/server/auth/actor.ts`:
```ts
import type { PrismaClient } from "@prisma/client";

export interface SessionActor {
  userId: number;
  username: string;
  fullName: string;
  perms: ReadonlySet<string>;
  mustChangePassword: boolean;
}

/** Đọc user + quyền từ DB mỗi request: khoá tài khoản / đổi quyền có hiệu lực ngay. */
export async function loadActor(prisma: PrismaClient, userId: number): Promise<SessionActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user || user.isLocked) return null;
  const perms = new Set(
    user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)),
  );
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    perms,
    mustChangePassword: user.mustChangePassword,
  };
}
```
Run: `npm test -- tests/auth` → PASS. (Test độ trễ: nếu chập chờn trên máy chậm, nới hệ số `0.5` → `0.3`, KHÔNG xoá test.)

- [ ] **Step 5: next-auth v4 + middleware + session helper**

`src/lib/auth.ts`:
```ts
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyCredentials } from "@/server/auth/credentials";

export const authOptions: NextAuthOptions = {
  // Gán rõ AUTH_SECRET (pitfalls mục 4): next-auth v4 không tự đọc tên biến này
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // 12 giờ = 1 ca làm việc
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: { username: {}, password: {} },
      async authorize(creds) {
        const r = await verifyCredentials(prisma, creds?.username ?? "", creds?.password ?? "");
        if (r.ok) return { id: String(r.user.id), name: r.user.fullName };
        if (r.reason === "LOCKED") throw new Error("LOCKED"); // login page đọc ?error=LOCKED
        return null;
      },
    }),
  ],
  callbacks: {
    // JWT chỉ giữ id — quyền đọc từ DB mỗi request (loadActor)
    jwt({ token, user }) {
      if (user) token.uid = Number(user.id);
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.uid as number;
      return session;
    },
  },
};
```
`src/types/next-auth.d.ts`:
```ts
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: { id: number; name?: string | null };
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    uid?: number;
  }
}
```
`src/app/api/auth/[...nextauth]/route.ts`:
```ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```
`src/middleware.ts` — **truyền `secret` tường minh**: middleware của next-auth v4 mặc định đọc `NEXTAUTH_SECRET`, KHÔNG đọc `AUTH_SECRET`; quên dòng này thì mọi trang trả `NO_SECRET` trên production (pitfalls mục 4):
```ts
import { withAuth } from "next-auth/middleware";

export default withAuth({
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/login" },
});

export const config = {
  // Mọi route trừ trang đăng nhập, API auth, health, tài nguyên tĩnh
  matcher: ["/((?!login|403|api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
```
`src/server/auth/session.ts`:
```ts
import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { PermissionCode } from "@/lib/permissions/catalog";
import { loadActor, type SessionActor } from "./actor";

/** Actor của request hiện tại (cache trong 1 request). Chưa đăng nhập/bị khoá → null. */
export const getActor = cache(async (): Promise<SessionActor | null> => {
  const session = await getServerSession(authOptions);
  const uid = session?.user?.id;
  if (!uid) return null;
  return loadActor(prisma, uid);
});

/** Dùng ở đầu mỗi page/layout/route: chưa đăng nhập → /login; thiếu quyền → /403. */
export async function requireActor(perm?: PermissionCode): Promise<SessionActor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (perm && !actor.perms.has(perm)) redirect("/403");
  return actor;
}
```

- [ ] **Step 6: Kiểm tra biên dịch và commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: xanh.
```bash
git add -A
git commit -m "feat(auth): đăng nhập Credentials, loadActor, khoá tài khoản có hiệu lực ngay"
```

---

### Task 7: Token UI, Tailwind, theme không FOUC, định dạng số/ngày

**Files:**
- Create: `tailwind.config.ts`, `postcss.config.mjs`, `src/styles/tokens.css`, `design/app-override.css`, `src/app/globals.css`, `src/components/providers.tsx`
- Modify: `src/app/layout.tsx`, `vitest.config.ts`
- Create: `src/lib/time.ts`, `src/lib/format.ts`, `src/lib/theme.ts`, `src/components/shell/ThemeSwitch.tsx`
- Test: `tests/lib/time.test.ts`, `tests/lib/format.test.ts`, `tests/lib/theme.test.ts`, `tests/design/no-hardcoded-colors.test.ts`

**Interfaces:**
- Produces:
  - `ICT_OFFSET_MS`, `toIct(d: Date): {y:number; m:number /*0-11*/; d:number; dow:number /*0=Thứ Hai*/; hh:number; mm:number}`, `ictStartOfDay(y,m,d): Date` (`@/lib/time`)
  - `NULL_TEXT = "—"`, `formatNumber(v, maxFrac?, minFrac?)`, `formatQty(v)`, `formatCurrency(v)`, `formatPercent(v)`, `formatDate(d)`, `formatDateTime(d)` (`@/lib/format`); đầu vào `number | string | {toString():string} | null | undefined` (Decimal của Prisma hợp lệ)
  - `readTheme`, `applyTheme`, `NO_FOUC_SCRIPT`, `type ThemeMode` (`@/lib/theme`)
  - class Tailwind: `bg-canvas bg-surface bg-raised bg-hover text-fg text-fg-secondary text-fg-muted border-border text-accent bg-accent bg-accent-soft text-success bg-success-soft …` (map từ token)

- [ ] **Step 1: Cài Tailwind 3.4 + công cụ test UI**

```bash
npm i -D tailwindcss@3.4 postcss autoprefixer jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitejs/plugin-react
npm i @radix-ui/react-dialog @radix-ui/react-dropdown-menu
```
Sửa `vitest.config.ts` thêm `esbuild: { jsx: "automatic" }` ở cấp gốc `defineConfig` (tsconfig của Next đặt `jsx: preserve` nên esbuild cần được chỉ rõ) và thêm `tests/setup-dom.ts` vào `setupFiles` (cạnh `tests/setup-env.ts`):
```ts
export default defineConfig({
  plugins: [tsconfigPaths()],
  esbuild: { jsx: "automatic" },
  test: { /* giữ nguyên */ setupFiles: ["tests/setup-env.ts", "tests/setup-dom.ts"] },
});
```
`tests/setup-dom.ts` — polyfill jsdom cho Radix (chỉ chạy khi có `Element`):
```ts
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 2: Test múi giờ ICT (đỏ)**

`tests/lib/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ictStartOfDay, toIct } from "@/lib/time";

describe("time (Asia/Ho_Chi_Minh, UTC+7)", () => {
  it("23:50 ICT 30/09 (16:50Z) vẫn là ngày 30/09", () => {
    const p = toIct(new Date("2026-09-30T16:50:00Z"));
    expect([p.y, p.m, p.d, p.hh, p.mm]).toEqual([2026, 8, 30, 23, 50]);
  });

  it("17:00Z = 00:00 ICT ngày hôm sau", () => {
    const p = toIct(new Date("2026-09-30T17:00:00Z"));
    expect([p.y, p.m, p.d, p.hh]).toEqual([2026, 9, 1, 0]);
  });

  it("dow: 0 = Thứ Hai … 6 = Chủ nhật (30/09/2026 là Thứ Tư)", () => {
    expect(toIct(new Date("2026-09-30T05:00:00Z")).dow).toBe(2);
    expect(toIct(new Date("2026-09-28T05:00:00Z")).dow).toBe(0);
    expect(toIct(new Date("2026-10-04T05:00:00Z")).dow).toBe(6);
  });

  it("ictStartOfDay trả 0h ICT dưới dạng thời điểm UTC", () => {
    expect(ictStartOfDay(2026, 8, 30).toISOString()).toBe("2026-09-29T17:00:00.000Z");
    expect(ictStartOfDay(2026, 9, 1).toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("ictStartOfDay tràn tháng/năm hợp lệ (m=12 → tháng 1 năm sau; d=0 → ngày cuối tháng trước)", () => {
    expect(ictStartOfDay(2026, 12, 1).toISOString()).toBe("2026-12-31T17:00:00.000Z");
    expect(ictStartOfDay(2026, 8, 0).toISOString()).toBe("2026-08-30T17:00:00.000Z");
  });
});
```
- [ ] **Step 3: Chạy → đỏ; cài `src/lib/time.ts`**

```ts
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
```
Run: `npm test -- tests/lib/time.test.ts` → PASS.

- [ ] **Step 4: Test định dạng (đỏ)**

`tests/lib/format.test.ts`:
```ts
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, formatQty, NULL_TEXT,
} from "@/lib/format";

describe("format", () => {
  it("số: phân cách nghìn '.', thập phân ','", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(1234.5, 2)).toBe("1.234,5");
    expect(formatNumber(1234.5, 2, 2)).toBe("1.234,50");
    expect(formatNumber(-1234567)).toBe("-1.234.567");
    expect(formatNumber("20444.4444", 2)).toBe("20.444,44");
  });

  it("null/undefined/chuỗi rỗng → '—', còn 0 → '0' (null ≠ 0)", () => {
    expect(NULL_TEXT).toBe("—");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
    expect(formatNumber("")).toBe("—");
    expect(formatNumber(0)).toBe("0");
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(0)).toBe("0 ₫");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
  });

  it("tiền: '1.500.000 ₫'; âm giữ dấu trừ", () => {
    expect(formatCurrency(1500000)).toBe("1.500.000 ₫");
    expect(formatCurrency(-250000)).toBe("-250.000 ₫");
    expect(formatCurrency(1500000.4)).toBe("1.500.000 ₫");
  });

  it("số lượng: tối đa 3 số lẻ, bỏ số 0 thừa", () => {
    expect(formatQty("1250.000")).toBe("1.250");
    expect(formatQty("333.3333")).toBe("333,333");
    expect(formatQty(2.4)).toBe("2,4");
  });

  it("nhận Prisma.Decimal", () => {
    expect(formatCurrency(new Prisma.Decimal("1500000.00"))).toBe("1.500.000 ₫");
    expect(formatQty(new Prisma.Decimal("1250.000"))).toBe("1.250");
  });

  it("ngày theo giờ Việt Nam", () => {
    expect(formatDate("2026-09-30T16:50:00Z")).toBe("30/09/2026");
    expect(formatDate("2026-09-30T17:00:00Z")).toBe("01/10/2026");
    expect(formatDateTime("2026-09-30T16:50:00Z")).toBe("23:50 30/09/2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("không phải ngày")).toBe("—");
  });
});
```
- [ ] **Step 5: Chạy → đỏ; cài `src/lib/format.ts`**

```ts
import { toIct } from "./time";

export const NULL_TEXT = "—";

type Numeric = number | string | { toString(): string } | null | undefined;

const isBlank = (v: Numeric) => v === null || v === undefined || v === "";

const group = (intPart: string) => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Chỉ để HIỂN THỊ (không dùng để tính). `null/undefined/""` → "—"; số 0 → "0".
 * maxFrac/minFrac: số chữ số thập phân tối đa/tối thiểu.
 */
export function formatNumber(v: Numeric, maxFrac = 0, minFrac = 0): string {
  if (isBlank(v)) return NULL_TEXT;
  const n = Number(String(v));
  if (!Number.isFinite(n)) return NULL_TEXT;
  const fixed = Math.abs(n).toFixed(maxFrac);
  const [int, fracRaw = ""] = fixed.split(".") as [string, string?];
  let frac = fracRaw;
  while (frac.length > minFrac && frac.endsWith("0")) frac = frac.slice(0, -1);
  const negative = n < 0 && /[1-9]/.test(fixed);
  return `${negative ? "-" : ""}${group(int)}${frac ? "," + frac : ""}`;
}

/** Số lượng: tối đa 3 số lẻ, bỏ số 0 thừa. */
export const formatQty = (v: Numeric) => formatNumber(v, 3, 0);

export function formatCurrency(v: Numeric): string {
  if (isBlank(v)) return NULL_TEXT;
  const s = formatNumber(v, 0, 0);
  return s === NULL_TEXT ? s : `${s} ₫`;
}

/** v là tỷ lệ theo phần trăm (12.5 → "12,5%"). Chưa có dữ liệu (null) → "—", KHÔNG phải "0%". */
export function formatPercent(v: Numeric, maxFrac = 1): string {
  if (isBlank(v)) return NULL_TEXT;
  const s = formatNumber(v, maxFrac, 0);
  return s === NULL_TEXT ? s : `${s}%`;
}

const p2 = (n: number) => String(n).padStart(2, "0");

function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return NULL_TEXT;
  const t = toIct(d);
  return `${p2(t.d)}/${p2(t.m + 1)}/${t.y}`;
}

export function formatDateTime(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return NULL_TEXT;
  const t = toIct(d);
  return `${p2(t.hh)}:${p2(t.mm)} ${p2(t.d)}/${p2(t.m + 1)}/${t.y}`;
}
```
Run: `npm test -- tests/lib/format.test.ts` → PASS.

- [ ] **Step 6: Test theme (đỏ) rồi cài**

`tests/lib/theme.test.ts`:
```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, NO_FOUC_SCRIPT, readTheme } from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("readTheme: giá trị lạ/không có → 'system'", () => {
    expect(readTheme(localStorage)).toBe("system");
    localStorage.setItem("theme", "xyz");
    expect(readTheme(localStorage)).toBe("system");
    localStorage.setItem("theme", "dark");
    expect(readTheme(localStorage)).toBe("dark");
  });

  it("applyTheme dark/light: set attribute + lưu; system: gỡ attribute + xoá lưu", () => {
    applyTheme("dark", document.documentElement, localStorage);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    applyTheme("system", document.documentElement, localStorage);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("script chống FOUC áp theme đã lưu TRƯỚC khi paint và không ném lỗi khi localStorage hỏng", () => {
    localStorage.setItem("theme", "dark");
    new Function(NO_FOUC_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    document.documentElement.removeAttribute("data-theme");
    const spy = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    expect(() => new Function(NO_FOUC_SCRIPT)()).not.toThrow();
    Object.defineProperty(window, "localStorage", spy);
  });
});
```
`src/lib/theme.ts`:
```ts
export type ThemeMode = "light" | "dark" | "system";
const KEY = "theme";

export function readTheme(storage: Pick<Storage, "getItem">): ThemeMode {
  const v = storage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** system = gỡ attribute → tokens.css tự theo prefers-color-scheme. */
export function applyTheme(
  mode: ThemeMode,
  root: HTMLElement,
  storage: Pick<Storage, "setItem" | "removeItem">,
): void {
  if (mode === "system") {
    root.removeAttribute("data-theme");
    storage.removeItem(KEY);
  } else {
    root.setAttribute("data-theme", mode);
    storage.setItem(KEY, mode);
  }
}

/** Chèn inline vào <head> để áp theme trước khi paint (chống FOUC khi vào dark). */
export const NO_FOUC_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;
```
Run: `npm test -- tests/lib/theme.test.ts` → PASS.

- [ ] **Step 7: Nền token — chép nguyên từ skill, KHÔNG sửa `tokens.css`**

```bash
mkdir -p src/styles design
cp "C:/Users/HP/.claude/skills/crm-design/examples/tokens.css" src/styles/tokens.css
```
`design/app-override.css` (Lớp 2 — chỉ file này khác giữa các app; bám `crm-design` v1.2). Accent xanh mặc định của skill; font Be Vietnam Pro cho dấu tiếng Việt; `// ASSUMPTION`: khách chưa cung cấp màu thương hiệu — đổi 2 dòng `--accent-*` khi có:
```css
/* app-override.css — Đặng Hương. Bám base skill crm-design v1.2. */
:root {
  --font-sans: var(--font-be-vietnam), 'Be Vietnam Pro', ui-sans-serif, system-ui, -apple-system, sans-serif;
  /* ASSUMPTION: chưa có màu thương hiệu → dùng accent mặc định của skill */
  --accent-500: #2563eb;
  --accent-600: #1d4ed8;
}
```
`tailwind.config.ts` (bản TypeScript của `examples/tailwind.config.js`):
```ts
import type { Config } from "tailwindcss";

const config: Config = {
  // Theo attribute; KHÔNG dùng dark: rời rạc — đổi theme chỉ đổi data-theme
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        raised: "var(--bg-surface-raised)",
        hover: "var(--bg-hover)",
        active: "var(--bg-active)",
        border: "var(--border-default)",
        "border-strong": "var(--border-strong)",
        accent: { DEFAULT: "var(--accent-500)", 600: "var(--accent-600)", soft: "var(--accent-soft)" },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
        tertiary: { DEFAULT: "var(--tertiary)", soft: "var(--tertiary-soft)" },
        fg: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          "on-accent": "var(--text-on-accent)",
        },
      },
      borderRadius: { sm: "var(--radius-sm)", md: "var(--radius-md)", lg: "var(--radius-lg)", full: "var(--radius-full)" },
      fontFamily: { sans: "var(--font-sans)", mono: "var(--font-mono)" },
      fontSize: {
        xs: "var(--text-xs)", sm: "var(--text-sm)", base: "var(--text-base)",
        lg: "var(--text-lg)", xl: "var(--text-xl)", "2xl": "var(--text-2xl)",
      },
      boxShadow: { sm: "var(--shadow-sm)", md: "var(--shadow-md)", lg: "var(--shadow-lg)" },
      zIndex: {
        header: "var(--z-sticky-header)", sidebar: "var(--z-sidebar)", dropdown: "var(--z-dropdown)",
        scrim: "var(--z-overlay-scrim)", sheet: "var(--z-slide-panel)", dialog: "var(--z-dialog)", toast: "var(--z-toast)",
      },
      transitionTimingFunction: { standard: "var(--ease-standard)" },
    },
  },
  plugins: [],
};

export default config;
```
`postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```
`src/app/globals.css`:
```css
@import "../styles/tokens.css";
@import "../../design/app-override.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

html, body { height: 100%; }
body { font-size: var(--text-base); }

/* focus rõ cho mọi control (a11y) */
:focus-visible { outline: 2px solid var(--accent-500); outline-offset: 2px; }
```
`src/app/layout.tsx` (thay bản create-next-app):
```tsx
import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { NO_FOUC_SCRIPT } from "@/lib/theme";
import { APP_NAME } from "@/lib/version";

const font = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
  display: "swap",
});

export const metadata: Metadata = { title: APP_NAME };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={font.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FOUC_SCRIPT }} />
      </head>
      <body className="bg-canvas text-fg antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```
`src/components/providers.tsx` (Toast/Confirm host thêm ở Task 11):
```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 8: `ThemeSwitch` (3 chế độ)**

`src/components/shell/ThemeSwitch.tsx`:
```tsx
"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { applyTheme, readTheme, type ThemeMode } from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "light", label: "Giao diện sáng", Icon: Sun },
  { mode: "dark", label: "Giao diện tối", Icon: Moon },
  { mode: "system", label: "Theo hệ thống", Icon: Monitor },
];

export function ThemeSwitch() {
  const [mode, setMode] = useState<ThemeMode>("system");
  useEffect(() => setMode(readTheme(localStorage)), []);

  return (
    <div role="radiogroup" aria-label="Giao diện" className="flex items-center rounded-full border border-border p-0.5">
      {OPTIONS.map(({ mode: m, label, Icon }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          aria-label={label}
          title={label}
          onClick={() => {
            setMode(m);
            applyTheme(m, document.documentElement, localStorage);
          }}
          className={clsx(
            "flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-hover",
            mode === m && "bg-accent-soft text-accent",
          )}
        >
          <Icon size={15} aria-hidden />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Test rà kỷ luật token (chạy trên MỌI code UI của các plan sau)**

`tests/design/no-hardcoded-colors.test.ts`:
```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

// tokens.css và app-override.css là NƠI DUY NHẤT được khai báo màu gốc
const ALLOWED = [/src[\\/]styles[\\/]tokens\.css$/, /design[\\/]app-override\.css$/, /tailwind\.config\.ts$/];

const files = [...walk("src"), ...walk("design")].filter((f) => !ALLOWED.some((r) => r.test(f)));

describe("kỷ luật token (crm-design)", () => {
  it("không hex hardcode trong code UI", () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // #rgb / #rrggbb / #rrggbbaa; bỏ qua fragment URL & id nằm trong chuỗi ngắn như "#main"
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(m[0])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("không dùng dark: rời rạc và không tham chiếu --gray-* trực tiếp", () => {
    const bad: string[] = [];
    for (const f of files.filter((f) => /\.tsx?$/.test(f))) {
      const text = readFileSync(f, "utf8");
      if (/\bdark:/.test(text)) bad.push(`${f}: dark:`);
      if (/var\(--gray-/.test(text)) bad.push(`${f}: var(--gray-*)`);
    }
    expect(bad).toEqual([]);
  });
});
```
Run: `npm test -- tests/design`
Expected: PASS.
Run: `npm run build`
Expected: build thành công (cần internet để tải font Google lúc build). Nếu build lỗi vì `src/app/page.tsx` mặc định của create-next-app còn dùng ảnh/hex → thay bằng `export default function Home() { return null; }` (trang chủ thật ở Task 14).

- [ ] **Step 10: Chạy toàn bộ, commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "feat(ui): token crm-design, Tailwind 3.4, theme không FOUC, format số/ngày theo ICT"
```

---

### Task 8: App Shell + `app.config` (1 nguồn Module→Category→Function)

**Files:**
- Create: `src/config/app.config.ts`, `src/lib/nav.ts`, `design/PROJECT_BRIEF.md`
- Create: `src/components/shell/{icons.tsx,Sidebar.tsx,BottomNav.tsx,Header.tsx,UserMenu.tsx,Footer.tsx,Breadcrumb.tsx,AppShell.tsx,ModuleLanding.tsx}`
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx` (tạm), `src/app/(app)/m/[module]/page.tsx`, `src/app/403/page.tsx`
- Test: `tests/config/app-config.test.ts`, `tests/lib/nav.test.ts`, `tests/shell/sidebar.test.tsx`

**Interfaces:**
- Consumes: `PermissionCode` (`@/lib/permissions/catalog`), `requireActor` (`@/server/auth/session`).
- Produces:
  - `APP_NAV: readonly NavModule[]`, `interface NavModule/NavCategory/NavFunction` (`@/config/app.config`)
  - `buildNav(nav, perms): NavModule[]`, `findActiveFunction(nav, pathname): {module, category, fn} | null`, `resolveBreadcrumb(nav, pathname): {label:string; href?:string}[]` (`@/lib/nav`)
  - `<AppShell nav user>` bọc mọi trang trong `(app)`; `.app-shell-main` là vùng cuộn duy nhất.

- [ ] **Step 1: `src/config/app.config.ts` — toàn bộ IA của sản phẩm (spec Phần 7) từ ngày đầu; chức năng chưa làm để `planned: true` (bị ẩn khỏi menu cho tới khi plan của module bật)**

```ts
import type { PermissionCode } from "@/lib/permissions/catalog";

export type ViewKind = "table" | "card" | "kanban" | "calendar" | "dashboard" | "tree" | "catalog" | "form" | "report";

export interface NavFunction {
  key: string;
  label: string;
  desc: string;
  icon: string;
  view: ViewKind;
  path: string;
  /** Mã phạm vi (spec Phần 7). Code không truy được về một mã thì không viết. */
  codes: readonly string[];
  perm?: PermissionCode;
  /** Chưa làm: ẩn khỏi menu. Plan của module bỏ cờ này khi giao. */
  planned?: boolean;
}

export interface NavCategory {
  key: string;
  label: string;
  functions: readonly NavFunction[];
}

export interface NavModule {
  key: string;
  label: string;
  icon: string;
  type: "flat" | "accordion";
  /** Chỉ module flat. */
  path?: string;
  /** Mã phạm vi của module flat (Trang chủ = 7). */
  codes?: readonly string[];
  perm?: PermissionCode;
  categories: readonly NavCategory[];
}

const P = true; // planned

// Thứ tự = luồng nghiệp vụ thực tế, KHÔNG alphabet (navigation-model.md).
export const APP_NAV: readonly NavModule[] = [
  { key: "home", label: "Trang chủ", icon: "home", type: "flat", path: "/", codes: ["7"], categories: [] },

  {
    key: "sales", label: "Bán hàng", icon: "shopping-cart", type: "accordion",
    categories: [
      {
        key: "orders", label: "Đơn hàng",
        functions: [
          { key: "order-new", label: "Bán hàng", desc: "Lập đơn, chiết khấu, xuất kho FIFO", icon: "shopping-cart", view: "form", path: "/sales/orders/new", codes: ["31"], perm: "order.create", planned: P },
          { key: "order-list", label: "Danh sách đơn", desc: "Đơn theo 2 trục trạng thái giao hàng & thanh toán", icon: "receipt", view: "table", path: "/sales/orders", codes: ["32", "33"], perm: "order.view", planned: P },
          { key: "order-deleted", label: "Đơn đã xóa", desc: "Xem, khôi phục đơn đã hủy", icon: "trash-2", view: "table", path: "/sales/orders-deleted", codes: ["34", "34a", "34b", "34c"], perm: "order.restore", planned: P },
          { key: "quote-list", label: "Báo giá", desc: "Lập báo giá, chuyển thành đơn", icon: "file-text", view: "table", path: "/sales/quotes", codes: ["35"], perm: "quote.manage", planned: P },
          { key: "deposit-list", label: "Tiền cọc", desc: "Quản lý tiền cọc của đơn", icon: "hand-coins", view: "table", path: "/sales/deposits", codes: ["36"], perm: "deposit.manage", planned: P },
          { key: "delivery-note-list", label: "Phiếu xuất / giao", desc: "Giao hàng nhiều lần cho một đơn", icon: "package", view: "table", path: "/sales/delivery-notes", codes: ["37"], perm: "order.view", planned: P },
        ],
      },
      {
        key: "customers", label: "Khách hàng",
        functions: [
          { key: "customer-list", label: "Khách hàng", desc: "Hồ sơ, hạn mức nợ, người phụ trách", icon: "users", view: "table", path: "/sales/customers", codes: ["9"], perm: "partner.view", planned: P },
        ],
      },
    ],
  },

  {
    key: "delivery", label: "Giao hàng", icon: "truck", type: "accordion",
    categories: [
      {
        key: "trips", label: "Chuyến giao",
        functions: [
          { key: "trip-new", label: "Xếp chuyến", desc: "Gom đơn theo tuyến, gán xe + lái + phụ, in phiếu giao", icon: "truck", view: "form", path: "/delivery/trips/new", codes: ["38"], perm: "trip.manage", planned: P },
          { key: "trip-list", label: "Danh sách chuyến", desc: "Chuyến theo trạng thái", icon: "clipboard-list", view: "table", path: "/delivery/trips", codes: ["39"], perm: "trip.manage", planned: P },
          { key: "trip-result", label: "Nhập kết quả giao", desc: "Trạng thái + tiền mặt + chuyển khoản + ghi nợ", icon: "list-checks", view: "form", path: "/delivery/results", codes: ["40"], perm: "trip.manage", planned: P },
          { key: "trip-settle", label: "Đối soát lái xe", desc: "Đối soát tiền, thủ quỹ xác nhận", icon: "scale", view: "table", path: "/delivery/settlements", codes: ["41"], perm: "trip.settle", planned: P },
          { key: "undelivered", label: "Hàng không giao được", desc: "Nhập lại kho, giao người bán xử lý", icon: "undo-2", view: "table", path: "/delivery/undelivered", codes: ["42"], perm: "trip.manage", planned: P },
        ],
      },
    ],
  },

  {
    key: "purchase", label: "Nhập hàng", icon: "package-plus", type: "accordion",
    categories: [
      {
        key: "receiving", label: "Nhập hàng",
        functions: [
          { key: "purchase-new", label: "Lập phiếu nhập", desc: "Quy đổi đơn vị, sinh lô FIFO, phân bổ cước", icon: "package-plus", view: "form", path: "/purchase/orders/new", codes: ["19"], perm: "purchase.create", planned: P },
          { key: "purchase-list", label: "Danh sách phiếu nhập", desc: "Xem, tìm, sửa phiếu nhập", icon: "clipboard-list", view: "table", path: "/purchase/orders", codes: ["20"], perm: "purchase.view", planned: P },
          { key: "stock-in-adj", label: "Nhập kho đầu kỳ / không NCC", desc: "Hàng lệch, dư — không sinh công nợ", icon: "layers", view: "table", path: "/purchase/adjustments-in", codes: ["21"], perm: "stock_adjust.manage", planned: P },
          { key: "supplier-list", label: "Nhà cung cấp", desc: "Danh sách NCC", icon: "building-2", view: "table", path: "/purchase/suppliers", codes: ["10"], perm: "partner.view", planned: P },
        ],
      },
    ],
  },

  {
    key: "inventory", label: "Kho", icon: "warehouse", type: "accordion",
    categories: [
      {
        key: "stock", label: "Tồn kho",
        functions: [
          { key: "stock-onhand", label: "Tồn kho hiện tại", desc: "Tồn theo mã hàng", icon: "warehouse", view: "table", path: "/inventory/stock", codes: ["23"], perm: "stock.view", planned: P },
          { key: "stock-ledger", label: "Sổ kho / thẻ kho", desc: "Chi tiết nhập xuất từng mã", icon: "scroll-text", view: "table", path: "/inventory/ledger", codes: ["22"], perm: "stock.view", planned: P },
          { key: "stock-xnt", label: "Báo cáo xuất nhập tồn", desc: "XNT kèm giá", icon: "bar-chart-3", view: "report", path: "/inventory/xnt", codes: ["24"], perm: "stock.view", planned: P },
          { key: "stock-min", label: "Định mức tồn", desc: "Cảnh báo dưới định mức", icon: "sliders-horizontal", view: "table", path: "/inventory/min-stock", codes: ["25"], perm: "stock.view", planned: P },
          { key: "roll-lookup", label: "Tra cứu cuộn", desc: "Ngày nhập, NCC, loại tôn, khối lượng, ghi chú cuộn", icon: "search", view: "table", path: "/inventory/rolls", codes: ["30"], perm: "stock.view", planned: P },
          { key: "pending-orders", label: "Đơn chưa đủ tồn", desc: "Đơn treo chờ nhập bù", icon: "clipboard-list", view: "table", path: "/inventory/pending-orders", codes: ["29"], perm: "stock.view", planned: P },
        ],
      },
      {
        key: "control", label: "Kiểm soát",
        functions: [
          { key: "stocktake-list", label: "Kiểm kho", desc: "Lập phiếu, danh sách kiểm kho", icon: "list-checks", view: "table", path: "/inventory/stocktakes", codes: ["26", "27"], perm: "stocktake.manage", planned: P },
          { key: "stock-adjust", label: "Điều chỉnh hao hụt / xuất hủy", desc: "Cắt lỗi ~1%/tháng", icon: "scale", view: "table", path: "/inventory/adjustments", codes: ["28"], perm: "stock_adjust.manage", planned: P },
        ],
      },
      {
        key: "products", label: "Sản phẩm",
        functions: [
          { key: "product-list", label: "Danh mục sản phẩm", desc: "~1.300 mã, đơn vị tính & quy đổi", icon: "package", view: "table", path: "/inventory/products", codes: ["11", "12"], perm: "product.view", planned: P },
        ],
      },
    ],
  },

  {
    key: "returns", label: "Trả hàng", icon: "undo-2", type: "accordion",
    categories: [
      {
        key: "customer-returns", label: "Khách trả",
        functions: [
          { key: "return-order", label: "Trả theo đơn", desc: "Nhập lại kho theo giá vốn dòng bán gốc", icon: "undo-2", view: "form", path: "/returns/by-order/new", codes: ["43"], perm: "return.manage", planned: P },
          { key: "return-order-list", label: "DS trả theo đơn", desc: "", icon: "clipboard-list", view: "table", path: "/returns/by-order", codes: ["44"], perm: "return.manage", planned: P },
          { key: "return-product", label: "Trả theo sản phẩm", desc: "Khách không nhớ đơn", icon: "undo-2", view: "form", path: "/returns/by-product/new", codes: ["45"], perm: "return.manage", planned: P },
          { key: "return-product-list", label: "DS trả theo SP", desc: "", icon: "clipboard-list", view: "table", path: "/returns/by-product", codes: ["46"], perm: "return.manage", planned: P },
        ],
      },
      {
        key: "supplier-returns", label: "Trả nhà cung cấp",
        functions: [
          { key: "return-supplier", label: "Trả NCC", desc: "Xuất kho FIFO, giảm công nợ phải trả", icon: "undo-2", view: "form", path: "/returns/to-supplier/new", codes: ["47"], perm: "return.manage", planned: P },
          { key: "return-supplier-list", label: "DS trả NCC", desc: "", icon: "clipboard-list", view: "table", path: "/returns/to-supplier", codes: ["48"], perm: "return.manage", planned: P },
        ],
      },
    ],
  },

  {
    key: "production", label: "Sản xuất", icon: "factory", type: "accordion",
    categories: [
      {
        key: "bom", label: "Định mức",
        functions: [
          { key: "bom-list", label: "Định mức NVL", desc: "Khai báo có phiên bản", icon: "sliders-horizontal", view: "table", path: "/production/bom", codes: ["51"], perm: "bom.manage", planned: P },
          { key: "consumption-actual", label: "Tiêu hao thực tế", desc: "Từ kiểm kho", icon: "scale", view: "table", path: "/production/actual-consumption", codes: ["52"], perm: "bom.manage", planned: P },
          { key: "consumption-compare", label: "Đối chiếu định mức", desc: "Định mức vs thực tế", icon: "bar-chart-3", view: "report", path: "/production/compare", codes: ["53"], perm: "bom.manage", planned: P },
        ],
      },
      {
        key: "orders", label: "Lệnh & gia công",
        functions: [
          { key: "production-order", label: "Lệnh sản xuất", desc: "Chỉ phụ kiện", icon: "factory", view: "table", path: "/production/orders", codes: ["49", "50"], perm: "production.manage", planned: P },
          { key: "processing-job", label: "Gia công thuê", desc: "Tôn của khách, tính tiền công + NVL xưởng", icon: "hammer", view: "table", path: "/production/processing", codes: ["54", "55"], perm: "processing.manage", planned: P },
        ],
      },
    ],
  },

  {
    key: "accounting", label: "Kế toán", icon: "wallet", type: "accordion",
    categories: [
      {
        key: "cash", label: "Thu chi & quỹ",
        functions: [
          { key: "receipt-list", label: "Phiếu thu", desc: "Lập & danh sách phiếu thu", icon: "banknote", view: "table", path: "/accounting/receipts", codes: ["56", "57"], perm: "receipt.manage", planned: P },
          { key: "payment-list", label: "Phiếu chi", desc: "Lập & danh sách phiếu chi", icon: "coins", view: "table", path: "/accounting/payments", codes: ["58", "59"], perm: "payment.manage", planned: P },
          { key: "cashbook", label: "Sổ quỹ tiền mặt", desc: "", icon: "wallet", view: "table", path: "/accounting/cashbook", codes: ["60"], perm: "cashbook.view", planned: P },
          { key: "bankbook", label: "Sổ tiền gửi ngân hàng", desc: "", icon: "landmark", view: "table", path: "/accounting/bankbook", codes: ["61"], perm: "cashbook.view", planned: P },
          { key: "expense", label: "Chi phí hoạt động", desc: "Lương, dầu, điện, sửa xe…", icon: "calculator", view: "table", path: "/accounting/expenses", codes: ["66"], perm: "expense.manage", planned: P },
        ],
      },
      {
        key: "debt", label: "Công nợ",
        functions: [
          { key: "debt-summary", label: "Công nợ tổng hợp", desc: "Lọc KH/nhóm, kèm số dư chiết khấu tích lũy", icon: "scale", view: "table", path: "/accounting/debts", codes: ["62", "63"], perm: "debt.view", planned: P },
          { key: "debt-adjust", label: "Điều chỉnh công nợ", desc: "Hàng lỗi, bẹp, móp; sổ chiết khấu tích lũy", icon: "percent", view: "table", path: "/accounting/debt-adjustments", codes: ["64"], perm: "debt.adjust", planned: P },
          { key: "debt-transfer", label: "Gộp / chuyển công nợ", desc: "", icon: "arrow-left-right", view: "table", path: "/accounting/debt-transfers", codes: ["65"], perm: "debt.adjust", planned: P },
        ],
      },
    ],
  },

  {
    key: "reports", label: "Báo cáo", icon: "bar-chart-3", type: "accordion",
    categories: [
      {
        key: "management", label: "Báo cáo quản trị",
        functions: [
          { key: "rp-order-profit", label: "Lãi từng đơn", desc: "Lãi âm bôi đỏ", icon: "bar-chart-3", view: "report", path: "/reports/order-profit", codes: ["67"], perm: "profit.view", planned: P },
          { key: "rp-period-pnl", label: "Lãi lỗ toàn xưởng", desc: "DT − giá vốn − chiết khấu tích lũy − chi phí", icon: "bar-chart-3", view: "report", path: "/reports/period-pnl", codes: ["68"], perm: "profit.view", planned: P },
          { key: "rp-by-customer", label: "Bán hàng theo khách", desc: "", icon: "users", view: "report", path: "/reports/by-customer", codes: ["69"], perm: "report.view", planned: P },
          { key: "rp-by-group", label: "Bán hàng theo nhóm khách", desc: "", icon: "users", view: "report", path: "/reports/by-group", codes: ["70"], perm: "report.view", planned: P },
          { key: "rp-issue-by-order", label: "Xuất kho theo đơn", desc: "", icon: "package", view: "report", path: "/reports/issue-by-order", codes: ["71"], perm: "report.view", planned: P },
          { key: "rp-production", label: "Báo cáo sản xuất", desc: "", icon: "factory", view: "report", path: "/reports/production", codes: ["72"], perm: "report.view", planned: P },
          { key: "rp-debt-check", label: "Đối chiếu công nợ", desc: "", icon: "scale", view: "report", path: "/reports/debt-reconciliation", codes: ["73"], perm: "report.view", planned: P },
        ],
      },
    ],
  },

  {
    key: "period", label: "Kỳ & số đầu kỳ", icon: "calendar-check", type: "accordion",
    categories: [
      {
        key: "opening", label: "Số đầu kỳ",
        functions: [
          { key: "open-stock", label: "Tồn kho đầu kỳ", desc: "Kèm giá vốn theo lô", icon: "warehouse", view: "table", path: "/period/opening-stock", codes: ["K1"], perm: "data.import", planned: P },
          { key: "open-debt", label: "Công nợ đầu kỳ", desc: "Khách & NCC", icon: "scale", view: "table", path: "/period/opening-debt", codes: ["K2"], perm: "data.import", planned: P },
          { key: "open-cash", label: "Số dư quỹ đầu kỳ", desc: "", icon: "wallet", view: "table", path: "/period/opening-cash", codes: ["K3"], perm: "data.import", planned: P },
          { key: "open-material", label: "Tồn NVL đầu kỳ", desc: "", icon: "layers", view: "table", path: "/period/opening-materials", codes: ["K4"], perm: "data.import", planned: P },
        ],
      },
      {
        key: "closing", label: "Kết sổ",
        functions: [
          { key: "period-close", label: "Kết sổ cuối kỳ", desc: "Checklist điều kiện, chỉ giám đốc; tra cứu kỳ cũ", icon: "calendar-check", view: "form", path: "/period/close", codes: ["K5"], perm: "period.close", planned: P },
        ],
      },
    ],
  },

  {
    key: "system", label: "Hệ thống", icon: "settings", type: "accordion",
    categories: [
      {
        key: "access", label: "Người dùng & phân quyền",
        functions: [
          { key: "user-list", label: "Người dùng", desc: "Tài khoản, khoá/mở khoá, cấp lại mật khẩu", icon: "users", view: "table", path: "/system/users", codes: ["1", "2", "4"], perm: "user.view" },
          { key: "role-list", label: "Nhóm quyền", desc: "Cấu hình quyền động tới từng chức năng + phạm vi dữ liệu", icon: "shield", view: "table", path: "/system/roles", codes: ["3"], perm: "role.manage" },
          { key: "audit-log", label: "Nhật ký thao tác", desc: "Số cũ / số mới, không xóa được", icon: "scroll-text", view: "table", path: "/system/audit-log", codes: ["5"], perm: "audit.view" },
        ],
      },
      {
        key: "config", label: "Cấu hình",
        functions: [
          { key: "company", label: "Công ty & mẫu in", desc: "Thông tin công ty, bật/tắt mẫu in", icon: "building-2", view: "form", path: "/system/company", codes: ["6"], perm: "company.manage", planned: P },
          // 1 Function duy nhất cho mọi danh mục nhỏ; các loại nằm ở mini-sidebar trong trang (?section=) — catalog-settings.md
          { key: "catalog-settings", label: "Cài đặt danh mục", desc: "Nhóm khách, kho, xe & lái xe, tuyến, loại thu chi, ngân hàng, kiểu gia công", icon: "sliders-horizontal", view: "catalog", path: "/system/catalog-settings", codes: ["8", "13", "14", "15", "16", "17", "18"], perm: "catalog.manage", planned: P },
        ],
      },
    ],
  },
];
```

- [ ] **Step 2: Test config (đỏ→xanh sau khi có `icons.ts`)**

`tests/config/app-config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { APP_NAV } from "@/config/app.config";
import { ICONS } from "@/components/shell/icons";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";

const functions = APP_NAV.flatMap((m) => m.categories.flatMap((c) => c.functions));

describe("app.config", () => {
  it("key module/function duy nhất", () => {
    const keys = [...APP_NAV.map((m) => m.key), ...functions.map((f) => f.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("path duy nhất và bắt đầu bằng '/'", () => {
    const paths = functions.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
  });

  it("mọi icon có trong bảng ICONS (không ô trống trong menu)", () => {
    const names = new Set([...APP_NAV.map((m) => m.icon), ...functions.map((f) => f.icon)]);
    for (const n of names) expect(ICONS[n], n).toBeDefined();
  });

  it("perm tham chiếu mã quyền có thật", () => {
    for (const f of functions) if (f.perm) expect(ALL_PERMISSION_CODES).toContain(f.perm);
    for (const m of APP_NAV) if (m.perm) expect(ALL_PERMISSION_CODES).toContain(m.perm);
  });

  it("module flat có path và không có category; module accordion có category", () => {
    for (const m of APP_NAV) {
      if (m.type === "flat") {
        expect(m.path).toBeTruthy();
        expect(m.categories).toHaveLength(0);
      } else {
        expect(m.categories.length).toBeGreaterThan(0);
      }
    }
  });

  it("phủ đủ mã phạm vi màn hình 1–73 + K1–K5 (truy vết spec)", () => {
    const covered = new Set([...functions.flatMap((f) => f.codes), ...APP_NAV.flatMap((m) => m.codes ?? [])]);
    const expected = [
      ...Array.from({ length: 73 }, (_, i) => String(i + 1)),
      "34a", "34b", "34c", "K1", "K2", "K3", "K4", "K5",
    ];
    // mã 1 (Đăng nhập) là màn ngoài menu → gắn ở function user-list; mã 7 (Trang chủ) gắn ở module home
    const missing = expected.filter((c) => !covered.has(c));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 3: `src/components/shell/icons.tsx`**

```ts
import {
  ArrowLeftRight, Banknote, BarChart3, Building2, CalendarCheck, Calculator, ClipboardList, Coins,
  Circle, Factory, FileText, HandCoins, Hammer, Home, Landmark, Layers, ListChecks, Package,
  PackagePlus, Percent, Receipt, Scale, ScrollText, Search, Settings, Shield, ShoppingCart,
  SlidersHorizontal, Trash2, Truck, Undo2, Users, Wallet, Warehouse, type LucideIcon,
} from "lucide-react";

// Chỉ import icon đang dùng (giữ bundle nhỏ). Thêm icon mới ở đây khi app.config cần.
export const ICONS: Record<string, LucideIcon> = {
  "arrow-left-right": ArrowLeftRight, banknote: Banknote, "bar-chart-3": BarChart3, "building-2": Building2,
  "calendar-check": CalendarCheck, calculator: Calculator, "clipboard-list": ClipboardList, coins: Coins,
  factory: Factory, "file-text": FileText, "hand-coins": HandCoins, hammer: Hammer, home: Home,
  landmark: Landmark, layers: Layers, "list-checks": ListChecks, package: Package, "package-plus": PackagePlus,
  percent: Percent, receipt: Receipt, scale: Scale, "scroll-text": ScrollText, search: Search,
  settings: Settings, shield: Shield, "shopping-cart": ShoppingCart, "sliders-horizontal": SlidersHorizontal,
  "trash-2": Trash2, truck: Truck, "undo-2": Undo2, users: Users, wallet: Wallet, warehouse: Warehouse,
};

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  const Cmp = ICONS[name] ?? Circle;
  return <Cmp size={size} className={className} aria-hidden />;
}
```
Run: `npm test -- tests/config/app-config.test.ts`
Expected: PASS. Nếu `missing` không rỗng → thêm mã còn thiếu vào `codes` của function tương ứng (không đổi phạm vi).

- [ ] **Step 4: Test `nav.ts` (đỏ)**

`tests/lib/nav.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { NavModule } from "@/config/app.config";
import { buildNav, findActiveFunction, resolveBreadcrumb } from "@/lib/nav";

const nav: readonly NavModule[] = [
  { key: "home", label: "Trang chủ", icon: "home", type: "flat", path: "/", categories: [] },
  {
    key: "sales", label: "Bán hàng", icon: "shopping-cart", type: "accordion",
    categories: [
      {
        key: "orders", label: "Đơn hàng",
        functions: [
          { key: "order-list", label: "Danh sách đơn", desc: "", icon: "receipt", view: "table", path: "/sales/orders", codes: ["32"], perm: "order.view" },
          { key: "order-deleted", label: "Đơn đã xóa", desc: "", icon: "trash-2", view: "table", path: "/sales/orders/deleted", codes: ["34"], perm: "order.restore" },
          { key: "quote", label: "Báo giá", desc: "", icon: "file-text", view: "table", path: "/sales/quotes", codes: ["35"], perm: "quote.manage", planned: true },
        ],
      },
    ],
  },
  {
    key: "system", label: "Hệ thống", icon: "settings", type: "accordion",
    categories: [
      { key: "a", label: "A", functions: [{ key: "users", label: "Người dùng", desc: "", icon: "users", view: "table", path: "/system/users", codes: ["2"], perm: "user.view" }] },
    ],
  },
];

describe("buildNav", () => {
  it("ẩn HẲN chức năng không có quyền và chức năng planned", () => {
    const out = buildNav(nav, new Set(["order.view"]));
    const fns = out.flatMap((m) => m.categories.flatMap((c) => c.functions.map((f) => f.key)));
    expect(fns).toEqual(["order-list"]);
  });

  it("module accordion không còn chức năng nào hiển thị → biến mất; module flat luôn còn", () => {
    const out = buildNav(nav, new Set(["order.view"]));
    expect(out.map((m) => m.key)).toEqual(["home", "sales"]);
  });

  it("category rỗng bị bỏ", () => {
    const out = buildNav(nav, new Set(["user.view"]));
    expect(out.map((m) => m.key)).toEqual(["home", "system"]);
  });
});

describe("findActiveFunction — khớp tiền tố DÀI NHẤT", () => {
  it("/sales/orders/deleted → order-deleted (không phải order-list)", () => {
    const all = buildNav(nav, new Set(["order.view", "order.restore"]));
    expect(findActiveFunction(all, "/sales/orders/deleted")!.fn.key).toBe("order-deleted");
    expect(findActiveFunction(all, "/sales/orders/12")!.fn.key).toBe("order-list");
    expect(findActiveFunction(all, "/sales/ordersXYZ")).toBeNull();
    expect(findActiveFunction(all, "/khong-co")).toBeNull();
  });
});

describe("resolveBreadcrumb", () => {
  const all = buildNav(nav, new Set(["order.view", "user.view"]));
  it("danh sách", () => {
    expect(resolveBreadcrumb(all, "/system/users")).toEqual([
      { label: "Hệ thống", href: "/m/system" },
      { label: "Người dùng" },
    ]);
  });
  it("chi tiết & thêm mới", () => {
    expect(resolveBreadcrumb(all, "/system/users/12")).toEqual([
      { label: "Hệ thống", href: "/m/system" },
      { label: "Người dùng", href: "/system/users" },
      { label: "Chi tiết" },
    ]);
    expect(resolveBreadcrumb(all, "/system/users/new").at(-1)).toEqual({ label: "Thêm mới" });
  });
  it("trang chủ", () => {
    expect(resolveBreadcrumb(all, "/")).toEqual([{ label: "Trang chủ" }]);
  });
});
```
- [ ] **Step 5: Cài `src/lib/nav.ts`**

```ts
import type { NavCategory, NavFunction, NavModule } from "@/config/app.config";

/** Lọc menu theo quyền: ẩn HẲN (không hiện xám) — global-rules.md mục 8. */
export function buildNav(nav: readonly NavModule[], perms: ReadonlySet<string>): NavModule[] {
  const allowed = (perm?: string) => !perm || perms.has(perm);
  return nav
    .filter((m) => allowed(m.perm))
    .map((m) => ({
      ...m,
      categories: m.categories
        .map((c) => ({ ...c, functions: c.functions.filter((f) => !f.planned && allowed(f.perm)) }))
        .filter((c) => c.functions.length > 0),
    }))
    .filter((m) => m.type === "flat" || m.categories.length > 0);
}

export interface ActiveMatch {
  module: NavModule;
  category: NavCategory;
  fn: NavFunction;
}

const matches = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(path + "/");

/** Chức năng có path là tiền tố DÀI NHẤT của pathname (để /a/deleted thắng /a). */
export function findActiveFunction(nav: readonly NavModule[], pathname: string): ActiveMatch | null {
  let best: ActiveMatch | null = null;
  for (const module of nav) {
    for (const category of module.categories) {
      for (const fn of category.functions) {
        if (matches(pathname, fn.path) && (!best || fn.path.length > best.fn.path.length)) {
          best = { module, category, fn };
        }
      }
    }
  }
  return best;
}

export interface Crumb {
  label: string;
  href?: string;
}

export function resolveBreadcrumb(nav: readonly NavModule[], pathname: string): Crumb[] {
  if (pathname === "/") return [{ label: "Trang chủ" }];
  const hit = findActiveFunction(nav, pathname);
  if (!hit) return [];
  const rest = pathname.slice(hit.fn.path.length).split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: hit.module.label, href: `/m/${hit.module.key}` }];
  if (rest.length === 0) {
    crumbs.push({ label: hit.fn.label });
    return crumbs;
  }
  crumbs.push({ label: hit.fn.label, href: hit.fn.path });
  crumbs.push({ label: rest[0] === "new" ? "Thêm mới" : "Chi tiết" });
  return crumbs;
}
```
Run: `npm test -- tests/lib/nav.test.ts` → PASS.

- [ ] **Step 6: Components của shell**

`src/components/shell/Sidebar.tsx`:
```tsx
"use client";

import clsx from "clsx";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavModule } from "@/config/app.config";
import { findActiveFunction } from "@/lib/nav";
import { APP_NAME } from "@/lib/version";
import { Icon } from "./icons";

const OPEN_KEY = "nav-open"; // trạng thái mở accordion: persist theo PHIÊN (sessionStorage)
const COLLAPSE_KEY = "sidebar-collapsed";

export function Sidebar({ nav }: { nav: NavModule[] }) {
  const pathname = usePathname();
  const active = findActiveFunction(nav, pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
      const raw = sessionStorage.getItem(OPEN_KEY);
      if (raw) setOpen(JSON.parse(raw));
    } catch {
      /* storage bị chặn: dùng mặc định */
    }
  }, []);

  // Module chứa chức năng đang active tự expand
  useEffect(() => {
    if (active) setOpen((o) => (o[active.module.key] ? o : { ...o, [active.module.key]: true }));
  }, [active?.module.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleModule = (key: string) =>
    setOpen((o) => {
      const next = { ...o, [key]: !o[key] };
      try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* bỏ qua */ }
      return next;
    });

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* bỏ qua */ }
      return !c;
    });

  return (
    <aside
      aria-label="Điều hướng chính"
      className={clsx(
        "z-sidebar hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-standard md:flex",
        // 768–1023: tự thu về icon rail; ≥1024: theo lựa chọn người dùng
        collapsed ? "w-16" : "w-16 lg:w-64",
      )}
    >
      <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
        <span className={clsx("truncate text-sm font-semibold", collapsed ? "hidden" : "hidden lg:block")}>{APP_NAME}</span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
          className="hidden h-8 w-8 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover lg:flex"
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {nav.map((m) => {
          const isActiveModule = active?.module.key === m.key || (m.type === "flat" && pathname === m.path);
          const expanded = !collapsed && m.type === "accordion" && open[m.key];
          const href = m.type === "flat" ? m.path! : `/m/${m.key}`;
          return (
            <div key={m.key} className="mb-0.5">
              <div
                className={clsx(
                  "flex h-10 items-center rounded-sm border-l-[3px]",
                  isActiveModule && m.type === "flat" ? "border-accent bg-accent-soft text-accent" : "border-transparent hover:bg-hover",
                )}
              >
                <Link
                  href={href}
                  title={m.label}
                  onClick={() => m.type === "accordion" && !open[m.key] && toggleModule(m.key)}
                  className={clsx(
                    "flex min-w-0 flex-1 items-center gap-3 px-3 text-sm font-medium",
                    isActiveModule ? "text-accent" : "text-fg-secondary",
                  )}
                >
                  <Icon name={m.icon} />
                  <span className={clsx("truncate", collapsed ? "hidden" : "hidden lg:inline")}>{m.label}</span>
                </Link>
                {m.type === "accordion" && !collapsed && (
                  <button
                    type="button"
                    aria-label={`${expanded ? "Thu gọn" : "Mở rộng"} ${m.label}`}
                    aria-expanded={!!expanded}
                    onClick={() => toggleModule(m.key)}
                    className="hidden h-8 w-8 items-center justify-center text-fg-muted hover:text-fg lg:flex"
                  >
                    <ChevronDown size={16} className={clsx("transition-transform", expanded && "rotate-180")} aria-hidden />
                  </button>
                )}
              </div>

              {expanded && (
                <div className="hidden pb-1 lg:block">
                  {m.categories.map((c) => (
                    <div key={c.key} className="mt-1">
                      <div className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">
                        {c.label}
                      </div>
                      {c.functions.map((f) => {
                        const on = active?.fn.key === f.key;
                        return (
                          <Link
                            key={f.key}
                            href={f.path}
                            aria-current={on ? "page" : undefined}
                            className={clsx(
                              "ml-8 flex h-9 items-center gap-2 truncate rounded-sm border-l-[3px] px-3 text-sm",
                              on ? "border-accent bg-accent-soft font-medium text-accent" : "border-transparent text-fg-secondary hover:bg-hover",
                            )}
                          >
                            <span className="truncate">{f.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
```
`src/components/shell/BottomNav.tsx` (mobile `<768`; Radix Dialog làm bottom sheet để có focus trap + Escape):
```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavModule } from "@/config/app.config";
import { findActiveFunction } from "@/lib/nav";
import { Icon } from "./icons";

const hrefOf = (m: NavModule) => (m.type === "flat" ? m.path! : `/m/${m.key}`);

export function BottomNav({ nav }: { nav: NavModule[] }) {
  const pathname = usePathname();
  const active = findActiveFunction(nav, pathname);
  const [sheet, setSheet] = useState(false);
  const shown = nav.slice(0, 4); // Trang chủ đầu tiên + 3 module hay dùng nhất theo thứ tự nghiệp vụ

  return (
    <nav aria-label="Điều hướng nhanh" className="fixed inset-x-0 bottom-0 z-sidebar flex h-14 border-t border-border bg-surface md:hidden">
      {shown.map((m) => {
        const on = active?.module.key === m.key || (m.type === "flat" && pathname === m.path);
        return (
          <Link key={m.key} href={hrefOf(m)} className={clsx("flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs", on ? "text-accent" : "text-fg-secondary")}>
            <Icon name={m.icon} />
            <span className="truncate">{m.label}</span>
          </Link>
        );
      })}
      <Dialog.Root open={sheet} onOpenChange={setSheet}>
        <Dialog.Trigger className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-fg-secondary">
          <Menu size={20} aria-hidden />
          <span>Thêm</span>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-sheet max-h-[80dvh] overflow-y-auto rounded-t-lg border-t border-border bg-raised p-4 shadow-lg">
            <Dialog.Title className="mb-3 text-base font-semibold">Tất cả chức năng</Dialog.Title>
            <Dialog.Description className="sr-only">Danh sách module và chức năng</Dialog.Description>
            {nav.map((m) => (
              <div key={m.key} className="mb-3">
                <Link href={hrefOf(m)} onClick={() => setSheet(false)} className="flex min-h-11 items-center gap-3 text-sm font-semibold">
                  <Icon name={m.icon} />
                  {m.label}
                </Link>
                {m.categories.flatMap((c) => c.functions).map((f) => (
                  <Link key={f.key} href={f.path} onClick={() => setSheet(false)} className="ml-8 flex min-h-11 items-center text-sm text-fg-secondary">
                    {f.label}
                  </Link>
                ))}
              </div>
            ))}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </nav>
  );
}
```
`src/components/shell/UserMenu.tsx`:
```tsx
"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(-2).map((w) => w[0]?.toUpperCase()).join("");

export function UserMenu({ fullName, username }: { fullName: string; username: string }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger aria-label={`Tài khoản ${fullName}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-fg-on-accent">
        {initials(fullName)}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={6} className="z-dropdown min-w-52 rounded-md border border-border bg-raised p-1 shadow-md">
          <div className="px-3 py-2">
            <div className="text-sm font-semibold">{fullName}</div>
            <div className="text-xs text-fg-muted">{username}</div>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-[var(--border-default)]" />
          <Dropdown.Item asChild>
            <Link href="/change-password" className="flex h-9 items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover">
              <KeyRound size={16} aria-hidden /> Đổi mật khẩu
            </Link>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => signOut({ callbackUrl: "/login" })}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover"
          >
            <LogOut size={16} aria-hidden /> Đăng xuất
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
```
`src/components/shell/Breadcrumb.tsx`:
```tsx
"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavModule } from "@/config/app.config";
import { resolveBreadcrumb } from "@/lib/nav";

export function Breadcrumb({ nav }: { nav: NavModule[] }) {
  const crumbs = resolveBreadcrumb(nav, usePathname());
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Đường dẫn" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-fg-secondary">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={14} aria-hidden className="shrink-0 text-fg-muted" />}
            {c.href ? (
              <Link href={c.href} className="truncate hover:text-fg">{c.label}</Link>
            ) : (
              <span aria-current="page" className="truncate font-medium text-fg">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
```
`src/components/shell/Header.tsx`, `Footer.tsx`, `AppShell.tsx`:
```tsx
// Header.tsx
import type { NavModule } from "@/config/app.config";
import { APP_NAME } from "@/lib/version";
import { Breadcrumb } from "./Breadcrumb";
import { ThemeSwitch } from "./ThemeSwitch";
import { UserMenu } from "./UserMenu";

export function Header({ nav, user }: { nav: NavModule[]; user: { fullName: string; username: string } }) {
  return (
    <header className="sticky top-0 z-header flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 lg:px-6">
      <div className="min-w-0">
        <span className="text-sm font-semibold md:hidden">{APP_NAME}</span>
        <div className="hidden md:block"><Breadcrumb nav={nav} /></div>
      </div>
      <div className="flex items-center gap-3">
        <ThemeSwitch />
        <UserMenu fullName={user.fullName} username={user.username} />
      </div>
    </header>
  );
}
```
```tsx
// Footer.tsx — 1 dòng
import { APP_NAME } from "@/lib/version";

export function Footer() {
  return (
    <footer className="hidden h-8 shrink-0 items-center justify-center border-t border-border bg-surface text-xs text-fg-muted lg:flex">
      © {new Date().getFullYear()} {APP_NAME}
    </footer>
  );
}
```
```tsx
// AppShell.tsx
import type { NavModule } from "@/config/app.config";
import { BottomNav } from "./BottomNav";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

export function AppShell({
  nav, user, children,
}: { nav: NavModule[]; user: { fullName: string; username: string }; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh bg-canvas text-fg">
      <Sidebar nav={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header nav={nav} user={user} />
        {/* Vùng cuộn DUY NHẤT của trang. Padding ngang cố định theo breakpoint (theming.md mục 1). */}
        <main className="app-shell-main min-h-0 flex-1 overflow-y-auto px-3 pb-20 pt-4 md:px-4 md:pb-4 lg:px-5 xl:px-6">
          {children}
        </main>
        <Footer />
      </div>
      <BottomNav nav={nav} />
    </div>
  );
}
```
`src/components/shell/ModuleLanding.tsx` (Level 2 — sinh từ CÙNG config):
```tsx
"use client";

import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { useState } from "react";
import type { NavModule } from "@/config/app.config";
import { normalizeSearch } from "@/lib/search";
import { Icon } from "./icons";

export function ModuleLanding({ module }: { module: NavModule }) {
  const [q, setQ] = useState("");
  const needle = normalizeSearch(q);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/" className="flex h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-hover">
          <ArrowLeft size={16} aria-hidden /> Trang chủ
        </Link>
        <h1 className="text-xl font-semibold">{module.label}</h1>
        <label className="relative ml-auto w-full sm:w-72">
          <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm chức năng…"
            aria-label="Tìm chức năng"
            className="h-10 w-full rounded-sm border border-border bg-canvas pl-9 pr-3 text-sm"
          />
        </label>
      </div>
      {module.categories.map((c) => {
        const fns = c.functions.filter((f) => !needle || normalizeSearch(f.label + " " + f.desc).includes(needle));
        if (fns.length === 0) return null;
        return (
          <section key={c.key} className="mb-8">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-accent">
              <span className="h-4 w-1 rounded-full bg-accent" aria-hidden />
              {c.label}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {fns.map((f) => (
                <Link key={f.key} href={f.path} className="flex min-h-28 flex-col gap-2 rounded-md border border-border bg-surface p-5 transition-shadow hover:shadow-md">
                  <span className="flex h-11 w-11 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <Icon name={f.icon} size={22} />
                  </span>
                  <span className="text-base font-semibold">{f.label}</span>
                  {f.desc && <span className="line-clamp-2 text-sm text-fg-secondary">{f.desc}</span>}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
```
Tạo ngay `src/lib/search.ts` bản đầu (thuần TypeScript, dùng được cả client; Task 10 bổ sung `searchTextWhere` + test):
```ts
/** Chuẩn hoá để tìm không dấu: NFD bỏ dấu, đ→d, lowercase, gộp khoảng trắng. */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 7: Route & layout**

`src/app/(app)/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { requireActor } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  if (actor.mustChangePassword) redirect("/change-password"); // bị bắt đổi mật khẩu trước khi dùng
  const nav = buildNav(APP_NAV, actor.perms);
  return (
    <AppShell nav={nav} user={{ fullName: actor.fullName, username: actor.username }}>
      {children}
    </AppShell>
  );
}
```
`src/app/(app)/m/[module]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { ModuleLanding } from "@/components/shell/ModuleLanding";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { requireActor } from "@/server/auth/session";

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: key } = await params;
  const actor = await requireActor();
  const module = buildNav(APP_NAV, actor.perms).find((m) => m.key === key && m.type === "accordion");
  if (!module) notFound(); // module không tồn tại HOẶC không có quyền: không lộ cấu trúc hệ thống
  return <ModuleLanding module={module} />;
}
```
`src/app/403/page.tsx`:
```tsx
import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
      <h1 className="text-2xl font-semibold">403 — Không có quyền truy cập</h1>
      <p className="max-w-md text-fg-secondary">Tài khoản của bạn chưa được cấp quyền cho chức năng này. Liên hệ giám đốc để được cấp quyền.</p>
      <Link href="/" className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent">Về trang chủ</Link>
    </main>
  );
}
```
`src/app/(app)/page.tsx` — giữ trang tạm cho tới Task 14: `export default function Home() { return <h1 className="text-xl font-semibold">Trang chủ</h1>; }`.

- [ ] **Step 8: Test Sidebar (RTL) — active, quyền, phân vùng click accordion**

`tests/shell/sidebar.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/shell/Sidebar";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";

let mockPath = "/system/users";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath }));

afterEach(cleanup);

const nav = buildNav(APP_NAV, new Set(["user.view", "role.manage", "audit.view"]));

describe("Sidebar", () => {
  it("module chứa chức năng đang active tự mở và đánh dấu aria-current", () => {
    mockPath = "/system/users";
    render(<Sidebar nav={nav} />);
    expect(screen.getByRole("link", { name: "Người dùng" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Nhóm quyền" })).not.toHaveAttribute("aria-current");
  });

  it("không có quyền → chức năng KHÔNG xuất hiện (ẩn hẳn)", () => {
    mockPath = "/system/users";
    render(<Sidebar nav={nav} />);
    expect(screen.queryByRole("link", { name: "Cài đặt danh mục" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Kế toán" })).toBeNull();
  });

  it("bấm chevron CHỈ thu/mở, không điều hướng; nhiều module mở độc lập", async () => {
    mockPath = "/";
    render(<Sidebar nav={nav} />);
    const chevron = screen.getByRole("button", { name: /Mở rộng Hệ thống/ });
    await userEvent.click(chevron);
    expect(screen.getByRole("link", { name: "Người dùng" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Thu gọn Hệ thống/ }));
    expect(screen.queryByRole("link", { name: "Người dùng" })).toBeNull();
  });
});
```
Run: `npm test -- tests/shell tests/config tests/lib/nav.test.ts`
Expected: PASS.

- [ ] **Step 9: `design/PROJECT_BRIEF.md` — đầu vào `crm-design` cho mọi plan sau (điền từ `examples/PROJECT_BRIEF.template.md`)**

```markdown
# PROJECT_BRIEF — Phần mềm quản lý Xưởng tôn Đặng Hương

## 1. Tổng quan
- Loại: ERP nghiệp vụ (đơn hàng – kho FIFO – giao hàng – kế toán – sản xuất/gia công – kết sổ kỳ)
- Người dùng: Giám đốc, Kế toán, Thủ kho, Thủ quỹ (2 người), Bán hàng
- Stack: Next.js 15 + Tailwind 3.4 (token) + Radix + TanStack Query
- Locale: vi-VN; tiền ₫ (VND); ngày dd/mm/yyyy; nghìn "."; thập phân ","; múi giờ Asia/Ho_Chi_Minh
- Thiết bị: 100% máy tính (D-5): cơ chế mobile có sẵn ở component chung, không nghiệm thu từng màn

## 2. Thương hiệu → design/app-override.css
- Accent: mặc định skill (#2563eb) — ASSUMPTION chờ màu thương hiệu; Font: Be Vietnam Pro; Semantic: mặc định
- Dark mode: Sáng/Tối/Hệ thống, mặc định Hệ thống

## 3. Schema → db/db_schema.sql (sinh bằng npm run db:schema)

## 4. Điều hướng → src/config/app.config.ts (1 nguồn; đã liệt kê đủ 81 màn theo mã phạm vi)
Tất cả module dùng Accordion (≥ 3 chức năng), riêng Trang chủ là Flat. Thứ tự theo luồng nghiệp vụ.

## 5. View mỗi chức năng
| Chức năng | View chính | Ghi chú |
|---|---|---|
| Mọi danh sách chứng từ (đơn, phiếu nhập/thu/chi, chuyến, trả hàng…) | Table server-paginated + Stat Card trạng thái + QuickTimeFilter | Mở chi tiết = Full-page Detail `/{module}/{id}?tab=`; tạo mới `/{module}/new` |
| Đơn hàng | Table (+ Kanban theo trục giao hàng khi cần) | 2 trục trạng thái: badge riêng, không gộp |
| Tồn kho, KH, NCC, SP | Table | Import Excel (D-6) |
| Cài đặt danh mục (8,13–18) | Catalog Settings | CATALOG_SECTIONS: nhóm KH, kho, xe & lái xe, tuyến, loại thu chi, ngân hàng/quỹ, kiểu gia công |
| Sổ kho, sổ quỹ, sổ NH, công nợ chi tiết | Table (không có chi tiết từng dòng) | Số dư TÍNH KHI ĐỌC, không cột lưu sẵn |
| XNT, báo cáo 67–73 | Pivot/Report | Ẩn cột giá vốn/lãi theo quyền ở SERVER |
| Trang chủ (7) | Dashboard số liệu trong ngày | GĐ1b-B7 |
| Kết sổ K5 | Form + checklist (mục đỏ khóa nút) | Chỉ Giám đốc |

## 6. Chi tiết bản ghi — tab & Action Bar
| Đối tượng | Tab (key) | Action (chỉ hiện khi) | Quyền |
|---|---|---|---|
| Đơn hàng | info · lines · delivery · payments · history | In hóa đơn/phiếu giao; Sửa (kỳ mở); Hủy (chưa dính tiền); Khôi phục (đã hủy, kỳ mở) | order.edit / order.cancel / order.restore |
| Khách hàng | info · orders · debt · discount · history | Gọi; Sửa; Gộp mã | partner.manage |
| Phiếu nhập | info · lines · freight · history | In; Sửa (kỳ mở); Hủy | purchase.edit / purchase.cancel |
| Chuyến giao | info · orders · settlement | In phiếu giao; Nhập kết quả; Đối soát; Xác nhận nhận tiền (thủ quỹ) | trip.manage / trip.settle / trip.confirm_cash |
| Người dùng | info · roles · history | Khóa/Mở khóa; Cấp lại mật khẩu | user.manage |

## 7. Workflow
- Giao hàng: Mới tạo → Chờ hàng → Sẵn hàng → Đã xếp xe → Đang giao → Đã giao / Giao một phần / Không giao được
- Thanh toán (trục độc lập): Chưa thu → Đã cọc → Thu một phần → Đã thanh toán → Nợ ghi sổ → Hẹn đơn sau trả → Dư tiền
- Chuyến: PLANNED → ON_ROAD → RETURNED → SETTLED → CONFIRMED (chênh lệch ≠ 0 bắt buộc lý do)
- Không có Kanban kéo-thả thay đổi trạng thái tiền/kho (chuyển trạng thái đi qua nghiệp vụ có transaction)

## 8. Phân quyền hiển thị
- Menu/action: ẩn HẲN khi thiếu quyền. Field nhạy cảm (giá vốn, lãi, giá nhập, giá bán): loại khỏi DTO ở server (redactDeep), UI không render cột.
- "Chỉ khách của mình": phạm vi dữ liệu ở query (partnerScopeWhere), không phải ẩn UI.

## 9. Ngoài phạm vi
Hóa đơn VAT, app điện thoại lái xe, nhiều chi nhánh/chuyển kho, tồn theo cuộn, nối ngân hàng tự động, Zalo/SMS, chấm công/lương, notification center (không có mã trong Phạm vi → không làm).
```

- [ ] **Step 10: Chạy toàn bộ và commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: xanh; build thành công.
```bash
git add -A
git commit -m "feat(ui): App Shell + app.config 1 nguồn (đủ 81 màn), sidebar/bottom nav/landing/breadcrumb, PROJECT_BRIEF"
```

---

### Task 9: Khung bảng danh sách (Badge, StatCard, EmptyState, PaginationFooter, DataTable, ListPageLayout)

**Files:**
- Create: `src/components/ui/{Badge,StatCard,EmptyState,PaginationFooter,DataTable,ListPageLayout,index}.tsx` (`index.ts` là barrel)
- Create: `src/lib/pagination.ts`
- Test: `tests/lib/pagination.test.ts`, `tests/ui/badge.test.tsx`, `tests/ui/data-table.test.tsx`

**Interfaces:**
- Produces:
  - `PAGE_SIZES = [10, 15, 20, 50, 100] as const`, `DEFAULT_PAGE_SIZE = 20`, `pageWindow(current, total): (number | "…")[]`, `nextSort(current: string | undefined, key: string): string | undefined` (`@/lib/pagination`)
  - `<Badge tone="info|success|warning|tertiary|danger|neutral">`, `<StatCard label value delta? tone? href? active?>`, `<EmptyState kind="empty|no-result|error" title description action?>`
  - `<PaginationFooter total page pageSize buildHref />`
  - `<DataTable<T> id columns rows rowKey rowHref? rowActions? sort? buildSortHref? mobileSummary? />`, `interface Column<T> { key; label; align?: "left"|"right"; sortable?; width?; hiddenByDefault?; primaryOnMobile?; render(row: T): ReactNode }`
  - `<ListPageLayout title actions stats filters footer>{table}</ListPageLayout>` — bố cục flex-fill bắt buộc

- [ ] **Step 1: Test logic phân trang & sort (đỏ)**

`tests/lib/pagination.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, nextSort, PAGE_SIZES, pageWindow } from "@/lib/pagination";

describe("pageWindow", () => {
  it("ít trang: hiện hết", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("nhiều trang: rút gọn với '…' và luôn có trang đầu/cuối/hiện tại ±1", () => {
    expect(pageWindow(1, 25)).toEqual([1, 2, 3, "…", 25]);
    expect(pageWindow(3, 25)).toEqual([1, 2, 3, 4, "…", 25]);
    expect(pageWindow(12, 25)).toEqual([1, "…", 11, 12, 13, "…", 25]);
    expect(pageWindow(24, 25)).toEqual([1, "…", 23, 24, 25]);
    expect(pageWindow(25, 25)).toEqual([1, "…", 24, 25]);
  });
  it("total = 0 → 1 trang", () => {
    expect(pageWindow(1, 0)).toEqual([1]);
  });
});

describe("nextSort — click header: tăng → giảm → bỏ sort", () => {
  it("chuyển vòng", () => {
    expect(nextSort(undefined, "name")).toBe("name");
    expect(nextSort("name", "name")).toBe("-name");
    expect(nextSort("-name", "name")).toBeUndefined();
    expect(nextSort("code", "name")).toBe("name"); // đổi cột → tăng dần cột mới
  });
});

describe("hằng số", () => {
  it("cỡ trang theo crm-design", () => {
    expect([...PAGE_SIZES]).toEqual([10, 15, 20, 50, 100]);
    expect(DEFAULT_PAGE_SIZE).toBe(20);
  });
});
```
`src/lib/pagination.ts`:
```ts
export const PAGE_SIZES = [10, 15, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** Dãy số trang hiển thị: 1 … 11 12 13 … 25. */
export function pageWindow(current: number, total: number): (number | "…")[] {
  const last = Math.max(1, total);
  if (last <= 5) return Array.from({ length: last }, (_, i) => i + 1);
  const keep = new Set([1, last, current - 1, current, current + 1].filter((p) => p >= 1 && p <= last));
  // đầu/cuối luôn kéo theo 2 trang liền kề để không nhấp nháy khi ở sát mép
  if (current <= 2) [2, 3].forEach((p) => keep.add(p));
  if (current >= last - 1) [last - 2, last - 1].forEach((p) => keep.add(p));
  const pages = [...keep].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1]! > 1) out.push("…");
    out.push(p);
  });
  return out;
}

/** Vòng sort khi click header: tăng → giảm (tiền tố '-') → bỏ sort. */
export function nextSort(current: string | undefined, key: string): string | undefined {
  if (current === key) return `-${key}`;
  if (current === `-${key}`) return undefined;
  return key;
}
```
Run: `npm test -- tests/lib/pagination.test.ts`
Expected: PASS. Nếu `pageWindow(1, 25)` ra `[1, 2, 3, "…", 25]` ✔; nếu sai ở mép, chỉnh logic — KHÔNG sửa expectation (đây là hành vi crm-design: `1 2 3 … 24 25`, xem `view-table.md` mục 6).

- [ ] **Step 2: Badge, StatCard, EmptyState**

`src/components/ui/Badge.tsx` — bảng màu semantic CỐ ĐỊNH toàn hệ thống (`theming.md`):
```tsx
import clsx from "clsx";

export type BadgeTone = "info" | "success" | "warning" | "tertiary" | "danger" | "neutral";

// Ý nghĩa → màu cố định, không đổi theo module
const TONES: Record<BadgeTone, string> = {
  info: "bg-info-soft text-info", // Mới / Đang xử lý
  success: "bg-success-soft text-success", // Đang hoạt động / Thành công
  warning: "bg-warning-soft text-warning", // Chờ / Đang thiết lập
  tertiary: "bg-tertiary-soft text-tertiary", // Hoàn tất
  danger: "bg-danger-soft text-danger", // Hủy / Từ chối / Lỗi
  neutral: "bg-hover text-fg-secondary", // Nháp / Vô hiệu
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", TONES[tone], className)}>
      {children}
    </span>
  );
}
```
`src/components/ui/StatCard.tsx` (dải tóm tắt theo trạng thái; là `<Link>` khi có `href` để bấm lọc):
```tsx
import clsx from "clsx";
import Link from "next/link";
import { formatNumber } from "@/lib/format";

export function StatCard({
  label, value, tone = "neutral", href, active,
}: {
  label: string;
  value: number | null;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  href?: string;
  active?: boolean;
}) {
  const valueColor = { neutral: "text-fg", success: "text-success", warning: "text-warning", danger: "text-danger", info: "text-info" }[tone];
  const body = (
    <>
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{label}</span>
      <span className={clsx("tabular text-2xl font-bold", valueColor)}>{formatNumber(value)}</span>
    </>
  );
  const cls = clsx(
    "flex min-w-32 flex-1 flex-col gap-1 rounded-md border bg-surface p-3",
    active ? "border-accent bg-accent-soft" : "border-border",
    href && "transition-colors hover:bg-hover",
  );
  return href ? <Link href={href} className={cls} aria-current={active ? "true" : undefined}>{body}</Link> : <div className={cls}>{body}</div>;
}
```
`src/components/ui/EmptyState.tsx` — đủ 3 loại (`states-and-feedback.md`):
```tsx
import { AlertTriangle, Inbox, SearchX } from "lucide-react";

const ICON = { empty: Inbox, "no-result": SearchX, error: AlertTriangle } as const;

export function EmptyState({
  kind, title, description, action,
}: {
  kind: "empty" | "no-result" | "error";
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const Cmp = ICON[kind];
  return (
    <div role={kind === "error" ? "alert" : undefined} className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <Cmp size={36} aria-hidden className={kind === "error" ? "text-danger" : "text-fg-muted"} />
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="max-w-md text-sm text-fg-secondary">{description}</p>}
      {action}
    </div>
  );
}
```

- [ ] **Step 3: `PaginationFooter`**

`src/components/ui/PaginationFooter.tsx`:
```tsx
import clsx from "clsx";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { PAGE_SIZES, pageWindow } from "@/lib/pagination";

interface Props {
  total: number;
  page: number;
  pageSize: number;
  /** Tạo href giữ nguyên mọi query khác (search/filter/sort). */
  buildHref: (patch: { page?: number; pageSize?: number }) => string;
}

const btn = "flex h-8 w-8 items-center justify-center rounded-sm text-sm hover:bg-hover";

/** LUÔN ở đáy khung (flex-shrink-0 + sticky bottom) dù ít hay nhiều dòng. */
export function PaginationFooter({ total, page, pageSize, buildHref }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const disabled = "pointer-events-none opacity-40";

  return (
    <div className="sticky bottom-0 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-3 py-2 text-sm">
      <div className="flex items-center gap-3 text-fg-secondary">
        <span className="tabular">Hiển thị {formatNumber(from)}–{formatNumber(to)} / Tổng: {formatNumber(total)}</span>
        <nav aria-label="Số dòng mỗi trang" className="hidden items-center gap-1 lg:flex">
          {PAGE_SIZES.map((s) => (
            <Link key={s} href={buildHref({ pageSize: s, page: 1 })} aria-current={s === pageSize ? "true" : undefined}
              className={clsx("rounded-sm px-2 py-1 tabular", s === pageSize ? "bg-accent-soft font-semibold text-accent" : "hover:bg-hover")}>
              {s}
            </Link>
          ))}
        </nav>
      </div>

      {/* PC: nút số trang */}
      <nav aria-label="Phân trang" className="hidden items-center gap-1 lg:flex">
        <Link aria-label="Trang đầu" href={buildHref({ page: 1 })} className={clsx(btn, page <= 1 && disabled)}><ChevronsLeft size={16} aria-hidden /></Link>
        <Link aria-label="Trang trước" href={buildHref({ page: page - 1 })} className={clsx(btn, page <= 1 && disabled)}><ChevronLeft size={16} aria-hidden /></Link>
        {pageWindow(page, pages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-fg-muted">…</span>
          ) : (
            <Link key={p} href={buildHref({ page: p })} aria-current={p === page ? "page" : undefined}
              className={clsx("tabular flex h-8 w-8 items-center justify-center rounded-full text-sm", p === page ? "bg-accent font-semibold text-fg-on-accent" : "hover:bg-hover")}>
              {p}
            </Link>
          ),
        )}
        <Link aria-label="Trang sau" href={buildHref({ page: page + 1 })} className={clsx(btn, page >= pages && disabled)}><ChevronRight size={16} aria-hidden /></Link>
        <Link aria-label="Trang cuối" href={buildHref({ page: pages })} className={clsx(btn, page >= pages && disabled)}><ChevronsRight size={16} aria-hidden /></Link>
      </nav>

      {/* Mobile/tablet: ‹ Prev — Trang 3/25 — Next › */}
      <nav aria-label="Phân trang" className="flex items-center gap-2 lg:hidden">
        <Link aria-label="Trang trước" href={buildHref({ page: page - 1 })} className={clsx("flex h-11 w-11 items-center justify-center rounded-sm border border-border", page <= 1 && disabled)}><ChevronLeft size={18} aria-hidden /></Link>
        <span className="tabular text-fg-secondary">Trang {page}/{pages}</span>
        <Link aria-label="Trang sau" href={buildHref({ page: page + 1 })} className={clsx("flex h-11 w-11 items-center justify-center rounded-sm border border-border", page >= pages && disabled)}><ChevronRight size={18} aria-hidden /></Link>
      </nav>
    </div>
  );
}
```

- [ ] **Step 4: `ListPageLayout` — bố cục flex-fill bắt buộc (chống "pagination nhảy" — `view-table.md` mục 6)**

`src/components/ui/ListPageLayout.tsx`:
```tsx
export function ListPageLayout({
  title, actions, stats, filters, footer, children,
}: {
  title: string;
  /** Thêm mới / Import / Export — luôn hiển thị cả khi danh sách rỗng. */
  actions?: React.ReactNode;
  stats?: React.ReactNode;
  filters?: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {stats && <div className="flex flex-wrap gap-3">{stats}</div>}
      {filters}
      {/* .page-container: khung cố định; chỉ vùng bảng cuộn, footer phân trang không nhảy */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface">
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Test `DataTable` (đỏ)**

`tests/ui/data-table.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataTable, type Column } from "@/components/ui/DataTable";

interface Row { id: number; code: string; name: string; qty: number }
const rows: Row[] = [
  { id: 1, code: "SP1", name: "Tôn lạnh 0.45", qty: 1250 },
  { id: 2, code: "SP2", name: "Tôn xốp 11 sóng", qty: 30.5 },
];
const columns: Column<Row>[] = [
  { key: "code", label: "Mã", sortable: true, render: (r) => r.code },
  { key: "name", label: "Tên", sortable: true, primaryOnMobile: true, render: (r) => r.name },
  { key: "qty", label: "Tồn", align: "right", render: (r) => r.qty },
];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("DataTable", () => {
  it("render header + dòng; header sortable là link sort đúng vòng", () => {
    render(
      <DataTable id="t1" columns={columns} rows={rows} rowKey={(r) => r.id} sort="name"
        buildSortHref={(s) => `/x?sort=${s ?? ""}`} />,
    );
    expect(screen.getAllByText("Tôn lạnh 0.45").length).toBeGreaterThan(0);
    const name = screen.getAllByRole("link", { name: /Tên/ })[0]!;
    expect(name).toHaveAttribute("href", "/x?sort=-name");
    expect(screen.getAllByRole("link", { name: /Mã/ })[0]).toHaveAttribute("href", "/x?sort=code");
    expect(screen.getAllByRole("columnheader", { name: /Tên/ })[0]).toHaveAttribute("aria-sort", "ascending");
  });

  it("số căn phải + tabular", () => {
    render(<DataTable id="t2" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const cell = screen.getAllByText("1250")[0]!.closest("td")!;
    expect(cell.className).toMatch(/text-right/);
    expect(cell.className).toMatch(/tabular/);
  });

  it("ẩn/hiện cột và nhớ lựa chọn (localStorage)", async () => {
    const { unmount } = render(<DataTable id="t3" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    await userEvent.click(screen.getByRole("button", { name: "Cột hiển thị" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Mã" }));
    expect(screen.queryAllByRole("columnheader", { name: /^Mã/ })).toHaveLength(0);
    unmount();
    render(<DataTable id="t3" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryAllByRole("columnheader", { name: /^Mã/ })).toHaveLength(0);
  });

  it("click dòng điều hướng bằng href (Link), không mở panel", () => {
    render(<DataTable id="t4" columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/items/${r.id}`} />);
    expect(screen.getAllByRole("link", { name: "Tôn lạnh 0.45" })[0]).toHaveAttribute("href", "/items/1");
  });

  it("cột thao tác chỉ icon có aria-label; quá 3 action → kebab", async () => {
    render(
      <DataTable id="t5" columns={columns} rows={[rows[0]!]} rowKey={(r) => r.id}
        rowActions={() => [
          { key: "view", label: "Xem", icon: "eye", href: "/v" },
          { key: "edit", label: "Sửa", icon: "pencil", href: "/e" },
          { key: "del", label: "Xóa", icon: "trash", danger: true, onClick: () => {} },
          { key: "lock", label: "Khóa", icon: "lock", onClick: () => {} },
        ]} />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Xem" })).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Khóa" })).toBeNull(); // nằm trong kebab
    await userEvent.click(within(table).getByRole("button", { name: "Thêm thao tác" }));
    expect(await screen.findByRole("menuitem", { name: "Khóa" })).toBeInTheDocument();
  });

  it("không có dòng → không render bảng rỗng (để trang hiện EmptyState)", () => {
    const { container } = render(<DataTable id="t6" columns={columns} rows={[]} rowKey={(r) => r.id} />);
    expect(container.querySelector("tbody tr")).toBeNull();
  });
});
```
- [ ] **Step 6: Chạy → đỏ; cài `DataTable`**

`src/components/ui/DataTable.tsx`:
```tsx
"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Check, Columns3, Eye, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { nextSort } from "@/lib/pagination";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  width?: number;
  hiddenByDefault?: boolean;
  /** Ô chính trên card mobile (tiêu đề card). */
  primaryOnMobile?: boolean;
  render: (row: T) => React.ReactNode;
}

export interface RowAction {
  key: string;
  label: string;
  icon: "eye" | "pencil" | "trash" | "lock";
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}

const ACTION_ICONS = { eye: Eye, pencil: Pencil, trash: Trash2, lock: Lock };
const MAX_INLINE_ACTIONS = 3;

interface Props<T> {
  /** Khoá lưu cột ẩn/độ rộng vào localStorage. */
  id: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  rowHref?: (row: T) => string;
  rowActions?: (row: T) => RowAction[];
  /** Cột sort hiện tại ('-name' = giảm dần). */
  sort?: string;
  buildSortHref?: (sort: string | undefined) => string;
}

function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch { /* bỏ qua */ }
  }, [key]);
  return [value, (v) => { setValue(v); try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* bỏ qua */ } }];
}

export function DataTable<T>({ id, columns, rows, rowKey, rowHref, rowActions, sort, buildSortHref }: Props<T>) {
  const router = useRouter();
  const [hidden, setHidden] = useStored<Record<string, boolean>>(`table:${id}:hidden`,
    Object.fromEntries(columns.filter((c) => c.hiddenByDefault).map((c) => [c.key, true])));
  const [widths, setWidths] = useStored<Record<string, number>>(`table:${id}:widths`, {});
  const visible = columns.filter((c) => !hidden[c.key]);
  const primary = columns.find((c) => c.primaryOnMobile) ?? columns[0]!;

  function startResize(key: string, e: React.PointerEvent) {
    const startX = e.clientX;
    const th = (e.currentTarget as HTMLElement).closest("th")!;
    const startW = th.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => setWidths({ ...widths, [key]: Math.max(64, Math.round(startW + ev.clientX - startX)) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const actionsCell = (row: T) => {
    const actions = rowActions?.(row) ?? [];
    if (actions.length === 0) return null;
    const inline = actions.length > MAX_INLINE_ACTIONS ? actions.slice(0, MAX_INLINE_ACTIONS) : actions;
    const rest = actions.length > MAX_INLINE_ACTIONS ? actions.slice(MAX_INLINE_ACTIONS) : [];
    const iconBtn = "flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover";
    return (
      <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        {inline.map((a) => {
          const Ic = ACTION_ICONS[a.icon];
          const cls = clsx(iconBtn, a.danger && "text-danger");
          return a.href ? (
            <Link key={a.key} href={a.href} aria-label={a.label} title={a.label} className={cls}><Ic size={16} aria-hidden /></Link>
          ) : (
            <button key={a.key} type="button" aria-label={a.label} title={a.label} onClick={a.onClick} className={cls}><Ic size={16} aria-hidden /></button>
          );
        })}
        {rest.length > 0 && (
          <Dropdown.Root>
            <Dropdown.Trigger aria-label="Thêm thao tác" className={iconBtn}><MoreHorizontal size={16} aria-hidden /></Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="end" className="z-dropdown min-w-40 rounded-md border border-border bg-raised p-1 shadow-md">
                {rest.map((a) => (
                  <Dropdown.Item key={a.key} onSelect={() => (a.href ? router.push(a.href) : a.onClick?.())}
                    className={clsx("flex h-9 cursor-pointer items-center rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover", a.danger && "text-danger")}>
                    {a.label}
                  </Dropdown.Item>
                ))}
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Điều khiển cột */}
      <div className="flex justify-end border-b border-border px-2 py-1">
        <Dropdown.Root>
          <Dropdown.Trigger aria-label="Cột hiển thị" title="Cột hiển thị" className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover">
            <Columns3 size={16} aria-hidden />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" className="z-dropdown min-w-44 rounded-md border border-border bg-raised p-1 shadow-md">
              {columns.map((c) => (
                <Dropdown.CheckboxItem key={c.key} checked={!hidden[c.key]} onCheckedChange={(v) => setHidden({ ...hidden, [c.key]: !v })}
                  onSelect={(e) => e.preventDefault()}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover">
                  <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-sm border border-border-strong">{!hidden[c.key] && <Check size={12} />}</span>
                  {c.label}
                </Dropdown.CheckboxItem>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>

      {/* PC/tablet: bảng */}
      <table className="hidden w-full border-collapse text-sm md:table">
        <thead className="sticky top-0 z-header bg-surface">
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">
            {visible.map((c) => {
              const dir = sort === c.key ? "ascending" : sort === `-${c.key}` ? "descending" : "none";
              return (
                <th key={c.key} scope="col" aria-sort={c.sortable ? dir : undefined}
                  style={widths[c.key] ? { width: widths[c.key] } : c.width ? { width: c.width } : undefined}
                  className={clsx("relative px-3 py-2", c.align === "right" && "text-right")}>
                  {c.sortable && buildSortHref ? (
                    <Link href={buildSortHref(nextSort(sort, c.key))} className="inline-flex items-center gap-1 hover:text-fg">
                      {c.label}
                      {dir === "ascending" && <ArrowUp size={12} aria-hidden />}
                      {dir === "descending" && <ArrowDown size={12} aria-hidden />}
                    </Link>
                  ) : c.label}
                  <span role="separator" aria-orientation="vertical" onPointerDown={(e) => startResize(c.key, e)}
                    className="absolute right-0 top-1/4 h-1/2 w-1 cursor-col-resize rounded-full hover:bg-accent" />
                </th>
              );
            })}
            {rowActions && <th scope="col" className="w-28 px-3 py-2 text-right">Thao tác</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} onClick={rowHref ? () => router.push(rowHref(row)) : undefined}
              className={clsx("border-b border-border last:border-b-0 hover:bg-hover", rowHref && "cursor-pointer")}>
              {visible.map((c) => (
                <td key={c.key} className={clsx("px-3 py-2", c.align === "right" && "tabular text-right")}>
                  {c === primary && rowHref ? (
                    <Link href={rowHref(row)} onClick={(e) => e.stopPropagation()} className="hover:text-accent">{c.render(row)}</Link>
                  ) : c.render(row)}
                </td>
              ))}
              {rowActions && <td className="px-3 py-1">{actionsCell(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: card list (cùng dữ liệu & hành vi, khác hình thức) */}
      <ul className="divide-y divide-[var(--border-default)] md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="flex items-start justify-between gap-2 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {rowHref ? <Link href={rowHref(row)}>{primary.render(row)}</Link> : primary.render(row)}
              </div>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {visible.filter((c) => c !== primary).slice(0, 4).map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-fg-muted">{c.label}</dt>
                    <dd className={clsx("truncate", c.align === "right" && "tabular")}>{c.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {rowActions && <div className="shrink-0">{actionsCell(row)}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```
Barrel `src/components/ui/index.ts`:
```ts
export { Badge } from "./Badge";
export { DataTable, type Column, type RowAction } from "./DataTable";
export { EmptyState } from "./EmptyState";
export { ListPageLayout } from "./ListPageLayout";
export { PaginationFooter } from "./PaginationFooter";
export { StatCard } from "./StatCard";
```
Run: `npm test -- tests/ui/data-table.test.tsx`
Expected: PASS. (Test dùng `getAllBy*` vì bảng và card list cùng nằm trong DOM — jsdom không áp media query. Nếu `next/navigation` `useRouter` ném lỗi "invariant expected app router" trong test → thêm `vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/" }))` ở đầu test file.)

- [ ] **Step 7: Test Badge (semantic cố định)**

`tests/ui/badge.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/Badge";

afterEach(cleanup);

describe("Badge", () => {
  it.each([
    ["info", "text-info", "bg-info-soft"],
    ["success", "text-success", "bg-success-soft"],
    ["warning", "text-warning", "bg-warning-soft"],
    ["tertiary", "text-tertiary", "bg-tertiary-soft"],
    ["danger", "text-danger", "bg-danger-soft"],
    ["neutral", "text-fg-secondary", "bg-hover"],
  ] as const)("tone %s → chữ %s trên nền %s (pill)", (tone, text, bg) => {
    render(<Badge tone={tone}>Nhãn</Badge>);
    const el = screen.getByText("Nhãn");
    expect(el.className).toContain(text);
    expect(el.className).toContain(bg);
    expect(el.className).toContain("rounded-full");
  });
});
```

- [ ] **Step 8: Chạy toàn bộ và commit**

Run: `npm run lint && npm run typecheck && npm test`
```bash
git add -A
git commit -m "feat(ui): khung danh sách — DataTable PC/mobile, PaginationFooter dính đáy, Badge, StatCard, EmptyState"
```

---

### Task 10: Lớp truy vấn danh sách — URL params, tìm không dấu, `QuickTimeFilter`, Export Excel

**Files:**
- Create: `src/lib/query-params.ts`, `src/lib/time-presets.ts`, `src/server/export/xlsx.ts`
- Modify: `src/lib/search.ts` (thêm `searchTextWhere`)
- Create: `src/components/ui/{QuickTimeFilter,ExportButton,SearchBox}.tsx`
- Test: `tests/lib/query-params.test.ts`, `tests/lib/search.test.ts`, `tests/lib/time-presets.test.ts`, `tests/server/xlsx.test.ts`, `tests/ui/quick-time-filter.test.tsx`

**Interfaces:**
- Consumes: `toIct`, `ictStartOfDay` (`@/lib/time`), `PAGE_SIZES`, `DEFAULT_PAGE_SIZE` (`@/lib/pagination`), `normalizeSearch` (`@/lib/search`).
- Produces:
  - `interface ListParams { page:number; pageSize:number; sort?:string; q?:string; timePreset?:TimePreset; timeStart?:string; timeEnd?:string; filters:Record<string,string[]> }`, `parseListParams(sp: Record<string,string|string[]|undefined>, filterKeys?: readonly string[]): ListParams`, `buildListHref(basePath, params, patch): string`, `sortToOrderBy(sort: string|undefined, allowed: readonly string[], fallback: Prisma.SortOrder-ish)` (`@/lib/query-params`)
  - `type TimePreset = "today"|"thisWeek"|"thisMonth"|"thisQuarter"|"lastWeek"|"lastMonth"|"lastQuarter"|"thisYear"|"lastYear"|"custom"`, `TIME_PRESETS: {value; label}[]`, `resolveTimeRange(preset, now, custom?): {start: Date; end: Date /*exclusive*/}`, `timeRangeWhere(range): {gte: Date; lt: Date}`, `parseYmd(s): {y; m; d} | null` (`@/lib/time-presets`)
  - `searchTextWhere(q: string | undefined): {AND: {searchText:{contains:string}}[]} | {}` (`@/lib/search`)
  - `buildXlsx(sheetName, columns: {header; key; width?; numFmt?}[], rows: Record<string,unknown>[]): Promise<Buffer>`, `xlsxResponse(filename, buffer): Response` (`@/server/export/xlsx`)
  - `<QuickTimeFilter basePath params />`, `<SearchBox defaultValue />`, `<ExportButton href />`

- [ ] **Step 1: Test tìm kiếm không dấu (Review Focus #1) — đỏ**

`tests/lib/search.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeSearch, searchTextWhere } from "@/lib/search";
import { prisma, resetDb } from "../helpers/db";
import { makeProduct } from "../helpers/factories";

describe("normalizeSearch", () => {
  it.each([
    ["Tôn lạnh màu 0.45", "ton lanh mau 0.45"],
    ["TÔN  LẠNH ", "ton lanh"],
    ["Đặng Hương", "dang huong"],
    ["ĐẶNG HƯƠNG", "dang huong"],
    ["  tôn\txốp\n11 sóng ", "ton xop 11 song"],
    ["Ư Ơ Ê Ô Ă Â", "u o e o a a"],
    ["", ""],
  ])("%j → %j", (input, out) => {
    expect(normalizeSearch(input)).toBe(out);
  });

  it("chuỗi đã ở dạng NFD/NFC khác nhau cho cùng kết quả", () => {
    expect(normalizeSearch("Tôn".normalize("NFD"))).toBe(normalizeSearch("Tôn".normalize("NFC")));
  });
});

describe("searchTextWhere", () => {
  it("rỗng/khoảng trắng → {} (không lọc)", () => {
    expect(searchTextWhere(undefined)).toEqual({});
    expect(searchTextWhere("   ")).toEqual({});
  });
  it("mỗi từ là 1 điều kiện AND (không phụ thuộc thứ tự từ)", () => {
    expect(searchTextWhere("Lạnh TÔN")).toEqual({
      AND: [{ searchText: { contains: "lanh" } }, { searchText: { contains: "ton" } }],
    });
  });
});

describe("tìm sản phẩm thật trên DB", () => {
  beforeEach(resetDb);

  it("ton lanh / TÔN  LẠNH  / lanh ton đều ra 'Tôn lạnh màu 0.45'; 'xop' không ra", async () => {
    const name = "Tôn lạnh màu 0.45";
    await makeProduct({ code: "TL045", name, searchText: normalizeSearch(name + " TL045") });
    await makeProduct({ code: "TX11", name: "Tôn xốp 11 sóng", searchText: normalizeSearch("Tôn xốp 11 sóng TX11") });
    const find = (q: string) => prisma.product.findMany({ where: searchTextWhere(q) });
    for (const q of ["ton lanh", "TÔN  LẠNH ", "lanh ton", "tl045"]) {
      expect((await find(q)).map((p) => p.code), q).toEqual(["TL045"]);
    }
    expect((await find("xop")).map((p) => p.code)).toEqual(["TX11"]);
    expect(await find("khong co")).toHaveLength(0);
  });
});
```
- [ ] **Step 2: Chạy → đỏ; hoàn thiện `src/lib/search.ts`**

```ts
/** Chuẩn hoá để tìm không dấu: NFD bỏ dấu, đ→d, lowercase, gộp khoảng trắng. Dùng cho MỌI đường ghi `searchText`. */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Điều kiện Prisma cho cột `searchText`: mỗi từ khoá phải có mặt (AND), không phụ thuộc thứ tự. */
export function searchTextWhere(q: string | undefined): { AND: { searchText: { contains: string } }[] } | Record<string, never> {
  const terms = normalizeSearch(q ?? "").split(" ").filter(Boolean);
  if (terms.length === 0) return {};
  return { AND: terms.map((t) => ({ searchText: { contains: t } })) };
}
```
Run: `npm test -- tests/lib/search.test.ts` → PASS.

- [ ] **Step 3: Test time presets (Review Focus #2) — đỏ**

`tests/lib/time-presets.test.ts` — mốc "bây giờ" mặc định `2026-09-30T16:50:00Z` (= 23:50 ICT thứ Tư 30/09/2026):
```ts
import { describe, expect, it } from "vitest";
import { resolveTimeRange, TIME_PRESETS } from "@/lib/time-presets";

const NOW = new Date("2026-09-30T16:50:00Z"); // 23:50 ICT, Thứ Tư 30/09/2026
const r = (p: Parameters<typeof resolveTimeRange>[0], now = NOW, custom?: { start?: string; end?: string }) => {
  const x = resolveTimeRange(p, now, custom)!;
  return [x.start.toISOString(), x.end.toISOString()];
};

describe("TIME_PRESETS — đủ 10 mốc theo crm-design", () => {
  it("thứ tự và nhãn", () => {
    expect(TIME_PRESETS.map((p) => p.label)).toEqual([
      "Hôm nay", "Tuần này", "Tháng này", "Quý này", "Tuần trước", "Tháng trước", "Quý trước",
      "Năm nay", "Năm trước", "Tùy chọn",
    ]);
  });
});

describe("resolveTimeRange — nửa mở [start, end), theo giờ ICT", () => {
  it("Hôm nay: 23:50 ICT 30/09 vẫn thuộc ngày 30/09", () => {
    expect(r("today")).toEqual(["2026-09-29T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
    const t = NOW.getTime();
    const x = resolveTimeRange("today", NOW)!;
    expect(t >= x.start.getTime() && t < x.end.getTime()).toBe(true);
  });

  it("đúng 00:00 ICT ngày 01/10 (17:00Z) đã sang ngày/tháng/quý mới", () => {
    const edge = new Date("2026-09-30T17:00:00Z");
    expect(r("today", edge)[0]).toBe("2026-09-30T17:00:00.000Z");
    expect(r("thisMonth", edge)).toEqual(["2026-09-30T17:00:00.000Z", "2026-10-31T17:00:00.000Z"]);
    expect(r("thisQuarter", edge)).toEqual(["2026-09-30T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
  });

  it("Tuần này bắt đầu THỨ HAI (28/09) đến hết Chủ nhật (04/10)", () => {
    expect(r("thisWeek")).toEqual(["2026-09-27T17:00:00.000Z", "2026-10-04T17:00:00.000Z"]);
  });

  it("Tuần này khi hôm nay là Chủ nhật vẫn là tuần chứa nó (không nhảy sang tuần sau)", () => {
    const sunday = new Date("2026-10-04T05:00:00Z"); // CN 04/10 12:00 ICT
    expect(r("thisWeek", sunday)).toEqual(["2026-09-27T17:00:00.000Z", "2026-10-04T17:00:00.000Z"]);
  });

  it("Tuần trước", () => {
    expect(r("lastWeek")).toEqual(["2026-09-20T17:00:00.000Z", "2026-09-27T17:00:00.000Z"]);
  });

  it("Tháng này / trước", () => {
    expect(r("thisMonth")).toEqual(["2026-08-31T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
    expect(r("lastMonth")).toEqual(["2026-07-31T17:00:00.000Z", "2026-08-31T17:00:00.000Z"]);
  });

  it("Tháng trước khi đang ở tháng 1 → tháng 12 năm trước", () => {
    const jan = new Date("2026-01-15T05:00:00Z");
    expect(r("lastMonth", jan)).toEqual(["2025-11-30T17:00:00.000Z", "2025-12-31T17:00:00.000Z"]);
  });

  it("Quý này (Q3) / trước (Q2)", () => {
    expect(r("thisQuarter")).toEqual(["2026-06-30T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
    expect(r("lastQuarter")).toEqual(["2026-03-31T17:00:00.000Z", "2026-06-30T17:00:00.000Z"]);
  });

  it("Quý trước khi đang ở Q1 → Q4 năm trước", () => {
    const feb = new Date("2026-02-10T05:00:00Z");
    expect(r("lastQuarter", feb)).toEqual(["2025-09-30T17:00:00.000Z", "2025-12-31T17:00:00.000Z"]);
  });

  it("Năm nay / trước", () => {
    expect(r("thisYear")).toEqual(["2025-12-31T17:00:00.000Z", "2026-12-31T17:00:00.000Z"]);
    expect(r("lastYear")).toEqual(["2024-12-31T17:00:00.000Z", "2025-12-31T17:00:00.000Z"]);
  });

  it("Tùy chọn: 'yyyy-mm-dd' bao gồm CẢ ngày kết thúc (end = 0h ICT ngày kế)", () => {
    expect(r("custom", NOW, { start: "2026-09-01", end: "2026-09-15" })).toEqual([
      "2026-08-31T17:00:00.000Z", "2026-09-15T17:00:00.000Z",
    ]);
  });

  it("Tùy chọn: thiếu/không hợp lệ hoặc end < start → null", () => {
    expect(resolveTimeRange("custom", NOW, {})).toBeNull();
    expect(resolveTimeRange("custom", NOW, { start: "abc", end: "2026-09-15" })).toBeNull();
    expect(resolveTimeRange("custom", NOW, { start: "2026-09-15", end: "2026-09-01" })).toBeNull();
    expect(resolveTimeRange("custom", NOW, { start: "2026-02-30", end: "2026-03-01" })).toBeNull(); // 30/02 không tồn tại
  });
});
```
- [ ] **Step 4: Cài `src/lib/time-presets.ts`**

```ts
import { ictStartOfDay, toIct } from "./time";

export type TimePreset =
  | "today" | "thisWeek" | "thisMonth" | "thisQuarter"
  | "lastWeek" | "lastMonth" | "lastQuarter" | "thisYear" | "lastYear" | "custom";

// Đủ 10 mốc cố định (view-table.md mục 2) — luôn dùng nguyên bộ, không lắp rời từng module
export const TIME_PRESETS: { value: TimePreset; label: string }[] = [
  { value: "today", label: "Hôm nay" },
  { value: "thisWeek", label: "Tuần này" },
  { value: "thisMonth", label: "Tháng này" },
  { value: "thisQuarter", label: "Quý này" },
  { value: "lastWeek", label: "Tuần trước" },
  { value: "lastMonth", label: "Tháng trước" },
  { value: "lastQuarter", label: "Quý trước" },
  { value: "thisYear", label: "Năm nay" },
  { value: "lastYear", label: "Năm trước" },
  { value: "custom", label: "Tùy chọn" },
];

export interface TimeRange {
  start: Date; // gồm
  end: Date; // KHÔNG gồm
}

/** 'yyyy-mm-dd' → {y, m (0–11), d}; ngày không tồn tại (30/02) → null. Engine kho dùng lại hàm này. */
export function parseYmd(s: string | undefined): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]! - 1, d = +m[3]!;
  const probe = new Date(Date.UTC(y, mo, d));
  // loại ngày không tồn tại (30/02)
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** Khoảng thời gian nửa mở [start, end) theo giờ Asia/Ho_Chi_Minh; custom không hợp lệ → null. */
export function resolveTimeRange(
  preset: TimePreset,
  now: Date,
  custom?: { start?: string; end?: string },
): TimeRange | null {
  const t = toIct(now);
  const day = (y: number, m: number, d: number) => ictStartOfDay(y, m, d);
  switch (preset) {
    case "today":
      return { start: day(t.y, t.m, t.d), end: day(t.y, t.m, t.d + 1) };
    case "thisWeek": {
      const monday = t.d - t.dow;
      return { start: day(t.y, t.m, monday), end: day(t.y, t.m, monday + 7) };
    }
    case "lastWeek": {
      const monday = t.d - t.dow - 7;
      return { start: day(t.y, t.m, monday), end: day(t.y, t.m, monday + 7) };
    }
    case "thisMonth":
      return { start: day(t.y, t.m, 1), end: day(t.y, t.m + 1, 1) };
    case "lastMonth":
      return { start: day(t.y, t.m - 1, 1), end: day(t.y, t.m, 1) };
    case "thisQuarter": {
      const q = Math.floor(t.m / 3) * 3;
      return { start: day(t.y, q, 1), end: day(t.y, q + 3, 1) };
    }
    case "lastQuarter": {
      const q = Math.floor(t.m / 3) * 3;
      return { start: day(t.y, q - 3, 1), end: day(t.y, q, 1) };
    }
    case "thisYear":
      return { start: day(t.y, 0, 1), end: day(t.y + 1, 0, 1) };
    case "lastYear":
      return { start: day(t.y - 1, 0, 1), end: day(t.y, 0, 1) };
    case "custom": {
      const s = parseYmd(custom?.start);
      const e = parseYmd(custom?.end);
      if (!s || !e) return null;
      const start = day(s.y, s.m, s.d);
      const end = day(e.y, e.m, e.d + 1); // gồm cả ngày kết thúc
      return end > start ? { start, end } : null;
    }
  }
}

export const timeRangeWhere = (range: TimeRange) => ({ gte: range.start, lt: range.end });
```
Run: `npm test -- tests/lib/time-presets.test.ts` → PASS.

- [ ] **Step 5: Test URL params (đỏ)**

`tests/lib/query-params.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildListHref, parseListParams, sortToOrderBy } from "@/lib/query-params";

describe("parseListParams", () => {
  it("mặc định", () => {
    expect(parseListParams({})).toEqual({ page: 1, pageSize: 20, filters: {} });
  });

  it("đọc page/pageSize/sort/q/time và filter nhiều giá trị nối bằng dấu phẩy", () => {
    const p = parseListParams(
      { page: "3", pageSize: "50", sort: "-createdAt", q: " ton lanh ", timePreset: "thisMonth", status: "active,pending", dept: "5" },
      ["status", "dept"],
    );
    expect(p).toEqual({
      page: 3, pageSize: 50, sort: "-createdAt", q: "ton lanh", timePreset: "thisMonth",
      filters: { status: ["active", "pending"], dept: ["5"] },
    });
  });

  it("giá trị rác → về mặc định (page < 1, pageSize không hợp lệ, preset lạ)", () => {
    const p = parseListParams({ page: "-2", pageSize: "7", timePreset: "hack" });
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(20);
    expect(p.timePreset).toBeUndefined();
    expect(parseListParams({ page: "abc" }).page).toBe(1);
  });

  it("chỉ nhận filter key được khai báo (không nhận key tuỳ ý từ URL)", () => {
    expect(parseListParams({ status: "a", evil: "b" }, ["status"]).filters).toEqual({ status: ["a"] });
  });

  it("mảng (?a=1&a=2) được gộp", () => {
    expect(parseListParams({ status: ["a", "b"] }, ["status"]).filters).toEqual({ status: ["a", "b"] });
  });
});

describe("buildListHref — bỏ khoá khi = mặc định", () => {
  const base = parseListParams({ q: "abc", status: "a,b", sort: "-name", page: "4" }, ["status"]);

  it("đổi page giữ nguyên các query khác", () => {
    expect(buildListHref("/x", base, { page: 5 })).toBe("/x?q=abc&status=a%2Cb&sort=-name&page=5");
  });
  it("page=1 và pageSize mặc định không lên URL, đổi cỡ trang về trang 1", () => {
    expect(buildListHref("/x", base, { page: 1 })).toBe("/x?q=abc&status=a%2Cb&sort=-name");
    // đổi cỡ trang luôn về trang 1; cỡ mặc định (20) không lên URL
    expect(buildListHref("/x", base, { pageSize: 20 })).toBe("/x?q=abc&status=a%2Cb&sort=-name");
  });
  it("đổi bộ lọc/tìm kiếm/sort/thời gian → reset về trang 1", () => {
    expect(buildListHref("/x", base, { q: "mới" })).toBe("/x?q=m%E1%BB%9Bi&status=a%2Cb&sort=-name");
    expect(buildListHref("/x", base, { sort: undefined })).toBe("/x?q=abc&status=a%2Cb");
    expect(buildListHref("/x", base, { filters: { status: [] } })).toBe("/x?q=abc&sort=-name");
    expect(buildListHref("/x", base, { timePreset: "today" })).toBe("/x?q=abc&status=a%2Cb&sort=-name&timePreset=today");
  });
  it("đổi cỡ trang reset về trang 1", () => {
    expect(buildListHref("/x", base, { pageSize: 50 })).toBe("/x?q=abc&status=a%2Cb&sort=-name&pageSize=50");
  });
});

describe("sortToOrderBy", () => {
  it("chỉ nhận cột nằm trong danh sách cho phép", () => {
    expect(sortToOrderBy("-name", ["name", "code"], { id: "desc" })).toEqual({ name: "desc" });
    expect(sortToOrderBy("code", ["name", "code"], { id: "desc" })).toEqual({ code: "asc" });
    expect(sortToOrderBy("passwordHash", ["name"], { id: "desc" })).toEqual({ id: "desc" });
    expect(sortToOrderBy(undefined, ["name"], { id: "desc" })).toEqual({ id: "desc" });
  });
});
```
- [ ] **Step 6: Cài `src/lib/query-params.ts`**

```ts
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "./pagination";
import type { TimePreset } from "./time-presets";
import { TIME_PRESETS } from "./time-presets";

export interface ListParams {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
  timePreset?: TimePreset;
  timeStart?: string;
  timeEnd?: string;
  filters: Record<string, string[]>;
}

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PRESETS = new Set<string>(TIME_PRESETS.map((p) => p.value));

/** Chuẩn query-param của crm-design (global-rules.md mục 5). Giá trị rác → mặc định; key filter phải khai báo. */
export function parseListParams(sp: SearchParams, filterKeys: readonly string[] = []): ListParams {
  const pageNum = Number(first(sp.page));
  const sizeNum = Number(first(sp.pageSize));
  const out: ListParams = {
    page: Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(sizeNum) ? sizeNum : DEFAULT_PAGE_SIZE,
    filters: {},
  };
  const sort = first(sp.sort)?.trim();
  if (sort) out.sort = sort;
  const q = first(sp.q)?.trim();
  if (q) out.q = q;
  const preset = first(sp.timePreset);
  if (preset && PRESETS.has(preset)) out.timePreset = preset as TimePreset;
  const ts = first(sp.timeStart);
  const te = first(sp.timeEnd);
  if (ts) out.timeStart = ts;
  if (te) out.timeEnd = te;
  for (const key of filterKeys) {
    const raw = sp[key];
    if (raw === undefined) continue;
    const values = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    if (values.length) out.filters[key] = values;
  }
  return out;
}

export interface ListPatch {
  page?: number;
  pageSize?: number;
  sort?: string | undefined;
  q?: string | undefined;
  timePreset?: TimePreset | undefined;
  timeStart?: string | undefined;
  timeEnd?: string | undefined;
  filters?: Record<string, string[]>;
}

/** Dựng URL giữ nguyên query hiện tại + patch. Bỏ khoá = mặc định; đổi lọc/sort/tìm → về trang 1. */
export function buildListHref(basePath: string, current: ListParams, patch: ListPatch): string {
  const has = (k: keyof ListPatch) => Object.prototype.hasOwnProperty.call(patch, k);
  const next = { ...current, filters: { ...current.filters } };
  let resetPage = false;
  for (const k of ["sort", "q", "timePreset", "timeStart", "timeEnd"] as const) {
    if (has(k)) { (next as Record<string, unknown>)[k] = patch[k]; resetPage = true; }
  }
  if (patch.filters) {
    for (const [k, v] of Object.entries(patch.filters)) {
      if (v.length) next.filters[k] = v; else delete next.filters[k];
    }
    resetPage = true;
  }
  if (patch.pageSize !== undefined) { next.pageSize = patch.pageSize; resetPage = true; }
  next.page = patch.page !== undefined ? patch.page : resetPage ? 1 : current.page;

  const qs = new URLSearchParams();
  if (next.q) qs.set("q", next.q);
  for (const [k, v] of Object.entries(next.filters)) qs.set(k, v.join(","));
  if (next.sort) qs.set("sort", next.sort);
  if (next.timePreset) qs.set("timePreset", next.timePreset);
  if (next.timeStart) qs.set("timeStart", next.timeStart);
  if (next.timeEnd) qs.set("timeEnd", next.timeEnd);
  if (next.pageSize !== DEFAULT_PAGE_SIZE) qs.set("pageSize", String(next.pageSize));
  if (next.page > 1) qs.set("page", String(next.page));
  const s = qs.toString(); // dấu phẩy được mã hoá thành %2C
  return s ? `${basePath}?${s}` : basePath;
}

/** '-name' → { name: 'desc' }; chỉ cột trong `allowed` (chặn sort theo cột nhạy cảm/không tồn tại). */
export function sortToOrderBy<F extends Record<string, "asc" | "desc">>(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: F,
): Record<string, "asc" | "desc"> {
  if (!sort) return fallback;
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort;
  return allowed.includes(key) ? { [key]: desc ? "desc" : "asc" } : fallback;
}
```
Test kỳ vọng `status=a%2Cb` vì `URLSearchParams` mã hoá dấu phẩy thành `%2C`.
Run: `npm test -- tests/lib/query-params.test.ts`
Expected: PASS. Thứ tự khoá trong URL kỳ vọng `q, filters…, sort, time…, pageSize, page` (khớp code).

- [ ] **Step 7: Test + cài Export Excel**

`tests/server/xlsx.test.ts`:
```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildXlsx } from "@/server/export/xlsx";

async function read(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0]!;
}

describe("buildXlsx", () => {
  const columns = [
    { header: "Mã", key: "code", width: 12, text: true },
    { header: "Số lượng", key: "qty", numFmt: "#,##0.###" },
    { header: "Tiền", key: "amount", numFmt: '#,##0 "₫"' },
    { header: "Ngày", key: "date" },
  ];

  it("dòng tiêu đề tiếng Việt + dữ liệu; số vẫn là SỐ (không phải chuỗi)", async () => {
    const buf = await buildXlsx("Sản phẩm", columns, [
      { code: "SP1", qty: 1250, amount: "1500000.50", date: new Date("2026-09-30T16:50:00Z") },
    ]);
    const ws = await read(buf);
    expect(ws.name).toBe("Sản phẩm");
    expect(ws.getRow(1).values).toEqual([undefined, "Mã", "Số lượng", "Tiền", "Ngày"]);
    expect(ws.getCell("B2").value).toBe(1250);
    expect(ws.getCell("C2").value).toBe(1500000.5); // chuỗi Decimal → số
    expect(ws.getCell("A2").value).toBe("SP1");
    expect(ws.getCell("D2").text).toBe("30/09/2026"); // ngày theo ICT
  });

  it("null/undefined → ô trống (không phải 0)", async () => {
    const ws = await read(await buildXlsx("S", columns, [{ code: "SP1", qty: null, amount: undefined, date: null }]));
    expect(ws.getCell("B2").value).toBeNull();
    expect(ws.getCell("C2").value).toBeNull();
  });

  it("chống công thức tiêm nhiễm: chuỗi bắt đầu bằng = + - @ được tiền tố dấu nháy", async () => {
    const ws = await read(await buildXlsx("S", columns, [{ code: "=HYPERLINK(\"http://x\")" }, { code: "+cmd" }, { code: "-1+1" }, { code: "@SUM(A1)" }]));
    for (const r of [2, 3, 4, 5]) expect(String(ws.getCell(`A${r}`).value).startsWith("'")).toBe(true);
  });

  it("cột mã (text: true) giữ nguyên số 0 đầu; cột thường đổi chuỗi số thành số", async () => {
    const ws = await read(await buildXlsx("S", [{ header: "Mã", key: "code", text: true }, { header: "Tiền", key: "amount" }], [{ code: "00123", amount: "00123" }]));
    expect(ws.getCell("A2").value).toBe("00123");
    expect(ws.getCell("B2").value).toBe(123);
  });

  it("làm việc với 5.000 dòng trong thời gian hợp lý", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ code: `SP${i}`, qty: i, amount: i * 1000, date: new Date() }));
    const t = performance.now();
    await buildXlsx("S", columns, rows);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});
```
`src/server/export/xlsx.ts`:
```ts
import ExcelJS from "exceljs";
import { formatDate } from "@/lib/format";

export interface XlsxColumn {
  header: string;
  key: string;
  width?: number;
  /** Định dạng số của Excel, vd '#,##0 "₫"'. */
  numFmt?: string;
  /** Cột MÃ (vd "00123"): giữ nguyên là chuỗi, không đổi thành số. */
  text?: boolean;
}

// Chuỗi bắt đầu bằng ký tự này bị Excel hiểu là công thức → tiền tố dấu nháy (formula injection)
const FORMULA_START = /^[=+\-@\t\r]/;

function toCell(v: unknown, asText: boolean): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return formatDate(v);
  if (typeof v === "number" || typeof v === "boolean") return asText ? String(v) : v;
  const s = String(v); // gồm Prisma.Decimal
  if (!asText && /^-?\d+(\.\d+)?$/.test(s)) return Number(s); // chuỗi số thập phân (Decimal) → SỐ
  return FORMULA_START.test(s) ? `'${s}` : s;
}

export async function buildXlsx(
  sheetName: string,
  columns: XlsxColumn[],
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, toCell(r[c.key], !!c.text)])));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function xlsxResponse(filename: string, buffer: Buffer): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
```
Run: `npm test -- tests/server/xlsx.test.ts` → PASS.

- [ ] **Step 8: Component `QuickTimeFilter`, `SearchBox`, `ExportButton` + test**

`src/components/ui/QuickTimeFilter.tsx` (client; dropdown 10 mốc, luôn hiện khoảng ngày để người dùng kiểm soát):
```tsx
"use client";

import { CalendarRange } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { resolveTimeRange, TIME_PRESETS, type TimePreset } from "@/lib/time-presets";

export function QuickTimeFilter({ basePath, params, now }: { basePath: string; params: ListParams; now?: Date }) {
  const router = useRouter();
  const range = useMemo(
    () => (params.timePreset ? resolveTimeRange(params.timePreset, now ?? new Date(), { start: params.timeStart, end: params.timeEnd }) : null),
    [params.timePreset, params.timeStart, params.timeEnd, now],
  );
  const go = (patch: Parameters<typeof buildListHref>[2]) => router.push(buildListHref(basePath, params, patch));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-10 items-center gap-2 rounded-sm border border-border bg-canvas px-3 text-sm">
        <CalendarRange size={16} aria-hidden className="text-fg-muted" />
        <select
          aria-label="Lọc nhanh theo thời gian"
          value={params.timePreset ?? ""}
          onChange={(e) => {
            const v = e.target.value as TimePreset | "";
            go(v ? { timePreset: v, timeStart: undefined, timeEnd: undefined } : { timePreset: undefined, timeStart: undefined, timeEnd: undefined });
          }}
          className="bg-transparent outline-none"
        >
          <option value="">Mọi thời gian</option>
          {TIME_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {params.timePreset === "custom" && (
        <div className="flex items-center gap-1 text-sm">
          <input type="date" aria-label="Từ ngày" value={params.timeStart ?? ""} onChange={(e) => go({ timeStart: e.target.value || undefined })} className="h-10 rounded-sm border border-border bg-canvas px-2" />
          <span aria-hidden>–</span>
          <input type="date" aria-label="Đến ngày" value={params.timeEnd ?? ""} onChange={(e) => go({ timeEnd: e.target.value || undefined })} className="h-10 rounded-sm border border-border bg-canvas px-2" />
        </div>
      )}
      {range && (
        <span className="tabular text-xs text-fg-secondary" data-testid="time-range">
          {formatDate(range.start)} – {formatDate(new Date(range.end.getTime() - 1))}
        </span>
      )}
    </div>
  );
}
```
`src/components/ui/SearchBox.tsx` (debounce 300ms, đẩy vào URL):
```tsx
"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buildListHref, type ListParams } from "@/lib/query-params";

export function SearchBox({ basePath, params, placeholder = "Tìm kiếm…" }: { basePath: string; params: ListParams; placeholder?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(params.q ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const id = setTimeout(() => router.push(buildListHref(basePath, params, { q: value.trim() || undefined })), 300);
    return () => clearTimeout(id);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="relative block w-full sm:w-72">
      <Search size={16} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
      <input type="search" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} aria-label="Tìm kiếm"
        className="h-10 w-full rounded-sm border border-border bg-canvas pl-9 pr-3 text-sm" />
    </label>
  );
}
```
`src/components/ui/ExportButton.tsx`:
```tsx
import { Download } from "lucide-react";

/** Nút Export Excel: trỏ tới route handler xuất file của module (giữ nguyên query filter hiện tại). */
export function ExportButton({ href }: { href: string }) {
  return (
    <a href={href} download className="flex h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover">
      <Download size={16} aria-hidden /> Xuất Excel
    </a>
  );
}
```
(`<a download>` thay `<Link>` vì đây là tải file, không phải điều hướng nội bộ.) Thêm `QuickTimeFilter`, `SearchBox`, `ExportButton` vào barrel `src/components/ui/index.ts`.

`tests/ui/quick-time-filter.test.tsx`:
```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { parseListParams } from "@/lib/query-params";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/x" }));
afterEach(() => { cleanup(); push.mockClear(); });

const NOW = new Date("2026-09-30T16:50:00Z");

describe("QuickTimeFilter", () => {
  it("có đủ 10 mốc + 'Mọi thời gian'", () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({})} now={NOW} />);
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Mọi thời gian", "Hôm nay", "Tuần này", "Tháng này", "Quý này", "Tuần trước", "Tháng trước", "Quý trước", "Năm nay", "Năm trước", "Tùy chọn"]);
  });

  it("chọn mốc → đẩy URL (timePreset), về trang 1", async () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ page: "3" })} now={NOW} />);
    await userEvent.selectOptions(screen.getByLabelText("Lọc nhanh theo thời gian"), "thisMonth");
    expect(push).toHaveBeenCalledWith("/x?timePreset=thisMonth");
  });

  it("hiện khoảng ngày theo ICT: 23:50 ICT 30/09 → Tháng này = 01/09/2026 – 30/09/2026", () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "thisMonth" })} now={NOW} />);
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/09/2026 – 30/09/2026");
  });

  it("Tùy chọn hiện 2 ô ngày", () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" })} now={NOW} />);
    expect(screen.getByLabelText("Từ ngày")).toHaveValue("2026-09-01");
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/09/2026 – 15/09/2026");
  });
});
```
Run: `npm test -- tests/ui/quick-time-filter.test.tsx`
Expected: PASS.

- [ ] **Step 9: Ghi mẫu trang danh sách vào `docs/conventions/list-page.md` (mọi module sau bám theo)**

`````markdown
# Mẫu trang danh sách (crm-design)

Server page lấy dữ liệu theo URL → client table nhận DTO đã lọc field theo quyền.

```tsx
// src/app/(app)/<module>/<function>/page.tsx
const actor = await requireActor("<perm>.view");
const params = parseListParams(await searchParams, ["status", "role"]);   // key filter phải khai báo
const where = { ...searchTextWhere(params.q) /* + filter + timeRangeWhere(range) */ };
const [rows, total] = await Promise.all([
  prisma.<model>.findMany({
    where,
    orderBy: sortToOrderBy(params.sort, ["fullName", "username"], { id: "desc" }), // chỉ cột cho phép
    skip: (params.page - 1) * params.pageSize,
    take: params.pageSize,
  }),
  prisma.<model>.count({ where }),
]);
return (
  <ListPageLayout title="…" actions={<>Thêm mới · Import (danh mục nền) · <ExportButton href=… /></>}
    stats={/* StatCard số đếm KHÔNG áp filter trạng thái đang chọn */}
    filters={<><SearchBox … /><QuickTimeFilter … /></>}
    footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize}
              buildHref={(patch) => buildListHref("/path", params, patch)} />}>
    {total === 0 ? <EmptyState … /> : <XxxTable rows={redactDeep(rows, actor.perms)} … />}
  </ListPageLayout>
);
```

Quy tắc: 3 loại empty state (chưa có dữ liệu / lọc không ra / lỗi); nút Thêm mới luôn hiện kể cả khi rỗng; trang có cột ngày nghiệp vụ PHẢI có `QuickTimeFilter` với where-clause đúng field ngày đó; cột nhạy cảm bị loại ở server bằng `redactDeep`, không ẩn bằng CSS.
`````

- [ ] **Step 10: Chạy toàn bộ và commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: xanh.
```bash
git add -A
git commit -m "feat(list): URL params chuẩn, tìm không dấu, QuickTimeFilter 10 mốc theo ICT, Export Excel"
```

---

## Self-Review (GĐ0b — Task 6–10)

**Spec coverage:** mã 1 (đăng nhập — lõi xác thực Task 6; giao diện ở plan 01c), T2 (loại field ở server — `loadActor` + `buildNav` + `redactDeep` từ 01a), nền cho mã 2–5; Phần 13 DoD (≤3s: phân trang server + index; tiếng Việt; quyền). Chưa thuộc plan này: màn hình 1–5 và trang chủ (plan 01c).
**Placeholder scan:** không còn "TBD/TODO". Hai chỗ "nếu lint/test chập chờn thì nới ngưỡng" là hướng dẫn xử lý có giới hạn, không phải nội dung thiếu.
**Type consistency:** `SessionActor.perms: ReadonlySet<string>` khớp `can()`/`redactDeep()` của 01a; `ListParams`/`buildListHref`/`parseListParams` dùng ở `QuickTimeFilter`, `SearchBox`, test; `Column<T>`, `RowAction` khớp giữa `DataTable` và test; `TimePreset` một nguồn ở `time-presets.ts`, `query-params.ts` import từ đó; `normalizeSearch` tạo ở Task 8 và hoàn thiện ở Task 10 (cùng chữ ký).
**Review Focus:** tìm không dấu (Task 10 test DB) ✔; ranh giới ngày ICT/tuần thứ Hai (Task 7 `time`, Task 10 presets) ✔; khoá tài khoản hiệu lực ngay (Task 6) ✔; không lộ tài khoản qua độ trễ (Task 6) ✔; `0` ≠ `null` (Task 7 format) ✔.
