import { ApiError, assertSameOrigin } from "@/lib/commission-validation";
import { Mail, NOW, database, emailConfigured, endpoint, json, readJson, requireAdmin, sendMails, serializeMail } from "@/lib/commissions";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return endpoint(async () => {
    await requireAdmin(request);
    const [records, counts] = await Promise.all([
      database().prepare("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 200").all<Mail>(),
      database().prepare("SELECT state,COUNT(*) AS count FROM email_outbox GROUP BY state").all<{ state: string; count: number }>(),
    ]);
    return json({ configured: emailConfigured(), notifications: records.results.map(serializeMail), counts: Object.fromEntries(counts.results.map((r) => [r.state, r.count])) });
  });
}

export async function POST(request: Request) {
  return endpoint(async () => {
    assertSameOrigin(request); await requireAdmin(request);
    if (!emailConfigured()) throw new ApiError(503, "Configure the email provider and verified sender before retrying notifications.");
    const input = await readJson(request), requested = input.ids;
    if (requested !== undefined && (!Array.isArray(requested) || requested.length > 20 || requested.some((v) => typeof v !== "string" || v.length > 80))) throw new ApiError(400, "Select a maximum of 20 notifications to retry.");
    const selection = requested as string[] | undefined;
    if (selection && !selection.length) return json({ retried: 0, email: { state: "unchanged", notifications: [] } });
    const staleLease = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const selectionSql = selection ? ` AND id IN (${selection.map(() => "?").join(",")})` : "";
    const rows = await database().prepare(`SELECT id FROM email_outbox WHERE ((state IN ('pending','failed','unconfigured') AND (next_attempt_at IS NULL OR next_attempt_at<=?)) OR (state='sending' AND last_attempt_at<?))${selectionSql} ORDER BY created_at ASC LIMIT 20`).bind(NOW(), staleLease, ...(selection ?? [])).all<{ id: string }>();
    const ids = rows.results.map((r) => r.id);
    return json({ retried: ids.length, email: ids.length ? await sendMails(ids) : { state: "unchanged", notifications: [] } });
  });
}
