import { assertSameOrigin, emailField } from "@/lib/commission-validation";
import { Commission, database, emailConfigured, endpoint, json, mailStatement, makeAccess, rateLimit, readJson, sendMails, siteOrigin } from "@/lib/commissions";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return endpoint(async () => {
    assertSameOrigin(request);
    await rateLimit(request, "recover", 3, 15 * 60);
    const input = await readJson(request), email = emailField(input.email);
    const generic = { message: "If a commission exists for that email, a private access link will be sent. Check your inbox and spam folder.", emailConfigured: emailConfigured() };
    // Do not disclose which addresses exist or supply a token to an unverified caller.
    if (!emailConfigured()) return json({ ...generic, message: "Email delivery is not configured yet. Use the private link you saved when submitting your request, or contact the developer." });
    const result = await database().prepare("SELECT * FROM commission_requests WHERE email=? ORDER BY created_at DESC LIMIT 10").bind(email).all<Commission>();
    const statements: D1PreparedStatement[] = [], links: string[] = [], origin = siteOrigin(request);
    for (const commission of result.results) {
      const access = await makeAccess(commission.id, request);
      // Recovery sends a token by email; it must not establish an unverified browser session.
      statements.push(access.statements[0]);
      links.push(`${commission.title}: ${new URL(access.portalUrl, origin).href}`);
    }
    if (links.length) {
      const mail = mailStatement(null, email, "Your private Bedrock commission links", `Here are your private commission access links:\n\n${links.join("\n\n")}\n\nKeep these links private. They expire in 180 days.`, "recovery-client");
      statements.push(mail.statement);
      await database().batch(statements);
      // Returning provider status only for existing email would leak membership, so response remains generic.
      await sendMails([mail.id]);
    }
    return json(generic);
  });
}
