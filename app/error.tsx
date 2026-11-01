"use client";

// Last-resort fallback when a page crashes; a reload recovers from stale data or a lost connection.
export default function ErrorPage() {
  return <main className="public-auth status-page"><section className="auth-content">
    <h1>Something went wrong</h1>
    <button className="primary-button" onClick={() => window.location.reload()}>Reload</button>
  </section></main>;
}
