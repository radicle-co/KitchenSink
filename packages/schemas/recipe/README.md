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
sibling `*.schema.js` modules. That restriction is enforced in code — by `@kitchensink/contract-gen`, whose
allowlist the recipe service configures in `contract/generate.ts` — not by convention.

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

Its route table is authored in `packages/services/recipe-service/contract/openapi.ts`; the derivation itself
(zod → JSON Schema, the component registry, the coverage accounting) lives once in
`@kitchensink/contract-gen`.

### Its coverage is PARTIAL, and deliberately so

All 41 operations the service serves are documented. **26 of 41 have a response schema for every response
they declare**; the other 15 carry a described operation with an _undescribed body_, because that body has no
authored zod on either side yet. `contract:generate` prints the exact `operationId statusCode` list on every
run, and `contract/__tests__/openapi.test.ts` pins it as a ratchet, so the set cannot grow silently.

The gaps are: the whole **collections** vertical, **account** export/erasure, and the two blended
**ingredient** endpoints (`suggest`, `candidates`). Those are precisely the boundaries the typed client
validates with `expectUnvalidated` — no shared schema on either side — and they close as each vertical
gains an authored `*.schema.ts`. A hopeful shape published for them now would be a contract that lies, which
is worse than an obviously incomplete one.
