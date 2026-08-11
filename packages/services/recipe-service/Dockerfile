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
COPY packages/shared/clerk-verify/prod.package.json ./packages/shared/clerk-verify/package.json
COPY packages/shared/clerk-verify/dist ./packages/shared/clerk-verify/dist
COPY packages/shared/identity-core/prod.package.json ./packages/shared/identity-core/package.json
COPY packages/shared/identity-core/dist ./packages/shared/identity-core/dist
COPY packages/schemas/recipe/prod.package.json ./packages/schemas/recipe/package.json
COPY packages/schemas/recipe/dist ./packages/schemas/recipe/dist

EXPOSE 3000

# WORKDIR the recipe package so the ECS task command (`node dist/src/main.js`) resolves; bare
# @kitchensink/* specifiers still resolve via the copied root node_modules symlinks.
WORKDIR /app/packages/services/recipe-service

CMD ["node", "dist/src/main.js"]
