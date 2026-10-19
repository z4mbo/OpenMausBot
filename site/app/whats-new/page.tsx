import type { Metadata } from "next";
import { releases } from "../../../shared/origin-releases";
import { SiteFrame } from "@/components/origin-site";
import st from "@/components/site.module.css";

export const metadata: Metadata = { title: "What's new | Origin" };

export default function WhatsNewPage() {
  return (
    <SiteFrame>
      <main id="main" className={st.releaseHistory}>
        <h1>What's new</h1>
        <p className={st.releaseIntro}>Release notes for the Origin desktop app.</p>
        {releases.map(release => (
          <article key={release.version} className={st.releaseEntry}>
            <p className={st.releaseMeta}><span>v{release.version}</span><time dateTime={release.date}>{release.date}</time></p>
            <h2>{release.title}</h2>
            <ul>{release.changes.map(change => <li key={change.title}><h3>{change.title}</h3><p>{change.body}</p></li>)}</ul>
          </article>
        ))}
      </main>
    </SiteFrame>
  );
}
