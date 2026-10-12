"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Paperclip, X } from "lucide-react";
import Workspace from "../components/Workspace";

type Project = { id: string; title: string; category: string; description: string; image: string; accent?: string };
type Site = { brand: string; intro: string; availability: string; projects: Project[]; readiness?: { database: boolean; uploads: boolean; email: boolean; admin: boolean } };
type SavedRequest = { request: { id: string; title: string }; portalUrl: string; warnings?: string[]; email?: { state: string } };
const PAGES_MODE = process.env.NEXT_PUBLIC_PAGES_MODE === "true";
const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");
const CONTACT_URL = "mailto:cjgsinclare@gmail.com";
const apiUrl = (path: string) => PAGES_MODE && BACKEND_URL ? new URL(path, `${BACKEND_URL}/`).href : path;
const workspaceUrl = (path: "/portal" | "/admin") => PAGES_MODE ? (BACKEND_URL ? apiUrl(path) : CONTACT_URL) : path;
const initialSite: Site = { brand: "sandstone", intro: "Minecraft Bedrock scripting and behaviour", availability: "Open for commissions", projects: [], ...(PAGES_MODE ? { readiness: { database: false, uploads: false, email: false, admin: false } } : {}) };
const discord = "https://discord.gg/KFaT7f3xTN";

function CommissionForm({ site }: { site: Site }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<SavedRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailDraft, setEmailDraft] = useState<{ href: string; body: string } | null>(null);
  const key = useRef("");
  function selectFiles(incoming: FileList | null) {
    if (!incoming) return;
    const next = [...files, ...Array.from(incoming)];
    if (next.length > 5) { setError("You can attach up to 5 files."); return; }
    if (next.some(file => file.size > 10 * 1024 * 1024) || next.reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) { setError("Each file must be under 10 MB, and all files together under 20 MB."); return; }
    setFiles(next); setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if ((PAGES_MODE && !BACKEND_URL) || (site.readiness && (!site.readiness.database || !site.readiness.admin))) {
      const data = new FormData(event.currentTarget);
      const get = (name: string) => String(data.get(name) || "").trim();
      const body = [`Name: ${get("name")}`, `Email: ${get("email")}`, `Project: ${get("title")}`, "", get("description"), "", `Budget: ${get("budget") || "Not specified"}`, `Timeline: ${get("timeline") || "Not specified"}`, `Assets: ${get("assets") || "Not specified"}`].join("\n");
      setEmailDraft({ body, href: `${CONTACT_URL}?subject=${encodeURIComponent(`Bedrock commission: ${get("title")}`)}&body=${encodeURIComponent(body)}` });
      return;
    }
    setSubmitting(true);
    const data = new FormData(event.currentTarget); data.delete("files"); files.forEach(file => data.append("files", file));
    if (!key.current) key.current = crypto.randomUUID().replaceAll("-", "");
    data.set("idempotencyKey", key.current);
    try {
      const response = await fetch(apiUrl("/api/requests"), { method: "POST", body: data, credentials: PAGES_MODE ? "omit" : "same-origin" });
      const result = await response.json() as SavedRequest & { error?: string };
      if (!response.ok) throw new Error(result.error || "Your request could not be saved. Please try again.");
      setSaved({ ...result, portalUrl: PAGES_MODE ? new URL(result.portalUrl, `${BACKEND_URL}/`).href : result.portalUrl });
    } catch (err) { setError(err instanceof Error ? err.message : "A connection problem interrupted your submission."); }
    finally { setSubmitting(false); }
  }
  if (saved) return <div className="request-success" role="status"><div className="success-icon"><Check size={25} /></div><p className="eyebrow">REQUEST SAVED</p><h3>Your idea is on its way.</h3><p>Your request for <strong>{saved.request.title}</strong> is waiting for review. Save your private page link.</p>{saved.email?.state === "sent" ? <p>A copy and your private link have been emailed to you.</p> : <p className="form-alert">Email delivery is not connected yet. Copy your private link before leaving.</p>}<a className="button button-primary" href={saved.portalUrl}>Open private page <ArrowUpRight size={18} /></a><button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(new URL(saved.portalUrl, window.location.origin).href); setCopied(true); } catch { setError("Select and copy the private link below."); } }}>{copied ? "Link copied" : "Copy private link"}</button><a className="private-link" href={saved.portalUrl}>{saved.portalUrl}</a><small>Keep this link private. Chat opens if your commission is accepted.</small>{error && <p className="form-error">{error}</p>}</div>;
  if (emailDraft) return <div className="request-success" role="status"><p className="eyebrow">EMAIL DRAFT READY</p><h3>Review and send.</h3><p>Your answers are ready to open in your email app. Add any reference files there, then send the email.</p><a className="button button-primary" href={emailDraft.href}>Open email draft <ArrowUpRight size={18} /></a><button type="button" className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(emailDraft.body); setCopied(true); } catch { setError("Select the text below and copy it."); } }}>{copied ? "Copied" : "Copy enquiry text"}</button><details className="draft-details"><summary>View enquiry text</summary><pre>{emailDraft.body}</pre></details><button type="button" className="text-button" onClick={() => setEmailDraft(null)}>Back to form</button><small>This enquiry has not been sent or saved to the website.</small>{error && <p className="form-error" role="alert">{error}</p>}</div>;
  const unavailable = (PAGES_MODE && !BACKEND_URL) || (site.readiness !== undefined && (!site.readiness.database || !site.readiness.admin));
  return <form className="commission-form" onSubmit={submit}><div className="form-heading"><span className="eyebrow">COMMISSION ENQUIRY</span><span>No account needed</span></div><div className="form-row"><label>Your name <input name="name" autoComplete="name" placeholder="What should I call you?" required minLength={2} maxLength={80} /></label><label>Email address <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label></div><label>Project name <input name="title" placeholder="Give your idea a short name" required minLength={3} maxLength={120} /></label><label>Tell me about your idea <textarea name="description" rows={5} placeholder="What should it do in game? Tell me what you have so far." required minLength={20} maxLength={8000} /><small>At least 20 characters is enough to start.</small></label><div className="form-row"><label>Budget <span className="optional">optional</span><input name="budget" placeholder="A range, or let's discuss" maxLength={120} /></label><label>Timeline <span className="optional">optional</span><input name="timeline" placeholder="Any deadline in mind?" maxLength={120} /></label></div><label>Assets you can provide <span className="optional">optional</span><textarea name="assets" rows={2} placeholder="Models, textures, sounds or an existing add-on" maxLength={2000} /></label>{!unavailable && <label className="file-drop"><input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.zip,.mcpack,.mcaddon,.json,.txt" onChange={event => { selectFiles(event.target.files); event.target.value = ""; }} /><Paperclip size={18} /><strong>Add references or files</strong><span>Optional · up to 5 files · 10 MB each</span></label>}{files.length > 0 && <ul className="file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X size={16} /></button></li>)}</ul>}<label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label><label className="consent"><input name="consent" type="checkbox" value="true" required /><span>I agree to my details being used to discuss this commission.</span></label>{unavailable && <p className="form-note">For now, this form prepares an email. You can review your answers and attach files in your email app before sending.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" className="button button-primary form-submit" disabled={submitting}>{submitting ? "Sending…" : unavailable ? "Prepare enquiry" : "Send enquiry"}<ArrowUpRight size={18} /></button><p className="form-foot">No commitment until we agree on scope and price.</p></form>;
}

export default function Home({ initialView = "home" }: { initialView?: "home" | "admin" | "portal" }) {
  const [site, setSite] = useState<Site>(initialSite);
  const [view, setView] = useState<"home" | "admin" | "portal">(PAGES_MODE ? "home" : initialView);
  const [formOpen, setFormOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const readView = () => {
      const query = new URLSearchParams(window.location.search).get("view");
      const next = window.location.pathname.startsWith("/admin") || query === "admin" ? "admin" : window.location.pathname.startsWith("/portal") || query === "portal" ? "portal" : "home";
      if (PAGES_MODE) { setView("home"); if (next !== "home" && BACKEND_URL) window.location.replace(`${apiUrl(`/${next}`)}${window.location.search}`); return; }
      setView(next);
    };
    readView(); window.addEventListener("popstate", readView);
    if (!PAGES_MODE || BACKEND_URL) fetch(apiUrl("/api/site"), { credentials: PAGES_MODE ? "omit" : "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000) }).then(async response => { if (response.ok) { const value = await response.json() as Partial<Site>; setSite({ ...initialSite, ...value, brand: value.brand === "BEDROCK" ? "sandstone" : value.brand || "sandstone" }); } }).catch(() => {});
    return () => window.removeEventListener("popstate", readView);
  }, []);
  useEffect(() => {
    if (!formOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [formOpen]);
  if (!PAGES_MODE && view !== "home") return <Workspace mode={view} onHome={() => { window.history.pushState({}, "", "/"); setView("home"); }} />;
  const brand = site.brand || "sandstone";
  const openForm = () => { dialog.current?.showModal(); setFormOpen(true); };
  return <div className="public-site">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner"><a className="wordmark" href="#main" aria-label={`${brand} home`}>{brand}<span>.</span></a><nav className="main-nav" aria-label="Main navigation"><a href={discord} target="_blank" rel="noopener noreferrer">Discord <ArrowUpRight size={13} /></a><a href={workspaceUrl("/portal")}>Client portal</a></nav><button type="button" className="header-cta" onClick={openForm}>Enquire <ArrowUpRight size={15} /></button></div></header>
    <main id="main" className="landing-main"><div className="landing-content"><p className="eyebrow">SAND282 / MINECRAFT BEDROCK DEVELOPMENT</p><h1>Bedrock add-ons.<br /><span>Built for your idea.</span></h1><p className="landing-description">Custom scripting and behaviour for Minecraft Bedrock.</p><p className="landing-scope">I can implement your textures, models and sounds.<br />Asset creation isn’t included.</p><button type="button" className="button button-primary landing-cta" onClick={openForm}>Start an enquiry <ArrowUpRight size={18} /></button><a className="email-link" href={CONTACT_URL}>cjgsinclare@gmail.com</a></div></main>
    <footer className="site-footer"><div className="footer-inner"><span>Independent Minecraft Bedrock commissions.</span><div><a href={discord} target="_blank" rel="noopener noreferrer">Discord</a><a href={workspaceUrl("/portal")}>Client portal</a><a href={workspaceUrl("/admin")}>Admin</a></div></div></footer>
    <dialog ref={dialog} className="enquiry-dialog" aria-labelledby="enquiry-title" onClose={() => setFormOpen(false)} onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close(); }}><div className="dialog-heading"><div><h2 id="enquiry-title">Tell me about your project.</h2><p>A brief outline is enough to get started.</p></div><button type="button" className="dialog-close" aria-label="Close enquiry form" onClick={() => dialog.current?.close()}><X size={20} /></button></div><CommissionForm site={site} /><p className="privacy-note">Your details are used to review and discuss your enquiry. You can request removal by email.</p></dialog>
  </div>;
}

