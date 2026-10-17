import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Camera, ChevronDown, KeyRound, Loader2, LogOut, UserRound } from "lucide-react";
import { cloudMutation, cloudUrl, useCloudQuery, useCloudSession } from "@/lib/origin-cloud";
import type { CloudUser } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { shareSession } from "./OriginConnect";
import { MemberAvatar, memberName } from "./OriginPeople";
import { SidebarProfileMenu } from "./SidebarProfileMenu";
import { Field, Modal, Notice, ghostButton, inputClass, primaryButton, useAction } from "./origin-pages/ui";

export type OriginMe = CloudUser & { avatarUrl?: string | null };

export function useOriginMe(): OriginMe | null {
  return useCloudQuery<OriginMe | null>("auth:me", {}) ?? null;
}

/** The signed-in Origin account at the top of the sidebar: avatar, username and a menu with the account and the app's own settings. */
export function OriginAccountMenu({ iconOnly = false }: { iconOnly?: boolean }) {
  const session = useCloudSession();
  const me = useOriginMe();
  const [settings, setSettings] = useState(false);
  if (!me) return <SidebarProfileMenu iconOnly compact={!iconOnly} />;
  const name = memberName(me);
  const signOut = async () => {
    try { await session.logout(); } finally { await shareSession(null, null); }
  };
  return (
    <>
      <SidebarProfileMenu account={{
        label: "Open account menu",
        renderTrigger: ({ open }) => iconOnly ? (
          <span data-origin-account title={name} className={cn("flex size-[46px] items-center justify-center rounded-xl transition-colors duration-150", open ? "bg-raised" : "hover:bg-raised/50")}>
            <MemberAvatar person={me} size={30} />
          </span>
        ) : (
          <span data-origin-account className={cn("flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pl-1 pr-1.5 transition-colors duration-150",
            open ? "bg-raised" : "hover:bg-raised/60")}>
            <MemberAvatar person={me} size={24} />
            <span className="min-w-0 truncate text-[13.5px] font-semibold leading-5 text-ink">{name}</span>
            <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform duration-200", open && "rotate-180")} />
          </span>
        ),
        before: [{
          key: "origin-account",
          label: me.name?.trim() || name,
          subtitle: me.email,
          icon: <MemberAvatar person={me} size={20} shape="square" />,
          onSelect: () => setSettings(true),
        }, {
          key: "origin-account-settings",
          label: "Account settings",
          icon: <UserRound size={18} />,
          onSelect: () => setSettings(true),
        }],
        after: [{
          key: "origin-sign-out",
          label: "Sign out",
          icon: <LogOut size={18} />,
          separatorBefore: true,
          onSelect: () => void signOut(),
        }],
      }} />
      {settings && <OriginAccountDialog key={JSON.stringify([cloudUrl(), me._id])} me={me} onClose={() => setSettings(false)} onSignOut={() => { setSettings(false); void signOut(); }} />}
    </>
  );
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function OriginAccountDialog({ me, onClose, onSignOut }: { me: OriginMe; onClose(): void; onSignOut(): void }) {
  const [username, setUsername] = useState(me.username || me.email.split("@")[0] || "");
  const [name, setName] = useState(me.name || "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const action = useAction();

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const dirty = file !== null || username !== (me.username || me.email.split("@")[0] || "") || name !== (me.name || "");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const ok = await action.run(async () => {
      let avatarStorageId: string | undefined;
      if (file) {
        const upload = await cloudMutation<string>("auth:generateAvatarUploadUrl", {});
        const response = await fetch(upload, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!response.ok) throw new Error("Avatar upload failed");
        avatarStorageId = ((await response.json()) as { storageId: string }).storageId;
      }
      await cloudMutation("auth:updateProfile", { username, name, ...(avatarStorageId ? { avatarStorageId } : {}) });
    }, "Profile update failed");
    if (ok) { setFile(null); setSaved(true); }
  };

  return createPortal(
    <Modal title="Origin account" onClose={onClose}>
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
        <div className="flex items-center gap-3.5">
          <button type="button" onClick={() => picker.current?.click()} aria-label="Change profile picture" title="Change profile picture"
            className="group/avatar relative shrink-0 overflow-hidden rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            <MemberAvatar person={{ ...me, username, avatarUrl: preview ?? me.avatarUrl }} size={56} shape="square" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100 focus-visible:opacity-100 touch:opacity-60">
              <Camera size={18} />
            </span>
          </button>
          <input ref={picker} type="file" accept={IMAGE_TYPES.join(",")} className="hidden"
            onChange={(event) => { const next = event.target.files?.[0] ?? null; event.target.value = ""; if (next && !IMAGE_TYPES.includes(next.type)) { action.setError("Choose a PNG, JPEG, WebP or GIF"); return; } setFile(next); }} />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-ink">{name.trim() || username}</div>
            <div className="truncate text-[12.5px] text-ink-secondary">{me.email}</div>
            <div className="truncate text-[11.5px] text-ink-tertiary">{cloudUrl()?.replace(/^https?:\/\//, "")}</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username"><input className={inputClass} value={username} maxLength={40} onChange={(event) => { setUsername(event.target.value); setSaved(false); }} placeholder="Username" /></Field>
          <Field label="Display name"><input className={inputClass} value={name} maxLength={100} onChange={(event) => { setName(event.target.value); setSaved(false); }} placeholder="Display name" /></Field>
        </div>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex items-center justify-end gap-2">
          {saved && !dirty && <span role="status" className="mr-auto text-[12.5px] text-success">Profile updated</span>}
          <button type="submit" className={primaryButton} disabled={action.busy || !dirty}>{action.busy && <Loader2 size={14} className="animate-spin" />}Save profile</button>
        </div>
      </form>
      <PasswordChanger />
      <div className="mt-4 flex items-center justify-between border-t border-hairline/40 pt-3">
        <span className="text-[12.5px] text-ink-tertiary">Signed in to Origin</span>
        <button type="button" className={cn(ghostButton, "text-danger")} onClick={onSignOut}><LogOut size={14} />Sign out</button>
      </div>
    </Modal>,
    document.body,
  );
}

function PasswordChanger() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const action = useAction();
  if (!open) {
    return (
      <div className="mt-3 flex flex-col gap-1.5">
        <button type="button" className={cn(ghostButton, "w-full justify-center")} onClick={() => { setOpen(true); setDone(false); }}><KeyRound size={14} />Change password</button>
        {done && <span role="status" className="text-center text-[12.5px] text-success">Password changed</span>}
      </div>
    );
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action.run(() => cloudMutation("auth:changePassword", { currentPassword: current, newPassword: next }), "Password change failed");
    if (ok) { setCurrent(""); setNext(""); setOpen(false); setDone(true); }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-2 rounded-xl border border-hairline/40 p-3 motion-safe:animate-pop-in">
      <input className={inputClass} type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={current} onChange={(event) => setCurrent(event.target.value)} />
      <input className={inputClass} type="password" autoComplete="new-password" placeholder="New password, 10 characters or more" aria-label="New password" value={next} onChange={(event) => setNext(event.target.value)} />
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <div className="flex justify-end gap-2">
        <button type="button" className={ghostButton} onClick={() => { setCurrent(""); setNext(""); action.setError(""); setOpen(false); }}>Cancel</button>
        <button type="submit" className={primaryButton} disabled={action.busy || !current || next.length < 10}>Save password</button>
      </div>
    </form>
  );
}
