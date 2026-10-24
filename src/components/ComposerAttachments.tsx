import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClipboardPaste, File as FileIcon, LoaderCircle, MessageSquareText, X } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  attachmentImageUrl,
  intakeFiles,
  formatSize,
  type Attachment,
  type PasteAttachment,
} from "@/lib/composer-attachments";
import { AttachmentPreviewDialog, previewImage, type PreviewImage } from "./AttachmentPreview";
import { CitationBadge } from "./CitationUI";
import type { CitationAttachment } from "@/lib/citations";

/** Electron 32 removed File.path — only the preload can name a file. */
export function pathForFile(file: File): string {
  return window.ogb?.getPathForFile?.(file) ?? "";
}

export function ComposerAttachments({
  items,
  onAdd,
  onRemove,
  onChangeCitation,
  onDisplayInChatBox,
  allowImages = true,
  notice,
  onNotice,
  onPendingChange,
  uploadImage,
}: {
  items: Attachment[];
  onAdd: (attachments: Attachment[]) => void;
  onRemove: (id: string) => void;
  onChangeCitation: (citation: CitationAttachment) => void;
  onDisplayInChatBox: (attachment: PasteAttachment) => void;
  allowImages?: boolean;
  notice: string | null;
  onNotice: (notice: string | null) => void;
  onPendingChange?: (pending: boolean) => void;
  uploadImage: (file: File) => Promise<Attachment | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  // dragenter/dragleave fire once per element crossed, so the overlay tracks depth.
  const depth = useRef(0);
  const callbacks = useRef({ onAdd, onNotice, onPendingChange, allowImages, uploadImage });
  callbacks.current = { onAdd, onNotice, onPendingChange, allowImages, uploadImage };
  const pendingDrops = useRef(new Set<symbol>());

  useEffect(() => {
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    // Without preventDefault the window navigates to the dropped file.
    const onOver = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const operation = Symbol("attachment-drop");
      pendingDrops.current.add(operation);
      callbacks.current.onPendingChange?.(true);
      try {
        const { attachments, notice: message } = await intakeFiles(files, {
          allowImages: callbacks.current.allowImages,
          getPath: pathForFile,
          uploadImage: callbacks.current.uploadImage,
        });
        if (attachments.length) callbacks.current.onAdd(attachments);
        if (message) callbacks.current.onNotice(message);
      } finally {
        if (pendingDrops.current.delete(operation)) callbacks.current.onPendingChange?.(false);
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <>
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-10">
          <div className="rounded-2xl border-2 border-dashed border-accent/70 bg-panel/90 px-8 py-6 text-[14px] font-medium text-ink">
            {t("composer.attachments.drop")}
          </div>
        </div>
      )}

      {notice && (
        <div role="status" className="mx-2 mt-2 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => onNotice(null)} aria-label={t("composer.attachments.dismissNotice")} className="shrink-0 rounded p-0.5 hover:bg-warning/10">
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div data-composer-attachments className="flex flex-wrap items-center gap-2 px-3.5 pt-3">
          {items.map((a) =>
            a.kind === "citation" ? (
              <CitationBadge
                key={a.id}
                citation={a}
                onChange={onChangeCitation}
                onRemove={() => onRemove(a.id)}
              />
            ) : a.kind === "image" ? (
              <div key={a.id} title={a.name} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    const image = previewImage(a.path, a.name);
                    const src = image?.src ?? a.previewUrl;
                    if (src) setPreview(image ?? { src, name: a.name });
                  }}
                  disabled={!attachmentImageUrl(a.path) && !a.previewUrl}
                  aria-busy={a.uploading || undefined}
                  aria-label={t("composer.attachments.preview", { name: a.name })}
                  className="relative flex size-12 items-center justify-center overflow-hidden rounded-xl border border-hairline/50 bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default"
                >
                  <img
                    src={attachmentImageUrl(a.path) ?? a.previewUrl}
                    alt=""
                    loading="eager"
                    fetchPriority="high"
                    className="size-full object-cover"
                  />
                  {a.uploading && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                      <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                      <span className="sr-only">{t("composer.attachments.uploading")}</span>
                    </span>
                  )}
                </button>
                <RemoveChip label={t("composer.attachments.remove", { name: a.name })} onRemove={() => onRemove(a.id)} />
              </div>
            ) : a.kind === "paste" ? (
              <Chip
                key={a.id}
                icon={ClipboardPaste}
                name={firstLine(a.text) || t("composer.attachments.pasted")}
                meta={t("composer.attachments.pasteMeta", { lines: a.lines, size: formatSize(a.size) })}
                title={a.text.slice(0, 4000)}
                removeLabel={t("composer.attachments.removePaste")}
                onRemove={() => onRemove(a.id)}
                action={
                  <button
                    type="button"
                    onClick={() => onDisplayInChatBox(a)}
                    aria-label={t("composer.attachments.showInBoxAria")}
                    title={t("composer.attachments.showInBox")}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <MessageSquareText size={14} aria-hidden="true" />
                  </button>
                }
              />
            ) : (
              <Chip
                key={a.id}
                icon={FileIcon}
                name={a.name}
                meta={formatSize(a.size)}
                title={a.path}
                removeLabel={t("composer.attachments.remove", { name: a.name })}
                onRemove={() => onRemove(a.id)}
              />
            ),
          )}
        </div>
      )}
      {preview && <AttachmentPreviewDialog image={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0] ?? "";
}

function Chip({
  icon: Icon,
  name,
  meta,
  title,
  removeLabel,
  onRemove,
  action,
}: {
  icon: typeof FileIcon;
  name: string;
  meta: string;
  title: string;
  removeLabel: string;
  onRemove: () => void;
  action?: ReactNode;
}) {
  return (
    <div title={title} className="group relative flex h-12 min-w-0 max-w-[15rem] items-center gap-2.5 rounded-xl border border-hairline/50 bg-inset/60 py-1.5 pl-1.5 pr-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-control text-ink-secondary">
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-[13px] leading-5 text-ink">{name}</span>
        <span className="block truncate text-[11px] leading-4 text-ink-tertiary">{meta}</span>
      </span>
      {action}
      <RemoveChip label={removeLabel} onRemove={onRemove} />
    </div>
  );
}

function RemoveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={label}
      title={label}
      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-hairline/60 bg-panel text-ink-secondary opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100"
    >
      <X size={11} aria-hidden="true" />
    </button>
  );
}
