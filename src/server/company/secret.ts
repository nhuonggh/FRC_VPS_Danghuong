import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Mã hoá secret của mẫu in (D-21). AES-256-GCM, định dạng `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * Khoá dẫn xuất (HKDF) từ `PRINT_TEMPLATE_KEY`, nếu không có thì từ `AUTH_SECRET` → không thêm biến bắt buộc trên VPS.
 * Đổi khoá gốc ⇒ secret đã lưu không giải mã được (phải nhập lại) — chấp nhận, ghi trong docs/STATUS.md.
 * Chỉ GĐ2 mới gọi `decryptSecret` (để gửi webhook); không có đường API nào trả plaintext.
 */
type Env = Record<string, string | undefined>;

function deriveKey(env: Env): Buffer {
  const root = env.PRINT_TEMPLATE_KEY || env.AUTH_SECRET;
  if (!root) throw new Error("Thiếu PRINT_TEMPLATE_KEY/AUTH_SECRET để mã hoá secret mẫu in.");
  return Buffer.from(hkdfSync("sha256", root, "dherp-print-template", "secret-v1", 32));
}

const b64 = (b: Buffer) => b.toString("base64url");

export function encryptSecret(plain: string, env: Env = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(env), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
}

export function decryptSecret(stored: string, env: Env = process.env): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Secret mẫu in không đúng định dạng.");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(env), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
