import type { ReactNode } from "react";
import { ArrowRight, Cloud, FolderGit2, KeyRound, Laptop, MonitorSmartphone, Server } from "lucide-react";
import { useStore, type AppSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { cardClass } from "../origin-pages/ui";

type Place = { icon: ReactNode; title: string; body: string; settings: { section: AppSettingsSection; label: LocaleKey }[] };

const PLACES: readonly Place[] = [
  {
    icon: <Laptop size={16} />,
    title: "Your own computer",
    body: "The default. Origin runs on your machine and its bots use your files, apps and browser there, asking before risky actions. A bot can also get a local VM instead of your real desktop.",
    settings: [{ section: "computer", label: "settings.section.computer" }],
  },
  {
    icon: <MonitorSmartphone size={16} />,
    title: "A teammate's computer",
    body: "Pair your app as a client of a teammate's Origin. Their app stays the host, so the bots, keys and computers are theirs and run on their machine; you drive them from yours. Lending folders or a screen to someone else's server is off by default.",
    settings: [{ section: "companion", label: "settings.section.companion" }, { section: "desktopWorkspaces", label: "settings.section.desktopWorkspaces" }],
  },
  {
    icon: <Cloud size={16} />,
    title: "A cloud computer or your own server",
    body: "Give a bot an isolated Linux desktop: a cloud computer on your own Boat key, or a container on a Linux VPS you own, reached over an SSH alias. The agent itself still runs in your app.",
    settings: [{ section: "connections", label: "settings.section.connections" }],
  },
  {
    icon: <KeyRound size={16} />,
    title: "Models from API keys",
    body: "Bots can think with a signed-in provider CLI or with an API key (OpenRouter, OpenAI, Anthropic and others). Each member brings their own sign-ins and keys; workspace membership does not share them.",
    settings: [{ section: "engines", label: "settings.section.engines" }, { section: "connections", label: "settings.section.connections" }],
  },
];

export function RuntimeHelp({ className }: { className?: string }) {
  const { dispatch } = useStore();
  const open = (section: AppSettingsSection) => dispatch({ type: "toggleAppSettings", open: true, section });
  return (
    <section className={cn(cardClass, "p-4", className)} aria-label="Where bots run">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><Server size={14} aria-hidden="true" />Where a member's bots run</h3>
      <p className="mt-1 text-[13px] text-ink-secondary">
        Joining a workspace shares its projects, issues and people. It does not give anyone a computer: every member runs bots from their own Origin app, in one of these places.
      </p>
      <ul className="mt-3 space-y-2">
        {PLACES.map((place) => (
          <li key={place.title} className="flex gap-3 rounded-xl bg-raised/50 p-3">
            <span className="mt-0.5 text-ink-secondary" aria-hidden="true">{place.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{place.title}</p>
              <p className="text-[12.5px] text-ink-secondary">{place.body}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {place.settings.map(({ section, label }) => (
                  <button key={section} type="button" onClick={() => open(section)}
                    className="inline-flex items-center gap-1 rounded-md bg-inset px-2 py-0.5 text-[12px] text-ink-secondary hover:text-ink">
                    {t(label)}<ArrowRight size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex gap-2 rounded-xl bg-inset px-3 py-2.5 text-[12.5px] text-ink-secondary">
        <FolderGit2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        Local development happens on the member's own machine: they need the repository cloned and the project's files there before their bots can build or run it. Origin syncs issues and people, not working copies.
      </p>
    </section>
  );
}
