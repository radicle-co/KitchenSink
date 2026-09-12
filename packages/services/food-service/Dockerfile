# ⛔ STAGE 1 — food's PRODUCTION DEPENDENCY CLOSURE, and nothing else.
#
# This image used to `COPY node_modules ./node_modules` from the build context: the host's tree, which on
# the sandbox path is the FULL DEV install (only `prod-deploy.yml` prunes). npm workspaces hoist to the
# root, so that single COPY shipped every workspace's dependencies — Next.js, Expo, React Native,
# `expo-modules-core`, and ADR-0025's 94 MB Python CRF parser — into a NestJS service that can execute none
# of them. Measured: 2.1 GB of prod closure against 449 MB for food's own, and the dev tree is larger still.
#
# `turbo prune --docker` emits a skeleton containing only the 21 workspaces food's graph reaches plus a
# pruned lockfile, and `npm ci` runs HERE rather than on the host. That ordering is deliberate: the deploy
# job runs `cdk deploy` AFTER this build and needs `aws-cdk-lib`, so pruning the host tree in place would
# break the very next step — the failure `prod-deploy.yml` records as "building after the prune exits 127".
#
# The install layer is keyed on the pruned lockfile's content, so BuildKit reuses it across builds whenever
# food's dependency closure has not changed, instead of re-uploading a fresh 500 MB layer every deploy.
FROM node:24-slim AS deps

WORKDIR /app

# The skeleton is package.json files only — no sources — so this layer is invalidated by a dependency
# change and by nothing else.
COPY .docker-prune/food/json/ ./
COPY .docker-prune/food/package-lock.json ./package-lock.json

# ⚠️ `--ignore-scripts`: nothing in food's runtime closure needs a postinstall, and running arbitrary
# install scripts in an image build is a supply-chain surface this does not need to open.
RUN npm ci --omit=dev --ignore-scripts

# ⛔ NOTHING IS DELETED FROM THE INSTALLED TREE HERE, AND NOTHING SHOULD BE. This build used to end with
# `rm -rf node_modules/aws-cdk-lib node_modules/aws-cdk node_modules/constructs …`, which treated a
# dependency-declaration problem as a housekeeping problem: the packages were in the image because they were
# declared as production dependencies, and the honest fix is to declare them correctly.
#
# They now are. `aws-cdk-lib` and `constructs` belong to the `infra/` package that owns each CDK app, which
# installs outside the npm workspace; the CDK CLI is a devDependency of those same packages. The root
# manifest declares NO production dependencies at all, so `npm ci --omit=dev` above simply does not fetch
# them — measured against a real `turbo prune --docker` install, not assumed.
#
# ⚠️ If something unwanted appears in this tree again, fix where it is DECLARED. A deletion here is invisible
# to every other image, silently diverges from what the lockfile says shipped, and — as the removed list
# showed — outlives the reason it was added.

# ── The runtime image ──────────────────────────────────────────────────────────────────────────────────
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ⚠️ The workspace symlinks inside this tree (`@kitchensink/* -> ../../packages/…`) resolve against the
# `packages/**` paths the COPYs below create. Links to workspaces food does not import at runtime dangle,
# harmlessly — nothing resolves them, and `serviceImageWorkspaceModules.test.ts` asserts every specifier
# food's shipped graph DOES reach has a real target.
COPY --from=deps /app/node_modules ./node_modules
# ⛔ There is deliberately NO `COPY packages/services/food-service/node_modules` here, and re-adding one breaks
# the build. npm workspaces hoist to the ROOT `node_modules` (copied above); a workspace gets its own
# directory only when a version conflict blocks hoisting, so its existence was never a property of this
# service. `c90098ff` aligned `@types/node` across workspaces on 2026-08-27, the last conflict vanished,
# `npm ci` stopped creating the directory, and every deploy failed with:
#     ERROR: failed to compute cache key: "/packages/services/food-service/node_modules": not found
# It copied nothing either way: the only entries that directory EVER held were `@types/node` and
# `undici-types`, both dev-only, and the pipeline runs `npm prune --omit=dev` BEFORE this build — so the
# line was copying an empty directory. Asserted by
# `packages/infra/global/__tests__/serviceImageWorkspaceModules.test.ts`, which permits the COPY again if
# a runtime dependency is ever genuinely pinned into a workspace.
COPY packages/services/food-service/prod.package.json ./packages/services/food-service/package.json
COPY packages/services/food-service/dist ./packages/services/food-service/dist
# Shared @kitchensink runtime deps. The root node_modules symlinks (@kitchensink/clerk-verify,
# @kitchensink/usda-client, @kitchensink/recipe-core) resolve to these paths, so each package's built
# dist + a dist-pointing prod.package.json must exist in the image or the bare-specifier imports
# crash-loop at boot. The committed package.json exports ./src for fresh consumers; the image copies
# prod.package.json (which exports ./dist) over it instead.
COPY packages/shared/clerk-verify/prod.package.json ./packages/shared/clerk-verify/package.json
COPY packages/shared/clerk-verify/dist ./packages/shared/clerk-verify/dist
COPY packages/clients/usda/prod.package.json ./packages/clients/usda/package.json
COPY packages/clients/usda/dist ./packages/clients/usda/dist
# recipe-core carries the shared service-erasure token contract (CR-002 U4b) that the food internal
# erasure route verifies against — a runtime import, so its dist must ship in the image.
COPY packages/shared/recipe-core/prod.package.json ./packages/shared/recipe-core/package.json
COPY packages/shared/recipe-core/dist ./packages/shared/recipe-core/dist
# The GENERATED wire-contract leaf (CODING_STANDARDS §15.2). `main.ts` imports its published CONTRACT_HASH to
# run the drift-layer-3 skew assertion BEFORE anything else, so this is a genuine runtime import on the very
# first line of the boot path: without its dist in the image the process crash-loops before it can report why.
COPY packages/schemas/food/prod.package.json ./packages/schemas/food/package.json
COPY packages/schemas/food/dist ./packages/schemas/food/dist
# Shared @kitchensink/nest-error-envelope — the ONE Nest->{ code, message, details? } normalization every
# service's ApiExceptionFilter runs (it replaced ~100 lines copied into each of the three). Same pattern as the
# shared leaves above: the root node_modules symlink resolves to this path, so its built dist + dist-pointing
# prod manifest must be in the image or the bare-specifier import from common/filters crash-loops at boot with
# ERR_MODULE_NOT_FOUND -- and it is on the request-failure path, so the first thing it would break is the
# ability to report anything.
COPY packages/shared/nest-error-envelope/prod.package.json ./packages/shared/nest-error-envelope/package.json
COPY packages/shared/nest-error-envelope/dist ./packages/shared/nest-error-envelope/dist

# Shared @kitchensink/rds-iam-auth — the ONE RDS-IAM pool config (signer, per-connection token function, TLS)
# every service's pool is built from. Same pattern as the shared leaves above: the root node_modules symlink
# resolves here, so without its built dist + dist-pointing prod manifest the database module crash-loops at
# boot with ERR_MODULE_NOT_FOUND before a single connection is attempted.
COPY packages/shared/rds-iam-auth/prod.package.json ./packages/shared/rds-iam-auth/package.json
COPY packages/shared/rds-iam-auth/dist ./packages/shared/rds-iam-auth/dist
COPY packages/shared/messaging/prod.package.json ./packages/shared/messaging/package.json
COPY packages/shared/messaging/dist ./packages/shared/messaging/dist

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
COPY packages/services/food-service/src/db/migrations ./packages/services/food-service/dist/src/db/migrations

EXPOSE 3000

# WORKDIR the food package so the ECS task commands (`node dist/src/main.js`,
# `node dist/src/worker/main.js`, `node dist/src/worker/change-refresh/main.js`) resolve; bare
# @kitchensink/* specifiers still resolve via the copied root node_modules symlinks.
WORKDIR /app/packages/services/food-service

CMD ["node", "dist/src/main.js"]
