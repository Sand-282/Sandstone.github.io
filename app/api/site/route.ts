import { env } from "cloudflare:workers";
import { adminConfigured, emailConfigured, getSite, json, publicEndpoint, publicOptions, storageConfigured } from "@/lib/commissions";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return publicEndpoint(request, async () => json({ ...await getSite(), readiness: { database: !!env.DB, uploads: storageConfigured(), email: emailConfigured(), admin: adminConfigured() } }));
}
export async function OPTIONS(request: Request) { return publicOptions(request, "GET"); }
