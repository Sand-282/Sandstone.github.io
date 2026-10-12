import { ApiError } from "@/lib/commission-validation";
import { storeUploads, uploadStatement, validateUploads } from "@/lib/commission-files";
import { authorizedCommission, bucket, database, endpoint, json, multipart, rateLimit, serializeFile } from "@/lib/commissions";
import { addActivity } from "@/lib/project-state";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    const { id } = await context.params;
    const { who, commission } = await authorizedCommission(request, id);
    if (who.role === "anonymous") throw new ApiError(403, "Open your private project link first.");
    await rateLimit(request, "project-files", 15, 60, `${id}:${who.role}`);
    const form = await multipart(request, 21 * 1024 * 1024);
    const uploads = await validateUploads(form.getAll("files"));
    if (!uploads.length) throw new ApiError(400, "Choose at least one file.");
    const existing = await database().prepare("SELECT COALESCE(SUM(size),0) AS total FROM files WHERE request_id=?").bind(id).first<{ total: number }>();
    if ((existing?.total ?? 0) + uploads.reduce((sum, item) => sum + item.file.size, 0) > 40 * 1024 * 1024) throw new ApiError(413, "This project has reached its 40 MB file limit.");
    await storeUploads(uploads);
    try { await database().batch(uploads.map((item) => uploadStatement(item, id))); }
    catch (error) { await bucket().delete(uploads.map((item) => item.storageKey)); throw error; }
    await addActivity(commission, `${who.role === "admin" ? "Admin" : "Client"} uploaded ${uploads.length === 1 ? uploads[0].name : `${uploads.length} files`}`);
    return json({ files: uploads.map((item) => serializeFile({ id: item.id, request_id: id, storage_key: item.storageKey, name: item.name, mime: item.mime, size: item.file.size, public: 0, created_at: new Date().toISOString() })) }, 201);
  });
}
