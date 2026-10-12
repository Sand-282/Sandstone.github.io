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
    if (!CHAT_STATUSES.has(commission.status)) throw new ApiError(409, "Chat opens after this commission has been accepted.");
    const input = await readJson(request), body = stringField(input.body, "Message", 5000, 1), key = idempotencyKey(input.idempotencyKey);
    const existing = await database().prepare("SELECT * FROM messages WHERE request_id=? AND sender=? AND idempotency_key=?").bind(id, who.role, key).first<Message>();
    if (existing) {
      if (existing.body !== body) throw new ApiError(409, "This message key has already been used. Try again with a new message.");
      const notification = await database().prepare("SELECT id,state FROM email_outbox WHERE id=?").bind(`message-${existing.id}`).first<{ id: string; state: string }>();
      return json({ message: serializeMessage(existing), email: notification ? notificationSummary([notification]) : { state: "pending" } });
    }
    await rateLimit(request, `message-${who.role}`, 30, 60, id);
    const messageId = crypto.randomUUID(), mailId = `message-${messageId}`, now = NOW(), recipient = who.role === "admin" ? commission.email : env.ADMIN_EMAIL?.trim();
    if (!recipient) throw new ApiError(503, "The owner's contact address has not been configured yet.");
    const origin = siteOrigin(request), link = who.role === "admin" ? `${origin}/portal` : `${origin}/admin?request=${id}`;
    const mailBody = `There's a new message in “${commission.title}”.\n\nFrom: ${who.role === "admin" ? "Your developer" : commission.name}\n\n${body}\n\nRead and reply: ${link}\n${who.role === "admin" ? "If you need access, recover your private link using your email from the commission portal.\n" : ""}\nReference: ${id}`;
    try {
      await database().batch([
        database().prepare("INSERT INTO messages(id,request_id,sender,body,idempotency_key,created_at) VALUES(?,?,?,?,?,?)").bind(messageId, id, who.role, body, key, now),
        database().prepare("UPDATE commission_requests SET updated_at=? WHERE id=?").bind(now, id),
        database().prepare("INSERT INTO email_outbox(id,request_id,recipient,subject,body,kind,state,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(mailId, id, recipient, `New message: ${commission.title}`, mailBody, who.role === "admin" ? "message-client" : "message-owner", emailConfigured() ? "pending" : "unconfigured", now),
      ]);
    } catch (error) {
      const duplicate = await database().prepare("SELECT * FROM messages WHERE request_id=? AND sender=? AND idempotency_key=?").bind(id, who.role, key).first<Message>();
      if (duplicate) {
        if (duplicate.body !== body) throw new ApiError(409, "This message key has already been used. Try again with a new message.");
        const notification = await database().prepare("SELECT id,state FROM email_outbox WHERE id=?").bind(`message-${duplicate.id}`).first<{ id: string; state: string }>();
        return json({ message: serializeMessage(duplicate), email: notification ? notificationSummary([notification]) : { state: "pending" } });
      }
      throw error;
    }
    await addActivity(commission, `${who.role === "admin" ? "Admin" : "Client"} sent a message`);
    return json({ message: { id: messageId, sender: who.role, body, createdAt: now }, email: await sendMails([mailId]) }, 201);
  });
}
