# `@kitchensink/schema-food`

**GENERATED PACKAGE — DO NOT EDIT `src/`, `openapi.yaml` OR `contract.schema.json` BY HAND.**

> ⚠️ Despite every `food_*` name, this is the **INGREDIENT** contract. The service's data comes from the USDA and
> it holds ingredients, not dishes. A recipe is never written back into it — a recipe is a method, not a
> substance (feature 001, T150). Read every identifier as `ingredient_*`; do not rename them.

The food API's wire contract is **authored as zod** in the food service, co-located with the controller each
schema serves:

```
packages/services/food-service/src/**/*.schema.ts   ← THE SOURCE OF TRUTH (hand-authored)
        │  npm run contract:generate --workspace=@kitchensink/food-service
        ▼
packages/schemas/food/                              ← this package (generated, committed)
        ▼
packages/clients/food-service  →  the recipe service, and any future consumer
```

## Why a copy rather than a re-export

A re-export would make this package depend on `@kitchensink/food-service`, dragging NestJS, drizzle, `pg` and
the AWS SDK into every consumer — including, transitively, the mobile bundle. Copying keeps this package a leaf,
which is why authored `*.schema.ts` files may import only `zod` and flat sibling `*.schema.js` modules. That
restriction is enforced in code — `@kitchensink/contract-gen`'s `findViolations` — not by convention.

The allowlist here is **narrower than recipe's**, which also admits `@kitchensink/recipe-core`. That is
deliberate: `recipe-core` is a _recipe_ domain package, and recipes reference ingredients one-directionally by
opaque `food_id`. An ingredient contract that depended on the recipe domain would point the arrow the wrong way.

## Why it has no `test`, `lint`, or `format` script

Nothing here is hand-written, so there is nothing to unit-test or style-check. Correctness is enforced from the
outside by three layers:

1. **Rebuild** — turbo declares this package's `build` as depending on the service's authored schema sources, so
   a change to one invalidates this package instead of serving a stale cache hit.
2. **Correctness** — `packages/services/food-service/contract/__tests__/contract.test.ts` regenerates and fails
   on any diff, so a hand-edit here is discarded rather than shipped.
3. **Skew** — `CONTRACT_HASH` is stamped into both this package and the service, so a consumer pinned to an
   older contract can detect that the service has moved ahead of it.

`typecheck` and `build` DO run: the generated zod must compile, and a copied schema that no longer resolves is a
generation bug worth failing on.

There is deliberately no `eslint.config.js` and no `.prettierignore` here either. Both existed and were
dead — `turbo run lint format:check --filter='./packages/schemas/*'` reported "No tasks were executed", because
no such script exists — and the `.prettierignore` justified itself with a claim that was false (the root
`.prettierignore` already covers `dist` and `packages/schemas/*/openapi.yaml`). Wiring the scripts instead would
be worse than dead config: a formatter rewriting generated `src/` reads as contract drift and reds layer 2 until
the generator is re-run. The authored sources are linted and formatted in the service that owns them, which is
the one place that knowledge belongs. `packages/infra/global/__tests__/generatedSchemaPackages.test.ts` pins
this, so the config cannot quietly come back.

## What `openapi.yaml` is

A **derived** artifact for external consumption — API diffing, published docs, third-party integrators. It is
**not** a code-generation input and **not** the type authority. Nothing in this repo compiles against it; the
authority is the zod exported from `./src/index.ts`, with its types via `z.infer`.

It is declared in `packages/services/food-service/contract/openapi.ts` from the same authored zod, rather than
scraped from the controllers with `@nestjs/swagger` — which emits no response schema for a handler returning an
`interface`, i.e. for every handler in this service.
