FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY node_modules ./node_modules
COPY packages/services/identity/node_modules ./packages/services/identity/node_modules
COPY packages/services/identity/prod.package.json ./packages/services/identity/package.json
COPY packages/services/identity/dist ./packages/services/identity/dist
# Shared @kitchensink/identity-utils — the root node_modules symlink resolves to this path; its built
# dist + dist-pointing manifest must exist or the bare-specifier import crash-loops at boot (KTD2a).
# The dev package.json exports ./src (so consumers typecheck/test/bundle against source without a prior
# build, like identity-service does); the runtime needs the prod manifest's ./dist exports instead.
COPY packages/utils/identity/prod.package.json ./packages/utils/identity/package.json
COPY packages/utils/identity/dist ./packages/utils/identity/dist
# Shared @kitchensink/clerk-verify — same pattern as identity-utils above. The root node_modules symlink
# resolves to this path, so its built dist + dist-pointing prod manifest must be in the image, or the
# bare-specifier import (auth/clerk-auth.service AND config/env.schema) crash-loops at boot with
# ERR_MODULE_NOT_FOUND. (food-service already copies it the same way.)
COPY packages/shared/clerk-verify/prod.package.json ./packages/shared/clerk-verify/package.json
COPY packages/shared/clerk-verify/dist ./packages/shared/clerk-verify/dist
# Shared @kitchensink/identity-db (S-I7) — same pattern as identity-utils/clerk-verify above. The
# schema/DAO/ulid code that used to live in this service's own src/database (Nest-coupled path, no
# COPY needed) now resolves via the root node_modules symlink, so its built dist + dist-pointing prod
# manifest must be in the image or the bare-specifier import crash-loops at boot (KTD2a).
COPY packages/shared/identity-db/prod.package.json ./packages/shared/identity-db/package.json
COPY packages/shared/identity-db/dist ./packages/shared/identity-db/dist

EXPOSE 3000
# Preload Sentry instrumentation before app modules (native ESM — a top-level import is not a
# reliable ordering guarantee for auto-instrumentation; KTD3 / U6).
CMD ["node", "--import", "./packages/services/identity/dist/src/instrument.js", "packages/services/identity/dist/src/main.js"]
