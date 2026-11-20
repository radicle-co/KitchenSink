# Technical Plan: Feature 004 — Recipe Importing

**Feature**: `004-recipe-importing`
**Spec**: [spec.md](./spec.md). Tasks: [tasks.md](./tasks.md). Screens: [designSource.md](./designSource.md).
**Source of truth**: the shipped codebase. Where this plan and `main` disagree, `main` wins and this plan is wrong.

This plan covers only what is **not built**. What shipped is cited, not restated. A build of any remainder item below gets
its own plan that cites this one for the design and holds only build order, tasks and tests.

---

## 1. What shipped (cited, not restated)

| Shipped                                                                                                     | Where                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The client-driven import route `/api/v1/import`, the item model, holds, the one allowance, the 30-day purge | [ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md)                                             |
| A pasted web link sets the source, and a web copy stays private                                             | [ADR-0089](../../docs/architecture/decisions/0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md) |
| Imported recipes go public only as a Commise-written version                                                | [ADR-0093](../../docs/architecture/decisions/0093-imported-recipes-go-public-only-as-a-commise-written-version.md)   |
| The device page reader: JSON-LD, microdata, the rule-based reader, the paste caps                           | `packages/shared/page-reader`                                                                                        |
| Ingredient-line normalisation and the sanitiser shared by import channels                                   | `packages/shared/recipe-import-core`                                                                                 |
| The import service, advance steps, holds, refusals, view builder                                            | `packages/services/recipe-service/src/import/`                                                                       |
| The import wire contract (zod, authored in the service, copied to `@kitchensink/schema-recipe`)             | `packages/services/recipe-service/src/recipes/import.schema.ts`                                                      |
| The purge of an import's working data                                                                       | `packages/services/recipe-workers/src/import/importPurge.ts`                                                         |
| The shipped error codes                                                                                     | `RecipeErrorCode` in `packages/shared/recipe-core/src/recipe.types.ts`                                               |

---

## 2. The remainder

| Item                                                          | Spec                                               | Section |
| ------------------------------------------------------------- | -------------------------------------------------- | ------- |
| Server link fetch                                             | `FR-008`, `FR-023`, `FR-064`, `NFR-006`, `NFR-007` | 4       |
| The paid list as data, seeded                                 | `FR-014`, `D-004`                                  | 5       |
| The AI text-extraction fallback                               | `FR-056` to `FR-063`                               | 6       |
| The `family` statement kind and the other new statement kinds | `FR-011`, `FR-014a`                                | 7       |
| Page photos                                                   | `FR-008`, `D-020`                                  | 8       |
| The bulk library-duplicate rule                               | `FR-068`                                           | 9       |
| Duplicate lookup and Replace                                  | `FR-008`, C-001                                    | 10      |
| The AI-attempt spend signal                                   | `FR-061`                                           | 6       |

Not in this plan: the Commise-written public version (spec 003B), the on-device AI tier's account setting (designed in
[designSource.md](./designSource.md) as owed), social video reads (spec 017 and `FR-009`, planned on their own), and photo
import (spec 011).

---

## 3. Pattern register

| Where                                    | Pattern                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `FetchSignalPolicy`, paid classification | **Policy / Specification**: pure functions from signals to allow or deny, no I/O                                                  |
| The server fetcher                       | **Ports and Adapters**: a `SourceFetcher` port, with an adapter on `undici` whose dispatcher is pinned to the validated address   |
| The extractor chain                      | **Strategy set with Chain of Responsibility** (C-007 in the spec): one interface, each tier a strict yes or no                    |
| The AI fallback job                      | **Command** over a queue, with its own dead-letter queue                                                                          |
| Statement kinds                          | A **discriminated union** with an exhaustive `switch` at the convergence point (`FR-047`): the language feature satisfies Visitor |
| The import advance steps                 | Shipped. Do not add machinery around them                                                                                         |

---

## 4. Server link fetch (`FR-008`, `FR-023`, `FR-064`)

The server fetch runs when the cook's device cannot fetch a link, and on web it usually runs. It never runs for a paste
and never for a known paid site.

### Outbound fetch budget (`NFR-006`)

| Control               | Value                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Connect timeout       | 3 s                                                                                           |
| Total request timeout | 10 s                                                                                          |
| Max redirects         | 5, with the SSRF checks re-run on every hop                                                   |
| Max response bytes    | 5 MB, aborted on exceed, streamed and not buffered                                            |
| Content types         | `text/html`, `application/xhtml+xml` only                                                     |
| User-Agent            | `Commise/1.0 (+https://commise.app/bot)`                                                      |
| Circuit breaker       | Per registrable domain, with `cockatiel` and a half-open probe                                |
| Retry                 | Idempotent GET only, transient failures only, 2 attempts, exponential backoff and full jitter |
| Bulkhead              | Bounded concurrency for outbound fetches, separate from the database pool                     |

### SSRF defence (`NFR-007`, `D-018`: non-waivable)

1. Reject non-`http(s)` schemes before anything else.
2. Resolve the host and check every resolved address with `ipaddr.js`. Reject loopback, private (RFC 1918), link-local
   (including `169.254.169.254`), CGNAT, unique-local and unspecified ranges.
3. Pin the connection to the validated address through a custom `undici` dispatcher, which closes the DNS-rebinding
   window between check and connect.
4. Re-run steps 1 to 3 for every redirect hop.
5. No outbound request carries credentials, cookies or `Authorization`.

**Tests are written first.** Integration cases are named: a redirect to a private address, a DNS answer that resolves to
a private address, and IPv6 and IPv4-mapped forms. The policy is under the mutation lens (`D-010`).

### Robots and data-mining opt-outs (`FR-023`, `D-007`)

`robots.txt` is fetched once per host and cached with a TTL. Group selection follows RFC 9309: the group that names our
agent binds the fetch, and if no group names it the `*` group binds it. Both a bare `Disallow: /` and a path-specific
`Disallow` block. A `robots.txt` that answers `4xx` means no rules apply. One that is unreachable (`5xx`, timeout or network error) is a
full disallow, reported as `IMPORT_SOURCE_BLOCKED`. For unparseable content, parse what can be read (RFC 9309). A fetch of
it that times out does not extend the import's own budget. A paste is never checked.

The same pre-fetch step reads TDMRep (`/.well-known/tdmrep.json` and the `tdm-reservation` header), `noai` and
`noimageai` tags, AI-crawler blocks (GPTBot, ClaudeBot, Google-Extended, CCBot) and Content Signals `ai-input=no`. A pure
`FetchSignalPolicy` returns allow or deny from the signals. The fetch writes one signal log row per fetch with what each
signal said, including "none found". An opt-out on a fetched page also gates the AI fallback (`FR-063`). The fetch never
passes a payment gate or a login, never uses a cook's cookies and never rotates addresses. Every robots-derived block
increments a counter (`robots_block_rate`) so the rule can be reviewed on evidence.

### Paid pre-check (`FR-014`)

Before any outbound request, the fetch asks the paid classification. A known paid site is not fetched, and the response
tells the client to ask the cook to paste the page.

### Burst limits and errors

Burst limiting reuses the shipped `@nestjs/throttler`: `10/min/user` on the link fetch. It is a transport limit on a write
route, not a product allowance. The allowance is `FR-067`, shipped.

The fetch adds these codes to `RecipeErrorCode`, mapped in `ApiExceptionFilter`. `422` is for policy and extraction
failures: the request is well formed but semantically unprocessable.

| Code                          | HTTP  | Meaning                                                                                         |
| ----------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `IMPORT_SOURCE_BLOCKED`       | `422` | The source's robots.txt or a data-mining opt-out forbids the fetch. Nothing else uses this code |
| `IMPORT_SOURCE_UNREACHABLE`   | `422` | DNS, TLS, timeout, 4xx or 5xx from the source                                                   |
| `IMPORT_NO_RECIPE_FOUND`      | `422` | Fetched, with no recognisable recipe                                                            |
| `IMPORT_NO_CAPTION`           | `422` | An Instagram post has no recipe text in its caption (the official-API path, `D-002`)            |
| `IMPORT_PAYLOAD_TOO_LARGE`    | `413` | The response exceeded its bound                                                                 |
| `IMPORT_PROVIDER_UNAVAILABLE` | `503` | The circuit is open or the provider is down. Retryable                                          |

A duplicate is not an error (`FR-008`).

---

## 5. The paid list as data (`FR-014`, `D-004`)

One table, with an admin-scoped endpoint and an audit trail.

| Column     | Meaning                        |
| ---------- | ------------------------------ |
| `domain`   | The registrable domain. Unique |
| `reason`   | Why it is on the list          |
| `added_by` | The admin principal            |
| `added_at` | When                           |

The table is seeded in the same build item as the server fetch, from a starting list of known paid recipe sites that
product supplies. An empty list on day one would let the server fetch a known paid site. The list classifies a source and
blocks only the server fetch. Updating it is an operational action, not a release. Any operator screen for it is owed a
design ([designSource.md](./designSource.md)) and is not planned here.

---

## 6. The AI text-extraction fallback (`FR-056` to `FR-063`)

- **Job**: a separate asynchronous job in recipe-workers, with its own Lambda, its own queue, its own dead-letter queue and
  its own reserved concurrency. It runs under the existing single Bedrock role (ADR-0024 §4c), so the set of Bedrock
  grantees does not change. It is not a parse-job leg (ADR-0026).
- **Spend**: call site `'text-extraction'`, a new member of `SPEND_CALL_SITES`. It reserves before the call and settles
  after (ADR-0024).
- **Egress**: the Lambda is VPC-attached, so it is an ADR-0004 NAT consumer and the `nat-consumers` table gains a row.
- **Input**: the cook's lines are numbered and sent. The model answers with line numbers only (`FR-057`). The input cap is
  48,000 UTF-8 bytes of reduced text, refused over the cap and never truncated (`FR-058`). The constant is named when it is
  built.
- **Cost rule**: a failed attempt (`budgetSpent`, `failed`) costs no import (`FR-061`). There is no per-cook cap on attempts.
  The shared AI ceiling (ADR-0024) bounds spend.
- **Attempt signal**: the fallback's spend metrics carry a per-principal attempt count, and an alarm fires when one
  principal's share of the month's ceiling passes a set fraction. It is detection, not a cap. The fraction is chosen at
  build. Metrics carry `Stage` (ADR-0062).
- **ADR**: a new ADR records the fallback's queue, role and call site. Its number is the next free number when it is
  written (0095 at the time of this plan).
- **Result**: a row with an expiry. The pasted text is deleted when the job leaves `pending`. Erasure and the
  test-principal purge cover the row.

---

## 7. Statement kinds (`FR-011`, `FR-014a`)

The shipped schema holds the statement kinds `authored` and `source`. The remainder adds `family`, `adapted` and
`publicDomain`, in this order of need.

- **`family`** is "From another person". It is stored with `sourceType = user_created` and the kind `family`, and it is
  private only through the visibility policy until spec 016's family source type ships. Its label and credit come from the
  kind and never read "Written by you". The build is an expand-only CHECK migration, one wire member in
  `import.schema.ts`, and a label test over the statement-to-label table.
- **`adapted`** and **`publicDomain`** follow spec 016's data model (§15 of its data-model document), and the curator grant
  for the latter.

The statement-to-label table in `FR-014a` is the one authority. The convergence point's exhaustive `switch` reads it, and
a new kind is a compile error until it is handled.

---

## 8. Page photos (`FR-008`, GATED, see `D-020`)

The device fetches the page's main photo and saves it to the private copy through the existing photo upload path, which
syncs. The fallback is a link plus a device-only display of the source photo, never saved. The server never fetches a
photo. The import contract gains the photo field only in this build. Both routes are gated by `D-020`: they ship only
after the owner records a release sign-off.

---

## 9. The bulk library-duplicate rule (`FR-068`)

A bulk item whose web address matches a recipe in the cook's library shows "Already in your library", is skipped by
default, and offers "Import as a new copy". The match key is the export's web address for that item, normalised the way
C-001 says, and it matches only library recipes that carry a `source_url`. A typed or book recipe never matches. Shipped
bulk has no library-duplicate check, so this is new behaviour. The build reads the address from the export file, because
shipped bulk items carry no source of their own.

---

## 10. Duplicate lookup and Replace

Duplicate lookup and Replace: built by 003B (`specs/003B-public-rewrite/`); not on main when this plan was written.

---

## 11. Tiers each build writes test-first

Every remainder item writes these tiers before its code (`docs/CODING_STANDARDS.md` §7.1):

- **Unit** for every policy: SSRF address and redirect, `FetchSignalPolicy`, paid classification, the statement-to-label
  table including `family`, and the `FR-068` match key. Policies are under the mutation lens.
- **Integration**, with the database mocked ([ADR-0032](../../docs/architecture/decisions/0032-deployed-ecosystem-test-tier.md)):
  routes, the fallback Command, and the queue and dead-letter handler. The SSRF cases are named in section 4.
- **Contract**: the `family` member and the new error codes, with `contract:generate` leaving no diff and schema tests that
  accept and reject.
- **LOCAL e2e** for each migration (the paid list table, the `family` CHECK).
- **Service e2e** for the server fetch and the fallback.
- **Component tests** (RTL) for every UI state, on web and `.native`.
- **One Playwright flow and one Maestro flow per user story**: the paste fallback, the link import and the bulk "Already in
  your library" state.
- **k6**, by hand.

---

## 12. Observability and SLOs (`NFR-009`)

- **SLIs**: import success rate and latency per channel; extractor tier hit rate; the fallback's states and spend; the
  per-principal attempt count; robots block rate; circuit-breaker state.
- **SLOs**: `SC-004` latency on the server fetch path. Success rate is 97% or better, excluding user-caused failures
  (`IMPORT_SOURCE_BLOCKED`, `IMPORT_NO_RECIPE_FOUND`).
- Structured logs carry a correlation id across the API, the queue and the worker, matching the shipped logger.
- **Never log** a pasted body or a fetched page body (third-party content, possible personal data).

---

## 13. Open items

1. **Meta app approval** for the Instagram official-API path: an external workstream. The capability flag defaults off
   (`D-002`).
2. **The held-out corpus for `SC-002`**: it is hand-verified, and `D-009` describes it.
3. **The alarm fraction** for the attempt signal (section 6) and the ADR number: chosen at build.

---

## 14. Complexity Tracking

Deviations from the constitution and standards, per `docs/CODING_STANDARDS.md` §14.1, which requires any single-platform
rollout to be waived here explicitly.

| Deviation                                                      | Why needed                                                                            | Simpler alternative rejected because                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Web HTML paste ships before the mobile paste row (`FR-062`)    | The page reader and the AI-free tiers are ready on web first, and the fallback is not | Holding web back delays the shipped paste for no gain                   |
| The Instagram official-API path ships behind a capability flag | `D-002`: the credential is externally gated and cannot be had on our schedule         | Blocking release on a review queue, or deleting a specified requirement |

The web-first exception is for paste only. It ends when `FR-056` to `FR-063` pass their tiers, and mobile then ships the
same outcomes. No other single-platform waiver is claimed.
