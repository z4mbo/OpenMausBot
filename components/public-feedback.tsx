"use client";
import { errorText } from "@/lib/error-text";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Bug, CheckCircle2, Lightbulb, Loader2, MessageSquareOff } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { DelayedSkeleton } from "./delayed-skeleton";

export function PublicFeedback({ slug }: { slug: string }) {
  const portal = useQuery(api.feedback.publicPortal, { slug });
  const [kind, setKind] = useState<"bug" | "idea">("idea"); const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [website, setWebsite] = useState(""); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false); const [error, setError] = useState("");
  return <main className="public-feedback"><a href="/" className="public-wordmark">Origin</a><section>
    {portal === undefined ? <DelayedSkeleton rows={5} label="Loading form" />
      : !portal ? <div className="public-feedback-state"><span className="project-empty-icon"><MessageSquareOff size={20} /></span><h1>This form is unavailable</h1></div>
        : sent ? <div className="public-feedback-state" role="status"><span className="project-empty-icon sent"><CheckCircle2 size={20} /></span><h1>Thank you.</h1><p>Your feedback was sent.</p><button className="ghost-button" onClick={() => { setSent(false); setTitle(""); setBody(""); }}>Send another</button></div>
          : <><h1>{portal.title}</h1>{portal.description && <p>{portal.description}</p>}
            <form className="feature-form" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, title, body, kind, website }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setSent(true); } catch (error) { setError(errorText(error, "Could not send feedback")); } finally { setBusy(false); } }}>
              <div className="segmented-control public-feedback-kind" role="radiogroup" aria-label="Type"><button type="button" role="radio" aria-checked={kind === "idea"} className={kind === "idea" ? "active" : ""} onClick={() => setKind("idea")}><Lightbulb size={14} />Idea</button><button type="button" role="radio" aria-checked={kind === "bug"} className={kind === "bug" ? "active" : ""} onClick={() => setKind("bug")}><Bug size={14} />Bug</button></div>
              <label>Title<input required value={title} maxLength={180} onChange={e => setTitle(e.target.value)} /></label>
              <label>Details<textarea required value={body} maxLength={8000} rows={7} onChange={e => setBody(e.target.value)} /></label>
              <label className="feedback-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label>
              {error && <p className="notice danger" role="alert">{error}</p>}
              <button className="primary-button" disabled={busy}>{busy && <Loader2 className="spin" size={15} />}Send feedback</button>
            </form></>}
  </section></main>;
}
