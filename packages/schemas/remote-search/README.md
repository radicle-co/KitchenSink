# `@kitchensink/schema-remote-search`

**GENERATED PACKAGE — DO NOT EDIT `src/`, `openapi.yaml` OR `contract.schema.json` BY HAND.**

The remote search service's wire contract (ADR-0055) is **authored as zod** in the service:

```
packages/services/remote-search/src/**/*.schema.ts   ← THE SOURCE OF TRUTH (hand-authored)
        │  npm run contract:generate --workspace=@kitchensink/remote-search-service
        ▼
packages/schemas/remote-search/                      ← this package (generated, committed)
```

Its intended consumer is `@kitchensink/food-service`, the service's one caller (ADR-0055 point 3); the apps never call
this service. Food-service takes the dependency in plan 002's S7.4.

It is a copy rather than a re-export, so food-service never depends on the service package (ADR-0014). Authored
`*.schema.ts` files may import only `zod`, which `@kitchensink/contract-gen` enforces.

It has no `test`, `lint` or `format` script, for the reasons `packages/schemas/identity/README.md` gives: the
authored sources are checked in the service, and `packages/services/remote-search/contract/__tests__/contract.test.ts`
regenerates and fails on any difference.

`openapi.yaml` is derived, for external consumption. It is not a code-generation input and not the type authority;
the zod exported from `./src/index.ts` is.
