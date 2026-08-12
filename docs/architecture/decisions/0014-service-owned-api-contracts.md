# 0014 — The service authors its wire contract in zod; a generated `packages/schemas/<service>` package is the only thing clients import

- **Status**: Accepted
- **Date**: 2026-08-11
- **Drivers**: `docs/CODING_STANDARDS.md` **§15 — API Contracts** (the normative rule this ADR records the
  reasoning for), and `specs/governance-rules.md` **GR-015** (the portfolio-wide obligation every feature
  inherits)
- **Relates to**: [ADR-0011](0011-api-version-prefix.md) (canonical `/api/{version}/*` — this ADR governs
  the _shapes_ at those paths, not the paths), `specs/governance-rules.md` GR-007 (shared **domain** types
  in `@kitchensink/recipe-core` — a different axis; see _Relationship to GR-007_ below),
  [ADR-0015](0015-input-validation-at-every-boundary.md) (**where the authored zod must RUN** — one boundary
  parse per service, the DB schema as the validation floor, response validation deferred; a service can
  satisfy this ADR in full and still accept anything, so ADR-0015 is a separate obligation, and its
  storage-floor rule is an **assertion** that does not weaken this ADR's `*.schema.ts` import constraint)

## Context

Measured on 2026-08-11: `@kitchensink/recipe-service-client` declared **276 lines** of request/response
types and `@kitchensink/food-service-client` **144**, and **neither imported anything from the service it
speaks to**. No service had `@nestjs/swagger` installed and no service emitted an OpenAPI document.

The consequence is the part that matters. A backend change that altered a response shape broke **no
consumer's `typecheck`** — the client went on asserting its own beliefs about the server, and the type
system reported agreement between two representations that had never been compared. The only layer where
the mismatch could surface was an end-to-end run against a live deployment: a **~50-minute Android emulator
job** for mobile, or production.

So the wire contract — one piece of knowledge — had two independent authors, and the drift was **silent by
construction**. That is the most expensive duplication this codebase can carry, and it survived behind
green builds precisely because nothing in the pipeline was capable of noticing it.

A second, subtler failure sat underneath it: the specs mandated nothing about the client half. Feature specs
described endpoints and response shapes as service concerns. A reader implementing a feature faithfully
would author the service correctly and then hand-write the client types, because no document told them not
to. **Mandating only the service side is how the client half got skipped**, and it is why GR-015 states the
client obligation explicitly rather than leaving it as an implication.

## Decision

**Zod is authored IN THE SERVICE. `packages/schemas/<service>` is a generated, committed COPY of it. Every
client imports wire types and zod from that package and declares none of its own.**

```
packages/services/<service>/src/**/*.schema.ts   ← zod AUTHORED here, beside the controller
                                                    it serves, and used directly for request
                                                    validation via nestjs-zod createZodDto
                        │
                        │  generate (copy)   turbo: schema-<service> dependsOn <service>
                        ▼
packages/schemas/<service>/    @kitchensink/schema-<service>  — GENERATED, committed
├── src/schemas.ts             the zod, assembled from the service's *.schema.ts
├── src/types.ts               `z.infer` types
├── src/contract-hash.ts       SHA-256 over the service's authored *.schema.ts sources
├── src/index.ts               barrel — named exports only
└── openapi.yaml               DERIVED from the zod, for oasdiff / docs / integrators
                        │
                        ▼
packages/clients/<service>  →  web + mobile      (depend on the leaf, never on the service)
```

1. **Derivation flows one way: zod → `z.infer` types, and zod → `openapi.yaml`.** Zod is the authored
   source. `openapi.yaml` is a derived artifact **for external consumption** — `oasdiff`, docs, integrators
   — and is explicitly **NOT a codegen input**.
2. **The service validates requests with the same zod it publishes** (`nestjs-zod`'s `createZodDto`), so
   server and clients check against one authored definition rather than two that agree by convention.
3. **A `*.schema.ts` may import ONLY `zod` and other `*.schema.ts` files**, and that constraint is enforced
   in code — a lint rule and/or a generate-time check that fails naming the file and symbol. One import of
   a service internal (a DAL type, a drizzle schema, a Nest symbol) either breaks the copied package
   outright or drags the server graph into every client.
4. **The client half is a first-class obligation, not a consequence.** A `packages/clients/*` package MUST
   NOT declare a request or response shape of a service in `packages/services/*`. Where a consumer's shape
   genuinely differs, it is **derived** from the wire type with `Pick`/`Omit`/`Partial` — never
   independently declared. Reference implementation:
   `packages/apps/commise/features/recipes/src/filters/model.ts`.
5. **Three drift layers, all required, each catching what the others cannot.**
    - **Rebuild (turbo)** — `schema-<service>#build` `dependsOn` `<service>#build`, with `inputs` covering
      the service's `*.schema.ts` sources, so content hashing rebuilds the package automatically.
    - **Correctness (CI)** — regenerate and fail on any diff against the committed artifacts. This is the
      strong gate; it is what catches generated output someone hand-edited.
    - **Skew (runtime)** — a `CONTRACT_HASH` over the service's `*.schema.ts` sources, embedded in both the
      service and the schema package and **asserted equal at service boot**. This catches a _deployed_
      service running ahead of a consumer's pinned schema, which is invisible to both layers above and is
      the live case for mobile, where a released binary cannot be updated in step with a backend deploy.
6. **One contract document per service, and it REPLACES any hand-written predecessor.** A generated document
   added _alongside_ a hand-maintained one makes the problem worse, because two documents then both claim
   to be normative.

### The third-party exception — a security boundary, not an inconsistency

For an API we do **not** serve (USDA FoodData Central, Clerk, Vercel, Stripe, an OCR provider, an LLM
provider), there is no service of ours to own the type and the upstream contract **cannot be trusted**.
Those clients **validate the raw upstream shape at the boundary with zod** and **MAY declare their own
types**.

`packages/clients/usda` is the reference implementation: its `schemas.ts` validates the raw upstream wire
shape the moment a body arrives, and deliberately differs from the normalized public type the client
returns. **Do not delete or "converge" those schemas in the name of this ADR, and do not write an OpenAPI
document for an API we do not serve.** The reasoning in _Context_ does not reach this case: duplication is
only wrong when one side could have been derived from the other, and here it could not — the "other side"
belongs to someone else and may change without telling us.

Applying rule 4 mechanically to a third-party client **deletes a validation boundary** and replaces a
checked parse with unchecked trust in a remote party's JSON. That is the specific damage this exception
exists to prevent, which is why it is restated in every feature spec that touches an external API rather
than being left to a single mention here.

### Relationship to GR-007

GR-007 governs **domain** types (`Recipe`, `Collection`, `User`, `PaginatedResponse`) and puts them in
`@kitchensink/recipe-core`. This ADR governs **wire** types — the endpoint envelopes. They are different
axes and neither replaces the other.

`recipe-core` already owns the recipe domain types with runtime zod, and is imported by 78 recipe-service
files and 13 client files. So a schema package **reuses `recipe-core` type-only and never re-declares its
types**; re-declaring `Recipe` or `PaginatedResponse` to achieve a literally dependency-free schema package
would manufacture the exact drift this ADR exists to prevent. An `import type` dependency on a shared domain
package is fine — it erases at compile time and pulls no runtime graph.

## Alternatives rejected

### 1. Derive the types THROUGH OpenAPI (`openapi.yaml` as the codegen input)

The tempting shape: emit OpenAPI from the service, then generate client types from the document, so the
document is the single source of truth for everyone including integrators.

**Rejected — it is lossy in exactly the places our types carry meaning.** JSON Schema cannot express
`readonly`, branded types, or template-literal types, and a discriminated union flattens without explicit
`oneOf`/`discriminator` handling (`IngredientSuggestion` is a live case; `Collection`'s intersection is
another). Routing derivation through it would **degrade the strong gate — `typecheck` — in order to serve
the weak artifact**. A generated schema that silently flattens a discriminated union to `object` is a
contract that lies, which is worse than no contract at all.

Zod also cannot be regenerated from JSON Schema without loss of its refinements, so the runtime validator
would have to be authored a second time — reintroducing the two-independent-representations problem one
layer down.

`openapi.yaml` is therefore kept as a **derived, outbound-only** artifact: `oasdiff`, docs, integrators.
One honest limitation is recorded rather than hidden: `oasdiff breaking` is worth wiring, but
`@nestjs/swagger` emits **no response schema** for a handler returning an `interface`, so until every
response type is a decorated class or zod-derived, that check is blind to response changes — which is most
of what actually breaks a client.

### 2. Let the client depend on the service package directly

If the service already owns the types, the client could just `import type` from
`@kitchensink/<service>-service`.

**Rejected — it drags the entire server graph into web and mobile.** The service package's dependency
closure is NestJS, drizzle, the AWS SDK, and its DAL. Even with `import type` at the source level, the
dependency edge exists in `package.json`, in the turbo graph, and in the installed tree; it lands in a
React Native bundler's resolution path and in every consumer's install and build times. It also inverts the
build order we want (clients would rebuild whenever any service internal changed) and gives a client a
legitimate-looking path to a DAL type, which is how "just this one internal type" becomes a leak.

The generated leaf package carries **no runtime dependency on the service graph** — that is its entire
reason for existing.

### 3. Co-locate the schema package inside the service directory

`packages/services/<service>/schema/` or `packages/services/<service>-schema/` keeps the copy next to the
files it is copied from, shortening the generator's paths and making the relationship obvious in the tree.

**Rejected by the owner. `packages/schemas/` is fixed.** The location is a deliberate statement about what
the package _is_: a leaf artifact for consumers, discoverable next to its siblings, not an implementation
detail of a deployable. Nesting it under `packages/services/` also makes it plausible for a client's
dependency to _look_ like a service dependency, which is the confusion alternative 2 already fails on.

### 4. Author the zod in the schema package and have the service import it

This removes the copy entirely — one authored location, no generation step, no regenerate-and-diff gate.

**Rejected — it puts authoring in the wrong place.** A contributor adding an endpoint must not have to edit
a second package to describe it; that is precisely how a contract drifts or the practice gets abandoned
under time pressure. Authoring lives beside the controller it serves.

## Consequences

**Accepted costs.**

- **There is a copy, and it is deliberate.** Zod schemas are runtime values, so they cannot be derived from
  themselves; and every package here exports raw `./src/*.ts` (see `recipe-core`, the recipe client), so
  there is no bundle-into-`dist` path that would let a build inline them instead. Naming it plainly matters:
  the "generation" of `schemas.ts`/`types.ts` is a **file copy**, not a transformation. The regenerate-and-diff
  CI gate is what makes a copy safe.
- **The turbo edge points schema → service**, which is the reverse of the intuitive direction and must not
  be "corrected".
- **Nothing in a schema package is hand-edited.** To change a contract you edit the service's `*.schema.ts`
  and regenerate; a hand-edit is discarded by CI rather than shipped.

**Known-incomplete work (as of 2026-08-11) — do not read this ADR as a description of a finished state.**

- `@kitchensink/schema-recipe` exists at `packages/schemas/recipe` with `schemas.ts`, `types.ts`,
  `contract-hash.ts` and a barrel. **Converged so far: the search/photos/ratings vertical only.**
- **Food and identity are being converged now.** Neither has a schema package yet.
- **`openapi.yaml` does not exist for any service yet.** `@kitchensink/schema-recipe`'s `package.json`
  already declares the `./openapi.yaml` export, so the export currently points at a file that has not been
  generated.
- `specs/001-commise-recipe-app/contracts/api.openapi.yaml` — 2810 hand-written lines that **57 source
  files cite as their authority**, verified by nothing — is **superseded** by recipe's generated document
  once it exists. Citations get repointed; the old file gets marked superseded.
- **A `CLAUDE.md` pointer is still owed.** Per this directory's README, an ADR that governs code needs an
  always-in-context tripwire. `docs/CODING_STANDARDS.md` §15 is the normative rule and is already reachable
  from the engineering-quality-bar mandate, but the root-`CLAUDE.md` "looks wrong, isn't" pointer and the
  co-located `// ⚠️ DELIBERATE` guard comments at the generator and at `packages/clients/usda/src/schemas.ts`
  have **not** been added.

**Where this ADR and an existing hand-written client type conflict, this ADR wins — the client is the one
that changes.**
