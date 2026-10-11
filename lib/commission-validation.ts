export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CHAT_STATUSES = new Set(["accepted", "active", "completed"]);

export function stringField(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== "string") throw new ApiError(400, `${label} must be text.`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(clean)) {
    throw new ApiError(400, `${label} must contain ${min ? `${min}–` : "at most "}${max} characters.`);
  }
  return clean;
}

export function emailField(value: unknown): string {
  const email = stringField(value, "Email", 254, 3).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new ApiError(400, "Enter a valid email address.");
  return email;
}

export function idempotencyKey(value: unknown): string {
  const key = stringField(value, "Submission key", 80, 24);
  if (!/^[a-zA-Z0-9_-]{24,80}$/.test(key)) throw new ApiError(400, "The submission key is invalid. Refresh and try again.");
  return key;
}

export function assertSameOrigin(request: Request, allowedOrigin?: string): void {
  const origin = request.headers.get("origin");
  // Only the public request route supplies this explicit, configured exception.
  if (allowedOrigin && origin === allowedOrigin) return;
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "This action must be submitted from this website.");
  }
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 160) || "attachment";
}

export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`;
}

export function detectMime(name: string, data: Uint8Array, publicImage = false): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const starts = (...bytes: number[]) => bytes.every((v, i) => data[i] === v);
  const ascii = (offset: number, value: string) => [...value].every((v, i) => data[offset + i] === v.charCodeAt(0));
  if (ext === "png" && starts(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
  if (["jpg", "jpeg"].includes(ext) && starts(255, 216, 255)) return "image/jpeg";
  if (ext === "gif" && (ascii(0, "GIF87a") || ascii(0, "GIF89a"))) return "image/gif";
  if (ext === "webp" && ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (publicImage) throw new ApiError(400, "Upload a PNG, JPEG, GIF or WebP image. SVG images are not supported.");
  if (ext === "pdf" && ascii(0, "%PDF-")) return "application/pdf";
  if (["zip", "mcpack", "mcaddon"].includes(ext) && (starts(80, 75, 3, 4) || starts(80, 75, 5, 6) || starts(80, 75, 7, 8))) return "application/zip";
  if (["txt", "json"].includes(ext)) {
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { throw new ApiError(400, "Text attachments must use UTF-8."); }
    if (content.includes("\0")) throw new ApiError(400, "The text attachment contains invalid binary data.");
    if (ext === "json") {
      try { JSON.parse(content); } catch { throw new ApiError(400, "The JSON attachment is not valid JSON."); }
      return "application/json";
    }
    return "text/plain; charset=utf-8";
  }
  throw new ApiError(400, "Supported files: PNG, JPEG, GIF, WebP, PDF, ZIP, MCPACK, MCADDON, JSON and TXT.");
}

export function validTransition(before: string, after: string): boolean {
  if (before === after) return true;
  return ({ pending: ["accepted", "declined"], accepted: ["active", "completed"], active: ["completed"], completed: [], declined: [] } as Record<string, string[]>)[before]?.includes(after) ?? false;
}
