import { ApiError, assertSameOrigin } from "@/lib/commission-validation";
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, NOW, adminConfigured, adminCookie, authMode, cookieToken, database, endpoint, hash, json, ownerPasswordMatches, randomToken, rateLimit, readJson } from "@/lib/commissions";
import { env } from "cloudflare:workers";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return endpoint(async () => {
    assertSameOrigin(request);
    if (authMode() !== "standalone") throw new ApiError(404, "This sign-in method is not available.");
    await rateLimit(request, "admin-login", 5, 15 * 60);
    const input = await readJson(request, 8 * 1024);
    if (!adminConfigured()) throw new ApiError(503, "Owner sign-in has not been configured yet.");
    const matches = await ownerPasswordMatches(input.email, input.password);
    if (!matches || typeof input.password !== "string" || new TextEncoder().encode(input.password).length > 1024) {
      throw new ApiError(401, "The email or password is incorrect.");
    }
    const token = randomToken(), expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000).toISOString();
    const previous = cookieToken(request, ADMIN_COOKIE);
    await database().batch([
      ...(previous ? [database().prepare("DELETE FROM admin_sessions WHERE hash=?").bind(await hash(previous))] : []),
      database().prepare("INSERT INTO admin_sessions(hash,owner_email,expires_at,created_at) VALUES(?,?,?,?)").bind(await hash(token), env.ADMIN_EMAIL!.trim().toLowerCase(), expiresAt, NOW()),
    ]);
    return json({ loggedIn: true, sessionToken: token }, 200, { "set-cookie": adminCookie(token) });
  });
}

export async function DELETE(request: Request) {
  return endpoint(async () => {
    assertSameOrigin(request);
    if (authMode() !== "standalone") throw new ApiError(404, "This sign-in method is not available.");
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] || cookieToken(request, ADMIN_COOKIE);
    if (token) await database().prepare("DELETE FROM admin_sessions WHERE hash=?").bind(await hash(token)).run();
    return json({ loggedOut: true }, 200, { "set-cookie": adminCookie("", 0) });
  });
}
