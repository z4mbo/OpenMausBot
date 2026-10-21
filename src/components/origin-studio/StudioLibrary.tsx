import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2, UserRound, X } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { EmptyState, Field, Loading, Modal, Notice, Segmented, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { StudioMediaPicker } from "./StudioMediaPicker";
import { MediaThumb, type SourceRef } from "./studio-ui";
import {
  STUDIO_CHARACTER_KINDS, STUDIO_CHARACTER_REFERENCES_MAX, studioCharacterLine,
  type StudioCharacter, type StudioCharacterKind, type StudioGeneration,
} from "../../../shared/studio";

/** What the editor starts from: an entry to change, or references for a new one. */
export interface CharacterSeed {
  character?: StudioCharacter;
  references?: SourceRef[];
}

const KIND_LABEL: Record<StudioCharacterKind, string> = { character: "Character", product: "Product", style: "Style" };

function refsOf(character: StudioCharacter): SourceRef[] {
  return character.references.map((reference, index) => ({ kind: "image", label: `${character.name} ${index + 1}`, url: reference.url ?? "", source: { assetId: reference.assetId } }));
}

/** Names a person, product or style and its reference images, which every later generation can follow. */
export function CharacterEditor({ projectId, rows, seed, onSaved, onClose }: {
  projectId: string; rows: readonly StudioGeneration[]; seed: CharacterSeed; onSaved?(id: string): void; onClose(): void;
}) {
  const existing = seed.character;
  const [name, setName] = useState(existing?.name ?? "");
  const [kind, setKind] = useState<StudioCharacterKind>(existing?.kind ?? "character");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [references, setReferences] = useState<SourceRef[]>(existing ? refsOf(existing) : seed.references ?? []);
  const [picking, setPicking] = useState(false);
  const action = useAction();
  const ready = name.trim() && references.length > 0;
  const save = () => {
    if (!ready || action.busy) return;
    void action.run(async () => {
      const id = await cloudMutation<string>("studioLibrary:save", {
        projectId, name, kind, description, ...(existing ? { characterId: existing._id } : {}),
        referenceAssetIds: references.flatMap((ref) => ("assetId" in ref.source ? [ref.source.assetId] : [])),
      });
      onSaved?.(id);
      onClose();
    }, "Could not save to the library");
  };
  return (
    <Modal title={existing ? `Edit ${existing.name}` : "New library entry"} onClose={onClose}>
      <div className="flex flex-col gap-3" onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); } }}>
        <Segmented label="Kind" value={kind} onChange={setKind} options={STUDIO_CHARACTER_KINDS} />
        <Field label="Name">
          <input autoFocus className={inputClass} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder={kind === "style" ? "Neon noir" : kind === "product" ? "Aurora bottle" : "Mia"} />
        </Field>
        <Field label="What stays the same">
          <textarea className={cn(inputClass, "resize-none")} rows={3} maxLength={600} value={description} onChange={(event) => setDescription(event.target.value)}
            placeholder={kind === "style" ? "Palette, light, grain, lens" : kind === "product" ? "Materials, colours, logo placement" : "Face, hair, wardrobe, age"} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink-secondary">References</span>
          <div className="grid grid-cols-4 gap-2" data-library-references>
            {references.map((ref, index) => (
              <div key={JSON.stringify(ref.source)} className="group relative aspect-square overflow-hidden rounded-lg bg-inset">
                <MediaThumb kind="image" url={ref.url} className="size-full" alt={ref.label} />
                <button type="button" aria-label={`Remove ${ref.label}`} onClick={() => setReferences(references.filter((_, other) => other !== index))}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-app/80 text-ink-secondary opacity-0 transition-opacity duration-(--motion-fast) hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100">
                  <X size={12} />
                </button>
              </div>
            ))}
            {references.length < STUDIO_CHARACTER_REFERENCES_MAX && (
              <button type="button" onClick={() => setPicking(true)} aria-label="Add a reference image"
                className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-hairline text-ink-tertiary outline-none transition-colors duration-(--motion-fast) hover:border-accent/60 hover:text-ink focus-visible:border-accent">
                <Plus size={16} />
              </button>
            )}
          </div>
        </div>
        {name.trim() && <p className="text-[12px] leading-snug text-ink-tertiary">Prompts gain: {studioCharacterLine({ name, kind, description })}</p>}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryButton} disabled={!ready || action.busy} onClick={save}>
            {action.busy && <Loader2 size={14} className="animate-spin" />}{existing ? "Save" : "Add to library"}
          </button>
        </div>
      </div>
      {picking && (
        <StudioMediaPicker projectId={projectId} kind="image" rows={rows} assetsOnly title="Choose a reference image" onClose={() => setPicking(false)}
          onPick={(ref) => setReferences((current) => (current.some((other) => JSON.stringify(other.source) === JSON.stringify(ref.source)) ? current : [...current, ref]))} />
      )}
    </Modal>
  );
}

function CharacterCard({ character, canEdit, onUse, onEdit, onRemove }: { character: StudioCharacter; canEdit: boolean; onUse(): void; onEdit(): void; onRemove(): void }) {
  const [cover, ...rest] = character.references;
  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-hairline/40 bg-panel" data-library-entry={character.name}>
      <button type="button" onClick={onUse} disabled={!canEdit} className="relative block aspect-[4/5] w-full overflow-hidden bg-inset text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
        aria-label={`Create with ${character.name}`}>
        <MediaThumb kind="image" url={cover?.url ?? undefined} className="size-full transition-transform duration-(--motion-slow) group-hover:scale-[1.02]" iconSize={22} />
        <span className="absolute left-2 top-2 rounded-full bg-app/80 px-2 py-0.5 text-[11px] text-ink-secondary">{KIND_LABEL[character.kind]}</span>
        {rest.length > 0 && (
          <span className="absolute bottom-2 right-2 flex gap-1">
            {rest.slice(0, 3).map((reference) => <MediaThumb key={reference.assetId} kind="image" url={reference.url ?? undefined} className="size-8 rounded-md ring-1 ring-app/70" />)}
          </span>
        )}
      </button>
      <div className="flex min-w-0 flex-col gap-0.5 p-2.5">
        <h4 className="truncate text-[13.5px] font-medium text-ink">{character.name}</h4>
        <p className="line-clamp-2 min-h-[2lh] text-[12px] leading-snug text-ink-tertiary">{character.description || `${character.references.length} reference ${character.references.length === 1 ? "image" : "images"}`}</p>
      </div>
      {canEdit && (
        <div className="absolute right-1.5 top-1.5 flex gap-px rounded-lg border border-hairline/40 bg-panel/95 p-0.5 opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100">
          <button type="button" className={cn(iconButton, "size-7 rounded-md")} onClick={onEdit} aria-label={`Edit ${character.name}`} title="Edit"><Pencil size={13} /></button>
          <button type="button" className={cn(iconButton, "size-7 rounded-md hover:text-danger")} onClick={onRemove} aria-label={`Delete ${character.name}`} title="Delete"><Trash2 size={13} /></button>
        </div>
      )}
    </article>
  );
}

/** The project's characters, products and styles; picking one sets up the next generation with it. */
export function StudioLibrary({ projectId, canEdit, rows, onUse }: { projectId: string; canEdit: boolean; rows: readonly StudioGeneration[]; onUse(character: StudioCharacter): void }) {
  const library = useCloudQuery<StudioCharacter[]>("studioLibrary:list", { projectId });
  const [editing, setEditing] = useState<CharacterSeed | null>(null);
  const [error, setError] = useState("");
  const remove = (character: StudioCharacter) => {
    if (!window.confirm(`Delete ${character.name} from the library? Its images stay in Assets.`)) return;
    void cloudMutation("studioLibrary:remove", { projectId, characterId: character._id }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  return (
    <div className="flex flex-col gap-3 pb-6" data-studio-library>
      {error && <Notice tone="danger">{error}</Notice>}
      {!library ? <Loading label="Loading the library" variant="grid" /> : !library.length && !canEdit ? (
        <EmptyState icon={<UserRound size={22} />} title="The library is empty" />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-3">
          {canEdit && (
            <button type="button" onClick={() => setEditing({})}
              className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hairline text-[13px] text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:border-accent/60 hover:text-ink focus-visible:border-accent">
              <Plus size={18} />New character, product or style
            </button>
          )}
          {library.map((character) => (
            <CharacterCard key={character._id} character={character} canEdit={canEdit} onUse={() => onUse(character)} onEdit={() => setEditing({ character })} onRemove={() => remove(character)} />
          ))}
        </div>
      )}
      {editing && <CharacterEditor projectId={projectId} rows={rows} seed={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
