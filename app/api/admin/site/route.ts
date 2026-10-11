import { ApiError, assertSameOrigin, stringField } from "@/lib/commission-validation";
import { database, endpoint, json, NOW, readJson, requireAdmin } from "@/lib/commissions";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  return endpoint(async () => {
    assertSameOrigin(request); await requireAdmin(request);
    const input = await readJson(request), brand = stringField(input.brand, "Brand", 50, 2), intro = stringField(input.intro, "Introduction", 500, 10), availability = stringField(input.availability, "Availability", 100, 3);
    if (!Array.isArray(input.projects) || input.projects.length > 24) throw new ApiError(400, "Add a maximum of 24 portfolio projects.");
    const ids = new Set<string>();
    const projects = [];
    for (const entry of input.projects) {
      if (!entry || typeof entry !== "object") throw new ApiError(400, "A portfolio project is invalid.");
      const p = entry as Record<string, unknown>, id = stringField(p.id, "Project ID", 80, 1);
      if (!/^[\w-]+$/.test(id) || ids.has(id)) throw new ApiError(400, "Portfolio project IDs must be unique.");
      ids.add(id);
      const image = stringField(p.image ?? "", "Image URL", 300);
      if (image) {
        if (image.startsWith("/api/files/")) {
          const fileId = image.slice("/api/files/".length);
          const file = await database().prepare("SELECT id FROM files WHERE id=? AND public=1 AND mime LIKE 'image/%'").bind(fileId).first();
          if (!file) throw new ApiError(400, "Choose a gallery image uploaded through the admin panel.");
        } else if (!/^\/images\/[\w./-]+\.(png|jpg|jpeg|webp|gif)$/i.test(image) || image.includes("..")) throw new ApiError(400, "Use an uploaded gallery image or a bundled website image.");
      }
      const accent = stringField(p.accent ?? "green", "Accent", 30);
      projects.push({ id, title: stringField(p.title, "Project title", 100, 2), category: stringField(p.category ?? "Scripting", "Category", 60, 2), description: stringField(p.description ?? "", "Project description", 500), image, accent });
    }
    const site = { brand, intro, availability, projects };
    await database().prepare("INSERT INTO site_content(id,value,updated_at) VALUES('public',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(site), NOW()).run();
    return json({ ...site, saved: true });
  });
}
