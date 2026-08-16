FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY node_modules ./node_modules
COPY packages/services/food-service/node_modules ./packages/services/food-service/node_modules
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
COPY packages/shared/messaging/prod.package.json ./packages/shared/messaging/package.json
COPY packages/shared/messaging/dist ./packages/shared/messaging/dist

EXPOSE 3000

# WORKDIR the food package so the ECS task commands (`node dist/src/main.js`,
# `node dist/src/worker/main.js`, `node dist/src/worker/change-refresh/main.js`) resolve; bare
# @kitchensink/* specifiers still resolve via the copied root node_modules symlinks.
WORKDIR /app/packages/services/food-service

CMD ["node", "dist/src/main.js"]
