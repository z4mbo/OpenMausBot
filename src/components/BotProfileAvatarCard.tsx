import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { cn } from "@/lib/cn";
import {
  PICKABLE_STATES,
  MAUS_COLORS,
  MAUS_COLOR_NAMES,
  type MausMotion,
  type MausState,
} from "@/lib/mascot";
import {
  AVATAR_FOCUS_CENTER,
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  BOT_AVATAR_CROPS,
  botAvatarUrlFromStoredPath,
  clampAvatarFocus,
  clampAvatarZoom,
  type BotAvatarCrop,
} from "../../shared/bot-avatar";
import { MASCOT_BODIES, MASCOT_BODY_IDS } from "../../shared/mascot-bodies";
import { BotAvatar } from "./Avatar";
import { AvatarImageGenerator } from "./AvatarImageGenerator";
import { useOrganizationBranding } from "@/lib/use-organization-branding";
import { ZAP_LOOKS } from "@/lib/origin-teams";
import { ZAP_SWATCHES, setAvatarLook, useAvatarLook } from "@/lib/origin-avatar-looks";

type AvatarPatch = Partial<
  Pick<Bot, "avatarCrop" | "avatarUrl" | "avatarZoom" | "avatarFocusX" | "avatarFocusY" | "color" | "mascotExpression" | "mascotBody">
>;

const FRAME_SIZE = 168;

function AvatarFraming({
  bot,
  disabled,
  onPatch,
}: {
  bot: Bot;
  disabled: boolean;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const zoom = clampAvatarZoom(bot.avatarZoom ?? AVATAR_ZOOM_MIN);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? AVATAR_FOCUS_CENTER);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? AVATAR_FOCUS_CENTER);
  const framed = zoom !== AVATAR_ZOOM_MIN || focusX !== AVATAR_FOCUS_CENTER || focusY !== AVATAR_FOCUS_CENTER;
  const drag = useRef<{ x: number; y: number; focusX: number; focusY: number; pointer: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, focusX, focusY, pointer: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointer) return;
    onPatch({
      avatarFocusX: clampAvatarFocus(start.focusX - (event.clientX - start.x) / FRAME_SIZE / zoom),
      avatarFocusY: clampAvatarFocus(start.focusY - (event.clientY - start.y) / FRAME_SIZE / zoom),
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (disabled || event.deltaY === 0) return;
    event.preventDefault();
    onPatch({ avatarZoom: clampAvatarZoom(zoom + (event.deltaY < 0 ? 0.08 : -0.08)) });
  };

  return (
    <div className="py-3">
      <div
        className="mx-auto w-fit cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <BotAvatar bot={bot} size={FRAME_SIZE} animated={false} label={`${bot.name} avatar preview`} />
      </div>
      <div className="mb-1.5 mt-4 flex items-baseline justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Zoom</span>
        <span className="tabular-nums text-[12px] text-ink-secondary">{Math.round(zoom * 100)}%</span>
      </div>
      <input
        type="range"
        min={AVATAR_ZOOM_MIN}
        max={AVATAR_ZOOM_MAX}
        step={0.01}
        value={zoom}
        disabled={disabled}
        aria-label="Zoom avatar"
        aria-valuemin={AVATAR_ZOOM_MIN}
        aria-valuemax={AVATAR_ZOOM_MAX}
        aria-valuenow={zoom}
        aria-valuetext={`${Math.round(zoom * 100)}%`}
        onChange={(event) => onPatch({ avatarZoom: clampAvatarZoom(Number(event.target.value)) })}
        className="w-full accent-accent"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px] text-ink-secondary">
        <span>Drag the picture to reposition it. Scroll to zoom.</span>
        {framed && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPatch({ avatarZoom: AVATAR_ZOOM_MIN, avatarFocusX: AVATAR_FOCUS_CENTER, avatarFocusY: AVATAR_FOCUS_CENTER })}
            className="shrink-0 rounded-md px-2 py-1 text-ink hover:bg-control disabled:opacity-50"
          >
            Reset framing
          </button>
        )}
      </div>
    </div>
  );
}

const CROP_LABEL = {
  mascot: "Mascot",
  circle: "Circle",
  rounded: "Rounded",
  square: "Square",
} satisfies Record<BotAvatarCrop, string>;

export function BotProfileAvatarCard({
  bot,
  activeState,
  mascotMotion,
  onPatch,
}: {
  bot: Bot;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const { flushBotPatches } = useStore();
  const { request: api, uploadAvatar, draft: isDraft } = useBotEditor();
  const zapLooks = ZAP_LOOKS && !isDraft;
  const look = useAvatarLook(zapLooks ? bot.id : undefined);
  const customFace = Boolean(look.face && look.face !== "#FFFFFF" && look.face !== "#050505");
  const customColour = Boolean((look.color && !(ZAP_SWATCHES as readonly string[]).includes(look.color)));
  const [lookError, setLookError] = useState("");
  const saveLook = (patch: { look?: "mascot" | "dot"; color?: string | null; face?: string | null }) => {
    setLookError("");
    void setAvatarLook(bot.id, patch).catch((cause) => setLookError(cause instanceof Error ? cause.message : String(cause)));
  };
  const organization = useOrganizationBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [savingConnection, setSavingConnection] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const crop = bot.avatarCrop ?? "mascot";
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const busy = uploading || generating || savingConnection;

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setUploading(true);
    setError(null);
    try {
      const saved = uploadAvatar ? null : await imageAttachmentFromFile(file);
      const avatarUrl = uploadAvatar ? await uploadAvatar(file) : saved ? botAvatarUrlFromStoredPath(saved.path) : null;
      if (!avatarUrl) throw new Error("The uploaded image could not be used as an avatar");
      const latestCrop = cropRef.current;
      onPatch({
        avatarUrl,
        avatarCrop: latestCrop === "mascot" ? "circle" : latestCrop,
        avatarZoom: AVATAR_ZOOM_MIN,
        avatarFocusX: AVATAR_FOCUS_CENTER,
        avatarFocusY: AVATAR_FOCUS_CENTER,
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = () => {
    setError(null);
    onPatch({
      avatarUrl: null,
      avatarCrop: "mascot",
      avatarZoom: AVATAR_ZOOM_MIN,
      avatarFocusX: AVATAR_FOCUS_CENTER,
      avatarFocusY: AVATAR_FOCUS_CENTER,
    });
  };

  const generate = async (direction: string) => {
    if (busy) return;
    setGenerating(true);
    setError(null);
    try {
      // Commit debounced profile edits first, then feed the generated avatar back through the same serialized mutation
      // lane as upload and remove.
      const cropAtStart = cropRef.current;
      await flushBotPatches(bot.id);
      const result: { avatarUrl: string; bot: Bot } = await api(`/api/bots/${bot.id}/avatar/generate`, {
        method: "POST",
        body: JSON.stringify({ prompt: direction.trim() }),
      });
      const latestCrop = cropRef.current;
      onPatch({
        avatarUrl: result.avatarUrl,
        avatarCrop:
          latestCrop === cropAtStart
            ? (result.bot.avatarCrop ?? "circle")
            : latestCrop,
      });
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : String(generateError));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between pb-1">
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-secondary">Avatar</span>
        <button
          disabled={busy}
          onClick={() => onPatch({ avatarCrop: "mascot", color: "green", mascotExpression: null, mascotBody: "cursor" })}
          className="rounded-md px-2 py-1.5 text-[13px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
        >
          Reset mascot
        </button>
      </div>

      <div className="pt-1">
        {Boolean(organization?.icons.length) && <div className="mb-3 border-b border-hairline/40 pb-3">
          <div className="mb-2 text-[13px] font-medium text-ink-secondary">{organization!.name} icons</div>
          <div className="flex flex-wrap gap-2">{organization!.icons.map(icon => <button key={icon.id} type="button" disabled={busy} title={icon.name} aria-label={`Use ${icon.name} icon`} className="flex size-12 items-center justify-center rounded-lg border border-hairline/40 hover:bg-control disabled:opacity-50" onClick={() => {
            const bytes = Uint8Array.from(atob(icon.image.slice(22)), byte => byte.charCodeAt(0));
            void upload(new File([bytes], `${icon.id}.png`, { type: "image/png" }));
          }}><img src={icon.image} alt="" className="size-10 rounded-md object-contain" /></button>)}</div>
        </div>}
        {crop !== "mascot" && bot.avatarUrl ? (
          <AvatarFraming bot={bot} disabled={busy} onPatch={onPatch} />
        ) : (
          <div className="flex justify-center py-3">
            <BotAvatar
              bot={bot}
              state={activeState}
              size={112}
              motion={mascotMotion?.kind ?? "none"}
              motionKey={mascotMotion?.nonce ?? 0}
            />
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="sr-only"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            Upload image
          </button>
          {bot.avatarUrl && (
            <button
              type="button"
              onClick={removeImage}
              disabled={busy}
              aria-label="Remove custom avatar image"
              title="Remove custom image"
              className="flex size-10 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-danger disabled:opacity-50"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="mt-1.5 text-[11.5px] text-ink-secondary">PNG, JPEG, GIF, or WebP · up to 10 MB</div>

        {zapLooks && !bot.avatarUrl ? (
          <>
            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Style</div>
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-hairline/40">
              {(["mascot", "dot"] as const).map((option, index) => (
                <button key={option} type="button" disabled={busy} aria-pressed={(look.look ?? "mascot") === option} onClick={() => saveLook({ look: option })}
                  className={cn("py-1.5 text-[12.5px] disabled:opacity-50", index > 0 && "border-l border-hairline/40",
                    (look.look ?? "mascot") === option ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/60 hover:text-ink")}>
                  {option === "mascot" ? "Minimal" : "Liquid"}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
        <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
          Shape
        </div>
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-hairline/40">
          {BOT_AVATAR_CROPS.map((candidate, index) => (
            <button
              key={candidate}
              type="button"
              disabled={busy}
              aria-pressed={crop === candidate}
              onClick={() => onPatch({ avatarCrop: candidate })}
              className={cn(
                "py-1.5 text-[12.5px] disabled:opacity-50",
                index > 0 && "border-l border-hairline/40",
                crop === candidate ? "bg-control text-ink" : "text-ink-secondary hover:bg-control/60 hover:text-ink",
              )}
            >
              {CROP_LABEL[candidate]}
            </button>
          ))}
        </div>

          </>
        )}

        {crop === "mascot" && (
          <>
            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              Expression
            </div>
            <div className="grid grid-cols-5 gap-2">
              {PICKABLE_STATES.map((expression) => (
                <button
                  key={expression}
                  type="button"
                  disabled={busy}
                  aria-pressed={activeState === expression}
                  onClick={() => onPatch({ mascotExpression: expression })}
                  className={cn(
                    "flex h-[58px] items-center justify-center rounded-xl bg-inset transition-colors hover:bg-control disabled:opacity-50",
                    activeState === expression && "ring-2 ring-accent-border",
                  )}
                  title={expression}
                  aria-label={`Use ${expression} expression`}
                >
                  <BotAvatar bot={bot} state={expression} size={42} animated={false} />
                </button>
              ))}
            </div>

            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              Color
            </div>
            <div className="flex flex-wrap gap-2.5">
              {MAUS_COLOR_NAMES.map((color) => (
                <button
                  key={color}
                  type="button"
                  disabled={busy}
                  aria-pressed={bot.color === color && !look.color}
                  onClick={() => { onPatch({ color }); if (look.color) saveLook({ color: null }); }}
                  className={cn(
                    "size-10 rounded-full border-2 border-transparent transition-transform hover:scale-110 disabled:opacity-50",
                    bot.color === color && !look.color && "ring-2 ring-accent-border ring-offset-2 ring-offset-card",
                  )}
                  style={{ backgroundColor: MAUS_COLORS[color] }}
                  title={color}
                  aria-label={`Use ${color} mascot color`}
                />
              ))}
              {zapLooks && ZAP_SWATCHES.map((swatch) => (
                <button key={swatch} type="button" disabled={busy} aria-pressed={look.color === swatch} onClick={() => saveLook({ color: swatch })}
                  className={cn("size-10 rounded-full border-2 border-transparent transition-transform hover:scale-110 disabled:opacity-50",
                    look.color === swatch && "ring-2 ring-accent-border ring-offset-2 ring-offset-card")}
                  style={{ backgroundColor: swatch }} title={swatch} aria-label={`Use ${swatch} colour`} />
              ))}
              {zapLooks && (
                <label title="Custom colour"
                  className={cn("relative flex size-10 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-hairline text-[16px] text-ink-secondary transition-transform hover:scale-110",
                    customColour && "border-solid ring-2 ring-accent-border ring-offset-2 ring-offset-card")}
                  style={customColour ? { backgroundColor: look.color } : undefined}>
                  {!customColour && "+"}
                  <input type="color" aria-label="Custom colour" value={look.color ?? "#C8FF00"} onChange={(event) => saveLook({ color: event.target.value })}
                    className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
              )}
            </div>
            {lookError && <p role="alert" className="mt-1 text-[12px] text-danger">{lookError}</p>}
            {zapLooks && (
              <>
                <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">Face</div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {([["#FFFFFF", "White"], ["#050505", "Black"]] as const).map(([value, name]) => {
                    const chosen = (look.face ?? (look.look === "dot" ? "#050505" : "#FFFFFF")) === value;
                    return (
                      <button key={value} type="button" disabled={busy} aria-pressed={chosen} onClick={() => saveLook({ face: value })}
                        className={cn("flex h-9 items-center gap-2 rounded-full border border-hairline/50 px-3 text-[12.5px] text-ink disabled:opacity-50",
                          chosen && "ring-2 ring-accent-border ring-offset-2 ring-offset-card")}>
                        <span className="size-4 rounded-full border border-hairline/60" style={{ backgroundColor: value }} />{name}
                      </button>
                    );
                  })}
                  <label title="Custom face colour"
                    className={cn("relative flex h-9 cursor-pointer items-center gap-2 overflow-hidden rounded-full border border-dashed border-hairline px-3 text-[12.5px] text-ink-secondary",
                      customFace && "border-solid text-ink ring-2 ring-accent-border ring-offset-2 ring-offset-card")}>
                    <span className="size-4 rounded-full border border-hairline/60" style={{ backgroundColor: customFace ? look.face : "transparent" }} />Custom
                    <input type="color" aria-label="Custom face colour" value={look.face ?? "#FFFFFF"} onChange={(event) => saveLook({ face: event.target.value })}
                      className="absolute inset-0 cursor-pointer opacity-0" />
                  </label>
                </div>
              </>
            )}


            <div className="mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
              Body
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {MASCOT_BODY_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  aria-pressed={(bot.mascotBody ?? "cursor") === id}
                  aria-label={`Use the ${MASCOT_BODIES[id].name} body`}
                  onClick={() => onPatch({ mascotBody: id })}
                  className={cn(
                    "flex items-center justify-center rounded-lg py-1.5 disabled:opacity-50",
                    (bot.mascotBody ?? "cursor") === id
                      ? "bg-control text-ink"
                      : "text-ink-secondary hover:bg-control/60",
                  )}
                >
                  <BotAvatar bot={{ ...bot, mascotBody: id }} size={34} animated={false} trackPointer={false} />
                </button>
              ))}
            </div>
          </>
        )}

        <AvatarImageGenerator
          botLabel={bot.title || bot.name}
          disabled={uploading}
          generating={generating}
          onGenerate={generate}
          onSavingChange={setSavingConnection}
        />

        {error && <div role="alert" className="mt-3 text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
