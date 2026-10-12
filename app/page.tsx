"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Paperclip, X } from "lucide-react";
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
const initialSite: Site = { brand: "sandstone", intro: "Minecraft Bedrock scripting and behaviour", availability: "Open for commissions", projects: [], boxes: Array.from({ length: 3 }, () => ({ title: "", text: "", media: "", mediaType: "image" })), ...(PAGES_MODE ? { readiness: { database: false, uploads: false, email: false, admin: false } } : {}) };
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
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
      if (next !== "home" && window.location.hostname.endsWith(".workers.dev") && !new URLSearchParams(window.location.search).has("embed")) {
        window.location.replace(`https://sand-282.github.io/Sandstone.github.io/?view=${next}${window.location.hash}`);
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
  if (!PAGES_MODE && view !== "home") return <Workspace mode={view} onHome={() => { window.history.pushState({}, "", "/"); setView("home"); }} />;
  const brand = site.brand || "sandstone";
  const openForm = () => { dialog.current?.showModal(); setFormOpen(true); };
  const openPortal = (mode: "portal" | "admin") => { setPortalMode(mode); window.history.pushState({}, "", `?view=${mode}`); };
  const closePortal = () => { setPortalMode(null); setPortalAccess(""); window.history.replaceState({}, "", window.location.pathname); };
  const portalSrc = portalMode ? `${workspaceUrl(`/${portalMode}`)}?embed=1${portalAccess ? `#access=${encodeURIComponent(portalAccess)}` : ""}` : "";
  const boxes = (site.boxes || initialSite.boxes).slice(0, 3);
  const portfolioItems = boxes.filter(box => box.media);
  return <div className="public-site">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner"><a className="wordmark" href="#main" aria-label={`${brand} home`}>{brand}<span>.</span></a><button type="button" className="mobile-menu-toggle" aria-expanded={mobileMenuOpen} aria-controls="main-navigation" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>Menu <span aria-hidden="true">{mobileMenuOpen ? "−" : "+"}</span></button><nav id="main-navigation" className={`main-nav ${mobileMenuOpen ? "main-nav-open" : ""}`} aria-label="Main navigation">{portfolioItems.length > 0 && <a href="#work" onClick={() => setMobileMenuOpen(false)}>Work</a>}<a href="#services" onClick={() => setMobileMenuOpen(false)}>What I make</a><a href="#process" onClick={() => setMobileMenuOpen(false)}>Process</a><a className="secondary-nav" href={discord} target="_blank" rel="noopener noreferrer">Discord</a><a className="secondary-nav" href={curseforge} target="_blank" rel="noopener noreferrer">CurseForge</a><button type="button" onClick={() => openPortal("portal")}>Client Portal <span className="nav-hint">existing clients</span></button></nav></div></header>
    <main id="main" className="landing-main">
      <section className="home-hero"><div className="hero-copy"><p className="eyebrow">MINECRAFT BEDROCK COMMISSIONS</p><h1>Custom Bedrock<br /><span>add-ons, scripted.</span></h1><p className="landing-description">I build custom Minecraft Bedrock add-ons, focusing on scripting and behaviour.</p><p className="landing-scope">I don’t create textures or models. If you have your own textures, models, sounds or other assets, I can implement them into the add-on.</p><div className="availability"><i aria-hidden="true" />{site.availability || "Open for commissions"}</div><button type="button" className="button button-primary landing-cta" onClick={openForm}>Get a Commission Quote <ArrowUpRight size={18} /></button><button type="button" className="portal-inline" onClick={() => openPortal("portal")}>Already have a commission? Open Client Portal <ArrowUpRight size={14} /></button></div><div className="hero-note"><span>01 / BEDROCK DEVELOPMENT</span><p>Gameplay systems made around your idea, with clear scope and a private project space from the start.</p></div></section>
      {portfolioItems.length > 0 && <section id="work" className="home-section portfolio-section"><div className="section-heading"><div><p className="eyebrow">SELECTED WORK</p><h2>Built for the game.</h2></div><p>Examples of scripting, behaviour and implementation work.</p></div><div className="portfolio-grid">{portfolioItems.map((box, index) => <article className="portfolio-item" key={index}><button className="portfolio-media" type="button" aria-label={`View ${box.title || `project ${index + 1}`} larger`} onClick={() => setSelectedWork(box)}>{box.media ? box.mediaType === "video" ? <video src={mediaUrl(box.media)} poster={box.preview ? mediaUrl(box.preview) : undefined} playsInline preload="none" /> : <img src={mediaUrl(box.preview || box.media)} alt={box.alt || box.title || "Minecraft Bedrock add-on screenshot"} loading="lazy" /> : <span className="portfolio-placeholder">Project image</span>}<span className="portfolio-reveal">{box.text || "Project details coming soon."}<span>View larger ↗</span></span></button><div className="portfolio-caption"><span>0{index + 1}</span><h3>{box.title || "Project"}</h3></div></article>)}</div></section>}
      <section id="services" className="home-section service-section"><div className="section-heading"><div><p className="eyebrow">WHAT I CAN BUILD</p><h2>From idea to in-game system.</h2></div><p>Focused on the logic that makes an add-on work.</p></div><div className="service-list"><div><span>01</span><p>Custom gameplay mechanics and scripted interactions</p></div><div><span>02</span><p>Items, abilities, tools and progression systems</p></div><div><span>03</span><p>Mob behaviour, drops and event-driven features</p></div><div><span>04</span><p>Implementing client-supplied models, textures, sounds and files</p></div></div></section>
      <section id="process" className="home-section process-section"><div className="section-heading"><div><p className="eyebrow">HOW COMMISSIONS WORK</p><h2>A clear plan before work begins.</h2></div><p>Sending a request starts a conversation. It does not commit you to paying anything.</p></div><ol className="process-steps"><li><span>01</span><h3>Share the idea</h3><p>Tell me what you want the add-on to do and include any references you have.</p></li><li><span>02</span><h3>Agree the scope</h3><p>I review the request and we agree what’s included and the price.</p></li><li><span>03</span><h3>Build and review</h3><p>Once accepted, use your private project page to message, share files and track progress.</p></li><li><span>04</span><h3>Finish and deliver</h3><p>We review the result, handle agreed revisions and complete the project.</p></li></ol><div className="provide-note"><strong>What to provide</strong><p>A short description of the idea is enough to start. A budget, timeline, reference images and your own assets are helpful, but optional.</p></div></section>
    </main>
    <footer className="site-footer"><div className="footer-inner"><span>sandstone · Minecraft Bedrock scripting commissions</span><div><a href={discord} target="_blank" rel="noopener noreferrer">Discord</a><a href={curseforge} target="_blank" rel="noopener noreferrer">CurseForge</a><button type="button" onClick={() => openPortal("admin")}>Admin</button></div></div></footer>
    {portalMode && <div className="portal-overlay" role="dialog" aria-modal="true" aria-label={portalMode === "admin" ? "Admin workspace" : "Client Portal"}><div className="portal-shell"><div className="portal-top"><span>{brand} / {portalMode === "admin" ? "Admin" : "Client Portal"}</span><div>{portalMode === "portal" && <button type="button" className="portal-new" onClick={() => { closePortal(); requestAnimationFrame(openForm); }}>New commission request</button>}<button type="button" onClick={closePortal} aria-label="Close portal"><X size={20} /></button></div></div>{BACKEND_URL || !PAGES_MODE ? <iframe title={portalMode === "admin" ? "Admin workspace" : "Client Portal"} src={portalSrc} referrerPolicy="no-referrer" /> : <p className="portal-unavailable">The private workspace is awaiting setup. You can start an enquiry by email.</p>}</div></div>}
    {selectedWork && <div className="work-viewer" role="dialog" aria-modal="true" aria-label={selectedWork.title || "Project image"} onClick={() => setSelectedWork(null)} onKeyDown={event => { if (event.key === "Escape") setSelectedWork(null); }}><button type="button" className="viewer-close" aria-label="Close image viewer" onClick={() => setSelectedWork(null)}>×</button>{selectedWork.mediaType === "video" ? <video src={mediaUrl(selectedWork.media)} controls playsInline autoFocus /> : <img src={mediaUrl(selectedWork.media)} alt={selectedWork.alt || selectedWork.title || "Minecraft Bedrock add-on screenshot"} />}{(selectedWork.title || selectedWork.text) && <div className="viewer-caption"><strong>{selectedWork.title}</strong><span>{selectedWork.text}</span></div>}</div>}
    <dialog ref={dialog} className="enquiry-dialog" aria-labelledby="enquiry-title" onClose={() => setFormOpen(false)} onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close(); }}><div className="dialog-heading"><div><h2 id="enquiry-title">Commission enquiry</h2><p>Describe what you would like made.</p></div><button type="button" className="dialog-close" aria-label="Close enquiry form" onClick={() => dialog.current?.close()}><X size={20} /></button></div><CommissionForm site={site} /><p className="privacy-note">Your details are used to review and discuss your enquiry. You can request removal by email.</p></dialog>
  </div>;
}

