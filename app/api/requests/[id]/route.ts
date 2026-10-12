import { ApiError, assertSameOrigin, stringField, validTransition } from "@/lib/commission-validation";
import { Commission, Mail, Message, StoredFile, authorizedCommission, database, emailConfigured, endpoint, json, mailStatement, NOW, readJson, requireAdmin, sendMails, serializeCommission, serializeFile, serializeMail, serializeMessage, siteOrigin } from "@/lib/commissions";
import { addActivity, getProject } from "@/lib/project-state";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return endpoint(async () => {
    const { id } = await context.params, { who, commission } = await authorizedCommission(request, id);
    const [messages, files, notifications] = await Promise.all([
      database().prepare("SELECT * FROM messages WHERE request_id=? ORDER BY created_at DESC,id DESC LIMIT 501").bind(id).all<Message>(),
      database().prepare("SELECT * FROM files WHERE request_id=? ORDER BY created_at ASC").bind(id).all<StoredFile>(),
      who.role === "admin" ? database().prepare("SELECT * FROM email_outbox WHERE request_id=? ORDER BY created_at DESC LIMIT 100").bind(id).all<Mail>() : null,
    ]);
    const project = (await getProject(commission)).state;
    return json({ request: serializeCommission(commission), project, messages: messages.results.slice(0, 500).reverse().map(serializeMessage), hasOlderMessages: messages.results.length > 500, files: files.results.map(serializeFile), ...(notifications ? { notifications: notifications.results.map(serializeMail) } : {}) });
  });
}

export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    assertSameOrigin(request); await requireAdmin(request);
    const { id } = await context.params, { commission } = await authorizedCommission(request, id), body = await readJson(request);
    const status = stringField(body.status, "Status", 20, 3), note = stringField(body.note ?? commission.note, "Note", 2000);
    if (!validTransition(commission.status, status)) throw new ApiError(409, `A ${commission.status} request cannot be changed to ${status}.`);
    if (status === commission.status && note === commission.note) return json({ request: serializeCommission(commission), email: { state: "unchanged" } });
    const origin = siteOrigin(request), changedStatus = status !== commission.status;
    const statusText = changedStatus ? ({ accepted: "Your request has been accepted. Your private chat is now open.", declined: "Your request has been declined.", active: "Work on your commission is now in progress.", completed: "Your commission is now complete. Your private chat remains available." } as Record<string, string>)[status] : "There is an update on your commission request.";
    const subject = `Commission ${changedStatus ? status : "update"}: ${commission.title}`;
    const mailBody = `Hi ${commission.name},\n\n${statusText}\n${note ? `\n${note}\n` : ""}\nOpen your commission page: ${origin}/portal\nIf you need a new private access link, choose “Recover access” and enter your email.\n\nReference: ${id}`;
    const mail = mailStatement(id, commission.email, subject, mailBody, "status-client");
    const change = database().prepare("UPDATE commission_requests SET status=?,note=?,updated_at=? WHERE id=? AND status=? AND updated_at=?").bind(status, note, NOW(), id, commission.status, commission.updated_at);
    // The conditional outbox insert avoids a notification if a concurrent decision already changed the status.
    const notification = database().prepare("INSERT INTO email_outbox(id,request_id,recipient,subject,body,kind,reply_to,state,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1").bind(mail.id, id, commission.email, subject, mailBody, "status-client", null, emailConfigured() ? "pending" : "unconfigured", NOW());
    const result = await database().batch([change, notification]);
    if (!result[0].meta.changes) throw new ApiError(409, "This request changed while you were reviewing it. Refresh and try again.");
    const saved = await database().prepare("SELECT * FROM commission_requests WHERE id=?").bind(id).first<Commission>();
    await addActivity(saved!, changedStatus ? `Admin changed project status to ${status}` : "Admin updated the project note");
    return json({ request: serializeCommission(saved!), email: await sendMails([mail.id]) });
  });
}

export async function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    assertSameOrigin(request); await requireAdmin(request);
    const { id } = await context.params;
    await authorizedCommission(request, id);
    await database().prepare("UPDATE access_tokens SET revoked=1 WHERE request_id=?").bind(id).run();
    return json({ revoked: true, requestId: id });
  });
}
