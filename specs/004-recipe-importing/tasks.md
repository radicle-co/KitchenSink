# Tasks: Feature 004 — Recipe Importing

**Feature**: `004-recipe-importing`
**Source**: [spec.md](./spec.md), [plan.md](./plan.md). Screens: [designSource.md](./designSource.md).

Shipped tasks are closed with their commit and the test file that proves them. Every other task is unbuilt and is written
test-first. A task names its tier and its test file. A test path marked "(planned)" does not exist yet.

---

## Mandatory conventions for every task

- **Test-first** ([`docs/CODING_STANDARDS.md`](../../docs/CODING_STANDARDS.md) §7.1, absolute). The failing test is
  written before the code, and the red run is watched.
- **Test tiers by category. Omitting one makes the task incomplete:**
    - Non-UI (services, DALs, policies, parsers): unit and integration, with the database mocked
      ([ADR-0032](../../docs/architecture/decisions/0032-deployed-ecosystem-test-tier.md)).
    - A deployable service: additionally service e2e, and k6 by hand.
    - A migration: a LOCAL e2e that asserts the migrated schema.
    - A wire change: a contract test, with `contract:generate` leaving no diff.
    - UI: a vitest component test for every state, on web and `.native`; one Playwright flow (web) and one Maestro flow
      (mobile) per user story.
- **File names** follow `docs/CODING_STANDARDS.md` §1: camelCase modules, PascalCase components, mobile leaves
  `*.native.tsx`, no hyphens in any file name.
- **Lockstep parity** (§14.1). A user-facing task ships web and mobile together. The one exception is the paste web-first
  exception (`FR-062`, plan.md section 14).
- **Localisation.** No user-facing literal. Copy goes through `@commise/i18n` and is shared by both platforms.
- **Purity.** Policies, normalisers and parsers are pure. An impure function carries `@sideEffect`.

---

## Shipped

- [x] **T-001** The import wire contract, authored as zod in the service and copied to `@kitchensink/schema-recipe`.
      `FR-025`. Commits `58ab190f1`, `0016a7f1b` (#220). Proof:
      [`import.schema.test.ts`](../../packages/services/recipe-service/src/recipes/__tests__/import.schema.test.ts).
- [x] **T-003** The shipped import error codes and their mapping. `FR-016`, `FR-022`, `FR-028`. Commits `0016a7f1b`
      (#220), `7899fa3a6` (#261). Proof:
      [`errorContractLockstep.test.ts`](../../packages/services/recipe-service/src/common/__tests__/errorContractLockstep.test.ts).
- [x] **T-006** The provenance policy, and provenance-aware creation in 001's recipes vertical. `FR-024`, `FR-025`.
      Commit `7b46e90fe`. Proof:
      [`provenancePolicy.test.ts`](../../packages/services/recipe-service/src/recipes/domain/__tests__/provenancePolicy.test.ts).
- [x] **T-007** The normalisers: ingredient lines, quantities, durations, servings and the sanitiser. `FR-020`,
      `FR-021`, `NFR-008`. Commit `7b46e90fe`. Proof:
      [`ingredientLine.test.ts`](../../packages/shared/recipe-import-core/src/__tests__/ingredientLine.test.ts) and
      [`valueNormalizers.test.ts`](../../packages/shared/recipe-import-core/src/__tests__/valueNormalizers.test.ts).
- [x] **T-008** The device extraction tiers with a strict yes or no: schema.org JSON-LD, microdata and the rule-based
      reader. `FR-064`, `FR-052`. Commit `8bbd17e7f` (#278). Proof:
      [`jsonLdRecipe.test.ts`](../../packages/shared/page-reader/src/__tests__/jsonLdRecipe.test.ts),
      [`microdataRecipe.test.ts`](../../packages/shared/page-reader/src/__tests__/microdataRecipe.test.ts) and
      [`readPastedContent.test.ts`](../../packages/shared/page-reader/src/__tests__/readPastedContent.test.ts).
- [x] **T-011** The import service: items, statement provenance, holds, refusals and the publish hold. `FR-015`,
      `FR-047`, `FR-026`, `FR-027`. Commit `0016a7f1b` (#220). Proof:
      [`importService.test.ts`](../../packages/services/recipe-service/src/import/__tests__/importService.test.ts).
- [x] **T-015** File import: the client reads the file and sends one structured recipe per item. `FR-019`. Commits
      `0016a7f1b` (#220), `7899fa3a6` (#261). Proof:
      [`importRoutes.integration.test.ts`](../../packages/services/recipe-service/__tests__/integration/import/importRoutes.integration.test.ts).
- [x] **T-049** The import controller with the one allowance, the unpaid-storage cap and safe body parsing. `FR-022`,
      `FR-067`, `D-018`. Commit `7899fa3a6` (#261). Proof:
      [`importRoutes.integration.test.ts`](../../packages/services/recipe-service/__tests__/integration/import/importRoutes.integration.test.ts).
- [x] **T-050** The editor's ingredient-list paste draws on the one allowance. `FR-022`, `FR-067`. Commit `5f56fd88c`
      (#277). Proof:
      [`importAllowancePolicy.test.ts`](../../packages/services/recipe-service/src/common/__tests__/importAllowancePolicy.test.ts).

---

## Server link fetch and its policies

- [ ] **T-033** `FetchSignalPolicy` and the per-fetch signal log. `FR-023`. Pure policy: allow or deny from robots.txt
      (the `*` group binds when no group names the agent), TDMRep, `noai`, `noimageai`, AI-crawler blocks and Content
      Signals. One log row per fetch, with "none found". Tiers: unit
      `packages/services/recipe-service/src/import/domain/__tests__/fetchSignalPolicy.test.ts` (planned), under the
      mutation lens; integration for the log row.
- [ ] **T-009** The paid list as data, seeded, with the paid classification. `FR-014`, `D-004`. One table and a pure
      classifier over the page's structured data, the list and a metered gate. Seeded from product's starting list in
      the same migration. Tiers: unit `.../domain/__tests__/paidClassification.test.ts` (planned); LOCAL e2e on the
      migrated table `packages/services/recipe-service/tests/e2e/paidList.e2e.test.ts` (planned).
- [ ] **T-017** Admin endpoints for the paid list, with an audit trail. `D-004`. Admin scope only. Tiers: unit and
      integration `.../__tests__/paidListAdmin.integration.test.ts` (planned). The operator screen is owed a design
      ([designSource.md](./designSource.md)) and is not in this task.
- [ ] **T-010** The server fetcher and the SSRF guard. **Security-critical, `D-018`, non-waivable.** `NFR-006`,
      `NFR-007`, plan.md section 4. The fetch budget, address checks with `ipaddr.js`, the connection pinned to the
      validated address, the checks re-run on every redirect hop, no credentials. Tiers: unit on the guard (mutation lens,
      95% gate, `D-010`) `.../fetch/__tests__/ssrfGuard.test.ts` (planned); integration with named cases (a redirect to a
      private address, a DNS answer that resolves to a private address, IPv6 and IPv4-mapped forms)
      `.../fetch/__tests__/sourceFetcher.integration.test.ts` (planned); service e2e against a local fixture server.
- [ ] **T-051** The fetch error codes: `IMPORT_SOURCE_BLOCKED`, `IMPORT_SOURCE_UNREACHABLE`, `IMPORT_NO_RECIPE_FOUND`,
      `IMPORT_NO_CAPTION`, `IMPORT_PAYLOAD_TOO_LARGE`, `IMPORT_PROVIDER_UNAVAILABLE`. `FR-016`, plan.md section 4.
      Tiers: contract (`contract:generate` leaves no diff, schema tests accept and reject); unit on the exception filter
      mapping `packages/services/recipe-service/src/common/__tests__/errorContractLockstep.test.ts`.
- [ ] **T-014** The link import channel: the device fetches first, then the server, never the server for a known paid
      site, with a fetched page going through the same tiers and the same server AI fallback as a paste. `FR-008`,
      `FR-064`, `FR-053`, `FR-053a`. Depends on T-010, T-033, T-009, T-051. Tiers: unit; integration
      `.../__tests__/linkImport.integration.test.ts` (planned); service e2e; Playwright flow (web) and Maestro flow
      (mobile) for the link import.
- [ ] **T-054** The bulk library-duplicate rule. `FR-068`. A bulk item whose web address matches a library recipe's
      `source_url` shows "Already in your library", is skipped by default, offers "Import as a new copy" and offers no
      Replace. The match key is the export's web address, normalised as C-001 says (the normaliser is built by 003B).
      Tiers: unit on the match key `.../import/domain/__tests__/libraryDuplicate.test.ts` (planned); integration;
      component tests for the state on web and `.native`; one Playwright and one Maestro flow.

## Statements and photos

- [ ] **T-052** The `family` statement kind, "From another person". `FR-011`, `FR-014a`. An expand-only CHECK migration,
      one wire member in `import.schema.ts`, private only through the visibility policy, and the label never reads
      "Written by you". Tiers: unit on the statement-to-label table `.../__tests__/statementLabel.test.ts` (planned);
      contract; LOCAL e2e on the CHECK `.../tests/e2e/statementKind.e2e.test.ts` (planned). The `adapted` and
      `publicDomain` kinds follow spec 016's data model.
- [ ] **T-053** Page photos. `FR-008`, **GATED, see `D-020`.** The device fetches the page's main photo and saves it to
      the private copy through the cook's ordinary photo upload. The fallback links to the source page and shows the
      photo loaded on the device, never saved. The server never fetches a photo. The import contract gains the photo
      field only in this task. Tiers: unit; integration; component tests for each state on web and `.native`; one
      Playwright and one Maestro flow. Ships only after `D-020`'s release sign-off.

## The AI text-extraction fallback

- [ ] **T-048** The fallback. `FR-056` to `FR-063`. A new Lambda under the single Bedrock role, with its own queue,
      dead-letter queue and reserved concurrency, VPC-attached, with call site `'text-extraction'` and a row in ADR-0004's
      `nat-consumers` table. Line numbers only, a pinned prompt builder, the 48,000-byte cap refused and never truncated,
      the opt-out skip, `budgetSpent` not retried, a result row with an expiry, and the same advance steps and one
      allowance as every import. Depends on T-032's web surfaces. The mobile paste row stays behind a flag until this ships. Tiers:
      unit and worker tests for the cases in `spec.md`'s criteria for `FR-056` to `FR-063`
      `packages/services/recipe-workers/src/__tests__/textExtract.test.ts` (planned); integration; LOCAL e2e on the
      result table and erasure; service e2e; Playwright and Maestro flows for the read, `budgetSpent`, over-cap and
      source-question states; k6 by hand. A new ADR records the queue, role and call site.
- [ ] **T-055** The AI-attempt spend signal. `FR-061`, plan.md section 6. A per-principal attempt count in the fallback's
      spend metrics, and an alarm when one principal's share of the month's ceiling passes a set fraction. Detection, not
      a cap. Tiers: unit on the share calculation `.../__tests__/attemptShare.test.ts` (planned); an infra synth test for
      the alarm.

## The channels' surfaces

- [ ] **T-032** The paste channel surfaces, web first and mobile after T-048. `FR-052`, `FR-062`, the paste design spec.
      The shipped device read is T-008. Tiers: component tests for every state on web and `.native`; one Playwright
      flow (web) and one Maestro flow (mobile).
- [ ] **T-019** The Instagram official-API path, gated by `D-002`. An oEmbed adapter with an app credential, behind a
      capability flag that defaults off. The adapter validates the raw upstream shape at the boundary with its own zod,
      and that boundary schema is never converged away. Developed against a contract fake generated from the same zod
      the adapter validates. Tiers: unit and integration against the fake; a contract test that pins the response shape
      and rejects a renamed, missing, wrong-typed and null field; service e2e with the flag on and off (`404`).
- [ ] **T-020** The typed client extension for the new routes. Wire types and runtime zod come from
      `@kitchensink/schema-recipe`, and the client declares none of its own. Every response is parsed on receipt and
      every outbound body is validated before the call. Extend the existing contract-skew guard
      (`packages/clients/recipe-service/src/contractSkew.ts`), and add no second guard. Tiers: unit on every mapped error
      status and on each parse failure; integration against a live response and a hand-skewed fixture.
- [ ] **T-021** The import-method chooser rows. `FR-046`. Only shipped methods are listed, paste and link are separate
      methods, and a pasted link is never fetched. Web and mobile together. Tiers: component tests for every row state;
      one Playwright flow and one Maestro flow.
- [ ] **T-023** Attribution display on recipes. `FR-010`. `RecipeAttribution` and `RecipeAttribution.native`, with an
      identical public API. A source that can no longer be verified shows as such. Tiers: component tests for a web source,
      an Instagram source, an unverifiable source and none, on both platforms.
- [ ] **T-024** The import error states. `FR-016`, `NFR-005`. An exhaustive switch over the error-code union, so a new
      code cannot ship without a rendering branch, each with a distinct message and next step. Tiers: a component test per
      code on both platforms.

## The ownership claim

- [ ] **T-040** Statement 1a on paste, link and social import. `FR-014a`, `FR-009`. Tiers: unit; integration; component
      tests; one Playwright and one Maestro flow.
- [ ] **T-041** The offer to verify the site, at import or later. `FR-014a`. Never pre-ticked, never a condition of
      saving, not repeated after a decline. Every state has copy and a localisation key. Tiers: component tests for
      offered, in progress, live, failed and declined.
- [ ] **T-043** The gate reads the claim as it stands each time it runs, and a lost claim stops clearing new hits at once.
      `FR-014a`, `020-FR-012g`. Tiers: unit; integration.
- [ ] **T-045** The "Save to Commise" screen offers the ownership claim. `FR-053`. Tiers: component tests; Playwright flow.
- [ ] **T-046** Claim ownership later, on a recipe already saved. `FR-055`. Tiers: unit; integration; component tests for
      offered, claimed, verifying, verified, failed and declined; one Playwright and one Maestro flow.
- [ ] **T-047** A social import clears its own-post hit only with a matching linked account. `FR-009`, `026-FR-061`.
      Tiers: unit; integration.

## The step check

- [ ] **T-038** The step check and its suggestions beside the ingredient-match review. `FR-054`. The rules are `020-FR-075`
      and `020-FR-076`. Tiers: component tests on both platforms; one Playwright and one Maestro flow.
- [ ] **T-039** The step suggestions in the review of a flagged recipe. `FR-054`. Tiers: component tests on both
      platforms.

---

## Verification gates

- [ ] **T-025** The end-to-end suite. Service e2e against a real Postgres and LocalStack (the shipped harness) for every
      channel, the duplicate choice, a blocked source and the holds. Web Playwright and mobile Maestro flows for every
      user story. `npm run lint`, `npm run typecheck`, `npm run test` and `npm run test:e2e` pass.
- [ ] **T-028** The mutation-score gates on the pure core (`D-010`): `policy/` and `normalize/` at 90%, the SSRF guard at
      95%, `extractors/` at 80%. I/O adapters are reported and not gated. A surviving mutant in a gated module is a test
      defect, fixed by strengthening the assertion, never by excluding the mutant or lowering the threshold. Config:
      `packages/services/recipe-service/stryker.conf.json`.
- [ ] **T-026** k6 load and soak for the server fetch. `SC-004`: p95 15 seconds and p99 30 seconds for a link import job.
      Outbound fetches target a local fixture server, never a third-party site. Soak to failure, and verify that
      over-capacity sheds `429` and does not queue without bound. Run by hand.
- [ ] **T-027** The `SC-002` held-out corpus and measurement. The corpus is stratified by extraction tier, hand-verified,
      captured as static fixtures so the measurement is deterministic and offline, with a report of each tier's coverage
      and wrong-yes bound (`SC-002`, `SC-003`, `D-009`). New pages go in `packages/shared/page-reader/src/__fixtures__/`, beside the page reader.
