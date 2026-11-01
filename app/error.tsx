"use client";
import Link from "next/link";

// Last-resort fallback when a page crashes; a reload recovers from stale data or a lost connection.
export default function ErrorPage() {
  return <main className="public-auth"><Link className="origin-wordmark" href="/">Origin</Link><section className="auth-content">
    <h1>Something went wrong.</h1>
    <div className="settings-confirm-actions"><button className="primary-button" onClick={() => window.location.reload()}>Reload</button></div>
  </section></main>;
}
