import Link from "next/link";

export default function NotFound() {
  return <main className="public-auth status-page"><section className="auth-content">
    <span className="status-code">404</span>
    <h1>Page not found</h1>
    <Link className="primary-button" href="/">Go to Origin</Link>
  </section></main>;
}
