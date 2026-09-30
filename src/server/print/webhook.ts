import { DomainError } from "@/server/http/errors";

type Env = Record<string, string | undefined>;
export const PRINT_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_WEBHOOK_HOSTS = ["script.google.com", "script.googleusercontent.com"];
const FILE_HOST_SUFFIXES = [".google.com", ".googleusercontent.com"];

/** Chỉ gửi tới Google Apps Script (chống SSRF vào mạng nội bộ). Thêm máy chủ khác qua PRINT_WEBHOOK_HOSTS (chỉ cho môi trường thử). */
export function allowedWebhookHosts(env: Env = process.env): string[] {
  return [...DEFAULT_WEBHOOK_HOSTS, ...(env.PRINT_WEBHOOK_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];
}
export function assertWebhookUrl(raw: string, env: Env = process.env): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new DomainError("Địa chỉ webhook của mẫu in không hợp lệ.", 409, "PRINT_BAD_WEBHOOK"); }
  if (u.protocol !== "https:" || !allowedWebhookHosts(env).includes(u.hostname.toLowerCase())) throw new DomainError("Webhook của mẫu in phải là địa chỉ Google Apps Script (https://script.google.com/…).", 409, "PRINT_BAD_WEBHOOK");
  return u;
}
/** URL bản in trả về phải là https của Google (Docs/Drive) — không hiển thị/ mở địa chỉ lạ. */
export function isAllowedFileUrl(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === "https:" && FILE_HOST_SUFFIXES.some((s) => u.hostname.toLowerCase().endsWith(s)); } catch { return false; }
}

export interface WebhookResult { fileId: string; url: string; name: string }
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Xoá secret và mọi URL khỏi thông điệp lỗi từ phía Apps Script trước khi trả cho người dùng. */
function clean(text: string, secret: string): string {
  let t = text.replaceAll(secret, "***").replace(/https?:\/\/\S+/g, "[link]");
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 160);
}

/**
 * Gọi webhook Apps Script: POST JSON (secret nằm TRONG body), tối đa 12 giây, tự đi theo chuyển hướng nhưng chỉ tới máy chủ Google
 * cho phép (Apps Script trả 302 sang script.googleusercontent.com). Lỗi trả về KHÔNG chứa secret/URL webhook.
 */
export async function callPrintWebhook(webhookUrl: string, payload: object & { secret: string }, opts: { env?: Env; fetchImpl?: FetchLike; timeoutMs?: number; expectFile?: boolean } = {}): Promise<WebhookResult> {
  const env = opts.env ?? process.env; const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  let url = assertWebhookUrl(webhookUrl, env);
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? PRINT_TIMEOUT_MS);
  try {
    let res: Response | null = null; let method = "POST"; let body: string | undefined = JSON.stringify(payload);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await doFetch(url.toString(), { method, body, headers: body ? { "content-type": "text/plain;charset=utf-8" } : {}, redirect: "manual", signal: ctrl.signal });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const loc = res.headers.get("location");
      if (!loc || hop === MAX_REDIRECTS) throw new DomainError("Apps Script chuyển hướng không hợp lệ.", 502, "PRINT_BAD_REDIRECT");
      url = assertWebhookUrl(new URL(loc, url).toString(), env);
      if (res.status === 301 || res.status === 302 || res.status === 303) { method = "GET"; body = undefined; }
    }
    if (!res || !res.ok) throw new DomainError(`Apps Script trả lỗi HTTP ${res?.status ?? "?"}.`, 502, "PRINT_HTTP");
    const text = (await res.text()).slice(0, MAX_RESPONSE_BYTES);
    let json: { ok?: boolean; fileId?: unknown; url?: unknown; name?: unknown; error?: unknown };
    try { json = JSON.parse(text); } catch { throw new DomainError("Apps Script trả về nội dung không phải JSON (kiểm tra đã triển khai web app và quyền “Bất kỳ ai”).", 502, "PRINT_BAD_RESPONSE"); }
    if (!json.ok) throw new DomainError(`Apps Script báo lỗi: ${clean(typeof json.error === "string" ? json.error : "không rõ", payload.secret)}`, 502, "PRINT_REMOTE_ERROR");
    if (opts.expectFile === false) return { fileId: "", url: "", name: "" };
    if (typeof json.fileId !== "string" || !json.fileId || typeof json.url !== "string" || !isAllowedFileUrl(json.url)) throw new DomainError("Apps Script không trả về file bản in hợp lệ.", 502, "PRINT_BAD_RESPONSE");
    return { fileId: json.fileId.slice(0, 200), url: json.url, name: typeof json.name === "string" ? json.name.slice(0, 200) : "" };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    if (e instanceof Error && (e.name === "AbortError" || ctrl.signal.aborted)) throw new DomainError("Google Apps Script không phản hồi trong 12 giây — thử lại sau.", 504, "PRINT_TIMEOUT");
    throw new DomainError("Không kết nối được tới Google Apps Script.", 502, "PRINT_NETWORK");
  } finally {
    clearTimeout(timer);
  }
}
