"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { ArrowRight, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Dialog } from "./dialog";

export function CreateWorkspaceDialog({ sessionToken, onClose }: { sessionToken: string; onClose: () => void }) {
  const create = useMutation(api.workspaces.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await create({ sessionToken, name }); window.location.assign(`/${result.slug}`); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not create workspace"); setBusy(false); }
  };
  return <Dialog title="Create workspace" onClose={onClose}><form className="dialog-body stack-form" onSubmit={submit}><label>Workspace name<input autoFocus required maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="Your team" /></label>{error && <p className="notice danger" role="alert">{error}</p>}<div className="dialog-actions"><button className="ghost-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !name.trim()}>{busy ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}Create workspace</button></div></form></Dialog>;
}
