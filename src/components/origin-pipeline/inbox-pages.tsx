import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import type { InboxFolder, InboxPage, InboxThread } from "../../../shared/origin-sales";

type PageKey = `${InboxFolder}:${string}`;

function PageQuery({ projectId, folder, cursor, onPage }: { projectId: string; folder: InboxFolder; cursor: string | null; onPage(key: PageKey, page: InboxPage): void }) {
  const page = useCloudQuery<InboxPage>("pipelineInbox:page", { projectId, folder, cursor });
  useEffect(() => { if (page) onPage(`${folder}:${cursor ?? ""}`, page); }, [page, folder, cursor, onPage]);
  return null;
}

export interface InboxPages {
  threads: InboxThread[] | null;
  isDone: boolean;
  loadMore(): void;
  queries: ReactNode;
}

export function useInboxPages(projectId: string, folder: InboxFolder): InboxPages {
  const [cursors, setCursors] = useState<Record<InboxFolder, (string | null)[]>>({ open: [null], snoozed: [null], archived: [null] });
  const [pages, setPages] = useState<ReadonlyMap<PageKey, InboxPage>>(new Map());
  const indexing = useRef(false);
  const onPage = useCallback((key: PageKey, page: InboxPage) => setPages((current) => new Map(current).set(key, page)), []);
  const mine = cursors[folder];
  const loaded = mine.map((cursor) => pages.get(`${folder}:${cursor ?? ""}`));
  const first = loaded[0];
  const last = loaded[loaded.length - 1];

  useEffect(() => {
    if (!first || first.indexed || indexing.current) return;
    indexing.current = true;
    void (async () => {
      let cursor: string | null = null;
      for (let round = 0; round < 200; round++) {
        const step: { done: boolean; cursor: string } = await cloudMutation("pipelineInbox:index", { projectId, cursor });
        if (step.done) break;
        cursor = step.cursor;
      }
    })().catch(() => undefined).finally(() => { indexing.current = false; });
  }, [first, projectId]);

  let threads: InboxThread[] | null = null;
  if (first) {
    const seen = new Map<string, InboxThread>();
    for (const page of loaded) for (const row of page?.threads ?? []) if (!seen.has(row.leadId)) seen.set(row.leadId, row);
    threads = [...seen.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  const next = last && !last.isDone && last.cursor ? last.cursor : null;
  const loadMore = useCallback(() => {
    if (next) setCursors((current) => (current[folder].includes(next) ? current : { ...current, [folder]: [...current[folder], next] }));
  }, [next, folder]);

  return {
    threads, isDone: !next, loadMore,
    queries: mine.map((cursor) => <PageQuery key={`${folder}:${cursor ?? ""}`} projectId={projectId} folder={folder} cursor={cursor} onPage={onPage} />),
  };
}
