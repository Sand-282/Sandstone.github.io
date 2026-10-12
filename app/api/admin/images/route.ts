import { ApiError } from "@/lib/commission-validation";
import { storeUploads, uploadStatement, validateUploads } from "@/lib/commission-files";
import { bucket, database, endpoint, json, multipart, requireAdmin } from "@/lib/commissions";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return endpoint(async () => {
    await requireAdmin(request);
    const form = await multipart(request, 21 * 1024 * 1024), uploads = await validateUploads(form.getAll("file"), true);
    if (uploads.length !== 1) throw new ApiError(400, "Choose one image or video to upload.");
    await storeUploads(uploads);
    try { await uploadStatement(uploads[0], null).run(); } catch (error) { await bucket().delete(uploads[0].storageKey); throw error; }
    const u = uploads[0];
    return json({ file: { id: u.id, name: u.name, mime: u.mime, size: u.file.size, url: `/api/files/${u.id}` } }, 201);
  });
}
