import { useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ModalFocusScope, useModalDialog } from "@/hooks/use-modal-dialog";

import {
  APP_NAME,
  APP_REPOSITORY,
  DOCS_URL,
  LICENSE_URL,
  RELEASES_URL,
  appVersion,
  openExternalLink,
  platformLabel,
} from "@/lib/app-links";

export function AboutDialog({ open, onClose, returnFocusRef }: { open: boolean; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { dismiss } = useModalDialog(panelRef, onClose, { open, initialFocusRef: closeRef, returnFocusRef });

  if (!open) return null;

  const platform = platformLabel(window.ogb?.platform);

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onMouseDown={(event) => event.target === event.currentTarget && dismiss()}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        className="w-full max-w-[360px] rounded-2xl border border-hairline/50 bg-panel p-6 text-center shadow-2xl"
      >
        <img src="/app-icon.svg" alt="" width={56} height={56} className="mx-auto size-14" />
        <h2 id="about-dialog-title" className="mt-3 text-[17px] font-semibold text-ink">
          {APP_NAME}
        </h2>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Version {appVersion()}
          {platform ? ` · ${platform}` : ""}
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">
          An open-source desktop home for your agents. Apache 2.0 licensed.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[13px]">
          <AboutLink href={APP_REPOSITORY} label="GitHub" />
          <AboutLink href={DOCS_URL} label="Docs" />
          <AboutLink href={RELEASES_URL} label="Releases" />
          <AboutLink href={LICENSE_URL} label="License" />
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={dismiss}
          className="mt-5 w-full rounded-xl bg-raised px-4 py-2 text-[13px] font-medium text-ink hover:brightness-110"
        >
          Close
        </button>
      </div>
    </div>
  );
  const content = <ModalFocusScope panelRef={panelRef}>{dialog}</ModalFocusScope>;
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function AboutLink({ href, label }: { href: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void openExternalLink(href)}
      className="text-accent hover:underline"
    >
      {label}
    </button>
  );
}
