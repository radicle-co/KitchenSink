# `@kitchensink/schema-identity`

**GENERATED PACKAGE — DO NOT EDIT `src/`, `openapi.yaml` OR `contract.schema.json` BY HAND.**

The identity API's wire contract is **authored as zod** in the identity service, co-located with the controller
each schema serves:

```
packages/services/identity/src/**/*.schema.ts   ← THE SOURCE OF TRUTH (hand-authored)
        │  npm run contract:generate --workspace=@kitchensink/identity-service
        ▼
packages/schemas/identity/                      ← this package (generated, committed)
        ▼
@commise/features-account  →  @commise/web, @commise/mobile
```

## Why this package exists at all

Identity has no `packages/clients/*` package: its consumers are the shared `@commise/features-account`
(`ProfileServiceClient`) plus the web and mobile apps directly. All three used to reach for the DTOs by declaring
a dependency on **`@kitchensink/identity-service`** — the whole NestJS service package, with drizzle, `pg`, the
AWS SDK and `@sentry/nestjs` in its graph.

The types erase at compile time, so nothing broke. The dependency **edge** from the mobile bundle to a server
package is what was wrong, and removing it is what this package is for. `features-account`, `@commise/web` and
`@commise/mobile` now depend on this leaf; only the identity **webhooks** service still imports the service
package, for `ClerkSessionClaims` — a service-to-service type, not a wire shape, and correctly not published here.

## Why a copy rather than a re-export

A re-export would reinstate exactly the dependency described above. Copying keeps this package a leaf, which is
why authored `*.schema.ts` files may import only `zod` and flat sibling `*.schema.js` modules. That restriction is
enforced in code — `@kitchensink/contract-gen`'s `findViolations` — not by convention.

## Ids are plain strings here, deliberately

The service brands its identifiers (`UserId = string & { __brand: 'UserId' }`, minted and checked by
`@kitchensink/identity-db`). The brand is a **server-side** invariant: it stops service code passing an account id
where a user id belongs. A client receives an opaque identifier it echoes back, so publishing the brand would only
force every consumer to cast at the boundary — ceremony asserting an invariant the client cannot establish.
`UserId` stays assignable to `string`, so the service's own handlers still satisfy these shapes.

## Why it has no `test`, `lint`, or `format` script

Nothing here is hand-written. Correctness is enforced from the outside by three layers:

1. **Rebuild** — turbo declares this package's `build` as depending on the service's authored schema sources.
2. **Correctness** — `packages/services/identity/contract/__tests__/contract.test.ts` regenerates and fails on
   any diff, so a hand-edit here is discarded rather than shipped.
3. **Skew** — `CONTRACT_HASH` is stamped into both this package and the service, so a consumer pinned to an older
   contract can detect that the service has moved ahead of it.

There is deliberately no `eslint.config.js` and no `.prettierignore` here either. Both existed and were dead —
`turbo run lint format:check --filter='./packages/schemas/*'` reported "No tasks were executed", because no such
script exists — and the `.prettierignore` justified itself with a claim that was false (the root `.prettierignore`
already covers `dist` and `packages/schemas/*/openapi.yaml`). Wiring the scripts instead would be worse than dead
config: a formatter rewriting generated `src/` reads as contract drift and reds layer 2 until the generator is
re-run. The authored sources are linted and formatted in the service that owns them, which is the one place that
knowledge belongs. `packages/infra/global/__tests__/generatedSchemaPackages.test.ts` pins this, so the config
cannot quietly come back.

## What `openapi.yaml` is

A **derived** artifact for external consumption — API diffing, published docs, integrators. It is **not** a
code-generation input and **not** the type authority. Nothing in this repo compiles against it; the authority is
the zod exported from `./src/index.ts`.

It is declared in `packages/services/identity/contract/openapi.ts` from the same authored zod, rather than scraped
with `@nestjs/swagger` — which emits no response schema for a handler returning an `interface`, and identity's
handlers mostly declare no return type at all.
