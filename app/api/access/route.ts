import { ApiError, assertSameOrigin, stringField } from "@/lib/commission-validation";
import { NOW, cookie, database, endpoint, hash, identity, json, randomToken, rateLimit, readJson } from "@/lib/commissions";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return endpoint(async () => {
    assertSameOrigin(request);
    await rateLimit(request, "access", 30, 15 * 60);
    const input = await readJson(request), token = stringField(input.token, "Access link", 43, 43);
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new ApiError(400, "This private link is invalid. Request a new one using your email.");
    const tokenHash = await hash(token);
    const found = await database().prepare("SELECT request_id FROM access_tokens WHERE hash=? AND expires_at>? AND revoked=0").bind(tokenHash, NOW()).first<{ request_id: string }>();
    if (!found) throw new ApiError(401, "This private link has expired or been revoked. Recover access using your email.");
    const session = randomToken(), expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await database().prepare("INSERT INTO client_sessions(hash,token_hash,request_id,expires_at,created_at) VALUES(?,?,?,?,?)").bind(await hash(session), tokenHash, found.request_id, expiresAt, NOW()).run();
    return json({ requestId: found.request_id, expiresAt }, 200, { "set-cookie": cookie(request, session) });
  });
}

export async function DELETE(request: Request) {
  return endpoint(async () => {
    assertSameOrigin(request);
    const who = await identity(request);
    if (who.sessionHash) await database().prepare("DELETE FROM client_sessions WHERE hash=?").bind(who.sessionHash).run();
    return json({ loggedOut: true }, 200, { "set-cookie": cookie(request, "", 0) });
  });
}
