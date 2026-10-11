import { ApiError, MAX_FILE_BYTES, detectMime, safeFilename } from "./commission-validation";
import { NOW, bucket, database } from "./commissions";

export type Upload = { id: string; name: string; mime: string; file: File; storageKey: string; contentHash: string };

export async function validateUploads(values: FormDataEntryValue[], publicImages = false): Promise<Upload[]> {
  const files = values.filter((value): value is File => typeof value !== "string" && value.size > 0);
  if (files.length > (publicImages ? 1 : 5)) throw new ApiError(400, "Attach a maximum of five files.");
  if (files.reduce((size, file) => size + file.size, 0) > 20 * 1024 * 1024) throw new ApiError(413, "The combined attachments must be smaller than 20 MB.");
  if (files.length) bucket();
  const uploads: Upload[] = [];
  for (const file of files) {
    if (file.size > (publicImages ? 8 * 1024 * 1024 : MAX_FILE_BYTES)) throw new ApiError(413, publicImages ? "Images must be smaller than 8 MB." : "Each attachment must be smaller than 10 MB.");
    const name = safeFilename(file.name);
    const content = await file.arrayBuffer();
    const bytes = new Uint8Array(content);
    const mime = detectMime(name, bytes, publicImages);
    const digest = await crypto.subtle.digest("SHA-256", content);
    const contentHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    const id = crypto.randomUUID();
    uploads.push({ id, name, mime, file, storageKey: `${publicImages ? "portfolio" : "private"}/${id}`, contentHash });
  }
  return uploads;
}

export async function storeUploads(uploads: Upload[]) {
  const written: string[] = [];
  try {
    for (const upload of uploads) {
      await bucket().put(upload.storageKey, upload.file.stream(), { httpMetadata: { contentType: upload.mime } });
      written.push(upload.storageKey);
    }
  } catch (error) {
    if (written.length) await bucket().delete(written);
    throw error;
  }
}

export const uploadStatement = (upload: Upload, requestId: string | null) => database().prepare("INSERT INTO files(id,request_id,storage_key,name,mime,size,public,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(upload.id, requestId, upload.storageKey, upload.name, upload.mime, upload.file.size, requestId ? 0 : 1, NOW());
