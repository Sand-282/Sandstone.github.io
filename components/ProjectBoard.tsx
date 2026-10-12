"use client";
import { useState, type FormEvent } from "react";
import { ArrowDownToLine, Check, ChevronDown, FilePlus2, ListChecks, Plus, RefreshCw } from "lucide-react";
import "./project-board.css";

export type ProjectState = {
  details: string;
  features: { id: string; text: string; state: "planned" | "working" | "complete" }[];
  revisions: { id: string; text: string; state: "requested" | "accepted" | "declined" | "complete"; createdAt: string }[];
  activity: { id: string; text: string; at: string }[];
};
type FileItem = { id: string; name: string; size: number; url: string };
type Props = { id: string; status: string; role: "admin" | "client"; project: ProjectState; files: FileItem[]; onRefresh: () => Promise<unknown>; onError: (error: string) => void };
const labels = { planned: "Planned", working: "In progress", complete: "Complete" };

export default function ProjectBoard({ id, status, role, project, files, onRefresh, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [feature, setFeature] = useState("");
  const [revision, setRevision] = useState("");
  const [details, setDetails] = useState(project.details);
  const [editing, setEditing] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const finished = project.features.filter((item) => item.state === "complete").length;
  const usable = ["accepted", "active", "completed"].includes(status);
  async function update(input: Record<string, unknown>) {
    setBusy(true); onError("");
    try {
      const headers = new Headers({ "content-type": "application/json" });
      const token = sessionStorage.getItem("sandstone-session");
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(`/api/requests/${encodeURIComponent(id)}/project`, { method: "PATCH", headers, body: JSON.stringify(input), credentials: "same-origin" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The project could not be updated.");
      await onRefresh();
    } catch (error) { onError(error instanceof Error ? error.message : "The project could not be updated."); }
    finally { setBusy(false); }
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    setBusy(true); onError("");
    try {
      const form = new FormData(); selected.forEach((file) => form.append("files", file));
      const headers = new Headers(); const token = sessionStorage.getItem("sandstone-session");
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(`/api/requests/${encodeURIComponent(id)}/files`, { method: "POST", headers, body: form, credentials: "same-origin" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The files could not be uploaded.");
      await onRefresh();
    } catch (error) { onError(error instanceof Error ? error.message : "The files could not be uploaded."); }
    finally { setBusy(false); }
  }
  async function download(file: FileItem) {
    try {
      const headers = new Headers(); const token = sessionStorage.getItem("sandstone-session");
      if (token) headers.set("authorization", `Bearer ${token}`);
      const response = await fetch(file.url, { headers, credentials: "same-origin" });
      if (!response.ok) throw new Error("This file could not be downloaded.");
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { onError(error instanceof Error ? error.message : "The file could not be downloaded."); }
  }
  function addFeature(event: FormEvent) { event.preventDefault(); if (!feature.trim()) return; void update({ action: "add_feature", text: feature.trim() }).then(() => setFeature("")); }
  function addRevision(event: FormEvent) { event.preventDefault(); if (!revision.trim()) return; void update({ action: "revision", text: revision.trim() }).then(() => setRevision("")); }
  return <div className="project-board">
    <section className="project-panel"><div className="project-panel-head"><div><span className="project-kicker">PROJECT PLAN</span><h3>Details and scope</h3></div><button type="button" className="project-text-button" onClick={() => { setDetails(project.details); setEditing(!editing); }}>{editing ? "Cancel" : "Edit details"}</button></div>
      {editing ? <form onSubmit={(event) => { event.preventDefault(); void update({ action: "details", text: details }).then(() => setEditing(false)); }}><textarea aria-label="Project details" value={details} minLength={10} maxLength={8000} rows={6} onChange={(event) => setDetails(event.target.value)} /><button className="project-action" disabled={busy}>Save details</button></form> : <p className="project-details">{project.details}</p>}
    </section>
    <section className="project-panel"><div className="project-panel-head"><div><span className="project-kicker">FEATURES</span><h3>What is being built</h3></div><span className="project-progress-count">{finished} / {project.features.length} complete</span></div><div className="project-progress-track"><span style={{ width: `${project.features.length ? finished / project.features.length * 100 : 0}%` }} /></div>
      {project.features.length ? <ul className="project-features">{project.features.map((item) => <li key={item.id}><span className={`project-feature-mark ${item.state}`}><Check size={14} /></span><span>{item.text}</span>{role === "admin" ? <select aria-label={`Progress for ${item.text}`} value={item.state} disabled={busy} onChange={(event) => void update({ action: "feature_state", id: item.id, state: event.target.value })}><option value="planned">Planned</option><option value="working">In progress</option><option value="complete">Complete</option></select> : <small>{labels[item.state]}</small>}</li>)}</ul> : <p className="project-empty">Add the first feature to turn the brief into a clear plan.</p>}
      <form className="project-inline-form" onSubmit={addFeature}><input aria-label="New feature" value={feature} maxLength={300} placeholder="Add a feature or task" onChange={(event) => setFeature(event.target.value)} /><button type="submit" disabled={busy || !feature.trim()} aria-label="Add feature"><Plus size={18} /></button></form>
    </section>
    <section className="project-panel"><div className="project-panel-head"><div><span className="project-kicker">REFERENCES & FILES</span><h3>Project files</h3></div><label className="project-upload"><FilePlus2 size={16} /> Add files<input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.zip,.mcpack,.mcaddon,.json,.txt" disabled={busy} onChange={upload} /></label></div>
      {files.length ? <ul className="project-files">{files.map((file) => <li key={file.id}><span>{file.name}</span><button type="button" onClick={() => void download(file)} aria-label={`Download ${file.name}`}><ArrowDownToLine size={17} /></button></li>)}</ul> : <p className="project-empty">Reference images, files, and supplied assets will appear here.</p>}<small className="project-hint">Up to 5 files per upload, 10 MB each. 40 MB per project.</small>
    </section>
    {usable && <section className="project-panel"><div className="project-panel-head"><div><span className="project-kicker">REVISIONS</span><h3>Change requests</h3></div></div>
      {project.revisions.length ? <ul className="project-revisions">{project.revisions.map((item) => <li key={item.id}><p>{item.text}</p>{role === "admin" ? <select aria-label="Revision status" value={item.state} disabled={busy} onChange={(event) => void update({ action: "revision_state", id: item.id, state: event.target.value })}><option value="requested">Requested</option><option value="accepted">Accepted</option><option value="declined">Declined</option><option value="complete">Complete</option></select> : <small>{item.state}</small>}</li>)}</ul> : <p className="project-empty">No changes have been requested.</p>}
      {role === "client" && <form className="project-revision-form" onSubmit={addRevision}><textarea aria-label="Describe a revision" rows={3} maxLength={2000} value={revision} placeholder="Describe the change you would like" onChange={(event) => setRevision(event.target.value)} /><button className="project-action" disabled={busy || !revision.trim()}>Request change</button></form>}
    </section>}
    <section className="project-activity"><button type="button" className="project-activity-toggle" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}><ListChecks size={16} /> Activity log <ChevronDown size={15} className={logOpen ? "open" : ""} /></button>{logOpen && <div><button type="button" className="project-text-button" onClick={() => void onRefresh()}><RefreshCw size={13} /> Refresh</button><ul>{project.activity.map((item) => <li key={item.id}><span>{item.text}</span><time dateTime={item.at}>{new Date(item.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time></li>)}</ul></div>}</section>
  </div>;
}
