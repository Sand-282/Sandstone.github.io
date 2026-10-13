import { ApiError, assertSameOrigin } from "@/lib/commission-validation";
import { Message, authorizedCommission, database, endpoint, json, NOW, readJson } from "@/lib/commissions";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    assertSameOrigin(request);
    const { id } = await context.params;
    const { who } = await authorizedCommission(request, id);
    if (who.role !== "admin") throw new ApiError(403, "Only the studio owner can mark client messages as read.");
    const input = await readJson(request, 2 * 1024);
    if (typeof input.messageId !== "string" || !/^[\da-f-]{36}$/i.test(input.messageId)) throw new ApiError(400, "Choose a message to mark as read.");

    const latest = await database().prepare("SELECT * FROM messages WHERE request_id=? AND sender='client' AND id=?").bind(id, input.messageId).first<Message>();
    if (!latest) return json({ readAt: null });

    const row = await database().prepare("SELECT value FROM site_content WHERE id='admin:reads'").first<{ value: string }>();
    let reads: Record<string, string> = {};
    try { reads = row ? JSON.parse(row.value) as Record<string, string> : {}; } catch { reads = {}; }
    if ((reads[id] || "") < latest.created_at) {
      reads[id] = latest.created_at;
      await database().prepare("INSERT INTO site_content(id,value,updated_at) VALUES('admin:reads',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(reads), NOW()).run();
    }
    return json({ readAt: latest.created_at });
  });
}

