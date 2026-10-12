"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUpRight, Check, Paperclip, ShieldCheck, X } from "lucide-react";
import Workspace from "../components/Workspace";

type Project = { id: string; title: string; category: string; description: string; image: string; accent?: string };
type Site = { brand: string; intro: string; availability: string; projects: Project[]; readiness?: { database: boolean; uploads: boolean; email: boolean; admin: boolean } };
type SavedRequest = { request: { id: string; title: string }; portalUrl: string; warnings?: string[]; email?: { state: string } };
const PAGES_MODE = process.env.NEXT_PUBLIC_PAGES_MODE === "true";
const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "");
const CONTACT_URL = "mailto:cjgsinclare@gmail.com";
const apiUrl = (path: string) => PAGES_MODE && BACKEND_URL ? new URL(path, `${BACKEND_URL}/`).href : path;
const workspaceUrl = (path: "/portal" | "/admin") => PAGES_MODE ? (BACKEND_URL ? apiUrl(path) : CONTACT_URL) : path;
const imageUrl = (path: string) => PAGES_MODE && path.startsWith("/api/files/") ? apiUrl(path) : path;
const assetUrl = (path: string) => PAGES_MODE ? `/Sandstone.github.io${path}` : path;
const initialSite: Site = { brand: "sandstone", intro: "Minecraft Bedrock scripting and behaviour", availability: "Open for commissions", projects: [], ...(PAGES_MODE ? { readiness: { database: false, uploads: false, email: false, admin: false } } : {}) };
const randomDrops = "https://www.curseforge.com/minecraft-bedrock/addons/sands-random-mob-drops";
const superheroes = "https://www.curseforge.com/minecraft-bedrock/addons/sand282s-superheros/files/all";
const discord = "https://discord.gg/KFaT7f3xTN";

function CommissionForm({ site }: { site: Site }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<SavedRequest | null>(null);
  const [copied, setCopied] = useState(false);
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
    if ((PAGES_MODE && !BACKEND_URL) || (site.readiness && (!site.readiness.database || !site.readiness.admin))) { setError("Online requests are being connected. Please email cjgsinclare@gmail.com for now."); return; }
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
  const unavailable = site.readiness !== undefined && (!site.readiness.database || !site.readiness.admin);
  return <form className="commission-form" onSubmit={submit}><div className="form-heading"><span className="eyebrow">START AN ENQUIRY</span><span>No account needed</span></div><div className="form-row"><label>Your name <input name="name" autoComplete="name" placeholder="What should I call you?" required minLength={2} maxLength={80} /></label><label>Email address <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label></div><label>Project name <input name="title" placeholder="Give your idea a short name" required minLength={3} maxLength={120} /></label><label>Tell me about your idea <textarea name="description" rows={5} placeholder="What should it do in game? Tell me what you have so far." required minLength={20} maxLength={8000} /><small>At least 20 characters is enough to start.</small></label><div className="form-row"><label>Budget <span className="optional">optional</span><input name="budget" placeholder="A range, or let's discuss" maxLength={120} /></label><label>Timeline <span className="optional">optional</span><input name="timeline" placeholder="Any deadline in mind?" maxLength={120} /></label></div><label>Assets you can provide <span className="optional">optional</span><textarea name="assets" rows={2} placeholder="Models, textures, sounds or an existing add-on" maxLength={2000} /></label><label className="file-drop"><input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.zip,.mcpack,.mcaddon,.json,.txt" onChange={event => { selectFiles(event.target.files); event.target.value = ""; }} /><Paperclip size={18} /><strong>Add references or files</strong><span>Optional · up to 5 files · 10 MB each</span></label>{files.length > 0 && <ul className="file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X size={16} /></button></li>)}</ul>}<label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label><label className="consent"><input name="consent" type="checkbox" value="true" required /><span>I agree to my details and files being used to review and discuss this commission. <a href="#privacy">How your details are used</a></span></label>{unavailable && <p className="form-alert">Online enquiries are being connected. For now, email <a href={CONTACT_URL}>cjgsinclare@gmail.com</a>.</p>}{error && <p className="form-error" role="alert">{error}</p>}{unavailable ? <a className="button button-primary form-submit" href="mailto:cjgsinclare@gmail.com?subject=Minecraft%20Bedrock%20commission%20enquiry">Email your enquiry <ArrowUpRight size={18} /></a> : <button className="button button-primary form-submit" disabled={submitting}>{submitting ? "Sending…" : "Send enquiry"}<ArrowUpRight size={18} /></button>}<p className="form-foot"><ShieldCheck size={15} /> No commitment until we agree on scope and price.</p></form>;
}

export default function Home({ initialView = "home" }: { initialView?: "home" | "admin" | "portal" }) {
  const [site, setSite] = useState<Site>(initialSite);
  const [view, setView] = useState<"home" | "admin" | "portal">(PAGES_MODE ? "home" : initialView);
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
  useEffect(() => { if (view !== "home") return; const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }), { threshold: 0.08 }); document.querySelectorAll(".reveal").forEach(el => observer.observe(el)); return () => observer.disconnect(); }, [view, site.projects.length]);
  if (!PAGES_MODE && view !== "home") return <Workspace mode={view} onHome={() => { window.history.pushState({}, "", "/"); setView("home"); }} />;
  const brand = site.brand || "sandstone";
  return <div className="public-site"><a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><div className="header-inner"><a className="wordmark" href="#top" aria-label={`${brand} home`}>{brand}</a><nav className="main-nav" aria-label="Main navigation"><a href="#work">Work</a><a href="#media">Media</a><a href={discord} target="_blank" rel="noopener noreferrer">Discord</a><a href={workspaceUrl("/portal")}>Client portal</a></nav><a className="header-cta" href="#request">Start an enquiry <ArrowUpRight size={15} /></a></div></header>
    <main id="main"><section className="hero section-shell" id="top"><p className="eyebrow">MINECRAFT BEDROCK / SCRIPTING &amp; BEHAVIOUR</p><h1>Minecraft Bedrock<br />add-on development.</h1><div className="hero-bottom"><p>Independent commission work by Sand282. Explore published add-ons and examples of my work, then get in touch about your project.</p><a href="#work">View the work <ArrowDown size={18} /></a></div></section>
      <section className="work-section section-shell" id="work"><div className="section-heading reveal"><span className="section-number">01</span><div><p className="eyebrow">PUBLISHED ADD-ONS</p><h2>Selected work</h2></div></div><div className="work-list"><article className="work-item reveal"><div className="work-index">01 / 02</div><div className="work-body"><h3>Sand282’s Superheros</h3><p>A modular Bedrock superhero add-on with custom abilities, an in-game ability system and separate hero packs.</p></div><a href={superheroes} target="_blank" rel="noopener noreferrer" aria-label="View Sand282’s Superheros on CurseForge">View on CurseForge <ArrowUpRight size={18} /></a></article><article className="work-item reveal"><div className="work-index">02 / 02</div><div className="work-body"><h3>Sand’s Random Mob Drops</h3><p>A survival add-on that replaces each mob’s usual drops with completely random loot.</p></div><a href={randomDrops} target="_blank" rel="noopener noreferrer" aria-label="View Sand’s Random Mob Drops on CurseForge">View on CurseForge <ArrowUpRight size={18} /></a></article></div>{site.projects.length > 0 && <div className="additional-work"><h3>Additional projects</h3><div className="additional-grid">{site.projects.map(project => <article key={project.id} className="additional-item">{project.image && <div className="additional-image"><img src={imageUrl(project.image)} alt={project.title} loading="lazy" /></div>}<p className="eyebrow">{project.category}</p><h4>{project.title}</h4><p>{project.description}</p></article>)}</div></div>}</section>
      <section className="media-section section-shell" id="media"><div className="section-heading reveal"><span className="section-number">02</span><div><p className="eyebrow">SELECTED MEDIA</p><h2>In game</h2></div></div><div className="media-intro"><p>Footage and screenshots from my Minecraft Bedrock work. The media is shown without edits or graphics over it.</p></div><figure className="lead-media reveal"><video controls playsInline preload="metadata" poster={assetUrl("/showcase/underwater.png")} aria-label="Minecraft Bedrock gameplay recording"><source src={assetUrl("/showcase/gameplay.mp4")} type="video/mp4" /></video><figcaption>Gameplay recording <span>VIDEO</span></figcaption></figure><div className="media-grid"><figure className="media-item reveal"><div className="media-frame"><img src={assetUrl("/showcase/bedrock-interface.jpg")} alt="Custom in-game status interface in Minecraft Bedrock" loading="lazy" /></div><figcaption>In-game interface <span>SCREENSHOT</span></figcaption></figure><figure className="media-item reveal"><div className="media-frame"><img src={assetUrl("/showcase/kart.gif")} alt="Animated pink kart model from Sand’s Minecraft Bedrock work" loading="lazy" /></div><figcaption>Kart animation <span>GIF</span></figcaption></figure><figure className="media-item reveal"><div className="media-frame"><img src={assetUrl("/showcase/sea-creature.jpg")} alt="Long blue creature swimming underwater in Minecraft Bedrock" loading="lazy" /></div><figcaption>Underwater creature <span>SCREENSHOT</span></figcaption></figure><figure className="media-item reveal"><div className="media-frame"><img src={assetUrl("/showcase/underwater.png")} alt="Underwater Minecraft Bedrock environment and creature" loading="lazy" /></div><figcaption>Underwater environment <span>SCREENSHOT</span></figcaption></figure></div></section>
      <section className="request-section" id="request"><div className="section-shell request-layout"><div className="request-copy"><p className="eyebrow">COMMISSION ENQUIRIES</p><h2>Tell me about<br />your project.</h2><p>I work on scripting and behaviour. If you have your own textures, models or sounds, I can implement them, but I don’t create those assets.</p><p>Send an outline of what you need and any reference files. We can agree the scope and price before work starts.</p><div className="contact-links"><a href={CONTACT_URL}>cjgsinclare@gmail.com <ArrowUpRight size={16} /></a><a href={discord} target="_blank" rel="noopener noreferrer">Discord <ArrowUpRight size={16} /></a></div></div><CommissionForm site={site} /></div></section>
      <section id="privacy" className="privacy-note section-shell"><ShieldCheck size={17} /><p>Your email, brief and uploaded files are used to review and manage your commission. Files and conversations are private to you and the administrator. Ask for removal at <a href={CONTACT_URL}>cjgsinclare@gmail.com</a>. Keep your private access link to yourself.</p></section>
    </main><footer className="site-footer"><div className="section-shell footer-inner"><a className="wordmark" href="#top">{brand}</a><div><a href="#work">Work</a><a href="#media">Media</a><a href={workspaceUrl("/portal")}>Client portal</a><a href={workspaceUrl("/admin")}>Admin</a><a href={discord} target="_blank" rel="noopener noreferrer">Discord</a></div><p>Independent Minecraft Bedrock commissions. Not affiliated with Mojang or Microsoft.</p></div></footer>
  </div>;
}

