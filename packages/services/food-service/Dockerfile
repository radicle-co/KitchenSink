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

EXPOSE 3000

# WORKDIR the food package so the ECS task commands (`node dist/src/main.js`,
# `node dist/src/worker/main.js`, `node dist/src/worker/change-refresh/main.js`) resolve; bare
# @kitchensink/* specifiers still resolve via the copied root node_modules symlinks.
WORKDIR /app/packages/services/food-service

CMD ["node", "dist/src/main.js"]
