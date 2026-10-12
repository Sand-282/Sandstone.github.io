import { ApiError, assertSameOrigin } from "@/lib/commission-validation";
import { authorizedCommission, endpoint, json, rateLimit, readJson } from "@/lib/commissions";
import { changeProject } from "@/lib/project-state";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    assertSameOrigin(request);
    const { id } = await context.params;
    const { who, commission } = await authorizedCommission(request, id);
    if (who.role === "anonymous") throw new ApiError(403, "Open your private project link first.");
    await rateLimit(request, "project-update", 60, 60, `${id}:${who.role}`);
    const input = await readJson(request, 12 * 1024);
    const project = await changeProject(commission, who.role, input);
    return json({ project });
  });
}

