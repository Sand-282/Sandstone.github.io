import { sqliteTable, text, integer, blob, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const commissionRequests = sqliteTable("commission_requests", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull(),
  title: text("title").notNull(), description: text("description").notNull(),
  budget: text("budget").notNull().default(""), timeline: text("timeline").notNull().default(""),
  assets: text("assets").notNull().default(""), status: text("status").notNull().default("pending"),
  note: text("note").notNull().default(""), idempotencyKey: text("idempotency_key").notNull().unique(),
  payloadHash: text("payload_hash").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [index("requests_email_created").on(t.email, t.createdAt)]);

export const accessTokens = sqliteTable("access_tokens", {
  hash: text("hash").primaryKey(), requestId: text("request_id").notNull().references(() => commissionRequests.id),
  expiresAt: text("expires_at").notNull(), revoked: integer("revoked").notNull().default(0), createdAt: text("created_at").notNull(),
}, (t) => [index("tokens_request").on(t.requestId)]);

export const clientSessions = sqliteTable("client_sessions", {
  hash: text("hash").primaryKey(), tokenHash: text("token_hash").notNull().references(() => accessTokens.hash),
  requestId: text("request_id").notNull().references(() => commissionRequests.id),
  expiresAt: text("expires_at").notNull(), createdAt: text("created_at").notNull(),
});

export const adminSessions = sqliteTable("admin_sessions", {
  hash: text("hash").primaryKey(), ownerEmail: text("owner_email").notNull(),
  expiresAt: text("expires_at").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("admin_sessions_expiry").on(t.expiresAt)]);

export const files = sqliteTable("files", {
  id: text("id").primaryKey(), requestId: text("request_id").references(() => commissionRequests.id),
  storageKey: text("storage_key").notNull().unique(), name: text("name").notNull(), mime: text("mime").notNull(),
  size: integer("size").notNull(), public: integer("public").notNull().default(0), createdAt: text("created_at").notNull(),
}, (t) => [index("files_request").on(t.requestId)]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(), requestId: text("request_id").notNull().references(() => commissionRequests.id),
  sender: text("sender").notNull(), body: text("body").notNull(), attachmentIds: text("attachment_ids").notNull().default("[]"), idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("message_duplicate").on(t.requestId, t.sender, t.idempotencyKey), index("messages_request_created").on(t.requestId, t.createdAt)]);

export const commissionReviews = sqliteTable("commission_reviews", {
  id: text("id").primaryKey(), requestId: text("request_id").notNull().unique().references(() => commissionRequests.id),
  rating: integer("rating").notNull(), body: text("body").notNull().default(""), state: text("state").notNull().default("new"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [index("reviews_state_created").on(t.state, t.createdAt)]);

export const siteContent = sqliteTable("site_content", {
  id: text("id").primaryKey(), value: text("value").notNull(), updatedAt: text("updated_at").notNull(),
});

export const emailOutbox = sqliteTable("email_outbox", {
  id: text("id").primaryKey(), requestId: text("request_id").references(() => commissionRequests.id),
  recipient: text("recipient").notNull(), subject: text("subject").notNull(), body: text("body").notNull(),
  replyTo: text("reply_to"), kind: text("kind").notNull(), state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0), error: text("error"), providerId: text("provider_id"),
  lastAttemptAt: text("last_attempt_at"), nextAttemptAt: text("next_attempt_at"), sentAt: text("sent_at"), createdAt: text("created_at").notNull(),
}, (t) => [index("email_state_created").on(t.state, t.createdAt), index("email_request").on(t.requestId)]);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull(), expiresAt: integer("expires_at").notNull(),
});

export const storedObjects = sqliteTable("stored_objects", {
  storageKey: text("storage_key").primaryKey(), size: integer("size").notNull(), chunkCount: integer("chunk_count").notNull(),
});
export const storedChunks = sqliteTable("stored_chunks", {
  storageKey: text("storage_key").notNull().references(() => storedObjects.storageKey),
  chunkIndex: integer("chunk_index").notNull(), data: blob("data").notNull(),
}, (t) => [uniqueIndex("stored_chunk_position").on(t.storageKey, t.chunkIndex)]);

