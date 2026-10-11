import { env } from "cloudflare:workers";
import { ApiError, assertSameOrigin } from "@/lib/commission-validation";
import { Commission, adminConfigured, bucket, database, endpoint, hash, identity, json, mailStatement, makeAccess, multipart, notificationSummary, NOW, pagesOrigin, publicEndpoint, publicOptions, rateLimit, sendMails, serializeCommission, siteOrigin, validateRequestFields } from "@/lib/commissions";
import { storeUploads, uploadStatement, validateUploads } from "@/lib/commission-files";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return endpoint(async () => {
    const who = await identity(request);
    if (who.role === "anonymous") throw new ApiError(401, "Open your private access link to view your commission.");
    if (who.role === "client") {
      const result = await database().prepare("SELECT * FROM commission_requests WHERE id=?").bind(who.requestId).all<Commission>();
      return json({ requests: result.results.map(serializeCommission), nextCursor: null });
    }
    const cursor = new URL(request.url).searchParams.get("cursor");
    let after: { updatedAt: string; id: string } | null = null;
    if (cursor) {
      try {
        if (cursor.length > 160 || !/^[\w-]+$/.test(cursor)) throw new Error("Invalid cursor");
        const decoded = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
        const [updatedAt, id] = decoded.split("|");
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt) || !/^[\w-]{1,80}$/.test(id)) throw new Error("Invalid cursor");
        after = { updatedAt, id };
      } catch { throw new ApiError(400, "This commission page has expired. Refresh the list."); }
    }
    const result = after
      ? await database().prepare("SELECT * FROM commission_requests WHERE updated_at<? OR (updated_at=? AND id<?) ORDER BY updated_at DESC,id DESC LIMIT 201").bind(after.updatedAt, after.updatedAt, after.id).all<Commission>()
      : await database().prepare("SELECT * FROM commission_requests ORDER BY updated_at DESC,id DESC LIMIT 201").all<Commission>();
    const rows = result.results.slice(0, 200), last = rows.at(-1);
    const nextCursor = result.results.length > 200 && last ? btoa(`${last.updated_at}|${last.id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
    return json({ requests: rows.map(serializeCommission), nextCursor });
  });
}

export async function POST(request: Request) {
  return publicEndpoint(request, async () => {
    const allowedOrigin = pagesOrigin();
    assertSameOrigin(request, allowedOrigin);
    if (!adminConfigured()) throw new ApiError(503, "Commission submissions are being connected. Please email cjgsinclare@gmail.com in the meantime.");
    await rateLimit(request, "submit", 8, 3600);
    const form = await multipart(request, undefined, allowedOrigin), fields = validateRequestFields(form);
    const uploads = await validateUploads(form.getAll("files"));
    const payloadHash = await hash(JSON.stringify({ ...fields, files: uploads.map((u) => ({ name: u.name, size: u.file.size, mime: u.mime, hash: u.contentHash })) }));
    const existing = await database().prepare("SELECT * FROM commission_requests WHERE idempotency_key=?").bind(fields.idempotencyKey).first<Commission>();
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new ApiError(409, "This submission key has already been used for a different request. Start a new submission.");
      const access = await makeAccess(existing.id, request);
      await database().batch(access.statements);
      const records = await database().prepare("SELECT id,state FROM email_outbox WHERE request_id=? AND kind IN ('request-owner','request-client')").bind(existing.id).all<{ id: string; state: string }>();
      return json({ request: serializeCommission(existing), portalUrl: access.portalUrl, email: notificationSummary(records.results), warnings: ["This request was already saved. Your private access link has been refreshed."] }, 200, { "set-cookie": access.cookie });
    }
    await rateLimit(request, "submit-email", 3, 24 * 3600, fields.email);
    const id = crypto.randomUUID(), now = NOW(), access = await makeAccess(id, request), origin = siteOrigin(request);
    const ownerBody = `A new Minecraft Bedrock commission request has arrived.\n\nName: ${fields.name}\nEmail: ${fields.email}\nProject: ${fields.title}\nBudget: ${fields.budget || "Not specified"}\nTimeline: ${fields.timeline || "Not specified"}\nAssets: ${fields.assets || "Not specified"}\n\nRequested work:\n${fields.description}\n\nAttachments: ${uploads.length ? uploads.map((u) => `${u.name} (${Math.ceil(u.file.size / 1024)} KB)`).join(", ") : "None"}\n\nReview the full request and securely download attachments: ${origin}/admin?request=${id}\n\nRequest reference: ${id}`;
    const ownerMail = env.ADMIN_EMAIL ? mailStatement(id, env.ADMIN_EMAIL.trim(), `New commission: ${fields.title}`, ownerBody, "request-owner", fields.email) : null;
    const clientMail = mailStatement(id, fields.email, "Your Bedrock commission request is saved", `Hi ${fields.name},\n\nYour request for “${fields.title}” has been saved and is waiting for review.\n\nYour private commission page:\n${new URL(access.portalUrl, origin).href}\n\nKeep this link private. It expires after 180 days. You can request a fresh access link from the commission portal using this email address.\n\nChat will open if your commission is accepted.\n\nReference: ${id}`, "request-client");
    await storeUploads(uploads);
    try {
      await database().batch([
        database().prepare("INSERT INTO commission_requests(id,name,email,title,description,budget,timeline,assets,idempotency_key,payload_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, fields.name, fields.email, fields.title, fields.description, fields.budget, fields.timeline, fields.assets, fields.idempotencyKey, payloadHash, now, now),
        ...access.statements, ...uploads.map((u) => uploadStatement(u, id)), ...(ownerMail ? [ownerMail.statement] : []), clientMail.statement,
      ]);
    } catch (error) {
      if (uploads.length) await bucket().delete(uploads.map((u) => u.storageKey));
      // A parallel retry may have won the unique idempotency-key insert. The caller can safely retry.
      const duplicate = await database().prepare("SELECT id FROM commission_requests WHERE idempotency_key=?").bind(fields.idempotencyKey).first();
      if (duplicate) throw new ApiError(409, "Your request is already saved. Retry this submission to retrieve your private access link.");
      throw error;
    }
    const saved = await database().prepare("SELECT * FROM commission_requests WHERE id=?").bind(id).first<Commission>();
    const email = await sendMails([...(ownerMail ? [ownerMail.id] : []), clientMail.id]);
    return json({ request: serializeCommission(saved!), portalUrl: access.portalUrl, email, warnings: email.state === "sent" ? [] : [email.error ?? "Email is not available yet. Save your private access link before leaving."] }, 201, { "set-cookie": access.cookie });
  });
}

export async function OPTIONS(request: Request) { return publicOptions(request, "POST"); }
