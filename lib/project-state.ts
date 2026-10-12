import { ApiError, stringField } from "./commission-validation";
import { Commission, NOW, database } from "./commissions";

export type Feature = { id: string; text: string; state: "planned" | "working" | "complete"; createdBy: "client" | "admin" };
export type Revision = { id: string; text: string; state: "requested" | "accepted" | "declined" | "complete"; createdAt: string };
export type Activity = { id: string; text: string; at: string };
export type ProjectState = { details: string; features: Feature[]; revisions: Revision[]; activity: Activity[] };

const key = (id: string) => `commission:${id}`;
export function initialProject(commission: Commission): ProjectState {
  return { details: commission.description, features: [], revisions: [], activity: [{ id: commission.id, text: "Client submitted a commission request", at: commission.created_at }] };
}
export async function getProject(commission: Commission): Promise<{ state: ProjectState; previous: string | null }> {
  const row = await database().prepare("SELECT value FROM site_content WHERE id=?").bind(key(commission.id)).first<{ value: string }>();
  if (!row) return { state: initialProject(commission), previous: null };
  const parsed = JSON.parse(row.value) as ProjectState;
  return { state: parsed, previous: row.value };
}
export async function changeProject(commission: Commission, actor: "client" | "admin", input: Record<string, unknown>): Promise<ProjectState> {
  const action = stringField(input.action, "Action", 40, 3);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, previous } = await getProject(commission);
    const next: ProjectState = { details: state.details, features: [...state.features], revisions: [...state.revisions], activity: [...state.activity] };
    let event = "";
    if (action === "details") {
      next.details = stringField(input.text, "Project details", 8000, 10);
      if (next.details === state.details) return state;
      event = `${actor === "admin" ? "Admin" : "Client"} changed project details`;
    } else if (action === "add_feature") {
      if (next.features.length >= 100) throw new ApiError(400, "The feature list is full.");
      next.features.push({ id: crypto.randomUUID(), text: stringField(input.text, "Feature", 300, 2), state: "planned", createdBy: actor });
      event = `${actor === "admin" ? "Admin" : "Client"} added a new feature`;
    } else if (action === "feature_state") {
      if (actor !== "admin") throw new ApiError(403, "Only the admin can update feature progress.");
      const id = stringField(input.id, "Feature ID", 80, 1);
      const feature = next.features.find((f) => f.id === id);
      if (!feature) throw new ApiError(404, "That feature could not be found.");
      if (!(["planned", "working", "complete"] as unknown[]).includes(input.state)) throw new ApiError(400, "Choose a valid progress state.");
      feature.state = input.state as Feature["state"];
      event = `Admin marked ${feature.text.slice(0, 80)} as ${feature.state === "complete" ? "complete" : feature.state === "working" ? "in progress" : "planned"}`;
    } else if (action === "revision") {
      if (actor !== "client" || !["accepted", "active", "completed"].includes(commission.status)) throw new ApiError(403, "Revisions can be requested after a project is accepted.");
      if (next.revisions.length >= 100) throw new ApiError(400, "The revision list is full.");
      next.revisions.push({ id: crypto.randomUUID(), text: stringField(input.text, "Revision", 2000, 5), state: "requested", createdAt: NOW() });
      event = "Client requested a revision";
    } else if (action === "revision_state") {
      if (actor !== "admin") throw new ApiError(403, "Only the admin can review revisions.");
      const id = stringField(input.id, "Revision ID", 80, 1);
      const revision = next.revisions.find((r) => r.id === id);
      if (!revision) throw new ApiError(404, "That revision could not be found.");
      if (!(["accepted", "declined", "complete"] as unknown[]).includes(input.state)) throw new ApiError(400, "Choose a valid revision state.");
      revision.state = input.state as Revision["state"];
      event = `Admin marked a revision as ${revision.state}`;
    } else throw new ApiError(400, "This project action is not supported.");
    next.activity = [{ id: crypto.randomUUID(), text: event, at: NOW() }, ...next.activity].slice(0, 200);
    const value = JSON.stringify(next);
    const result = previous === null
      ? await database().prepare("INSERT INTO site_content(id,value,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING").bind(key(commission.id), value, NOW()).run()
      : await database().prepare("UPDATE site_content SET value=?,updated_at=? WHERE id=? AND value=?").bind(value, NOW(), key(commission.id), previous).run();
    if (result.meta.changes) return next;
  }
  throw new ApiError(409, "The project changed at the same time. Refresh and try again.");
}
export async function addActivity(commission: Commission, text: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, previous } = await getProject(commission);
    const value = JSON.stringify({ ...state, activity: [{ id: crypto.randomUUID(), text, at: NOW() }, ...state.activity].slice(0, 200) });
    const result = previous === null
      ? await database().prepare("INSERT INTO site_content(id,value,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING").bind(key(commission.id), value, NOW()).run()
      : await database().prepare("UPDATE site_content SET value=?,updated_at=? WHERE id=? AND value=?").bind(value, NOW(), key(commission.id), previous).run();
    if (result.meta.changes) return;
  }
}

