import { env } from "cloudflare:workers";
import { ApiError, CHAT_STATUSES, assertSameOrigin, idempotencyKey, stringField } from "@/lib/commission-validation";
import { Message, authorizedCommission, database, emailConfigured, endpoint, json, notificationSummary, NOW, rateLimit, readJson, sendMails, serializeMessage, siteOrigin } from "@/lib/commissions";
import { addActivity } from "@/lib/project-state";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return endpoint(async () => {
    const { id } = await context.params;
    await authorizedCommission(request, id);
    const result = await database().prepare("SELECT * FROM messages WHERE request_id=? ORDER BY created_at DESC,id DESC LIMIT 501").bind(id).all<Message>();
    return json({ messages: result.results.slice(0, 500).reverse().map(serializeMessage), hasOlderMessages: result.results.length > 500 });
  });
}

export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    assertSameOrigin(request);
    const { id } = await context.params, { who, commission } = await authorizedCommission(request, id);
    if (who.role === "anonymous") throw new ApiError(403, "Open your private project link first.");
    if (!CHAT_STATUSES.has(commission.status)) throw new ApiError(409, "Chat opens after this commission has been accepted.");
    const input = await readJson(request);
    const rawAttachmentIds = input.attachmentIds ?? [];
    if (!Array.isArray(rawAttachmentIds) || rawAttachmentIds.length > 5 || rawAttachmentIds.some((fileId) => typeof fileId !== "string" || !/^[\da-f-]{36}$/i.test(fileId)) || new Set(rawAttachmentIds).size !== rawAttachmentIds.length) {
      throw new ApiError(400, "Choose up to five valid project files to attach.");
    }
    const attachmentIds = rawAttachmentIds as string[];
    const body = stringField(input.body ?? "", "Message", 5000, attachmentIds.length ? 0 : 1), key = idempotencyKey(input.idempotencyKey);
    const attachedFiles = attachmentIds.length
      ? (await database().prepare(`SELECT id,name FROM files WHERE request_id=? AND id IN (${attachmentIds.map(() => "?").join(",")})`).bind(id, ...attachmentIds).all<{ id: string; name: string }>()).results
      : [];
    if (attachedFiles.length !== attachmentIds.length) throw new ApiError(404, "One of those files is no longer available in this project.");
    const existing = await database().prepare("SELECT * FROM messages WHERE request_id=? AND sender=? AND idempotency_key=?").bind(id, who.role, key).first<Message>();
    if (existing) {
      if (existing.body !== body || (existing.attachment_ids || "[]") !== JSON.stringify(attachmentIds)) throw new ApiError(409, "This message key has already been used. Try again with a new message.");
      const notification = await database().prepare("SELECT id,state FROM email_outbox WHERE id=?").bind(`message-${existing.id}`).first<{ id: string; state: string }>();
      return json({ message: serializeMessage(existing), email: notification ? notificationSummary([notification]) : { state: "pending" } });
    }
    await rateLimit(request, `message-${who.role}`, 30, 60, id);
    const messageId = crypto.randomUUID(), mailId = `message-${messageId}`, now = NOW(), recipient = who.role === "admin" ? commission.email : env.ADMIN_EMAIL?.trim();
    if (!recipient) throw new ApiError(503, "The owner's contact address has not been configured yet.");
    const origin = siteOrigin(request), link = who.role === "admin" ? `${origin}/portal` : `${origin}/admin?request=${id}`;
    const mailBody = `There's a new message in “${commission.title}”.\n\nFrom: ${who.role === "admin" ? "Your developer" : commission.name}\n\n${body || "Shared project files"}${attachedFiles.length ? `\n\nFiles: ${attachedFiles.map((file) => file.name).join(", ")}` : ""}\n\nRead and reply: ${link}\n${who.role === "admin" ? "If you need access, recover your private link using your email from the commission portal.\n" : ""}\nReference: ${id}`;
    try {
      await database().batch([
        database().prepare("INSERT INTO messages(id,request_id,sender,body,attachment_ids,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?)").bind(messageId, id, who.role, body, JSON.stringify(attachmentIds), key, now),
        database().prepare("UPDATE commission_requests SET updated_at=? WHERE id=?").bind(now, id),
        database().prepare("INSERT INTO email_outbox(id,request_id,recipient,subject,body,kind,state,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(mailId, id, recipient, `New message: ${commission.title}`, mailBody, who.role === "admin" ? "message-client" : "message-owner", emailConfigured() ? "pending" : "unconfigured", now),
      ]);
    } catch (error) {
      const duplicate = await database().prepare("SELECT * FROM messages WHERE request_id=? AND sender=? AND idempotency_key=?").bind(id, who.role, key).first<Message>();
      if (duplicate) {
        if (duplicate.body !== body || (duplicate.attachment_ids || "[]") !== JSON.stringify(attachmentIds)) throw new ApiError(409, "This message key has already been used. Try again with a new message.");
        const notification = await database().prepare("SELECT id,state FROM email_outbox WHERE id=?").bind(`message-${duplicate.id}`).first<{ id: string; state: string }>();
        return json({ message: serializeMessage(duplicate), email: notification ? notificationSummary([notification]) : { state: "pending" } });
      }
      throw error;
    }
    await addActivity(commission, `${who.role === "admin" ? "Admin" : "Client"} sent a message`);
    return json({ message: serializeMessage({ id: messageId, request_id: id, sender: who.role, body, attachment_ids: JSON.stringify(attachmentIds), created_at: now }), email: await sendMails([mailId]) }, 201);
  });
}

