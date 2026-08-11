# `@kitchensink/schema-recipe`

**GENERATED PACKAGE — DO NOT EDIT `src/` OR `openapi.yaml` BY HAND.**

The recipe API's wire contract is **authored as zod** in the recipe service, co-located with the controller
each schema serves:

```
packages/services/recipe-service/src/**/*.schema.ts   ← THE SOURCE OF TRUTH (hand-authored)
        │  npm run contract:generate --workspace=@kitchensink/recipe-service
        ▼
packages/schemas/recipe/                              ← this package (generated, committed)
        ▼
packages/clients/recipe-service  →  @commise/web, @commise/mobile
```

## Why a copy rather than a re-export

A re-export would make this package depend on `@kitchensink/recipe-service`, dragging NestJS, drizzle, `pg`
and the AWS SDK into the web and mobile bundles. Copying keeps this package a leaf, which is why authored
`*.schema.ts` files may import only `zod`, `@kitchensink/recipe-core` (itself a zod-only leaf), and flat
sibling `*.schema.js` modules. That restriction is enforced in code — see
`packages/services/recipe-service/contract/schema-imports.ts` — not by convention.

## Why it has no `test`, `lint`, or `format` script

Nothing here is hand-written, so there is nothing to unit-test or style-check. Correctness is enforced from
the outside by three layers:

1. **Rebuild** — turbo declares this package's `build` as depending on the service's, so a change to an
   authored schema invalidates this package.
2. **Correctness** — CI regenerates and fails on any diff, so a hand-edit here is discarded rather than
   shipped.
3. **Skew** — `CONTRACT_HASH` is stamped into both this package and the service, so a consumer pinned to an
   older contract can detect that the service has moved ahead of it.

`typecheck` and `build` DO run: the generated zod must compile, and a copied schema that no longer resolves
is a generation bug worth failing on.

## What `openapi.yaml` is

A **derived** artifact for external consumption — API diffing, published docs, third-party integrators. It is
**not** a code-generation input and **not** the type authority. Nothing in this repo compiles against it; the
authority is the zod exported from `./src/index.ts`, with its types via `z.infer`.
