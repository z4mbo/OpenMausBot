import { createContext, memo, useContext, type ReactNode } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatUrlTransform } from "../ChatMarkdown";

type Props = { children?: ReactNode } & ExtraProps;

/** The source line of the task item being rendered, so its checkbox toggles that line. */
const TaskLine = createContext<number | null>(null);
const Toggle = createContext<((line: number) => void) | null>(null);

function TaskBox({ checked }: { checked?: boolean }) {
  const line = useContext(TaskLine);
  const toggle = useContext(Toggle);
  return (
    <input type="checkbox" checked={Boolean(checked)} disabled={!toggle || line === null} onChange={() => { if (line !== null) toggle?.(line); }}
      aria-label={checked ? "Mark not done" : "Mark done"}
      className="me-2 size-4 translate-y-[3px] cursor-pointer rounded accent-[var(--color-accent)] disabled:cursor-default" />
  );
}

const COMPONENTS: Components = {
  h1: ({ children }: Props) => <h1 className="mt-6 text-[22px] font-semibold tracking-[-0.01em] text-ink first:mt-0">{children}</h1>,
  h2: ({ children }: Props) => <h2 className="mt-6 border-b border-hairline/40 pb-1.5 text-[17px] font-semibold text-ink first:mt-0">{children}</h2>,
  h3: ({ children }: Props) => <h3 className="mt-4 text-[15px] font-semibold text-ink">{children}</h3>,
  h4: ({ children }: Props) => <h4 className="mt-3 text-[14px] font-semibold text-ink-secondary">{children}</h4>,
  p: ({ children }: Props) => <p className="mt-2 leading-relaxed">{children}</p>,
  ul: ({ children, className }: Props & { className?: string }) =>
    <ul className={className?.includes("contains-task-list") ? "mt-2 space-y-1 ps-1" : "mt-2 list-disc space-y-1 ps-5"}>{children}</ul>,
  ol: ({ children }: Props) => <ol className="mt-2 list-decimal space-y-1 ps-5">{children}</ol>,
  li({ children, node, className }: Props & { className?: string }) {
    if (!className?.includes("task-list-item")) return <li className="leading-relaxed">{children}</li>;
    const line = node?.position ? node.position.start.line - 1 : null;
    return <li className="list-none leading-relaxed"><TaskLine.Provider value={line}>{children}</TaskLine.Provider></li>;
  },
  input: ({ checked, type }: { checked?: boolean; type?: string }) => type === "checkbox" ? <TaskBox checked={checked} /> : null,
  a: ({ children, href }: Props & { href?: string }) =>
    <a href={href} target="_blank" rel="noreferrer" className="break-words text-accent-text underline decoration-accent/40 hover:decoration-accent">{children}</a>,
  blockquote: ({ children }: Props) => <blockquote className="mt-2 border-s-2 border-hairline ps-3 text-ink-secondary">{children}</blockquote>,
  hr: () => <hr className="my-5 border-hairline/40" />,
  code: ({ children }: Props) => <code className="ui-code-chip break-words">{children}</code>,
  pre: ({ children }: Props) => <pre className="mt-2 overflow-x-auto rounded-lg bg-inset p-3 text-[12.5px] [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  table: ({ children }: Props) => <div className="mt-2 overflow-x-auto"><table className="w-full border-collapse text-[13px]">{children}</table></div>,
  th: ({ children }: Props) => <th className="border-b border-hairline/40 px-2 py-1.5 text-start font-semibold">{children}</th>,
  td: ({ children }: Props) => <td className="border-b border-hairline/20 px-2 py-1.5 align-top">{children}</td>,
};

/** A project document rendered for reading; with `onToggle`, its task items are checkboxes that edit the source. */
export const DocMarkdown = memo(function DocMarkdown({ text, onToggle }: { text: string; onToggle?(line: number): void }) {
  return (
    <div className="min-w-0 text-[14px] text-ink [overflow-wrap:anywhere]" data-doc-markdown>
      <Toggle.Provider value={onToggle ?? null}>
        <Markdown remarkPlugins={[remarkGfm]} urlTransform={chatUrlTransform} components={COMPONENTS}>{text}</Markdown>
      </Toggle.Provider>
    </div>
  );
});
