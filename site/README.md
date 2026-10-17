# Origin site

origin.imbored.fun: the landing page, sign-in and sign-up, and invite links (`/join/<token>`). A Next.js app
that talks to the Convex backend in `../backend` (types come from `@origin/backend`, calls go to
`NEXT_PUBLIC_CONVEX_URL`). The desktop downloads under `/downloads/` are served by the host, not by this app.

```text
app/            routes: /, /login, /signup, /join/[token]; any other path shows the landing page
components/     the website and the sign-in pages
lib/            Convex API handle, CSP, fonts, metadata
public/         favicon, social image, product images and agent avatars captured from the desktop app
scripts/        test-landing.mjs (browser checks), capture-app.mjs (recaptures public/landing)
Dockerfile      image built by the `origin` compose service on the server
```

The download buttons point at the stable links in `components/brand.tsx` (`/downloads/Origin-Setup.exe`,
`Origin-Mac-AppleSilicon.dmg`, `Origin-Mac-Intel.dmg`), which `scripts/deploy-origin.mjs --downloads` updates.

## Develop and check

Against the local Convex dev deployment (`pnpm dev:backend`), with `site/.env.local` holding
`NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210` and `NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211`:

```sh
pnpm dev:site                      # http://127.0.0.1:3001
pnpm test:site                     # unit tests
pnpm --filter @origin/site build && pnpm --filter @origin/site exec next start -p 3001 -H 127.0.0.1
pnpm --filter @origin/site test:landing    # creates throwaway @example.test accounts; local Convex only
```

## Deploy

`node scripts/deploy-origin.mjs --site` (dry run; add `--execute`) builds a context from HEAD, uploads it to
`/root/origin` on the server, keeps the previous tree as `/root/origin.bak-<release>` and rebuilds the container.
Each rollout uses unique staging and backup paths, preserves the existing `deploy/` operator configuration,
and updates only the `origin` compose service. Other services and Docker images are left alone. Keep operator
configuration outside the archived source tree or under the preserved `deploy/` directory; occupied rollout
paths or conflicting incoming operator configuration stop the rollout before the current site moves.
