import { adminConfigured, authMode, emailConfigured, endpoint, identity, json } from "@/lib/commissions";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(async () => {
    const who = await identity(request);
    return json({ role: who.role, authentication: authMode() === "standalone" ? "password" : "chatgpt", adminConfigured: adminConfigured(), emailConfigured: emailConfigured(), ...(who.requestId ? { clientRequestId: who.requestId, expiresAt: who.expiresAt } : {}) });
  });
}
