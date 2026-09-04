# 0023 — A granted curator DECLARES `imported_public`; the corpus is fetched OUT OF BAND, never at runtime

- **Status**: Accepted
- **Date**: 2026-08-19
- **Drivers**: Seeding the recipe tier with 100+ public-domain recipes from Project Gutenberg cookbooks,
  through the real `POST /api/v1/recipes` rather than a side door, ran straight into two walls:
    - `RecipesService.create` hardcoded `sourceType: RecipeSourceType.USER_CREATED`, so **the service could
      not create an imported recipe at all** — 004's own spec already says so in its
      _"⚠️ 004 REQUIRES an additive change to 001's shipped service"_ callout. The consequence was quieter
      than "a missing feature": C-004 visibility was being evaluated against a provenance that was never the
      recipe's real one, because `evaluateVisibility` was handed a literal.
    - 004-`FR-025` forbids **any** caller from declaring `imported_public`, on the reasoning that the server
      sets it "from the channel it observed". Here **the server observes nothing** — it performs no fetch —
      so the rule as written admits no correct implementation for this channel. That gap had to be closed by
      an amendment with a stated threat model, not by an interpretation.
- **Relates to**:
  [ADR-0019](0019-recipe-import-spine.md) — recipe creation is the **convergence point** where provenance is
  classified (`FR-047` as amended); this ADR is that classification, landing early and additively;
  [ADR-0014](0014-service-owned-api-contracts.md) — `source` is authored as zod in the recipe service and
  copied to `@kitchensink/schema-recipe`, so adding it moved the `CONTRACT_HASH`;
  [ADR-0015](0015-input-validation-at-every-boundary.md) — the declaration is parsed once at the boundary
  against the service's own `z.strictObject`s;
  [ADR-0004](0004-minimize-nat-egress.md) — the blast radius of an automated fetch, and why the corpus is not
  fetched by anything we deploy;
  [ADR-0012](0012-mcp-agent-credential-bridge.md) — the same posture it records: Clerk proves identity, **we**
  own the grant.

## ⚠️ Before you change this — the three "improvements" that are all wrong

1. **Do not turn the grant check into a route Guard.** `identity`'s `ScopesGuard` + `@RequireScopes` is the
   codebase's established shape for scope checks and it is the wrong tool here — see Decision §3. What is
   authorized is a **field value**, on a route that must stay open to every authenticated user.
2. **Do not make the importer fetch `gutenberg.org` at runtime.** `robots.txt` permits the path; the site's
   Terms do not permit the access. See Decision §2 — this is the "looks wrong, isn't".
3. **Do not add `imported_physical` or `imported_paid` to the declarable union** "for symmetry". Both are
   private-only under C-004 and `evaluateVisibility` admits either to `private` with **no premium check**, so
   admitting them hands a free-tier caller exactly the private recipe 004-`FR-028` says must be
   entitlement-gated. See Consequences.

## Context

### What was actually broken

`RecipesService.create` took no provenance argument and wrote `USER_CREATED` unconditionally. The DAL had
supported `sourceType`/`sourceUrl`/`sourceAttribution` since `0001_initial.sql` — `clone()` writes all three —
but no _creation_ path exposed them. So:

- an imported recipe could not be created through the public API at all; and
- `evaluateVisibility` was called with a literal, which means the C-004 decision and the recipe's provenance
  were **structurally incapable of being the same fact**. That was harmless only because exactly one value was
  ever reachable.

004-`FR-024` / `D-011` already specify the repair — "creation MUST accept an explicit provenance … and MUST
evaluate the C-004 visibility policy against the **actual** provenance" — and `D-011` explicitly chose _fixing
the method_ over fencing it off with lint rules and a wrapper. This ADR lands that requirement early, and only
the part of it the seeding work needs.

### The constraint FR-025 did not anticipate

`FR-025`'s control is: a caller may declare only provenance **equally or more restrictive** than
`user_created`; `imported_public` and `imported_physical` are "set **only** by the server from the channel it
observed". The hazard it names is real and unchanged — **false attribution on public content**: a caller who
can declare `imported_public` can assert that a recipe they wrote came from a named work by a named author.

That control assumed the server does the fetching, so that "the channel" is something the server witnesses.
The curated-import channel has no such witness, because **nothing we deploy fetches the source** (§2 below).
Pretending otherwise — inventing a server-side "observation" that is really the caller's own claim — would be
the worst option available: it would satisfy the letter of `FR-025` while removing its substance.

## Decision

### 1. `imported_public` is DECLARABLE, and the declaration is authorized by a grant

`POST /api/v1/recipes` accepts an optional `source` object. It is a **discriminated union** over `sourceType`
with exactly two members (`recipes.schema.ts`):

```ts
export const CURATOR_IMPORT_SCOPE = 'recipes:import:public';

export const recipeSourceInputSchema = z.discriminatedUnion('sourceType', [
    z.strictObject({ sourceType: z.literal(RecipeSourceType.USER_CREATED) }),
    z.strictObject({
        sourceType: z.literal(RecipeSourceType.IMPORTED_PUBLIC),
        sourceUrl: recipeSourceUrlSchema, // REQUIRED
        sourceAttribution: recipeSourceAttributionSchema, // REQUIRED
    }),
]);
```

The union is the requirement, not a style choice. `imported_public` asserts "this came from somewhere else,
and here is where"; a declaration carrying that claim with **no** URL and **no** attribution is precisely the
false-attribution hazard. Making both fields required on that member — and _unrepresentable_ on
`user_created`, where they would mean nothing — turns "an import must be attributed" from a rule the service
enforces into a state the wire cannot express.

**`source` is added to `createRecipeRequestSchema` via `.extend()` AFTER the base, never to
`createRecipeRequestBaseSchema`.** `updateRecipeRequestSchema` derives from that base through
`.omit().partial()`, so a field placed there is inherited by `PATCH /api/v1/recipes/{id}` — which would let
**any** caller re-classify an existing recipe as `imported_public` after creation, bypassing the policy
entirely (it runs only on create). `recipes.schema.test.ts` pins the absence as a regression.

**This amends 004-`FR-025`, and it is an amendment, not a reading of it.** The sentence becomes:

> An **unprivileged** caller MUST NOT be able to declare `imported_public` …

The curator grant is a **new channel member**, and its "observation" is stated plainly rather than
manufactured: _an administrator granted this principal `recipes:import:public` out of band in Clerk, carried
inside the token's signed `public_metadata`, on the signing key's authority._

Argued on `FR-025`'s **own threat model**, an administrator grant is a **stronger** control against false
attribution than "the server fetched a URL the caller chose" — because a caller-supplied URL can point at
content the caller wrote. Server-side fetching proves that _a document exists at that URL_. It proves nothing
about authorship, and `FR-025` is an authorship control.

### 2. The corpus is an OPERATOR-DOWNLOADED file. Nothing we deploy fetches Project Gutenberg. ⚠️ looks wrong, isn't

Verified 2026-08-19 against the live site:

- `https://www.gutenberg.org/robots.txt` is, in full, `User-agent: *` / `Disallow: /ebooks/search`. A
  `robots.txt` check therefore **PASSES** for `/cache/epub/…` — the exact paths the corpus comes from.
- `https://www.gutenberg.org/policy/robot_access.html` states: _"The Project Gutenberg website is intended for
  human users only. Any perceived use of automated tools to access the Project Gutenberg website will result
  in a temporary or permanent block of your IP address. The only exceptions to this rule are below."_ The
  listed exceptions are a **private mirror**, the **`/robot/harvest` endpoint** (with `wget -w 2`, i.e. a
  rate-limited bulk harvest), and the catalog feeds — all of them **operator** activities, none of them a
  per-request fetch of a `/cache/epub/…` URL by an application server.

**The finding this produces is against 004-`FR-023`, and it generalises beyond Gutenberg: `robots.txt`
compliance is not terms-of-use compliance, and `FR-023` treats them as the same check.** A site can permit a
path in `robots.txt` and forbid automated access in prose on another page. `FR-023` is written as the whole
of the "may we fetch this" question and it is not.

**Consequence, and it is deliberate:** the public-domain cookbook corpus is downloaded **by an operator, out
of band**, and committed/staged as a file. No deployed component and no CI job performs an automated fetch of
`gutenberg.org`. The `sourceUrl` we persist is a **citation for a human reader**, not a fetch target.

The blast radius makes this cheap insurance rather than fussiness. Egress identity in this account is
**shared and stage-level**: a VPC-attached Lambda leaves through the single `t4g.nano` NAT instance's address
(ADR-0004), Fargate tasks run in public subnets with `assignPublicIp` (`RecipeServiceStack.ts`) and leave
through addresses the task does not choose, and CI runners share GitHub's pools. A block earned by an import
job is therefore not scoped to that job.

### 3. The check is a pure POLICY module, NOT a route Guard

`evaluateProvenance` (`src/recipes/domain/provenancePolicy.ts`) is a pure, total function — the sibling of
`evaluateVisibility` — taking the declared provenance and the caller's grants as a primitive
`readonly string[]`, and returning a discriminated union: allow-with-resolved-provenance, or deny-with-the-
required-scope. It reaches nothing: no DB, no `Principal`, no I/O. Grants arrive as strings for the same
reason `evaluateVisibility` takes `isPremium: boolean` — a policy that can reach a request cannot be exhausted
as a truth table.

⛔ **The rejected anti-pattern, named so nobody "improves" it back in:** applying `ScopesGuard` +
`@RequireScopes('recipes:import:public')` to `POST /api/v1/recipes`. A guard is **route**-level, and that route
must stay open to every authenticated user — gating it would break ordinary recipe creation for everyone
without the grant. What is authorized here is a **field value**.

Say this loudly because it is easy to mistake for novelty-for-its-own-sake: **field-level authorization is a
genuinely NEW authorization SHAPE in this codebase.** It is **not** a new authorization _concept_ —
`Principal.scopes` and `Principal.permissions` have been read from the token's signed `public_metadata` since
the service shipped, and this policy unions the two exactly as `ScopesGuard` does ("satisfied by EITHER
list"). What is new is only _where_ the check lives, and it lives there because that is where the decision is:
inside the rule, as one pure, total, table-testable function, instead of split across a guard that gates the
wrong thing and a service that resolves the rest.

### 4. Provenance is resolved FIRST, then C-004 judges what that thing may be

`RecipesService.create` now runs the provenance policy, then feeds the **resolved** `sourceType` into
`evaluateVisibility`, then writes all three provenance columns from the policy's output — never from the body.
The ordering is the seam: **this policy decides what the recipe IS; C-004 decides what visibility that thing
may hold.**

An **absent** `source` resolves to `user_created` with both source fields `null`, which is byte-for-byte what
`create` hardcoded before. That equivalence is what makes `FR-024`'s "existing behaviour is unchanged" a
checked property rather than a claim.

A denial is `apiError('FORBIDDEN', …)` — a **403**, reusing the code already published in
`common/apiError.schema.ts` and documented there as _"Authenticated, but not permitted (a scope/permission
gate rather than an ownership one)"_, which is this case verbatim. It is a 403 and not a 400 because the
refusal is about the **caller**, not the body: the same bytes from a curator are accepted, and a 400 would
send an ordinary user to fix a payload that is already correct. **No member was added to
`RecipeErrorCode`** — that enum is a recipe-_domain_ vocabulary both apps consume, and widening a shared union
buys nothing that `details.requiredScope` does not already make actionable.

## Alternatives considered

- **Seed the rows directly in SQL / through the DAL, bypassing the API.** Rejected: it would have left
  `create` unable to do the job — the actual defect — untouched, and produced 100+ rows that no code path can
  reproduce, validate, or re-run. The seeding requirement is what _found_ the bug; routing around it discards
  the finding.
- **Keep `FR-025` literal: the server sets `imported_public` only from a channel it fetched.** Rejected on its
  own threat model. It would force a runtime fetch of a site whose Terms forbid automated access (§2), and the
  control it buys is weaker than the grant it replaces: fetching proves a document exists at a URL, not that
  the caller did not write it.
- **`ScopesGuard` + `@RequireScopes` on the create route.** Rejected: gates a route that must not be gated,
  and splits one decision across two layers. §3.
- **A separate curator-only endpoint (`POST /api/v1/recipes/imports`).** Rejected: a second write path into
  the same aggregate, with its own copy of validation, visibility evaluation, ingredient resolution and
  outcome shape — the exact divergence ADR-0019's convergence point exists to prevent, bought only to avoid
  one optional field.
- **An `imported: boolean` flag plus optional `sourceUrl`/`sourceAttribution`.** Rejected: it makes
  "classified as an import, with nothing to attribute it to" representable, which is the hazard. The
  discriminated union makes that state unrepresentable.
- **A config allow-list of curator user ids instead of a Clerk grant.** Rejected: it puts an authorization
  fact in a deploy artifact — revocation becomes a release — while the identity provider already carries
  signed, revocable grants that both services read the same way.
- **Add `source` to `createRecipeRequestBaseSchema`.** Rejected, and pinned by a test: `PATCH` derives from
  that base, so it would let any caller re-classify a recipe after creation, when the policy runs only on
  create.

## Consequences

**Accepted.**

- **`source` is now a published field on a public wire contract.** `@kitchensink/schema-recipe` was
  regenerated and the `CONTRACT_HASH` moved (`ff94b94d…` → `f5400a38…` as measured while writing this;
  treat any hash in prose as a timestamp). Once mobile ships against it this is a **one-way door** — removing
  or reshaping `source` breaks installed clients that cannot be redeployed.
- **`imported_physical` and `imported_paid` are deliberately NOT declarable**, which **narrows** `FR-025`
  rather than implementing it. Both are private-only classes, and `evaluateVisibility` admits either to
  `private` with **no premium check** (`visibilityPolicy.ts`) — so admitting them would hand a free-tier
  caller exactly the private recipe 004-`FR-028` says must be entitlement-gated, and `FR-014a`'s
  attestation + citation machinery that is supposed to travel with them does not exist yet. They join the
  union when 004 builds that gate; adding a member is additive.
- **The corpus is an operator responsibility.** Refreshing it is a manual, out-of-band step with no automation
  behind it, and no job will notice if it goes stale.
- **A curator token is a real credential.** It must be minted with the grant inside the signed
  `public_metadata` — a top-level claim or a header is never read as a grant by either service.

**Required by this ADR.**

- `CURATOR_IMPORT_SCOPE` is published from the contract and **imported**, never restated. A second copy of an
  authorization identifier is drift that fails **open**.
- Any future channel that declares provenance goes through `evaluateProvenance`, not around it, and extends
  the union — so every new member is a compile error at the exhaustive `switch` until it is handled.

## Residual risk

- **A leaked or misused curator token can attach false attribution to public recipes.** This is the hazard
  `FR-025` names, and the grant narrows rather than eliminates it. Two things bound it: such rows are
  **enumerable** (`WHERE owner_id = … AND source_type = 'imported_public'` over columns that both exist and
  are indexed on `owner_id`), so the damage is reversible rather than silent; and the grant is revocable in
  Clerk — **effective on the next token mint**, not immediately, so an already-issued token stays usable until
  it expires. Nothing today alerts on a first-ever `imported_public` create by a new principal.
- **Attribution correctness is unverified by anything.** The service checks that a URL and a credit line are
  _present_ and well-formed, never that they are _true_. That check does not exist and cannot be built from
  the request.
- **`sourceUrl` is a citation, not a promise.** Nothing re-checks that it still resolves; 004-`FR-017` already
  anticipates a source disappearing, but no such checker ships.
- ~~**The `create` docstring still describes the pre-ADR behaviour** ("A create is always a `user_created`
  recipe"). Stale, and it is the first thing the next reader will believe.~~
  ⚠️ STALE (2026-09-04) — **this risk is CLOSED; the docstring was fixed.**
  `packages/services/recipe-service/src/recipes/recipes.service.ts:1181-1191` now opens with _"⚠️ A create is
  no longer ALWAYS `user_created` (004-FR-024 / ADR-0023). It carries the provenance the caller DECLARED,
  resolved by {@link evaluateProvenance}…"_, and the string "A create is always a `user_created` recipe" no
  longer appears anywhere in the repository.
- **The `imported_public` → `private` transition remains gated by C-004 as before**: premium **and** a
  substantive edit. A curated import is public and stays public unless a premium owner substantively edits it.
  That is unchanged by this ADR and is called out because it is the first question asked about a corpus of
  imported public recipes.

## Addendum (2026-08-23) — `statedMeasure` is NOT gated on the curator grant, deliberately

Plan U7/U11 added a second create-only ingredient-line field shaped very much like `sourceLine`:
`statedMeasure`, the amount and unit the source PRINTED before the importer restated a historical measure
(`one gill of milk` is persisted as `0.5 cup`, because the USDA household-portion table has never heard of a
gill). Migration `0027_ingredient_stated_measure.sql` persists it, and U11's verification gate asks the model
about it instead of about the restated pair — which is what stops the gate manufacturing a false DISAGREE
against a line we parsed correctly.

**It was considered for `CURATOR_IMPORT_SCOPE` and deliberately left ungated.** The argument for gating was
real and is worth stating, because it will be re-derived by the next reader: a lie in `sourceLine` is
_visible_ to the model (the model checks our parse against it), while a lie in `statedMeasure` is _invisible_,
because the stated pair IS the parse the model is shown. A caller could therefore post
`quantity: 500, unit: cup` with `statedMeasure: {1, gill}` and a matching source line, collect an `agree`, and
publish nutrition computed from 500 cups.

**Three things defeat that argument.**

1. **The cheaper attack already exists and always has.** `sourceLine` is optional. A caller who wants the same
   outcome simply omits it: `decideVerification` returns `skip: 'no-source-text'`, the gate never runs, and
   the recipe publishes. Gating `statedMeasure` removes no protection anybody was relying on.
2. **The gate is a parser-quality control, not an integrity control against a hostile client.** Both
   `verificationGatePolicy.ts` and `0023_line_verifications.sql` say so in their own words — absence of a
   verdict PUBLISHES. Treating it as an authorization surface would be citing this ADR's conclusion without
   its premise.
3. **This ADR's grant exists for a DIFFERENT harm.** `imported_public` attaches a named author's credit to
   public content, so a false declaration is a cross-user reputational harm. Wrong nutrition on your own
   recipe is not that harm, and the populations that legitimately restate a historical measure without holding
   `recipes:import:public` — 011's photographed physical cookbooks, 017's capture waterfall — are real.

**What protects it instead** is the arithmetic, asserted where it is performed rather than where it is read:
`convertHistoricalUnit` REFUSES a restatement whose kind changes or whose bounds do not round-trip back to the
stated amount within 1%, so the two halves of a conversion cannot describe different amounts. That is a
statement about our own code, which is the only thing an assertion can be a statement about.

⚠️ A scope gate on a create-only wire field is cheap to add and **expensive to remove**. If this is revisited,
revisit it as a product decision about who may import, not as a patch to the verification gate.
