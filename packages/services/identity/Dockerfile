FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY node_modules ./node_modules
# ⛔ There is deliberately NO `COPY packages/services/identity/node_modules` here, and re-adding one breaks
# the build. npm workspaces hoist to the ROOT `node_modules` (copied above); a workspace gets its own
# directory only when a version conflict blocks hoisting, so its existence was never a property of this
# service. `c90098ff` aligned `@types/node` across workspaces on 2026-08-27, the last conflict vanished,
# `npm ci` stopped creating the directory, and every deploy failed with:
#     ERROR: failed to compute cache key: "/packages/services/identity/node_modules": not found
# It copied nothing either way: the only entries that directory EVER held were `@types/node` and
# `undici-types`, both dev-only, and the pipeline runs `npm prune --omit=dev` BEFORE this build — so the
# line was copying an empty directory. Asserted by
# `packages/infra/global/__tests__/serviceImageWorkspaceModules.test.ts`, which permits the COPY again if
# a runtime dependency is ever genuinely pinned into a workspace.
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
# bare-specifier import (auth/clerkAuth.service AND config/env.schema) crash-loops at boot with
# ERR_MODULE_NOT_FOUND. (food-service already copies it the same way.)
COPY packages/shared/clerk-verify/prod.package.json ./packages/shared/clerk-verify/package.json
COPY packages/shared/clerk-verify/dist ./packages/shared/clerk-verify/dist
# Shared @kitchensink/identity-db (S-I7) — same pattern as identity-utils/clerk-verify above. The
# schema/DAO/ulid code that used to live in this service's own src/database (Nest-coupled path, no
# COPY needed) now resolves via the root node_modules symlink, so its built dist + dist-pointing prod
# manifest must be in the image or the bare-specifier import crash-loops at boot (KTD2a).
COPY packages/shared/identity-db/prod.package.json ./packages/shared/identity-db/package.json
COPY packages/shared/identity-db/dist ./packages/shared/identity-db/dist
# Shared @kitchensink/identity-core — same pattern as identity-db/identity-utils/clerk-verify above. The
# display-name derivation logic resolves via the root node_modules symlink, so its built dist + a
# dist-pointing prod manifest must be in the image or the bare-specifier import crash-loops at boot.
COPY packages/shared/identity-core/prod.package.json ./packages/shared/identity-core/package.json
COPY packages/shared/identity-core/dist ./packages/shared/identity-core/dist
# The GENERATED wire-contract leaf (CODING_STANDARDS §15.2). `main.ts` imports its published CONTRACT_HASH to
# run the drift-layer-3 skew assertion BEFORE anything else, so this is a genuine runtime import on the very
# first line of the boot path: without its dist in the image the process crash-loops before it can report why.
COPY packages/schemas/identity/prod.package.json ./packages/schemas/identity/package.json
COPY packages/schemas/identity/dist ./packages/schemas/identity/dist

# Shared @kitchensink/nest-error-envelope — the ONE Nest->{ code, message, details? } normalization every
# service's ApiExceptionFilter runs (it replaced ~100 lines copied into each of the three). Same pattern as the
# shared leaves above: the root node_modules symlink resolves to this path, so its built dist + dist-pointing
# prod manifest must be in the image or the bare-specifier import from common/filters crash-loops at boot with
# ERR_MODULE_NOT_FOUND -- and it is on the request-failure path, so the first thing it would break is the
# ability to report anything.
COPY packages/shared/nest-error-envelope/prod.package.json ./packages/shared/nest-error-envelope/package.json
COPY packages/shared/nest-error-envelope/dist ./packages/shared/nest-error-envelope/dist

# Shared @kitchensink/db-schema-guard — the boot-time schema-currency check (`main.ts` calls it before
# `listen`), and the one apply engine the migration runner Lambda shares. Same pattern as the shared leaves
# above: the root node_modules symlink resolves to this path, so its built dist + dist-pointing prod manifest
# must be in the image or the bare-specifier import crash-loops at boot.
COPY packages/shared/db-schema-guard/prod.package.json ./packages/shared/db-schema-guard/package.json
COPY packages/shared/db-schema-guard/dist ./packages/shared/db-schema-guard/dist

# ⛔ THIS RELEASE'S ORDERED `.sql`, copied to the place the compiled `schemaCurrency.js` resolves as its
# own SIBLING. This build emits `dist/src/**` (the CMD above runs `dist/src/main.js`), so the compiled module
# and its migrations sit at the same relative offset as the source pair — ONE path is correct both from
# source and inside the image, with no probing and no branch that is only ever exercised in one of the two. Without it the boot check reports
# a packaging fault on every start (and, under `SCHEMA_CURRENCY_MODE=enforce`, refuses).
COPY packages/services/identity/src/database/migrations ./packages/services/identity/dist/src/database/migrations

EXPOSE 3000
# Preload Sentry instrumentation before app modules (native ESM — a top-level import is not a
# reliable ordering guarantee for auto-instrumentation; KTD3 / U6).
CMD ["node", "--import", "./packages/services/identity/dist/src/instrument.js", "packages/services/identity/dist/src/main.js"]
