# syntax=docker/dockerfile:1
# Deferred portability (ADR-0001 / U3): builds the Next.js standalone server so the web app can run
# on ECS/Fargate when we leave Vercel. NOT deployed by the sandbox-path-routing plan — it exists so
# the migration is a config change, not a rebuild. Validated at migration time.
FROM node:24-slim AS builder
WORKDIR /repo
COPY . .
RUN npm ci
# Per-PR previews bake their own basePath; pass it as a build arg off-Vercel (on Vercel it derives
# from VERCEL_GIT_PULL_REQUEST_ID). Empty → a production-style (no-prefix) image.
ARG PREVIEW_BASE_PATH=""
ENV PREVIEW_BASE_PATH=${PREVIEW_BASE_PATH}
RUN npx turbo run build --filter=@commise/web

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# `output: 'standalone'` + `outputFileTracingRoot` = the repo root, so the standalone bundle mirrors
# the monorepo layout. The minimal server does not copy static/public — do it explicitly.
COPY --from=builder /repo/packages/apps/commise/web/.next/standalone ./
COPY --from=builder /repo/packages/apps/commise/web/.next/static ./packages/apps/commise/web/.next/static
COPY --from=builder /repo/packages/apps/commise/web/public ./packages/apps/commise/web/public
EXPOSE 3000
CMD ["node", "packages/apps/commise/web/server.js"]
