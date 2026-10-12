import { env } from "cloudflare:workers";
import { databaseFileStore } from "./commission-storage";
import { ApiError, assertSameOrigin, emailField, idempotencyKey, stringField } from "./commission-validation";

export type Commission = {
  id: string; name: string; email: string; title: string; description: string; budget: string; timeline: string;
  assets: string; status: string; note: string; created_at: string; updated_at: string; idempotency_key: string; payload_hash: string;
};
export type Message = { id: string; request_id: string; sender: "admin" | "client"; body: string; created_at: string };
export type StoredFile = { id: string; request_id: string | null; storage_key: string; name: string; mime: string; size: number; public: number; created_at: string };
export type Identity = { role: "admin" | "client" | "anonymous"; requestId?: string; sessionHash?: string; adminSessionHash?: string; expiresAt?: string };
export type Mail = { id: string; request_id: string | null; recipient: string; subject: string; body: string; reply_to: string | null; kind: string; state: string; attempts: number; error: string | null; created_at: string; last_attempt_at: string | null; next_attempt_at: string | null; provider_id: string | null; sent_at: string | null };

export const COOKIE = "bedrock_client";
export const ADMIN_COOKIE = "__Host-bedrock_admin";
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
export const NOW = () => new Date().toISOString();
export const database = () => {
  if (!env.DB) throw new ApiError(503, "The commission database is not connected yet. Please try again shortly.");
  return env.DB;
};
export const bucket = () => {
  if (env.FILE_STORAGE === "d1" && env.DB) return databaseFileStore(env.DB);
  if (!env.BUCKET) throw new ApiError(503, "File storage is not connected yet. You can submit without attachments.");
  return env.BUCKET;
};
export const storageConfigured = () => env.FILE_STORAGE === "d1" ? !!env.DB : !!env.BUCKET;
export function authMode(): "sites" | "standalone" {
  if (!env.AUTH_MODE || env.AUTH_MODE === "sites") return "sites";
  if (env.AUTH_MODE === "standalone") return "standalone";
  throw new ApiError(503, "Owner sign-in is not configured correctly.");
}
export function adminConfigured(): boolean {
  return !!env.ADMIN_EMAIL?.trim() && (authMode() === "sites" || new TextEncoder().encode(env.ADMIN_PASSWORD ?? "").length >= 16);
}
function gmailBridgeConfigured(): boolean {
  try {
    const url = new URL(env.GMAIL_BRIDGE_URL ?? "");
    return url.protocol === "https:" && url.hostname === "script.google.com" && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) && !url.search && !url.hash && (env.GMAIL_BRIDGE_TOKEN?.length ?? 0) >= 32;
  } catch { return false; }
}
export function emailConfigured(): boolean { return !!env.ADMIN_EMAIL?.trim() && (gmailBridgeConfigured() || !!(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim())); }

export function pagesOrigin(): string | undefined {
  if (authMode() !== "standalone" || !env.PAGES_ORIGIN) return;
  try {
    const url = new URL(env.PAGES_ORIGIN);
    if (url.protocol === "https:" && env.PAGES_ORIGIN === url.origin) return url.origin;
  } catch { /* A malformed allowlist must never open cross-origin access. */ }
  throw new ApiError(503, "The public website address is not configured correctly.");
}

export function publicCors(request: Request, response: Response): Response {
  const origin = request.headers.get("origin");
  if (origin && origin === pagesOrigin()) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.append("vary", "Origin");
    // Public submissions use an anonymous request; the portal exchanges its link
    // after navigation to this backend as a first-party page.
    response.headers.delete("set-cookie");
  }
  return response;
}

export async function publicOptions(request: Request, method: "GET" | "POST"): Promise<Response> {
  return endpoint(async () => {
    const origin = request.headers.get("origin"), allowed = pagesOrigin();
    const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (!allowed || origin !== allowed || request.headers.get("access-control-request-method") !== method || requestedHeaders.some((v) => v !== "content-type")) {
      throw new ApiError(403, "This website cannot access that action.");
    }
    return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": allowed, "access-control-allow-methods": method,
      "access-control-allow-headers": "Content-Type", "access-control-max-age": "600", "vary": "Origin",
    } });
  });
}

export async function publicEndpoint(request: Request, run: () => Promise<Response>): Promise<Response> {
  // Keep validation and error responses inside the same CORS boundary.
  return endpoint(async () => publicCors(request, await endpoint(run)));
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(JSON.stringify(data), { status, headers });
}

export async function endpoint(run: () => Promise<Response>): Promise<Response> {
  try { return await run(); } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error("Commission API failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Something went wrong while saving your changes. Please try again." }, 500);
  }
}

export async function readJson(request: Request, limit = 64 * 1024): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "Send this request as JSON.");
  // Streaming bound prevents untrusted Content-Length values from bypassing limits.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "This request has no content.");
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, "This request is too large."); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError(400, "The request contains invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "The request must be a JSON object.");
  return body as Record<string, unknown>;
}

export const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export async function hash(value: string): Promise<string> {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(data)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function cookieToken(request: Request, name: string): string | undefined {
  const raw = request.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1);
  return raw && /^[\w-]{43}$/.test(raw) ? raw : undefined;
}

export function adminCookie(token: string, maxAge = ADMIN_SESSION_SECONDS): string {
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function ownerPasswordMatches(email: unknown, password: unknown): Promise<boolean> {
  // Hash both inputs to a fixed size and compare every byte. The configured
  // password lives only in provider secrets, never in source or the database.
  const submitted = typeof password === "string" ? password : "";
  const configured = env.ADMIN_PASSWORD ?? "";
  const [actual, expected] = await Promise.all([hash(submitted), hash(configured)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0 && new TextEncoder().encode(configured).length >= 16 && typeof email === "string" && email.trim().toLowerCase() === env.ADMIN_EMAIL?.trim().toLowerCase();
}

export async function identity(request: Request): Promise<Identity> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (authMode() === "sites") {
    // Sites dispatch strips untrusted identity headers and injects authenticated ones.
    const id = request.headers.get("oai-authenticated-user-id");
    const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
    if (id && email && env.ADMIN_EMAIL?.trim().toLowerCase() === email) return { role: "admin" };
  } else {
    // A public Worker has no trusted Sites gateway. Never use its identity headers.
    const adminToken = bearer || cookieToken(request, ADMIN_COOKIE);
    if (adminToken && env.DB && adminConfigured()) {
      const digest = await hash(adminToken);
      const row = await database().prepare("SELECT expires_at FROM admin_sessions WHERE hash=? AND owner_email=? AND expires_at>?").bind(digest, env.ADMIN_EMAIL!.trim().toLowerCase(), NOW()).first<{ expires_at: string }>();
      if (row) return { role: "admin", adminSessionHash: digest, expiresAt: row.expires_at };
    }
  }
  const raw = bearer || cookieToken(request, COOKIE);
  if (!raw || !env.DB) return { role: "anonymous" };
  const digest = await hash(raw);
  const row = await database().prepare("SELECT s.request_id, s.expires_at FROM client_sessions s JOIN access_tokens t ON t.hash=s.token_hash WHERE s.hash=? AND s.expires_at>? AND t.expires_at>? AND t.revoked=0").bind(digest, NOW(), NOW()).first<{ request_id: string; expires_at: string }>();
  return row ? { role: "client", requestId: row.request_id, sessionHash: digest, expiresAt: row.expires_at } : { role: "anonymous" };
}

export async function requireAdmin(request: Request): Promise<Identity> {
  const who = await identity(request);
  if (who.role !== "admin") throw new ApiError(403, adminConfigured() ? (authMode() === "standalone" ? "Sign in to the owner workspace to continue." : "Sign in with the configured owner's ChatGPT account to continue.") : "Owner sign-in has not been configured yet.");
  return who;
}

export async function authorizedCommission(request: Request, id: string): Promise<{ who: Identity; commission: Commission }> {
  const who = await identity(request);
  if (who.role !== "admin" && !(who.role === "client" && who.requestId === id)) throw new ApiError(404, "This commission could not be found. Open your private access link.");
  const commission = await database().prepare("SELECT * FROM commission_requests WHERE id=?").bind(id).first<Commission>();
  if (!commission) throw new ApiError(404, "This commission could not be found.");
  return { who, commission };
}

export function serializeCommission(c: Commission) {
  return { id: c.id, name: c.name, email: c.email, title: c.title, description: c.description, budget: c.budget, timeline: c.timeline, assets: c.assets, status: c.status, note: c.note, createdAt: c.created_at, updatedAt: c.updated_at };
}
export const serializeMessage = (m: Message) => ({ id: m.id, sender: m.sender, body: m.body, createdAt: m.created_at });
export const serializeFile = (f: StoredFile) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, url: `/api/files/${f.id}` });
export function serializeMail(m: Mail) { return { id: m.id, recipient: m.recipient, kind: m.kind, state: m.state, attempts: m.attempts, error: m.error, createdAt: m.created_at, sentAt: m.sent_at }; }

export function cookie(request: Request, token: string, maxAge = 30 * 24 * 60 * 60) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function makeAccess(requestId: string, request: Request) {
  const token = randomToken(), tokenHash = await hash(token), sessionToken = randomToken(), sessionHash = await hash(sessionToken);
  const now = NOW(), expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const portalUrl = authMode() === "standalone" && pagesOrigin()
    ? `${pagesOrigin()}/Sandstone.github.io/?view=portal#access=${token}`
    : `${authMode() === "standalone" ? siteOrigin(request) : ""}/portal#access=${token}`;
  return { token, tokenHash, portalUrl, cookie: cookie(request, sessionToken), statements: [
    database().prepare("INSERT INTO access_tokens(hash,request_id,expires_at,created_at) VALUES(?,?,?,?)").bind(tokenHash, requestId, expiresAt, now),
    database().prepare("INSERT INTO client_sessions(hash,token_hash,request_id,expires_at,created_at) VALUES(?,?,?,?,?)").bind(sessionHash, tokenHash, requestId, sessionExpiresAt, now),
  ] };
}

export function siteOrigin(request: Request) {
  if (env.SITE_URL) {
    const url = new URL(env.SITE_URL);
    const loopback = (value: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname);
    const local = url.protocol === "http:" && loopback(url) && loopback(new URL(request.url));
    if ((url.protocol !== "https:" && !local) || url.username || url.password) throw new ApiError(503, "The website address needs to be configured correctly.");
    return url.origin;
  }
  return new URL(request.url).origin;
}

export async function rateLimit(request: Request, purpose: string, max: number, windowSeconds: number, extra?: string) {
  const ip = request.headers.get("cf-connecting-ip") ?? "shared-preview";
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = await hash(`${purpose}|${extra ?? ip}|${window}`);
  const expires = (window + 1) * windowSeconds;
  const row = await database().prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").bind(key, expires).first<{ count: number }>();
  if (row && row.count > max) throw new ApiError(429, "Too many attempts. Please wait before trying again.");
  // Bounded maintenance of expired anonymous-rate records and sessions.
  await database().batch([
    database().prepare("DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<? LIMIT 100)").bind(Math.floor(Date.now() / 1000)),
    database().prepare("DELETE FROM client_sessions WHERE hash IN (SELECT hash FROM client_sessions WHERE expires_at<? LIMIT 100)").bind(NOW()),
    ...(authMode() === "standalone" ? [database().prepare("DELETE FROM admin_sessions WHERE hash IN (SELECT hash FROM admin_sessions WHERE expires_at<? LIMIT 100)").bind(NOW())] : []),
  ]);
}

export function mailStatement(requestId: string | null, recipient: string, subject: string, body: string, kind: string, replyTo?: string) {
  const id = crypto.randomUUID(), state = emailConfigured() ? "pending" : "unconfigured";
  return { id, statement: database().prepare("INSERT INTO email_outbox(id,request_id,recipient,subject,body,kind,reply_to,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, requestId, recipient, subject, body, kind, replyTo ?? null, state, NOW()) };
}

export async function deliverMail(id: string): Promise<{ id: string; state: string; error?: string }> {
  if (!emailConfigured()) return { id, state: "unconfigured", error: "Your changes are saved. Email delivery is not configured yet." };
  const db = database(), now = NOW(), staleLease = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const claim = await db.prepare("UPDATE email_outbox SET state='sending', attempts=attempts+1, last_attempt_at=? WHERE id=? AND (state IN ('pending','failed','unconfigured') OR (state='sending' AND last_attempt_at<?)) RETURNING *").bind(now, id, staleLease).first<Mail>();
  if (!claim) {
    const existing = await db.prepare("SELECT state FROM email_outbox WHERE id=?").bind(id).first<{ state: string }>();
    return { id, state: existing?.state ?? "pending" };
  }
  try {
    const useGmail = gmailBridgeConfigured();
    const response = await fetch(useGmail ? env.GMAIL_BRIDGE_URL! : "https://api.resend.com/emails", useGmail ? {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: env.GMAIL_BRIDGE_TOKEN, id, to: claim.recipient, subject: claim.subject, text: claim.body, replyTo: claim.reply_to ?? "" }),
      signal: AbortSignal.timeout(12000),
    } : {
      // Resend's idempotency key suppresses retries when the first response was lost.
      method: "POST", headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `bedrock-${id}` },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [claim.recipient], subject: claim.subject, text: claim.body, ...(claim.reply_to ? { reply_to: claim.reply_to } : {}) }),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json() as { id?: string; message?: string; name?: string };
    if (!response.ok || !result.id || (useGmail && result.id !== id)) throw new Error(`Email provider ${response.status}: ${result.message ?? result.name ?? "Delivery was not confirmed"}`);
    // The raw magic link is retained only while delivery is pending; completed bodies are removed.
    await db.prepare("UPDATE email_outbox SET state='sent', provider_id=?, sent_at=?, error=NULL, body='' WHERE id=?").bind(result.id, NOW(), id).run();
    return { id, state: "sent" };
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Delivery failed").slice(0, 500);
    const next = new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(claim.attempts, 7)) * 1000).toISOString();
    await db.prepare("UPDATE email_outbox SET state='failed',error=?,next_attempt_at=? WHERE id=?").bind(message, next, id).run();
    return { id, state: "failed", error: "Your changes are saved, but the email notification could not be sent. The owner can retry it." };
  }
}

export async function sendMails(ids: string[]) {
  const results = await Promise.all(ids.map(deliverMail));
  return notificationSummary(results);
}

export function notificationSummary(results: { id: string; state: string; error?: string }[]) {
  const state = results.every((r) => r.state === "sent") ? "sent" : results.some((r) => r.state === "failed") ? "failed" : results.some((r) => r.state === "unconfigured") ? "unconfigured" : "pending";
  return { state, notifications: results, ...(state !== "sent" ? { error: results.find((r) => r.error)?.error ?? (state === "unconfigured" ? "Email delivery is not configured. Your submission is saved; keep your private access link." : "Email notifications are waiting to be sent.") } : {}) };
}

export const defaultSite = {
  brand: "sandstone", intro: "Custom Minecraft Bedrock scripting & behaviour. Thoughtful mechanics, built around your world.",
  availability: "Open for commissions", projects: [] as { id: string; title: string; category: string; description: string; image: string; accent?: string }[],
  boxes: [1, 2, 3].map(() => ({ title: "", text: "", media: "", mediaType: "image" as "image" | "video" })),
};

export async function getSite() {
  if (!env.DB) return defaultSite;
  const row = await database().prepare("SELECT value FROM site_content WHERE id='public'").first<{ value: string }>();
  if (!row) return defaultSite;
  const saved = JSON.parse(row.value) as Partial<typeof defaultSite>;
  return { ...defaultSite, ...saved, boxes: Array.isArray(saved.boxes) && saved.boxes.length === 3 ? saved.boxes : defaultSite.boxes };
}

export function validateRequestFields(form: FormData) {
  if (form.get("website")) throw new ApiError(400, "This request could not be submitted.");
  if (form.get("consent") !== "true") throw new ApiError(400, "Please agree to the use of your details for this commission.");
  return { name: stringField(form.get("name"), "Name", 80, 2), email: emailField(form.get("email")), title: stringField(form.get("title"), "Project title", 120, 3), description: stringField(form.get("description"), "Project details", 8000, 20), budget: stringField(form.get("budget") ?? "", "Budget", 120), timeline: stringField(form.get("timeline") ?? "", "Timeline", 120), assets: stringField(form.get("assets") ?? "", "Asset details", 2000), idempotencyKey: idempotencyKey(form.get("idempotencyKey")) };
}

export async function multipart(request: Request, maxSize = 21 * 1024 * 1024, allowedOrigin?: string): Promise<FormData> {
  assertSameOrigin(request, allowedOrigin);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new ApiError(415, "Submit this form with multipart data.");
  if (Number(request.headers.get("content-length") ?? 0) > maxSize) throw new ApiError(413, "The attachments are too large.");
  // Bound the stream before the multipart parser, without retaining a second 50 MB copy.
  if (!request.body) throw new ApiError(400, "The form is empty.");
  let size = 0;
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxSize) throw new ApiError(413, "The attachments are too large.");
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type")! }, body: bounded }).formData();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "The uploaded form could not be read.");
  }
}

