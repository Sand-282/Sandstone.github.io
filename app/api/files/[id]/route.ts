import { ApiError, attachmentDisposition } from "@/lib/commission-validation";
import { StoredFile, bucket, database, endpoint, identity } from "@/lib/commissions";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { id } = await context.params;
    const file = await database().prepare("SELECT * FROM files WHERE id=?").bind(id).first<StoredFile>();
    if (!file) throw new ApiError(404, "This file could not be found.");
    if (!file.public) {
      const who = await identity(request);
      if (who.role !== "admin" && !(who.role === "client" && who.requestId === file.request_id)) throw new ApiError(404, "This file could not be found.");
    }
    const object = await bucket().get(file.storage_key);
    if (!object) throw new ApiError(404, "This file is no longer available.");
    const headers = new Headers({ "content-type": file.mime, "content-length": String(file.size), "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": file.public ? "public, max-age=86400, immutable" : "private, no-store", "content-security-policy": "default-src 'none'; sandbox" });
    if (!file.public) headers.set("content-disposition", attachmentDisposition(file.name));
    return new Response(object.body, { headers });
  });
}
