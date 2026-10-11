"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, FileText, ImagePlus, Inbox, LoaderCircle, LockKeyhole, Mail, MessageSquare, Plus, RefreshCw, Send, Settings2, ShieldCheck, Trash2, X } from "lucide-react";
import "./workspace.css";

type Role = "admin" | "client" | "anonymous";
type Session = { role: Role; authentication?: "password" | "chatgpt"; adminConfigured: boolean; emailConfigured: boolean; clientRequestId?: string };
type Commission = { id: string; name: string; email: string; title: string; description: string; budget: string; timeline: string; assets: string; status: string; note: string; createdAt: string; updatedAt: string };
type Message = { id: string; sender: "admin" | "client"; body: string; createdAt: string };
type Attachment = { id: string; name: string; mime: string; size: number; url: string };
type Notification = { id: string; recipient: string; kind: string; state: string; attempts: number; error?: string; createdAt: string; sentAt?: string };
type Details = { request: Commission; messages: Message[]; files: Attachment[]; notifications?: Notification[]; hasOlderMessages?: boolean };
type Project = { id: string; title: string; category: string; description: string; image: string; accent?: string };
type Content = { brand: string; intro: string; availability: string; projects: Project[] };
type EmailState = { configured: boolean; notifications: Notification[]; counts: Record<string, number> };
type EmailResult = { state: string; error?: string };
type Tab = "requests" | "content" | "email";
const CHAT_STATUSES = new Set(["accepted", "active", "completed"]);
const STATUS_NAMES: Record<string, string> = { pending: "Awaiting review", accepted: "Accepted", active: "In progress", completed: "Completed", declined: "Declined" };

class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000), ...init }); }
  catch { throw new RequestError("We couldn’t connect. Check your connection and try again.", 0); }
  const result = await response.json().catch(() => ({ error: "The server returned an unexpected response. Please try again." })) as { error?: string };
  if (!response.ok) throw new RequestError(result.error || "This action could not be completed.", response.status);
  return result as T;
}
const jsonRequest = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const date = (value: string, time = false) => new Intl.DateTimeFormat("en-GB", time ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
function Badge({ status }: { status: string }) { return <span className={`ws-status ws-status-${status}`}><i />{STATUS_NAMES[status] || status}</span>; }
function Empty({ icon = "inbox", title, children }: { icon?: "inbox" | "chat" | "image"; title: string; children: React.ReactNode }) { const Icon = icon === "chat" ? MessageSquare : icon === "image" ? ImagePlus : Inbox; return <div className="ws-empty"><span className="ws-empty-icon"><Icon size={26} /></span><h3>{title}</h3><p>{children}</p></div>; }

export default function Workspace({ mode, onHome }: { mode: "admin" | "portal"; onHome: () => void }) {
  const isAdmin = mode === "admin";
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("requests");
  const [requests, setRequests] = useState<Commission[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const paginationStarted = useRef(false);
  const [selectedId, setSelectedId] = useState("");
  const selectedRef = useRef("");
  const [filter, setFilter] = useState("all");
  const [details, setDetails] = useState<Details | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");
  const [changingStatus, setChangingStatus] = useState(false);
  const [content, setContent] = useState<Content | null>(null);
  const [contentDirty, setContentDirty] = useState(false);
  const [contentSaving, setContentSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [emails, setEmails] = useState<EmailState | null>(null);
  const [retrying, setRetrying] = useState(false);
  const sendAttempt = useRef<{ requestId: string; body: string; key: string } | null>(null);
  const initialised = useRef(false);
  const polling = useRef(false);
  const messageList = useRef<HTMLDivElement>(null);

  const select = useCallback((id: string) => { selectedRef.current = id; setSelectedId(id); setDetailLoading(!!id); setDraft(""); sendAttempt.current = null; setDecisionNote(""); setDetails(null); setError(""); }, []);
  const refreshDetail = useCallback(async (id: string) => {
    const result = await api<Details>(`/api/requests/${encodeURIComponent(id)}`);
    if (selectedRef.current === id) { setDetails(result); setRequests((items) => items.map((r) => r.id === id ? result.request : r)); }
    return result;
  }, []);
  const refreshRequests = useCallback(async () => {
    const result = await api<{ requests: Commission[]; nextCursor: string | null }>("/api/requests");
    setRequests((previous) => [...result.requests, ...previous.filter((r) => !result.requests.some((fresh) => fresh.id === r.id))]);
    if (!paginationStarted.current) setNextCursor(result.nextCursor);
    return result.requests;
  }, []);

  const initialise = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (!isAdmin) {
        const token = new URLSearchParams(window.location.hash.slice(1)).get("access");
        if (token) {
          await api("/api/access", jsonRequest("POST", { token }));
          window.history.replaceState({}, "", window.location.pathname + window.location.search);
        }
      }
      const who = await api<Session>("/api/session");
      setSession(who);
      if (isAdmin && who.role === "admin") {
        const items = await refreshRequests();
        const linked = new URLSearchParams(window.location.search).get("request");
        if (items.length) select(items.some((r) => r.id === linked) ? linked! : items[0].id);
      } else if (!isAdmin && who.role === "client" && who.clientRequestId) select(who.clientRequestId);
    } catch (e) { setError(errorText(e)); if (!isAdmin) setSession({ role: "anonymous", adminConfigured: true, emailConfigured: false }); }
    finally { setLoading(false); }
  }, [isAdmin, refreshRequests, select]);
  useEffect(() => { if (!initialised.current) { initialised.current = true; void initialise(); } }, [initialise]);
  useEffect(() => {
    if (!selectedId) return;
    void refreshDetail(selectedId).then((result) => { if (selectedRef.current === selectedId) setDecisionNote(result.request.note); }).catch((e) => { if (selectedRef.current === selectedId) setError(errorText(e)); }).finally(() => { if (selectedRef.current === selectedId) setDetailLoading(false); });
  }, [selectedId, refreshDetail]);
  useEffect(() => {
    if (!session || session.role === "anonymous" || (isAdmin && session.role !== "admin")) return;
    const poll = async () => {
      if (document.visibilityState !== "visible" || polling.current) return;
      polling.current = true;
      try {
        const jobs: Promise<unknown>[] = [];
        if (isAdmin && tab === "requests") jobs.push(refreshRequests());
        if (selectedRef.current && tab === "requests") jobs.push(refreshDetail(selectedRef.current));
        if (isAdmin && tab === "email") jobs.push(api<EmailState>("/api/admin/email").then(setEmails));
        await Promise.all(jobs);
      } catch (e) { setError(errorText(e)); }
      finally { polling.current = false; }
    };
    const timer = window.setInterval(() => void poll(), 8000);
    const visibility = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [session, isAdmin, tab, refreshRequests, refreshDetail]);
  useEffect(() => {
    if (session?.role !== "admin") return;
    if (tab === "content" && !content) void api<Content>("/api/site").then(setContent).catch((e) => setError(errorText(e)));
    if (tab === "email") void api<EmailState>("/api/admin/email").then(setEmails).catch((e) => setError(errorText(e)));
  }, [tab, session, content]);
  useEffect(() => { if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight; }, [details?.messages.length]);

  const emailNotice = (email?: EmailResult) => {
    if (email && email.state !== "sent" && email.state !== "unchanged") setNotice(email.error || (email.state === "unconfigured" ? "Saved. Email delivery needs to be connected before notifications can be sent." : "Saved. The email notification is waiting to be sent."));
  };
  async function recover(e: FormEvent) {
    e.preventDefault(); setRecoveryBusy(true); setError(""); setRecoveryResult("");
    try { const result = await api<{ message: string }>("/api/access/recover", jsonRequest("POST", { email: recoveryEmail })); setRecoveryResult(result.message); }
    catch (e) { setError(errorText(e)); }
    finally { setRecoveryBusy(false); }
  }
  async function signIn(e: FormEvent) {
    e.preventDefault(); if (signingIn) return;
    setSigningIn(true); setError("");
    try { await api("/api/admin/auth", jsonRequest("POST", { email: ownerEmail, password: ownerPassword })); setOwnerPassword(""); await initialise(); }
    catch (e) { setError(errorText(e)); }
    finally { setSigningIn(false); }
  }
  async function loadOlderRequests() {
    if (!nextCursor || loadingOlder) return;
    paginationStarted.current = true;
    setLoadingOlder(true); setError("");
    try { const result = await api<{ requests: Commission[]; nextCursor: string | null }>(`/api/requests?cursor=${encodeURIComponent(nextCursor)}`); setRequests((previous) => [...previous, ...result.requests.filter((r) => !previous.some((old) => old.id === r.id))]); setNextCursor(result.nextCursor); }
    catch (e) { setError(errorText(e)); }
    finally { setLoadingOlder(false); }
  }
  async function send(e: FormEvent) {
    e.preventDefault(); const body = draft.trim(), id = selectedId;
    if (!body || sending || !id) return;
    setSending(true); setError(""); setNotice("");
    if (!sendAttempt.current || sendAttempt.current.body !== body || sendAttempt.current.requestId !== id) sendAttempt.current = { requestId: id, body, key: crypto.randomUUID() };
    try {
      const result = await api<{ message: Message; email: EmailResult }>(`/api/requests/${encodeURIComponent(id)}/messages`, jsonRequest("POST", { body, idempotencyKey: sendAttempt.current.key }));
      if (selectedRef.current === id) {
        setDetails((previous) => previous && previous.request.id === id ? { ...previous, messages: previous.messages.some((m) => m.id === result.message.id) ? previous.messages : [...previous.messages, result.message] } : previous);
        setDraft(""); sendAttempt.current = null; emailNotice(result.email);
      }
    } catch (e) { setError(errorText(e)); }
    finally { setSending(false); }
  }
  async function changeStatus(status: string) {
    if (!selectedId || changingStatus) return;
    const id = selectedId;
    setChangingStatus(true); setError(""); setNotice("");
    try {
      const result = await api<{ request: Commission; email: EmailResult }>(`/api/requests/${encodeURIComponent(id)}`, jsonRequest("PATCH", { status, note: decisionNote }));
      if (selectedRef.current === id) setDetails((d) => d && d.request.id === id ? { ...d, request: result.request } : d);
      setRequests((items) => items.map((r) => r.id === result.request.id ? result.request : r));
      setNotice(`Commission ${STATUS_NAMES[status]?.toLowerCase() || status}.`); emailNotice(result.email);
    } catch (e) { setError(errorText(e)); }
    finally { setChangingStatus(false); }
  }
  function editContent(change: Partial<Content>) { setContent((c) => c ? { ...c, ...change } : c); setContentDirty(true); }
  function editProject(id: string, change: Partial<Project>) { setContent((current) => current ? { ...current, projects: current.projects.map((p) => p.id === id ? { ...p, ...change } : p) } : current); setContentDirty(true); }
  async function uploadImage(projectId: string, file?: File) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError("Choose an image smaller than 8 MB."); return; }
    setUploading(projectId); setError("");
    const form = new FormData(); form.append("file", file);
    try { const result = await api<{ file: Attachment }>("/api/admin/images", { method: "POST", body: form }); editProject(projectId, { image: result.file.url }); setNotice("Image uploaded. Save your changes to show it on the website."); }
    catch (e) { setError(errorText(e)); }
    finally { setUploading(""); }
  }
  async function saveContent(e: FormEvent) {
    e.preventDefault(); if (!content) return;
    setContentSaving(true); setError(""); setNotice("");
    try { const saved = await api<Content>("/api/admin/site", jsonRequest("PUT", content)); setContent(saved); setContentDirty(false); setNotice("Your website content has been saved."); }
    catch (e) { setError(errorText(e)); }
    finally { setContentSaving(false); }
  }
  async function retryEmails() {
    setRetrying(true); setError("");
    try { const result = await api<{ retried: number; email: EmailResult }>("/api/admin/email", jsonRequest("POST", {})); setNotice(result.retried ? `${result.retried} notification${result.retried === 1 ? "" : "s"} retried.` : "No notifications are ready to retry yet."); emailNotice(result.email); setEmails(await api<EmailState>("/api/admin/email")); }
    catch (e) { setError(errorText(e)); }
    finally { setRetrying(false); }
  }
  async function signOut() { try { await api(isAdmin && session?.authentication === "password" ? "/api/admin/auth" : "/api/access", { method: "DELETE" }); setSession(await api<Session>("/api/session")); select(""); setRequests([]); setContent(null); setEmails(null); } catch (e) { setError(errorText(e)); } }

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const visibleRequests = requests.filter((r) => filter === "all" || r.status === filter);
  const current = details?.request;
  const authorised = isAdmin ? session?.role === "admin" : session?.role === "client";

  return <div className="ws-root">
    <header className="ws-header"><button className="ws-brand" onClick={onHome} aria-label="Return to sandstone home"><span className="ws-brand-icon"><span /><span /><span /></span>sandstone<span className="ws-brand-divider" /> <span className="ws-header-label">{isAdmin ? "Studio workspace" : "Client workspace"}</span></button><button className="ws-back ws-btn ws-btn-quiet" onClick={onHome}><ArrowLeft size={16} /> Back to website</button></header>
    <div className="ws-page">
      {loading ? <div className="ws-loading"><LoaderCircle className="ws-spin" size={28} /><p>Opening your workspace…</p></div> : !authorised ? <section className="ws-access">
        <div className="ws-access-illustration"><div className="ws-access-orbit" /><div className="ws-access-lock"><LockKeyhole size={35} /></div><span className="ws-access-dot ws-access-dot-one" /><span className="ws-access-dot ws-access-dot-two" /></div>
        <div className="ws-eyebrow">{isAdmin ? "YOUR STUDIO, IN ONE PLACE" : "A SPACE FOR YOUR PROJECT"}</div>
        <h1>{isAdmin ? "Welcome back." : "Your commission.\nYour private space."}</h1>
        <p className="ws-access-intro">{isAdmin ? "Review requests, talk with your clients and keep your website up to date." : "Open the private link from your email to follow your commission and talk with your developer."}</p>
        {error && <div className="ws-alert ws-alert-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
        {isAdmin ? session?.authentication === "password" ? <form className="ws-access-form" onSubmit={signIn}><label className="ws-field">Owner email<input type="email" autoComplete="username" required maxLength={254} value={ownerEmail} placeholder="you@example.com" onChange={(e) => setOwnerEmail(e.target.value)} /></label><label className="ws-field">Password<input type="password" autoComplete="current-password" required maxLength={1024} value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} /></label><button className="ws-btn ws-btn-primary ws-wide" disabled={signingIn || !session.adminConfigured}>{signingIn ? <LoaderCircle className="ws-spin" size={17} /> : <ShieldCheck size={18} />} {signingIn ? "Signing in…" : "Sign in to your studio"}<ArrowRight size={17} /></button><p className="ws-helper">{session.adminConfigured ? "Use the owner email and studio password." : "Owner sign-in is waiting for setup."}</p></form> : <div className="ws-access-form"><a className="ws-btn ws-btn-primary ws-wide" href="/signin-with-chatgpt?return_to=/admin" target="_top"><ShieldCheck size={18} /> Sign in with ChatGPT <ArrowRight size={17} /></a><p className="ws-helper">Use the ChatGPT account connected to your owner email.</p><button className="ws-btn ws-btn-quiet" onClick={() => void initialise()}><RefreshCw size={15} /> Check access again</button></div> : session?.role === "admin" ? <div className="ws-access-form"><p className="ws-helper">You’re signed in as the studio owner. Open a client’s commission from the admin workspace.</p><a className="ws-btn ws-btn-primary ws-wide" href="/admin">Open studio workspace <ArrowRight size={17} /></a></div> : <form className="ws-access-form" onSubmit={recover}><div className="ws-access-divider"><span>Need a fresh link?</span></div><label className="ws-field">Email address<input type="email" autoComplete="email" required value={recoveryEmail} placeholder="you@example.com" onChange={(e) => setRecoveryEmail(e.target.value)} /></label><button className="ws-btn ws-btn-primary ws-wide" disabled={recoveryBusy}>{recoveryBusy ? <LoaderCircle className="ws-spin" size={17} /> : <Mail size={17} />} {recoveryBusy ? "Checking…" : "Send a private access link"}</button>{recoveryResult && <p className="ws-recovery-result" role="status">{recoveryResult}</p>}<p className="ws-helper"><LockKeyhole size={13} /> No account or password needed.</p></form>}
      </section> : <>
        <div className="ws-title-row"><div><div className="ws-eyebrow">{isAdmin ? "THE STUDIO" : "YOUR PRIVATE COMMISSION"}</div><h1>{isAdmin ? "Let’s build something good." : `Hi, ${current?.name?.split(" ")[0] || "there"}.`}</h1><p>{isAdmin ? "A little organisation. More room for creating." : "Everything for your project, together in one place."}</p></div><div className="ws-private-pill"><LockKeyhole size={14} /> {isAdmin ? "Owner access" : "Private workspace"}</div></div>
        {error && <div className="ws-alert ws-alert-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
        {notice && <div className="ws-alert ws-alert-success" role="status"><Check size={16} />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16} /></button></div>}
        {session && !session.emailConfigured && <div className="ws-mail-warning"><Mail size={16} /><span>{isAdmin ? "Email delivery is waiting for setup. Requests and messages are saved; notifications stay in the email queue." : "Email notifications aren’t available yet. Your messages are saved here, so check this page for updates."}</span>{isAdmin && <button onClick={() => setTab("email")}>View email queue <ArrowRight size={14} /></button>}</div>}
        {isAdmin && <nav className="ws-tabs" aria-label="Workspace sections"><button aria-pressed={tab === "requests"} className={tab === "requests" ? "ws-tab-active" : ""} onClick={() => { setTab("requests"); setError(""); }}><Inbox size={17} /> Commissions {pendingCount > 0 && <span>{pendingCount}</span>}</button><button aria-pressed={tab === "content"} className={tab === "content" ? "ws-tab-active" : ""} onClick={() => { setTab("content"); setError(""); }}><Settings2 size={17} /> Website content {contentDirty && <i className="ws-unsaved-dot" />}</button><button aria-pressed={tab === "email"} className={tab === "email" ? "ws-tab-active" : ""} onClick={() => { setTab("email"); setError(""); }}><Mail size={17} /> Email delivery</button></nav>}
        {tab === "requests" && <div className={`ws-commission-grid ${isAdmin ? "ws-admin-grid" : "ws-client-grid"}`}>
          {isAdmin && <aside className="ws-request-sidebar"><div className="ws-sidebar-heading"><h2>Commissions <span>{requests.length}</span></h2><button className="ws-icon-button" aria-label="Refresh commissions" onClick={() => void refreshRequests().catch((e) => setError(errorText(e)))}><RefreshCw size={15} /></button></div><label className="ws-filter"><span className="ws-sr-only">Filter commissions</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All commissions</option>{Object.entries(STATUS_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="ws-request-list">{visibleRequests.length ? visibleRequests.map((r) => <button key={r.id} aria-pressed={selectedId === r.id} className={`ws-request-card ${selectedId === r.id ? "ws-request-selected" : ""}`} onClick={() => select(r.id)}><div><Badge status={r.status} /><span className="ws-request-date">{date(r.createdAt).replace(/ \d{4}/, "")}</span></div><strong>{r.title}</strong><span className="ws-request-client">{r.name}<ChevronRight size={15} /></span></button>) : <Empty title="A clean slate">{requests.length ? "No commissions match this filter." : "New requests will appear here, ready for your review."}</Empty>}{nextCursor && <button className="ws-btn ws-btn-quiet ws-load-older" disabled={loadingOlder} onClick={() => void loadOlderRequests()}>{loadingOlder ? <LoaderCircle className="ws-spin" size={15} /> : <ArrowDownToLine size={15} />} {loadingOlder ? "Loading…" : "Load older commissions"}</button>}</div></aside>}
          <main className="ws-detail">{detailLoading ? <div className="ws-loading ws-detail-loader"><LoaderCircle className="ws-spin" size={23} /><p>Loading commission…</p></div> : !current ? <Empty title="Room for the next idea">{error ? <button className="ws-btn ws-btn-quiet" onClick={() => selectedId && void refreshDetail(selectedId).catch((e) => setError(errorText(e)))}>Try loading again</button> : "Select a commission to see its details and conversation."}</Empty> : <>
            <section className="ws-project-summary"><div className="ws-summary-top"><div className="ws-eyebrow">COMMISSION / {current.id.slice(0, 8).toUpperCase()}</div><Badge status={current.status} /></div><h2>{current.title}</h2><p className="ws-project-byline">{isAdmin ? <><span className="ws-avatar">{current.name.slice(0, 1).toUpperCase()}</span><strong>{current.name}</strong><span>{current.email}</span></> : <>Submitted {date(current.createdAt)}<span>•</span> Minecraft Bedrock</>}</p><div className="ws-project-meta"><div><span>Budget</span><strong>{current.budget || "To be discussed"}</strong></div><div><span>Timeline</span><strong>{current.timeline || "Flexible"}</strong></div><div><span>Focus</span><strong>Scripting & behaviour</strong></div></div></section>
            <section className="ws-brief"><h3><FileText size={17} /> The project brief</h3><p className="ws-preserve">{current.description}</p>{current.assets && <div className="ws-assets-note"><span>Provided assets</span><p className="ws-preserve">{current.assets}</p></div>}{details.files.length > 0 && <div className="ws-files"><span className="ws-subheading">Attachments · {details.files.length}</span>{details.files.map((f) => <a key={f.id} className="ws-file" href={f.url} download={f.name}><span className="ws-file-icon"><FileText size={18} /></span><span><strong>{f.name}</strong><small>{size(f.size)}</small></span><ArrowDownToLine size={17} /></a>)}</div>}{current.note && <div className="ws-developer-note"><span>Note from the developer</span><p className="ws-preserve">{current.note}</p></div>}</section>
            {isAdmin && <section className="ws-decisions"><div><h3>{current.status === "pending" ? "Ready to make a call?" : "Commission status"}</h3><p>{current.status === "pending" ? "A decision will update the client’s workspace and queue an email." : "Keep your client in the loop as their project moves forward."}</p></div><label className="ws-field">{current.status === "pending" ? "Note to the client" : "Update note"} <span>optional</span><textarea maxLength={2000} rows={2} placeholder={current.status === "pending" ? "Add a personal note with your decision…" : "Add a short progress or delivery note…"} value={decisionNote} disabled={changingStatus} onChange={(e) => setDecisionNote(e.target.value)} /></label><div className="ws-decision-actions">{current.status === "pending" ? <><button className="ws-btn ws-btn-primary" disabled={changingStatus} onClick={() => void changeStatus("accepted")}>{changingStatus ? <LoaderCircle className="ws-spin" size={16} /> : <Check size={16} />} Accept request</button><button className="ws-btn ws-btn-outline" disabled={changingStatus} onClick={() => void changeStatus("declined")}><X size={16} /> Decline request</button></> : <>{current.status === "accepted" && <button className="ws-btn ws-btn-primary" disabled={changingStatus} onClick={() => void changeStatus("active")}>Start work <ArrowRight size={16} /></button>}{["accepted", "active"].includes(current.status) && <button className="ws-btn ws-btn-outline" disabled={changingStatus} onClick={() => void changeStatus("completed")}><Check size={16} /> Mark completed</button>}<button className="ws-btn ws-btn-quiet" disabled={changingStatus || !decisionNote.trim()} onClick={() => void changeStatus(current.status)}>{changingStatus && <LoaderCircle className="ws-spin" size={15} />} Save note</button></>}</div></section>}
            <section className="ws-conversation"><div className="ws-chat-heading"><div><h3><MessageSquare size={18} /> Conversation</h3><p>{CHAT_STATUSES.has(current.status) ? "A direct line, from first idea to final handover." : current.status === "declined" ? "This request wasn’t accepted." : "Your private chat opens when the request is accepted."}</p></div><span className="ws-chat-private"><LockKeyhole size={13} /> Only you two</span></div>{!CHAT_STATUSES.has(current.status) ? <div className="ws-chat-locked"><span><LockKeyhole size={24} /></span><h4>{current.status === "declined" ? "Chat is closed" : "Good ideas are worth a conversation."}</h4><p>{current.status === "declined" ? "You can submit a new request from the website if your plans change." : "Once this commission is accepted, you can discuss the details right here."}</p></div> : <><div className="ws-messages" ref={messageList} aria-live="polite" aria-relevant="additions">{details.hasOlderMessages && <p className="ws-history-note">Showing the latest 500 messages.</p>}{details.messages.length ? details.messages.map((m) => <article key={m.id} className={`ws-message ${m.sender === (isAdmin ? "admin" : "client") ? "ws-message-own" : ""}`}><div className="ws-message-author">{m.sender === "admin" ? "Developer" : current.name}<time dateTime={m.createdAt}>{date(m.createdAt, true)}</time></div><p>{m.body}</p></article>) : <Empty icon="chat" title="The conversation starts here">Ask a question, share an idea or say hello.</Empty>}</div><form className="ws-composer" onSubmit={send}><label className="ws-sr-only" htmlFor="ws-message">Your message</label><textarea id="ws-message" placeholder={isAdmin ? "Write a message to your client…" : "Write a message to your developer…"} value={draft} maxLength={5000} rows={3} disabled={sending} onChange={(e) => setDraft(e.target.value)} /><div><span>{session?.emailConfigured ? "The other person receives an email notification." : "Messages save here. Email delivery is awaiting setup."}</span><button className="ws-btn ws-btn-primary" disabled={sending || !draft.trim()}>{sending ? <LoaderCircle className="ws-spin" size={16} /> : <Send size={16} />} {sending ? "Sending…" : "Send message"}</button></div></form></> }</section>
          </>}</main>
        </div>}
        {isAdmin && tab === "content" && <section className="ws-content-panel">{!content ? error ? <Empty icon="image" title="Content is unavailable"><button className="ws-btn ws-btn-outline" onClick={() => { setError(""); void api<Content>("/api/site").then(setContent).catch((e) => setError(errorText(e))); }}>Try again</button></Empty> : <div className="ws-loading"><LoaderCircle className="ws-spin" size={25} /><p>Loading website content…</p></div> : <form onSubmit={saveContent}><fieldset disabled={contentSaving}><div className="ws-panel-title"><div><div className="ws-eyebrow">MAKE IT YOURS</div><h2>A website that stays fresh.</h2><p>Update your words and screenshots here. No code required.</p></div><button className="ws-btn ws-btn-primary" disabled={contentSaving || !contentDirty || !!uploading}>{contentSaving ? <LoaderCircle className="ws-spin" size={17} /> : <Check size={17} />}{contentSaving ? "Saving…" : "Save changes"}</button></div><div className="ws-content-fields"><label className="ws-field">Display name<input required minLength={2} maxLength={50} value={content.brand} onChange={(e) => editContent({ brand: e.target.value })} /></label><label className="ws-field">Availability<input required minLength={3} maxLength={100} value={content.availability} onChange={(e) => editContent({ availability: e.target.value })} /></label><label className="ws-field ws-intro-field">Introduction<textarea required minLength={10} maxLength={500} rows={3} value={content.intro} onChange={(e) => editContent({ intro: e.target.value })} /></label></div><div className="ws-project-editor-heading"><div><h3>Project showcase</h3><p>Your real work, with a little room to shine.</p></div><button type="button" className="ws-btn ws-btn-outline" disabled={content.projects.length >= 24} onClick={() => editContent({ projects: [...content.projects, { id: crypto.randomUUID(), title: "New project", category: "Scripting", description: "", image: "", accent: "green" }] })}><Plus size={16} /> Add project</button></div>{content.projects.length === 0 ? <Empty icon="image" title="Your work belongs here">Add a project and upload a screenshot. Only projects you add will be shown on the website.</Empty> : <div className="ws-project-editors">{content.projects.map((project, index) => <div key={project.id} className="ws-project-editor"><div className="ws-project-image">{project.image ? <img src={project.image} alt={project.title} /> : <div className="ws-image-placeholder"><ImagePlus size={30} /><span>Add a screenshot</span></div>}<label className={`ws-image-upload ${uploading === project.id ? "ws-upload-busy" : ""}`}>{uploading === project.id ? <LoaderCircle className="ws-spin" size={17} /> : <ImagePlus size={17} />}{uploading === project.id ? "Uploading…" : project.image ? "Change image" : "Upload image"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!!uploading} onChange={(e) => { void uploadImage(project.id, e.target.files?.[0]); e.target.value = ""; }} /></label><span className="ws-image-limit">PNG, JPG, WebP or GIF · up to 8 MB</span></div><div className="ws-project-edit-fields"><div className="ws-edit-top"><span className="ws-eyebrow">PROJECT {String(index + 1).padStart(2, "0")}</span><button type="button" className="ws-icon-button ws-remove" aria-label={`Remove ${project.title}`} onClick={() => editContent({ projects: content.projects.filter((p) => p.id !== project.id) })}><Trash2 size={16} /></button></div><div className="ws-editor-row"><label className="ws-field">Title<input required minLength={2} maxLength={100} value={project.title} onChange={(e) => editProject(project.id, { title: e.target.value })} /></label><label className="ws-field">Category<input required minLength={2} maxLength={60} value={project.category} onChange={(e) => editProject(project.id, { category: e.target.value })} /></label></div><label className="ws-field">Description<textarea rows={3} maxLength={500} value={project.description} placeholder="What did you build, and what makes it interesting?" onChange={(e) => editProject(project.id, { description: e.target.value })} /></label>{project.image && <button type="button" className="ws-btn ws-btn-quiet ws-clear-image" onClick={() => editProject(project.id, { image: "" })}>Remove image</button>}</div></div>)}</div>}<div className="ws-save-footer"><span><CircleHelp size={15} /> Changes appear on your website after you save.</span><button className="ws-btn ws-btn-primary" disabled={contentSaving || !contentDirty || !!uploading}>{contentSaving ? "Saving…" : "Save changes"}<ArrowRight size={16} /></button></div></fieldset></form>}</section>}
        {isAdmin && tab === "email" && <section className="ws-email-panel"><div className="ws-panel-title"><div><div className="ws-eyebrow">KEEP EVERYONE IN THE LOOP</div><h2>The email desk.</h2><p>Request updates and new message notifications, all accounted for.</p></div><button className="ws-btn ws-btn-outline" disabled={!emails?.configured || retrying} onClick={() => void retryEmails()}>{retrying ? <LoaderCircle className="ws-spin" size={16} /> : <RefreshCw size={16} />} {retrying ? "Retrying…" : "Retry queued emails"}</button></div>{!emails ? error ? <Empty title="Email status is unavailable"><button className="ws-btn ws-btn-outline" onClick={() => { setError(""); void api<EmailState>("/api/admin/email").then(setEmails).catch((e) => setError(errorText(e))); }}>Try again</button></Empty> : <div className="ws-loading"><LoaderCircle className="ws-spin" size={25} /></div> : <><div className={`ws-email-readiness ${emails.configured ? "ws-email-ready" : ""}`}><span><Mail size={23} /></span><div><h3>{emails.configured ? "Email delivery is connected" : "Email delivery is awaiting setup"}</h3><p>{emails.configured ? "Each new request, decision and chat message creates a notification. Delivery status is shown below." : "Connect an email provider and verified sender in your hosting settings. Saved requests and messages stay safe, and queued emails can be retried afterwards."}</p></div><span className="ws-readiness-label">{emails.configured ? "Connected" : "Setup needed"}</span></div><div className="ws-email-counts"><div><strong>{emails.counts.sent || 0}</strong><span>Sent to provider</span></div><div><strong>{(emails.counts.pending || 0) + (emails.counts.unconfigured || 0) + (emails.counts.sending || 0)}</strong><span>Waiting</span></div><div><strong>{emails.counts.failed || 0}</strong><span>Need a retry</span></div></div>{emails.notifications.length ? <div className="ws-email-table"><div className="ws-email-table-head"><span>Notification</span><span>Recipient</span><span>Delivery status</span><span>Created</span></div>{emails.notifications.map((mail) => <div className="ws-email-record" key={mail.id}><div><strong>{({ "request-owner": "New commission request", "request-client": "Request confirmation", "status-client": "Commission update", "message-owner": "New client message", "message-client": "New developer message", "recovery-client": "Private access link" } as Record<string, string>)[mail.kind] || mail.kind}</strong>{mail.error && <small>{mail.error}</small>}</div><span className="ws-email-recipient">{mail.recipient}</span><span className={`ws-mail-state ws-mail-${mail.state}`}>{({ sent: "Sent to provider", pending: "Queued", unconfigured: "Awaiting setup", failed: "Retry needed", sending: "Sending" } as Record<string, string>)[mail.state] || mail.state}</span><time dateTime={mail.createdAt}>{date(mail.createdAt, true)}</time></div>)}</div> : <Empty title="Nothing in the outbox yet">Email notifications will appear here as requests and messages arrive.</Empty>}</>}</section>}
        {isAdmin && session?.authentication === "password" && <div className="ws-client-footer"><span><ShieldCheck size={14} /> Your owner session lasts up to 12 hours.</span><button className="ws-btn ws-btn-quiet" onClick={() => void signOut()}>Sign out</button></div>}
        {!isAdmin && <div className="ws-client-footer"><span><ShieldCheck size={14} /> Your commission is private. Keep your access link safe.</span><button className="ws-btn ws-btn-quiet" onClick={() => void signOut()}>Close this session</button></div>}
      </>}
      <footer className="ws-footer"><span>Built for good ideas.</span><span>sandstone <span>·</span> Minecraft Bedrock commissions</span></footer>
    </div>
  </div>;
}
