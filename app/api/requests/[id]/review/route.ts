import { env } from "cloudflare:workers";
import { ApiError, assertSameOrigin, stringField } from "@/lib/commission-validation";
import { CommissionReview, authorizedCommission, database, endpoint, json, mailStatement, NOW, readJson, requireAdmin, sendMails, serializeReview } from "@/lib/commissions";
import { addActivity } from "@/lib/project-state";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    assertSameOrigin(request);
    const { id } = await context.params;
    const { who, commission } = await authorizedCommission(request, id);
    if (who.role !== "client") throw new ApiError(403, "Only the client can leave a review.");
    if (commission.status !== "completed") throw new ApiError(409, "You can leave a review after the commission is completed.");
    const input = await readJson(request, 4 * 1024);
    if (!Number.isInteger(input.rating) || Number(input.rating) < 1 || Number(input.rating) > 5) throw new ApiError(400, "Choose a rating from 1 to 5 stars.");
    const body = stringField(input.body ?? "", "Review", 1200);
    const existing = await database().prepare("SELECT * FROM commission_reviews WHERE request_id=?").bind(id).first<CommissionReview>();
    if (existing) {
      if (existing.rating === input.rating && existing.body === body) return json({ review: serializeReview(existing), alreadySubmitted: true });
      throw new ApiError(409, "A review has already been submitted for this commission.");
    }

    const reviewId = crypto.randomUUID(), now = NOW();
    const mail = env.ADMIN_EMAIL?.trim()
      ? mailStatement(id, env.ADMIN_EMAIL.trim(), `Review received: ${commission.title}`, `A client left a ${input.rating}-star review for “${commission.title}”.\n\n${body || "No written comment."}\n\nOpen the commission workspace to review it.\n\nReference: ${id}`, "commission-review")
      : null;
    try {
      const statements = [database().prepare("INSERT INTO commission_reviews(id,request_id,rating,body,state,created_at,updated_at) VALUES(?,?,?,?,'new',?,?)").bind(reviewId, id, input.rating, body, now, now)];
      if (mail) statements.push(mail.statement);
      await database().batch(statements);
    } catch (error) {
      const duplicate = await database().prepare("SELECT * FROM commission_reviews WHERE request_id=?").bind(id).first<CommissionReview>();
      if (duplicate) {
        if (duplicate.rating === input.rating && duplicate.body === body) return json({ review: serializeReview(duplicate), alreadySubmitted: true });
        throw new ApiError(409, "A review has already been submitted for this commission.");
      }
      throw error;
    }
    const review = await database().prepare("SELECT * FROM commission_reviews WHERE id=?").bind(reviewId).first<CommissionReview>();
    await addActivity(commission, "Client submitted a review");
    return json({ review: serializeReview(review!), alreadySubmitted: false, email: mail ? await sendMails([mail.id]) : { state: "unconfigured" } }, 201);
  });
}

export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    assertSameOrigin(request);
    await requireAdmin(request);
    const { id } = await context.params, { commission } = await authorizedCommission(request, id), input = await readJson(request, 2 * 1024);
    const state = stringField(input.state, "Review state", 20, 3);
    if (!( ["reviewed", "hidden"] as unknown[]).includes(state)) throw new ApiError(400, "Choose whether to mark the review as reviewed or hide it.");
    const result = await database().prepare("UPDATE commission_reviews SET state=?,updated_at=? WHERE request_id=?").bind(state, NOW(), id).run();
    if (!result.meta.changes) throw new ApiError(404, "There is no review for this commission yet.");
    await addActivity(commission, state === "hidden" ? "Admin hid the client review" : "Admin marked the client review as reviewed");
    const review = await database().prepare("SELECT * FROM commission_reviews WHERE request_id=?").bind(id).first<CommissionReview>();
    return json({ review: serializeReview(review!) });
  });
}

