FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY node_modules ./node_modules
COPY packages/services/recipe-service/node_modules ./packages/services/recipe-service/node_modules
COPY packages/services/recipe-service/prod.package.json ./packages/services/recipe-service/package.json
COPY packages/services/recipe-service/dist ./packages/services/recipe-service/dist
# Shared @kitchensink runtime deps. The root node_modules symlinks (@kitchensink/recipe-core,
# @kitchensink/food-service-client, @kitchensink/clerk-verify, @kitchensink/schema-recipe) resolve to these
# paths, so each package's built dist + a dist-pointing prod.package.json must exist in the image or the
# bare-specifier imports crash-loop at boot. The committed package.json exports ./src for fresh consumers;
# the image copies prod.package.json (which exports ./dist) over it instead.
#
# @kitchensink/schema-recipe is a RUNTIME dep, not a build-time one: `main.ts` imports its `CONTRACT_HASH`
# for the drift-layer-3 boot assertion (CODING_STANDARDS §15.2.5). Omitting it here would turn a gate that
# refuses to start on contract skew into a container that cannot start AT ALL — the exact failure the
# assertion is supposed to prevent, arriving for the wrong reason.
COPY packages/shared/recipe-core/prod.package.json ./packages/shared/recipe-core/package.json
COPY packages/shared/recipe-core/dist ./packages/shared/recipe-core/dist
COPY packages/clients/food-service/prod.package.json ./packages/clients/food-service/package.json
COPY packages/clients/food-service/dist ./packages/clients/food-service/dist
# TRANSITIVE, and it WILL look redundant — it is not. This service does not import @kitchensink/schema-food
# itself; @kitchensink/food-service-client does, and only since it began reading that package's CONTRACT_HASH
# as a VALUE for the drift-layer-3 skew comparison (CODING_STANDARDS §15.2.5). Before that the import was
# `import type` only, so it erased at compile time and the image never needed the package on disk. The moment it
# became a runtime import, omitting this COPY turned a diagnostic WARNING into `ERR_MODULE_NOT_FOUND` at boot —
# a crash-loop caused by the feature meant to report drift. service-dockerfile-deps.test.ts now walks the
# TRANSITIVE @kitchensink closure precisely so this class cannot return.
COPY packages/schemas/food/prod.package.json ./packages/schemas/food/package.json
COPY packages/schemas/food/dist ./packages/schemas/food/dist
COPY packages/shared/clerk-verify/prod.package.json ./packages/shared/clerk-verify/package.json
COPY packages/shared/clerk-verify/dist ./packages/shared/clerk-verify/dist
COPY packages/shared/identity-core/prod.package.json ./packages/shared/identity-core/package.json
COPY packages/shared/identity-core/dist ./packages/shared/identity-core/dist
COPY packages/schemas/recipe/prod.package.json ./packages/schemas/recipe/package.json
COPY packages/schemas/recipe/dist ./packages/schemas/recipe/dist

# Shared @kitchensink/nest-error-envelope — the ONE Nest->{ code, message, details? } normalization every
# service's ApiExceptionFilter runs (it replaced ~100 lines copied into each of the three). Same pattern as the
# shared leaves above: the root node_modules symlink resolves to this path, so its built dist + dist-pointing
# prod manifest must be in the image or the bare-specifier import from common/filters crash-loops at boot with
# ERR_MODULE_NOT_FOUND -- and it is on the request-failure path, so the first thing it would break is the
# ability to report anything.
COPY packages/shared/nest-error-envelope/prod.package.json ./packages/shared/nest-error-envelope/package.json
COPY packages/shared/nest-error-envelope/dist ./packages/shared/nest-error-envelope/dist

EXPOSE 3000

# WORKDIR the recipe package so the ECS task command (`node dist/src/main.js`) resolves; bare
# @kitchensink/* specifiers still resolve via the copied root node_modules symlinks.
WORKDIR /app/packages/services/recipe-service

CMD ["node", "dist/src/main.js"]
