export function DropGap({ height }: { height: number }) {
  return <span aria-hidden="true" data-drop-gap className="block rounded-xl border-2 border-dashed border-accent/45 bg-accent/[0.06] motion-safe:animate-[pop-in_var(--motion-base)_var(--ease-out)]" style={{ height }} />;
}
