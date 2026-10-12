"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, LockKeyhole, Paperclip, X } from "lucide-react";
import Workspace from "../components/Workspace";

type Project = { id: string; title: string; category: string; description: string; image: string; accent?: string };
type Box = { title: string; text: string; media: string; mediaType: "image" | "video"; alt?: string; preview?: string };
type Site = { brand: string; intro: string; availability: string; projects: Project[]; boxes: Box[]; readiness?: { database: boolean; uploads: boolean; email: boolean; admin: boolean } };
type SavedRequest = { request: { id: string; title: string }; portalUrl: string; warnings?: string[]; email?: { state: string } };
const PAGES_MODE = process.env.NEXT_PUBLIC_PAGES_MODE === "true";
const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");
const CONTACT_URL = "mailto:cjgsinclare@gmail.com";
const apiUrl = (path: string) => PAGES_MODE && BACKEND_URL ? new URL(path, `${BACKEND_URL}/`).href : path;
const mediaUrl = (path: string) => path.startsWith("/api/") ? apiUrl(path) : path;
const workspaceUrl = (path: "/portal" | "/admin") => PAGES_MODE ? (BACKEND_URL ? apiUrl(path) : CONTACT_URL) : path;
const initialSite: Site = { brand: "sandstone", intro: "Minecraft Bedrock scripting and behaviour", availability: "Open for commissions", projects: [], boxes: Array.from({ length: 6 }, () => ({ title: "", text: "", media: "", mediaType: "image" })), ...(PAGES_MODE ? { readiness: { database: false, uploads: false, email: false, admin: false } } : {}) };
const discord = "https://discord.gg/KFaT7f3xTN";
const curseforge = "https://www.curseforge.com/members/sand282/projects";

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
  if (saved) return <div className="request-success" role="status"><div className="success-icon"><Check size={25} /></div><p className="eyebrow">REQUEST SAVED</p><h3>Request saved.</h3><p>Your request for <strong>{saved.request.title}</strong> is waiting for review. Save your private page link.</p>{saved.email?.state === "sent" ? <p>A copy and your private link have been emailed to you.</p> : <p className="form-alert">Email delivery is not connected yet. Copy your private link before leaving.</p>}<a className="button button-primary" href={saved.portalUrl}>Open your project <ArrowUpRight size={18} /></a><button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(new URL(saved.portalUrl, window.location.origin).href); setCopied(true); } catch { setError("Select and copy the private link below."); } }}>{copied ? "Link copied" : "Copy private link"}</button><a className="private-link" href={saved.portalUrl}>{saved.portalUrl}</a><small>Keep this link private. You can use this link to manage your project after review.</small>{error && <p className="form-error">{error}</p>}</div>;
  if (emailDraft) return <div className="request-success" role="status"><p className="eyebrow">EMAIL DRAFT READY</p><h3>Review and send.</h3><p>Your answers are ready to open in your email app. Add any reference files there, then send the email.</p><a className="button button-primary" href={emailDraft.href}>Open email draft <ArrowUpRight size={18} /></a><button type="button" className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(emailDraft.body); setCopied(true); } catch { setError("Select the text below and copy it."); } }}>{copied ? "Copied" : "Copy enquiry text"}</button><details className="draft-details"><summary>View enquiry text</summary><pre>{emailDraft.body}</pre></details><button type="button" className="text-button" onClick={() => setEmailDraft(null)}>Back to form</button><small>This enquiry has not been sent or saved to the website.</small>{error && <p className="form-error" role="alert">{error}</p>}</div>;
  const unavailable = (PAGES_MODE && !BACKEND_URL) || (site.readiness !== undefined && (!site.readiness.database || !site.readiness.admin));
  return <form className="commission-form" onSubmit={submit}><div className="form-heading"><span className="eyebrow">COMMISSION QUOTE</span><span>No account needed</span></div><div className="form-section-label"><strong>Your details</strong><span>Used to reply about this project</span></div><div className="form-row"><label>Your name <input name="name" autoComplete="name" placeholder="What should I call you?" required minLength={2} maxLength={80} /></label><label>Email address <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label></div><div className="form-section-label"><strong>Project</strong><span>Start with the main idea</span></div><label>Project name <input name="title" placeholder="Give your idea a short name" required minLength={3} maxLength={120} /></label><label>What would you like made? <textarea name="description" rows={5} placeholder="What should it do in game? Tell me what you have so far." required minLength={20} maxLength={8000} /><small>At least 20 characters is enough to start.</small></label><div className="form-section-label"><strong>Budget and timing <span className="optional">optional</span></strong><span>It’s fine if you’re not sure yet</span></div><div className="form-row"><label>Budget <span className="optional">optional</span><input name="budget" placeholder="A range, or let's discuss" maxLength={120} /></label><label>Timeline <span className="optional">optional</span><input name="timeline" placeholder="Any deadline in mind?" maxLength={120} /></label></div><div className="form-section-label"><strong>Assets and references <span className="optional">optional</span></strong><span>Your own assets can be implemented into the add-on</span></div><label>What do you already have? <textarea name="assets" rows={2} placeholder="Models, textures, sounds or an existing add-on" maxLength={2000} /></label>{!unavailable && <label className="file-drop"><input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.zip,.mcpack,.mcaddon,.json,.txt" onChange={event => { selectFiles(event.target.files); event.target.value = ""; }} /><Paperclip size={18} /><strong>Drop files here or choose files</strong><span>Up to 5 files · 10 MB each · 20 MB total</span></label>}{files.length > 0 && <ul className="file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X size={16} /></button></li>)}</ul>}<label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label><label className="consent"><input name="consent" type="checkbox" value="true" required /><span>I agree to my details being used to discuss this commission.</span></label>{unavailable && <p className="form-note">For now, this form prepares an email. You can review your answers and attach files in your email app before sending.</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="no-commitment"><strong>No commitment until we agree on scope and price.</strong><span>Submitting this form starts a discussion. You’ll receive a private project link after it’s saved.</span></div><button type="submit" className="button button-primary form-submit" disabled={submitting}>{submitting ? "Sending…" : unavailable ? "Prepare quote request" : "Send quote request"}<ArrowUpRight size={18} /></button></form>;
}

export default function Home({ initialView = "home" }: { initialView?: "home" | "admin" | "portal" }) {
  const [site, setSite] = useState<Site>(initialSite);
  const [view, setView] = useState<"home" | "admin" | "portal">(PAGES_MODE ? "home" : initialView);
  const [formOpen, setFormOpen] = useState(false);
  const [portalMode, setPortalMode] = useState<"portal" | "admin" | null>(null);
  const [portalAccess, setPortalAccess] = useState("");
  const [selectedWork, setSelectedWork] = useState<Box | null>(null);
  const [activeWorkIndex, setActiveWorkIndex] = useState(0);
  const [activeProcessStep, setActiveProcessStep] = useState(0);
  const [pauseShowcase, setPauseShowcase] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const boxes = (site.boxes || initialSite.boxes).slice(0, 6);
  const portfolioItems: Box[] = boxes.filter(box => box.media).length
    ? boxes.filter(box => box.media)
    : (site.projects || []).slice(0, 6).filter(project => project.image).map(project => ({ title: project.title, text: project.description, media: project.image, mediaType: "image", alt: project.title }));
  const setWork = (index: number) => setActiveWorkIndex((index + portfolioItems.length) % portfolioItems.length);
  useEffect(() => {
    const readView = () => {
      const query = new URLSearchParams(window.location.search).get("view");
      const next = window.location.pathname.startsWith("/admin") || query === "admin" ? "admin" : window.location.pathname.startsWith("/portal") || query === "portal" ? "portal" : "home";
      if (PAGES_MODE) {
        setView("home");
        const access = new URLSearchParams(window.location.hash.slice(1)).get("access") || "";
        if (access) { setPortalAccess(access); window.history.replaceState({}, "", window.location.pathname); }
        setPortalMode(next !== "home" || new URLSearchParams(window.location.search).get("portal") === "1" || access ? next === "admin" ? "admin" : "portal" : null);
        return;
      }
      if (window.location.hostname.endsWith(".workers.dev") && !new URLSearchParams(window.location.search).has("embed")) {
        const destination = new URL("https://sand-282.github.io/Sandstone.github.io/");
        if (next !== "home") destination.searchParams.set("view", next);
        destination.hash = window.location.hash;
        window.location.replace(destination.href);
        return;
      }
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
  useEffect(() => { if (!portalMode) return; const before = document.body.style.overflow; document.body.style.overflow = "hidden"; const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPortalMode(null); setPortalAccess(""); window.history.replaceState({}, "", window.location.pathname); } }; window.addEventListener("keydown", escape); return () => { document.body.style.overflow = before; window.removeEventListener("keydown", escape); }; }, [portalMode]);
  useEffect(() => {
    if (pauseShowcase || portfolioItems.length < 2) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const timer = window.setInterval(() => setActiveWorkIndex(index => (index + 1) % portfolioItems.length), 6500);
    return () => window.clearInterval(timer);
  }, [pauseShowcase, portfolioItems.length]);
  if (!PAGES_MODE && view !== "home") return <Workspace mode={view} onHome={() => { window.top?.location.assign("https://sand-282.github.io/Sandstone.github.io/"); }} />;
  const brand = site.brand || "sandstone";
  const processSteps = [
    { title: "Tell me your idea", detail: "Describe the main idea, what players should be able to do and any features you have in mind. You don’t need a technical brief. Include useful images, videos or references, and any textures, models or sounds you’d like me to use." },
    { title: "Agree the details", detail: "We’ll work through open questions and adjust anything that needs changing. Before I start, we’ll agree what the add-on should do and what’s included." },
    { title: "Get a price", detail: "I’ll send a final project overview and price. You can pay in full upfront, or pay a 50% deposit to begin and the remaining 50% when the project is finished, before delivery." },
    { title: "Build and finish", detail: "After the first payment, I’ll build the project. Use the Client Portal to follow progress, message me and send files. Review the result and request changes. Commissions over $80 / £60 can include extra revisions after the main work. When you’re happy and the balance is paid, I’ll mark it complete and send the files." }
  ];
  const openForm = () => { dialog.current?.showModal(); setFormOpen(true); };
  const openPortal = (mode: "portal" | "admin") => { setPortalMode(mode); window.history.pushState({}, "", `?view=${mode}`); };
  const closePortal = () => { setPortalMode(null); setPortalAccess(""); window.history.replaceState({}, "", window.location.pathname); };
  const portalSrc = portalMode ? `${workspaceUrl(`/${portalMode}`)}?embed=1${portalAccess ? `#access=${encodeURIComponent(portalAccess)}` : ""}` : "";
  return <div className="public-site">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner"><a className="wordmark" href="#main" aria-label={`${brand} home`}>{brand}<span>.</span></a><nav className="main-nav" aria-label="Quick links"><a href={discord} target="_blank" rel="noopener noreferrer"><svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M19.7 5.3A18 18 0 0 0 15.3 4l-.5 1a16 16 0 0 0-5.6 0l-.5-1a18 18 0 0 0-4.4 1.3C1.5 9.5.8 13.6 1.2 17.6a18 18 0 0 0 5.4 2.7l1.2-2a11 11 0 0 1-1.9-.9l.5-.4a12.8 12.8 0 0 0 11.2 0l.5.4a11 11 0 0 1-1.9.9l1.2 2a18 18 0 0 0 5.4-2.7c.5-4.7-.8-8.8-3.1-12.3ZM8.8 14.8c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>Discord</a><a href={curseforge} target="_blank" rel="noopener noreferrer"><svg aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M3 4h18l-2 4h-4l-2 12H8l2-12H6L3 4Zm3 5H3l-1 3h4l.5-3ZM2 14h4l-.5 3H1l1-3Z"/></svg>CurseForge</a><button type="button" onClick={() => openPortal("portal")}><LockKeyhole size={15} aria-hidden="true" />Client Portal</button></nav></div></header>
    <main id="main" className="landing-main">
      <section className={`home-hero ${portfolioItems.length ? "has-work" : ""}`}>
        <div className="hero-copy"><p className="eyebrow">MINECRAFT BEDROCK COMMISSIONS</p><h1>Bedrock add-ons.<br /><span>Built to your brief.</span></h1><p className="landing-description">I handle the scripting and behaviour work for custom Bedrock add-ons.</p><p className="landing-scope">I don’t make textures or models. Send your own assets and I can add them to the project.</p><div className="availability"><i aria-hidden="true" />{site.availability || "Open for commissions"}</div><button type="button" className="button button-primary landing-cta" onClick={openForm}>Get a Commission Quote <ArrowUpRight size={18} /></button></div>
        <section className="hero-work" id="work" aria-label="Work showcase" onMouseEnter={() => setPauseShowcase(true)} onMouseLeave={() => setPauseShowcase(false)} onFocus={() => setPauseShowcase(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPauseShowcase(false); }}>{portfolioItems.length > 0 ? <><div className="showcase-frame"><div className="showcase-track" style={{ transform: `translateX(-${activeWorkIndex * 100}%)` }}>{portfolioItems.map((box, index) => <button className="showcase-slide" key={`${box.title}-${box.media}-${index}`} type="button" onClick={() => setSelectedWork(box)} aria-label={`View ${box.title || `project ${index + 1}`} larger`} aria-hidden={index !== activeWorkIndex} tabIndex={index === activeWorkIndex ? 0 : -1}>{box.mediaType === "video" ? <video src={mediaUrl(box.media)} poster={box.preview ? mediaUrl(box.preview) : undefined} muted playsInline preload="none" /> : <img src={mediaUrl(box.preview || box.media)} alt={box.alt || box.title || "Minecraft Bedrock project"} loading={index === 0 ? "eager" : "lazy"} />}</button>)}</div></div><div className="showcase-caption"><div><span className="eyebrow">SELECTED WORK</span><h2>{portfolioItems[activeWorkIndex]?.title || "Minecraft Bedrock project"}</h2>{portfolioItems[activeWorkIndex]?.text && <p>{portfolioItems[activeWorkIndex].text}</p>}</div><div className="showcase-controls"><span>{String(activeWorkIndex + 1).padStart(2, "0")} / {String(portfolioItems.length).padStart(2, "0")}</span>{portfolioItems.length > 1 && <><button type="button" aria-label="Previous project" onClick={() => setWork(activeWorkIndex - 1)}><ArrowLeft size={18} /></button><button type="button" aria-label="Next project" onClick={() => setWork(activeWorkIndex + 1)}><ArrowRight size={18} /></button></>}</div></div>{portfolioItems.length > 1 && <div className="showcase-dots" aria-label="Choose a project">{portfolioItems.map((box, index) => <button type="button" key={index} aria-label={`Show project ${index + 1}: ${box.title || "Untitled"}`} aria-current={index === activeWorkIndex ? "true" : undefined} onClick={() => setWork(index)} />)}</div>}</> : <div className="showcase-empty"><span className="eyebrow">WORK</span><p>Project images will appear here.</p></div>}</section>
      </section>
      <section id="process" className="home-section process-section" aria-labelledby="process-title"><div className="process-heading"><p className="eyebrow">THE PROCESS</p><h2 id="process-title">How a commission works</h2></div><div className="process-switcher"><div className="process-choices" role="tablist" aria-label="Commission steps">{processSteps.map((step, index) => <button key={step.title} id={`process-tab-${index}`} className="process-choice" type="button" role="tab" aria-selected={activeProcessStep === index} aria-controls="process-detail" tabIndex={activeProcessStep === index ? 0 : -1} onClick={() => setActiveProcessStep(index)}><span>{String(index + 1).padStart(2, "0")}</span>{step.title}</button>)}</div><div className="process-progress" aria-hidden="true"><span style={{ width: `${((activeProcessStep + 1) / processSteps.length) * 100}%` }} /></div><div className="process-detail" id="process-detail" role="tabpanel" aria-labelledby={`process-tab-${activeProcessStep}`} aria-live="polite"><span className="process-detail-step">STEP {String(activeProcessStep + 1).padStart(2, "0")} <i>/</i> 04</span><p key={activeProcessStep}>{processSteps[activeProcessStep].detail}</p></div></div></section>
    </main>
    <footer className="site-footer"><div className="footer-inner"><span>sandstone · Minecraft Bedrock scripting commissions</span><div><a href={discord} target="_blank" rel="noopener noreferrer">Discord</a><a href={curseforge} target="_blank" rel="noopener noreferrer">CurseForge</a><button type="button" onClick={() => openPortal("admin")}>Admin</button></div></div></footer>
    {portalMode && <div className="portal-overlay" role="dialog" aria-modal="true" aria-label={portalMode === "admin" ? "Admin workspace" : "Client Portal"}><div className="portal-shell"><div className="portal-top"><span>{brand} / {portalMode === "admin" ? "Admin" : "Client Portal"}</span><div>{portalMode === "portal" && <button type="button" className="portal-new" onClick={() => { closePortal(); requestAnimationFrame(openForm); }}>New commission request</button>}<button type="button" onClick={closePortal} aria-label="Close portal"><X size={20} /></button></div></div>{BACKEND_URL || !PAGES_MODE ? <iframe title={portalMode === "admin" ? "Admin workspace" : "Client Portal"} src={portalSrc} referrerPolicy="no-referrer" /> : <p className="portal-unavailable">The private workspace is awaiting setup. You can start an enquiry by email.</p>}</div></div>}
    {selectedWork && <div className="work-viewer" role="dialog" aria-modal="true" aria-label={selectedWork.title || "Project image"} onClick={() => setSelectedWork(null)} onKeyDown={event => { if (event.key === "Escape") setSelectedWork(null); }}><button type="button" className="viewer-close" aria-label="Close image viewer" onClick={() => setSelectedWork(null)}>×</button>{selectedWork.mediaType === "video" ? <video src={mediaUrl(selectedWork.media)} controls playsInline autoFocus /> : <img src={mediaUrl(selectedWork.media)} alt={selectedWork.alt || selectedWork.title || "Minecraft Bedrock add-on screenshot"} />}{(selectedWork.title || selectedWork.text) && <div className="viewer-caption"><strong>{selectedWork.title}</strong><span>{selectedWork.text}</span></div>}</div>}
    <dialog ref={dialog} className="enquiry-dialog" aria-labelledby="enquiry-title" onClose={() => setFormOpen(false)} onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close(); }}><div className="dialog-heading"><div><h2 id="enquiry-title">Commission enquiry</h2><p>Describe what you would like made.</p></div><button type="button" className="dialog-close" aria-label="Close enquiry form" onClick={() => dialog.current?.close()}><X size={20} /></button></div><CommissionForm site={site} /><p className="privacy-note">Your details are used to review and discuss your enquiry. You can request removal by email.</p></dialog>
  </div>;
}
