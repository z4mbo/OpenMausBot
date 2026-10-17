# Build context: the tree scripts/deploy-origin.mjs stages (a workspace of backend/ and site/ with a pruned
# lockfile), uploaded to /root/origin and built by the `origin` service of /root/multi-ghost/docker-compose.yml.
FROM node:24-alpine

WORKDIR /app
RUN npm install -g pnpm@10.33.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY site/package.json site/
RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_CONVEX_SITE_URL
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL
ENV NEXT_PUBLIC_CONVEX_SITE_URL=$NEXT_PUBLIC_CONVEX_SITE_URL
ENV NODE_ENV=production

COPY backend/convex backend/convex
COPY backend/lib backend/lib
COPY site site
RUN pnpm --filter @origin/site build

WORKDIR /app/site
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
