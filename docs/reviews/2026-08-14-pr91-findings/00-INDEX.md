# PR 91 — authoritative findings index

> Generated from the 18 reports in this directory. **203 findings.**

> IDs are `<report>.<local>` because `A-1` and `P-1` are **reused across six documents** — local IDs alone are ambiguous.

> `Status` is the acceptance criterion for requirement R3.4: every row must end as `fixed`, `rejected` (with a reason) or `deferred` (with a target). **Every row is dispositioned as of plan unit U12 (2026-08-16); none reads `open`.** The one-word status links to its entry under _Dispositions_, which carries the reason or the trigger and is the authoritative text.

> **REFUTED / SUPPORTED rows are attacks that FAILED** — the design held. They need no fix; they are listed so the reasoning survives. ⚠️ **Report 11 states its verdicts about the CLAIM UNDER ATTACK, the inverse of reports 12 and 13** (`11-adversarial-004-011-split.md:7-9` vs `13-adversarial-topology.md:6-7`): there, `SURVIVES` means the attack failed and `REFUTED`/`WEAKENED` means it landed. Applying the blanket rule to report 11 would wrongly reject seven findings that landed.

## What a disposition means here

- **`fixed`** — the change is in the tree now, with the tiers §7.1 requires for its category. The entry names the commit or the file.
- **`rejected`** — with a reason a reviewer can check WITHOUT reading code: a false premise disproved at a named file and line, an owner ruling, or an attack the report itself withdrew.
- **`deferred`** — with a TRIGGER, never a date: a named plan unit, a feature spec that owns it, or a measurable condition.

Two classes of row are worth reading before the table. **Verified-false premises** were rejected on evidence rather than on judgement — 01.F-R7 and 02.F-F3 both describe machinery that U4/U5/U6 shipped, and 07.F-T14 describes a duplication that ADR-0014 deliberately forbids. **Unbuilt-surface risks** (most of report 23) are deferred against the spec that must carry the control, because a risk in a surface with zero lines of code is not a live defect — `tesseract`, `OcrProvider` and any image-upload route return zero hits across the tree and the lockfile.

## Counts

| Severity / verdict | Count   |
| ------------------ | ------- |
| CRITICAL           | 6       |
| HIGH               | 38      |
| MED                | 56      |
| LOW                | 25      |
| SURVIVES           | 18      |
| WEAKENED           | 1       |
| UNSUPPORTED        | 10      |
| WEAK               | 4       |
| REFUTED            | 2       |
| UNSET              | 43      |
| **TOTAL**          | **203** |

### Dispositions (U12, 2026-08-16)

| Disposition | Count   |
| ----------- | ------- |
| `fixed`     | 17      |
| `rejected`  | 32      |
| `deferred`  | 154     |
| **TOTAL**   | **203** |
| **`open`**  | **0**   |

Of the 154 deferrals, the largest single destination is the 004–014 respec (U13/U14): the portfolio's specs contradict each other and the amended ADRs, and no amount of code fixes a contradiction between two documents. The next largest is "the next change to this file", used where a defect is real, small and sitting in a file another unit is actively rewriting — recorded rather than raced.

## Findings

| ID            | Report                                 | Severity / verdict                                                     | Finding                                                                                            | Status                 |
| ------------- | -------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------- |
| `05.F-S1`     | 05-cross-feature-specs.md              | CRITICAL                                                               | 004's plan, tasks and V-Model still ship the Textract OCR channel at launch                        | [deferred](#05fs1)     |
| `05.F-S2`     | 05-cross-feature-specs.md              | CRITICAL                                                               | 011 still builds a stateful `digitization_jobs` service with its own save path                     | [deferred](#05fs2)     |
| `05.F-S3`     | 05-cross-feature-specs.md              | CRITICAL                                                               | 006's spec answers "which service owns 006" both ways, and its tasks pick the wrong one            | [deferred](#05fs3)     |
| `05.F-S4`     | 05-cross-feature-specs.md              | CRITICAL                                                               | 005 and 006 both claim ALB base priority 400 and cite retired bands                                | [deferred](#05fs4)     |
| `07.F-T1`     | 07-test-coverage.md                    | Critical                                                               | The whole mobile vitest E2E tier tests a function defined inside the test file                     | [deferred](#07ft1)     |
| `09.F-DB1`    | 09-data-model.md                       | Critical (as a constraint to preserve                                  | The single-writer rule holds today, but nothing records why                                        | [deferred](#09fdb1)    |
| `01.F-R1`     | 01-recipe-service.md                   | HIGH                                                                   | Nutrient projection picks kJ over kcal and saturated fat over total fat                            | [fixed](#01fr1)        |
| `01.F-R2`     | 01-recipe-service.md                   | HIGH                                                                   | `resolve`'s converge-only guard is read-then-act with no compare-and-swap                          | [deferred](#01fr2)     |
| `01.F-R3`     | 01-recipe-service.md                   | HIGH                                                                   | Ingredients `search`/`suggest` bypass their own published query schema                             | [deferred](#01fr3)     |
| `01.F-R5`     | 01-recipe-service.md                   | HIGH (readiness blocker for ADR-                                       | No machine credential exists for a background import to call food                                  | [deferred](#01fr5)     |
| `02.F-F1`     | 02-food-service.md                     | High (unauthenticated remote memory exhaustion                         | Auth load shedder's per-source map is keyed by a spoofable header and never evicted                | [fixed](#02ff1)        |
| `02.F-F2`     | 02-food-service.md                     | High (backpressure permanently corrupts food rows                      | Admission shed strands committed `PENDING` rows with no queue row                                  | [deferred](#02ff2)     |
| `02.F-F3`     | 02-food-service.md                     | High (confirms the suspicion                                           | Food's events go to stdout; no bus adapter and no SDK exist                                        | [rejected](#02ff3)     |
| `03.F-U1`     | 03-apps-ui.md                          | High (correctness                                                      | Rename without an id falls through to CREATE on web, silent no-op on mobile                        | [deferred](#03fu1)     |
| `03.F-U2`     | 03-apps-ui.md                          | High (mobile layout                                                    | No keyboard avoidance on any authoring or search surface but the three Clerk screens               | [deferred](#03fu2)     |
| `03.F-U3`     | 03-apps-ui.md                          | High (mobile layout                                                    | The FAB overlaps the last recipe card by 56pt                                                      | [deferred](#03fu3)     |
| `03.F-U4`     | 03-apps-ui.md                          | High (state completeness                                               | The recipe-detail error state renders with zero styling, including an unstyled Retry               | [deferred](#03fu4)     |
| `04.F-I1`     | 04-infra-ci.md                         | High (planning blocker                                                 | The accepted service roster is nine against eight reserved ephemeral ALB slots                     | [deferred](#04fi1)     |
| `04.F-I2`     | 04-infra-ci.md                         | High                                                                   | 006's V-Model prescribes listener bands above the 50,000 ALB ceiling                               | [deferred](#04fi2)     |
| `05.F-S5`     | 05-cross-feature-specs.md              | HIGH                                                                   | 007's data model declares foreign keys across three databases                                      | [deferred](#05fs5)     |
| `05.F-S6`     | 05-cross-feature-specs.md              | HIGH                                                                   | 009's FKs are cross-database, and ADR-0017's 006-009 rationale is stale                            | [deferred](#05fs6)     |
| `05.F-S7`     | 05-cross-feature-specs.md              | HIGH                                                                   | 004's import-spine requirements exist only as prose in spec.md                                     | [deferred](#05fs7)     |
| `05.F-S8`     | 05-cross-feature-specs.md              | HIGH                                                                   | 011's spec says the premium OCR gate is both optional and binding                                  | [deferred](#05fs8)     |
| `06.F-D1`     | 06-identity-shared.md                  | HIGH                                                                   | Handle-sync producer and consumer disagree on bounds, and drops are silent                         | [deferred](#06fd1)     |
| `06.F-D2`     | 06-identity-shared.md                  | HIGH                                                                   | GDPR erasure leaves the avatar photograph readable in S3, two ways                                 | [deferred](#06fd2)     |
| `06.F-D3`     | 06-identity-shared.md                  | HIGH                                                                   | Admin suspend/unsuspend have no lifecycle guard, so erased users resurrect                         | [deferred](#06fd3)     |
| `06.F-D4`     | 06-identity-shared.md                  | HIGH                                                                   | The erasure fan-out parses responses unsafely and fails OPEN on food                               | [deferred](#06fd4)     |
| `07.F-T2`     | 07-test-coverage.md                    | High                                                                   | Mobile's default test glob swallows the E2E tier                                                   | [deferred](#07ft2)     |
| `07.F-T3`     | 07-test-coverage.md                    | High                                                                   | A tautological "performance" spec runs in the default Test job                                     | [deferred](#07ft3)     |
| `07.F-T4`     | 07-test-coverage.md                    | High                                                                   | No guard holds vitest tiers to CI, though the same failure has happened twice                      | [deferred](#07ft4)     |
| `07.F-T5`     | 07-test-coverage.md                    | High                                                                   | The visual-regression gate is inert: `ARGOS_ENABLED` is not set                                    | [deferred](#07ft5)     |
| `08.F-SEC1`   | 08-security.md                         | HIGH                                                                   | Load shedder keyed on a spoofable header and never evicted — memory-exhaustion DoS                 | [fixed](#08fsec1)      |
| `08.F-SEC2`   | 08-security.md                         | HIGH                                                                   | `PATCH /foods/{id}` `candidateIds` is unbounded and un-deduped, draining the USDA hour             | [deferred](#08fsec2)   |
| `08.F-SEC3`   | 08-security.md                         | HIGH                                                                   | `sharp` 0.34.5 decodes attacker-supplied bytes in-process against live libvips CVEs                | [deferred](#08fsec3)   |
| `09.F-DB14`   | 09-data-model.md                       | High (spec defect blocking implementation of both features)            | 28 of the 29 foreign keys 007 and 009 assert cannot exist                                          | [deferred](#09fdb14)   |
| `09.F-DB2`    | 09-data-model.md                       | High                                                                   | A shed enqueue leaves a permanently-PENDING orphan shell                                           | [deferred](#09fdb2)    |
| `09.F-DB3`    | 09-data-model.md                       | High                                                                   | `ingredients` can represent four illegal placeholder states                                        | [deferred](#09fdb3)    |
| `09.F-DB4`    | 09-data-model.md                       | High                                                                   | The status projection has no index and no freshness anchor                                         | [deferred](#09fdb4)    |
| `09.F-DB5`    | 09-data-model.md                       | High                                                                   | Nothing exists for per-recipe bulk-import status                                                   | [deferred](#09fdb5)    |
| `09.F-DB6`    | 09-data-model.md                       | High                                                                   | Unresolved and failed shells are published to every user's ingredient typeahead                    | [deferred](#09fdb6)    |
| `09.F-DB7`    | 09-data-model.md                       | High                                                                   | Recipe-side status transitions are unguarded and carry no sequence                                 | [deferred](#09fdb7)    |
| `19.P-1`      | 19-privacy.md                          | High today                                                             | "Erase my account" never reaches identity or Clerk; it erases the recipe domain only               | [fixed](#19p1)         |
| `19.P-4`      | 19-privacy.md                          | High today                                                             | A user's raw typed ingredient string becomes a permanent, ownerless, globally-searchable row       | [deferred](#19p4)      |
| `19.P-8`      | 19-privacy.md                          | High as a design risk                                                  | Privacy is sold, not defaulted: photo import is premium-only and free recipes cannot be private    | [rejected](#19p8)      |
| `01.F-R4`     | 01-recipe-service.md                   | MED                                                                    | Publishing an empty stored draft raises off-contract `BAD_REQUEST`, untested                       | [deferred](#01fr4)     |
| `01.F-R6`     | 01-recipe-service.md                   | MED (readiness)                                                        | Import-scale ingredient resolution is one food call per name, unbounded                            | [deferred](#01fr6)     |
| `01.F-R7`     | 01-recipe-service.md                   | MED (readiness)                                                        | Status envelope has no package that can author and publish it                                      | [rejected](#01fr7)     |
| `02.F-F4`     | 02-food-service.md                     | Medium (confirms the suspicion                                         | Food client parses a non-JSON error body outside the try, throwing a raw `SyntaxError`             | [deferred](#02ff4)     |
| `02.F-F5`     | 02-food-service.md                     | Medium (coverage theatre                                               | The ALB-HTML client test cannot emit a non-JSON body, so it proves nothing                         | [deferred](#02ff5)     |
| `02.F-F6`     | 02-food-service.md                     | Medium (change-refresh covers a fixed prefix of the catalogue forever) | Change-refresh rescans the same 1,000 oldest rows forever, never the rest                          | [deferred](#02ff6)     |
| `03.F-U10`    | 03-apps-ui.md                          | Medium (mobile layout                                                  | The native recipe-card title is unclamped where web has `line-clamp-2`                             | [deferred](#03fu10)    |
| `03.F-U11`    | 03-apps-ui.md                          | Medium (touch targets                                                  | ~26-32pt hand-rolled Pressables bypass the `@commise/ui` 44pt touch floor                          | [deferred](#03fu11)    |
| `03.F-U12`    | 03-apps-ui.md                          | Medium (state completeness                                             | Wizard submit-failure text is unstyled and flush against x = 0                                     | [deferred](#03fu12)    |
| `03.F-U13`    | 03-apps-ui.md                          | Medium (cross-platform state gap                                       | The mobile collection form submits an untrimmed or empty name; web rejects it                      | [deferred](#03fu13)    |
| `03.F-U5`     | 03-apps-ui.md                          | Medium-High (state completeness                                        | A rename seed-fetch error renders a blank but functional rename form                               | [deferred](#03fu5)     |
| `03.F-U6`     | 03-apps-ui.md                          | Medium-High (layout                                                    | "Remove {title}" is the visible label and cannot shrink, crushing the title                        | [deferred](#03fu6)     |
| `03.F-U7`     | 03-apps-ui.md                          | Medium-High (mobile layout                                             | The photo-queue failure reason is white-on-`#F5F5F5` (~1.08:1) and clipped                         | [deferred](#03fu7)     |
| `03.F-U8`     | 03-apps-ui.md                          | Medium (mobile layout                                                  | The native photo grid is three columns at every width, with ~21pt controls                         | [deferred](#03fu8)     |
| `03.F-U9`     | 03-apps-ui.md                          | Medium (web layout                                                     | The web bottom tab bar has a fixed 64px height six labels can overflow                             | [deferred](#03fu9)     |
| `04.F-I3`     | 04-infra-ci.md                         | Medium                                                                 | ADR-0003 records only the adjustable rules quota, not the target-group one                         | [deferred](#04fi3)     |
| `04.F-I4`     | 04-infra-ci.md                         | Medium                                                                 | ECR repos have no lifecycle policy, and teardown's ECR sweeps match nothing                        | [deferred](#04fi4)     |
| `04.F-I5`     | 04-infra-ci.md                         | Medium (residual                                                       | Sandbox deploy jobs hold prod-capable static keys, and ECR tags are MUTABLE                        | [deferred](#04fi5)     |
| `05.F-S10`    | 05-cross-feature-specs.md              | MEDIUM                                                                 | GR-011's AC-011-b is unmet — only 003 declares a 014 dependency                                    | [deferred](#05fs10)    |
| `05.F-S11`    | 05-cross-feature-specs.md              | MEDIUM                                                                 | The cross-feature FR registry is missing every 2026-08-14 citation                                 | [deferred](#05fs11)    |
| `05.F-S12`    | 05-cross-feature-specs.md              | MEDIUM                                                                 | 003's spec and plan document the deprecated bare `/v1/foods` as canonical                          | [deferred](#05fs12)    |
| `05.F-S13`    | 05-cross-feature-specs.md              | MEDIUM                                                                 | Four features' task lists leave requirements untraced, 006 worst                                   | [deferred](#05fs13)    |
| `05.F-S14`    | 05-cross-feature-specs.md              | MEDIUM                                                                 | Six new ALB-attached deployables are declared against five free slots                              | [deferred](#05fs14)    |
| `05.F-S9`     | 05-cross-feature-specs.md              | MEDIUM                                                                 | Governance ledgers GR-015/GR-016/GR-002 went stale within two days                                 | [deferred](#05fs9)     |
| `06.F-D5`     | 06-identity-shared.md                  | MEDIUM                                                                 | The avatar presign returns a `publicUrl` that answers 403 to everyone                              | [deferred](#06fd5)     |
| `06.F-D6`     | 06-identity-shared.md                  | MEDIUM                                                                 | A Lambda deployable imports another deployable service's source                                    | [deferred](#06fd6)     |
| `06.F-D7`     | 06-identity-shared.md                  | MEDIUM (root cause of F-D                                              | The only live bus contract is declared twice, in two different mechanisms                          | [deferred](#06fd7)     |
| `06.F-D8`     | 06-identity-shared.md                  | MEDIUM                                                                 | The failed-enqueue residual note understates the cross-service exposure                            | [deferred](#06fd8)     |
| `07.F-T10`    | 07-test-coverage.md                    | Medium                                                                 | The only Playwright spec that talks to a real backend is gated on an unset env var                 | [rejected](#07ft10)    |
| `07.F-T11`    | 07-test-coverage.md                    | Medium                                                                 | `passWithNoTests: true` turns a broken include glob into a green tier                              | [deferred](#07ft11)    |
| `07.F-T12`    | 07-test-coverage.md                    | Medium                                                                 | Coverage is never measured anywhere                                                                | [deferred](#07ft12)    |
| `07.F-T13`    | 07-test-coverage.md                    | Medium                                                                 | Non-UI libraries and clients have unit tests only; §7.1 requires both tiers                        | [deferred](#07ft13)    |
| `07.F-T15`    | 07-test-coverage.md                    | Medium (                                                               | No end-to-end coverage of the async PENDING to RESOLVED transition on either platform              | [deferred](#07ft15)    |
| `07.F-T6`     | 07-test-coverage.md                    | Medium-High                                                            | identity-webhooks is a deployable HTTP API with no k6 tier                                         | [deferred](#07ft6)     |
| `07.F-T7`     | 07-test-coverage.md                    | Medium                                                                 | The web last-resort error boundary is tested only for its Sentry side effect                       | [deferred](#07ft7)     |
| `07.F-T8`     | 07-test-coverage.md                    | Medium                                                                 | recipe-service's DB pool config has zero tests while its stated mirror has them                    | [deferred](#07ft8)     |
| `07.F-T9`     | 07-test-coverage.md                    | Medium                                                                 | Two committed Maestro flows are executed by nothing                                                | [deferred](#07ft9)     |
| `08.F-SEC4`   | 08-security.md                         | MED                                                                    | `PATCH /foods/{id}` has no authorization beyond authenticated, and records no actor                | [deferred](#08fsec4)   |
| `08.F-SEC5`   | 08-security.md                         | MED                                                                    | zod v4 `z.url()` accepts any scheme, so `avatarUrl`/`sourceUrl` admit `javascript:`/`data:`        | [deferred](#08fsec5)   |
| `08.F-SEC6`   | 08-security.md                         | MED                                                                    | Nine collections routes pass an unvalidated path param into a uuid column                          | [deferred](#08fsec6)   |
| `08.F-SEC7`   | 08-security.md                         | MED                                                                    | Unbounded `ParseIntPipe` writes an out-of-int4-range `versionNumber` into an integer column        | [deferred](#08fsec7)   |
| `08.F-SEC8`   | 08-security.md                         | MED                                                                    | recipe-service alone leaves the dev-auth bypass armed on deployed non-prod stages                  | [deferred](#08fsec8)   |
| `08.F-SEC9`   | 08-security.md                         | MED                                                                    | Web runs Next 15.5.19 with HIGH Server-Action and image advisories                                 | [deferred](#08fsec9)   |
| `09.F-DB10`   | 09-data-model.md                       | Medium                                                                 | `recipe_versions.created_by` has no index                                                          | [deferred](#09fdb10)   |
| `09.F-DB11`   | 09-data-model.md                       | Medium                                                                 | The handle fan-out cannot use the partial `idx_recipes_owner_id`                                   | [deferred](#09fdb11)   |
| `09.F-DB12`   | 09-data-model.md                       | Medium                                                                 | Two `recipes` indexes no longer match the shipped read predicate                                   | [deferred](#09fdb12)   |
| `09.F-DB16`   | 09-data-model.md                       | Medium (design risk                                                    | The food contract has a batch WRITE but no batch STATUS READ                                       | [deferred](#09fdb16)   |
| `09.F-DB8`    | 09-data-model.md                       | Medium                                                                 | No status history exists, and the one field that could explain a failure is cleared on retry       | [deferred](#09fdb8)    |
| `09.F-DB9`    | 09-data-model.md                       | Medium (High under ADR-                                                | A never-resolvable name is re-enqueued forever, and bulk import makes it a queue flood             | [deferred](#09fdb9)    |
| `19.P-10`     | 19-privacy.md                          | Medium                                                                 | The Article 15/20 export covers the recipe domain only                                             | [deferred](#19p10)     |
| `19.P-11`     | 19-privacy.md                          | Medium                                                                 | Avatar objects survive a webhook-triggered erasure                                                 | [deferred](#19p11)     |
| `19.P-2`      | 19-privacy.md                          | Medium today                                                           | On-device OCR relocates the retention obligation rather than reducing it                           | [deferred](#19p2)      |
| `19.P-3`      | 19-privacy.md                          | Medium today                                                           | D1 and D2 create two processing operations, two retention regimes and two disclosures              | [deferred](#19p3)      |
| `19.P-5`      | 19-privacy.md                          | Medium                                                                 | The freeform dedup index makes the first typist the permanent global owner of a string             | [deferred](#19p5)      |
| `19.P-6`      | 19-privacy.md                          | Medium today                                                           | D4's live nutrition reference silently rewrites a data subject's historical health record          | [deferred](#19p6)      |
| `19.P-7`      | 19-privacy.md                          | Medium today                                                           | Dropping Textract changes the processor set, and nothing in the repo records one                   | [deferred](#19p7)      |
| `01.F-R10`    | 01-recipe-service.md                   | LOW                                                                    | Two swallowed-exception sites log via `console.error`, not the Nest `Logger`                       | [deferred](#01fr10)    |
| `01.F-R8`     | 01-recipe-service.md                   | LOW                                                                    | `addByFoodId` can regress a settled shared row to a non-terminal status                            | [deferred](#01fr8)     |
| `01.F-R9`     | 01-recipe-service.md                   | LOW                                                                    | Five docstrings cite a bare `FR-047` that now names two requirements                               | [deferred](#01fr9)     |
| `02.F-F7`     | 02-food-service.md                     | Low (an operator-facing knob that is validated                         | `FOOD_STALE_THRESHOLD_DAYS` is boot-validated and documented but read by nothing                   | [deferred](#02ff7)     |
| `02.F-F8`     | 02-food-service.md                     | Low (a wire-boundary                                                   | `Retry-After` parsed with a bare `Number()`, so an HTTP-date yields `NaN`                          | [deferred](#02ff8)     |
| `03.F-U14`    | 03-apps-ui.md                          | Low-Medium (localization                                               | Three `[locale]` routes export hard-coded English `Metadata`                                       | [deferred](#03fu14)    |
| `03.F-U15`    | 03-apps-ui.md                          | Low (mobile layout                                                     | The wizard footer row cannot wrap; templated Prev/Next collide at 360pt                            | [deferred](#03fu15)    |
| `03.F-U16`    | 03-apps-ui.md                          | Low (mobile layout                                                     | The USDA badge sits in the search row and never shrinks, squeezing the input                       | [deferred](#03fu16)    |
| `04.F-I6`     | 04-infra-ci.md                         | Low                                                                    | `workflow_dispatch` yields the image tag `pr--<sha>` and a bogus web origin                        | [deferred](#04fi6)     |
| `05.F-S15`    | 05-cross-feature-specs.md              | LOW                                                                    | The cross-feature consistency report still describes a pre-code portfolio                          | [deferred](#05fs15)    |
| `06.F-D10`    | 06-identity-shared.md                  | LOW                                                                    | Two erasure-path docstrings describe an unbuilt system that is built                               | [deferred](#06fd10)    |
| `06.F-D11`    | 06-identity-shared.md                  | LOW (defence-in-depth                                                  | The dev-auth bypass gates on `NODE_ENV`, not the repo's stage predicate                            | [deferred](#06fd11)    |
| `06.F-D9`     | 06-identity-shared.md                  | LOW                                                                    | The "one display-name rule" exists twice and the two disagree on whitespace                        | [deferred](#06fd9)     |
| `07.F-T14`    | 07-test-coverage.md                    | Low                                                                    | `packages/schemas/*` have no test script, so `turbo run test` skips them                           | [rejected](#07ft14)    |
| `07.F-T16`    | 07-test-coverage.md                    | Low                                                                    | Cross-platform parity gap on the exact component 004 will duplicate                                | [deferred](#07ft16)    |
| `08.F-SEC10`  | 08-security.md                         | LOW                                                                    | food-service has no rate limiting, CORS policy or security headers                                 | [deferred](#08fsec10)  |
| `08.F-SEC11`  | 08-security.md                         | LOW                                                                    | Collections return 403 where recipes deliberately return 404                                       | [deferred](#08fsec11)  |
| `08.F-SEC12`  | 08-security.md                         | LOW                                                                    | Search filters and recipe steps/dietary flags carry no upper bound                                 | [deferred](#08fsec12)  |
| `08.F-SEC13`  | 08-security.md                         | LOW                                                                    | Avatar upload never re-validates the uploaded bytes; the photo path does                           | [deferred](#08fsec13)  |
| `08.F-SEC14`  | 08-security.md                         | LOW                                                                    | Three route families hand-roll parsing that ADR-0015 requires in the pipe                          | [deferred](#08fsec14)  |
| `09.F-DB13`   | 09-data-model.md                       | Low                                                                    | `recipe_ingredients` denormalizes a flag with nothing keeping it in sync, and accepts negatives    | [deferred](#09fdb13)   |
| `09.F-DB15`   | 09-data-model.md                       | Low                                                                    | `food_status_idx` is the wrong shape for any shell sweep or shell-status scan                      | [deferred](#09fdb15)   |
| `19.P-12`     | 19-privacy.md                          | Low                                                                    | Privacy-critical documentation asserts the opposite of the shipped code, in both directions        | [deferred](#19p12)     |
| `19.P-13`     | 19-privacy.md                          | Low today                                                              | The mobile app declares no camera purpose strings and no iOS privacy manifest                      | [deferred](#19p13)     |
| `19.P-9`      | 19-privacy.md                          | Low                                                                    | The `recipes` table defaults to `visibility = 'public'`, `status = 'published'`                    | [rejected](#19p9)      |
| `12.A-1`      | 12-adversarial-status-shells.md        | SURVIVES                                                               | The producer-assigned sequence is a counter the design never sites, and it collides                | [fixed](#12a1)         |
| `12.A-10`     | 12-adversarial-status-shells.md        | SURVIVES                                                               | The typeahead leak is real, but it is the recipe placeholder, not the food shell                   | [deferred](#12a10)     |
| `12.A-2`      | 12-adversarial-status-shells.md        | SURVIVES                                                               | FR-045 is self-contradictory and permits the regression it exists to prevent                       | [fixed](#12a2)         |
| `12.A-3`      | 12-adversarial-status-shells.md        | SURVIVES                                                               | The DB projection — the declared source of truth — is written unguarded                            | [deferred](#12a3)      |
| `12.A-4`      | 12-adversarial-status-shells.md        | SURVIVES                                                               | The ADR requires a dual write and no outbox; the emitter already loses events                      | [deferred](#12a4)      |
| `12.A-5`      | 12-adversarial-status-shells.md        | SURVIVES                                                               | Nobody can emit the per-food-item message, and the codebase already recorded that                  | [fixed](#12a5)         |
| `12.A-8`      | 12-adversarial-status-shells.md        | SURVIVES                                                               | Nobody owns the garbage: shells are never deleted, and the catalog is ownerless                    | [deferred](#12a8)      |
| `12.A-9`      | 12-adversarial-status-shells.md        | SURVIVES                                                               | The bulk case fights food's fairness machinery, and demand weighting collapses                     | [deferred](#12a9)      |
| `13.A-1`      | 13-adversarial-topology.md             | SURVIVES                                                               | The portfolio is already a distributed monolith, and nothing in the tree counts it                 | [deferred](#13a1)      |
| `13.A-10`     | 13-adversarial-topology.md             | SURVIVES                                                               | The per-PR ephemeral model multiplies every service, and every ADR prices it as additive           | [deferred](#13a10)     |
| `13.A-2`      | 13-adversarial-topology.md             | SURVIVES                                                               | The binding ALB ceiling is target groups (non-adjustable), and the repo documents the other one    | [deferred](#13a2)      |
| `13.A-3`      | 13-adversarial-topology.md             | SURVIVES on the reasoning                                              | Extracting 006 before implementation draws a boundary with zero access-pattern data                | [fixed](#13a3)         |
| `13.A-4`      | 13-adversarial-topology.md             | SURVIVES                                                               | "007, 009 and 010 are unchanged" is false — cross-database FKs remain                              | [deferred](#13a4)      |
| `13.A-5`      | 13-adversarial-topology.md             | SURVIVES on the reasoning                                              | The amendment's premise is circular, and it ignored the better argument in 006's own spec          | [fixed](#13a5)         |
| `13.A-6`      | 13-adversarial-topology.md             | SURVIVES                                                               | An always-on ALB-fronted service is the wrong compute shape for bursty OCR                         | [deferred](#13a6)      |
| `13.A-7`      | 13-adversarial-topology.md             | SURVIVES                                                               | "It holds no persistent state" is incompatible with what 011 actually requires                     | [deferred](#13a7)      |
| `13.A-8`      | 13-adversarial-topology.md             | SURVIVES                                                               | FR-048/049's user-visible value cannot ship, and the degraded path is asserted                     | [deferred](#13a8)      |
| `13.A-9`      | 13-adversarial-topology.md             | SURVIVES                                                               | ADR-0019 adds cross-service edges that nothing in this system can authenticate                     | [deferred](#13a9)      |
| `12.A-6`      | 12-adversarial-status-shells.md        | WEAKENED                                                               | §4's premise is false (a poll ships) and puts unbuilt 014 on the critical path                     | [deferred](#12a6)      |
| `14.P-1`      | 14-adversarial-premises.md             | UNSUPPORTED                                                            | ADR-0019 claims no spec described in-flight import status                                          | [rejected](#14p1)      |
| `14.P-11`     | 14-adversarial-premises.md             | UNSUPPORTED                                                            | 004's transfer clause asserts inheritance without amending 011                                     | [rejected](#14p11)     |
| `14.P-12`     | 14-adversarial-premises.md             | UNSUPPORTED                                                            | 011 does build a second path to a saved recipe                                                     | [rejected](#14p12)     |
| `14.P-13`     | 14-adversarial-premises.md             | UNSUPPORTED                                                            | 004's tasks, plan and V-Model still specify OCR at launch                                          | [rejected](#14p13)     |
| `14.P-2`      | 14-adversarial-premises.md             | UNSUPPORTED as a problem statement                                     | "Nothing to hang a resolving status on" is a false motivation                                      | [rejected](#14p2)      |
| `14.P-3`      | 14-adversarial-premises.md             | UNSUPPORTED                                                            | `sourceType` whitelisting inverts 004's server-observed rule                                       | [rejected](#14p3)      |
| `14.P-4`      | 14-adversarial-premises.md             | UNSUPPORTED                                                            | "011's image service owns NO database" contradicts 011's own job requirements                      | [rejected](#14p4)      |
| `14.P-5`      | 14-adversarial-premises.md             | UNSUPPORTED as reasoning                                               | The deployable exception cites ADR-0017 flip conditions that do not exist                          | [rejected](#14p5)      |
| `14.P-6`      | 14-adversarial-premises.md             | UNSUPPORTED as stated                                                  | "One additional deployable" undercounts the session's new services                                 | [rejected](#14p6)      |
| `14.P-8`      | 14-adversarial-premises.md             | UNSUPPORTED as                                                         | The five-stage vocabulary is a fourth vocabulary, not "one contract"                               | [rejected](#14p8)      |
| `14.P-10`     | 14-adversarial-premises.md             | WEAK                                                                   | "Everything after parsing is identical" is false                                                   | [rejected](#14p10)     |
| `14.P-15`     | 14-adversarial-premises.md             | WEAK as a defect in isolation                                          | Every document cites an "owner ruling" with no clarifications record                               | [rejected](#14p15)     |
| `14.P-7`      | 14-adversarial-premises.md             | WEAK                                                                   | ADR-0017's amendment overstates its two "engineering facts" for 006                                | [rejected](#14p7)      |
| `14.P-9`      | 14-adversarial-premises.md             | WEAK                                                                   | Supersession needs a producer-assigned monotonic sequence                                          | [rejected](#14p9)      |
| `12.A-11`     | 12-adversarial-status-shells.md        | REFUTED                                                                | Lock contention and index bloat at 1,000 recipes                                                   | [rejected](#12a11)     |
| `12.A-7`      | 12-adversarial-status-shells.md        | REFUTED                                                                | The shell entry breaches the food database's single-writer rule                                    | [rejected](#12a7)      |
| `01.ADR-0019` | 01-recipe-service.md                   | —                                                                      | Recipe-service readiness verdict for hosting the import spine                                      | [deferred](#01adr0019) |
| `02.ADR-0019` | 02-food-service.md                     | —                                                                      | Food-service readiness verdict for shells and superseding per-item status                          | [deferred](#02adr0019) |
| `11.A-1`      | 11-adversarial-004-011-split.md        | —                                                                      | The post-parse tail is not identical; the 004/011 seam is drawn too early                          | [deferred](#11a1)      |
| `11.A-2`      | 11-adversarial-004-011-split.md        | —                                                                      | "The image service owns NO database" cannot hold                                                   | [deferred](#11a2)      |
| `11.A-3`      | 11-adversarial-004-011-split.md        | —                                                                      | The 011→004 handoff names no principal, and `imported_physical` is forgeable                       | [deferred](#11a3)      |
| `11.A-4`      | 11-adversarial-004-011-split.md        | —                                                                      | Making 011 depend on 004 creates no new critical path                                              | [rejected](#11a4)      |
| `11.A-5`      | 11-adversarial-004-011-split.md        | —                                                                      | Steelman: 004 keeps the pipe and 011 keeps the depth — and it wins                                 | [deferred](#11a5)      |
| `11.A-6`      | 11-adversarial-004-011-split.md        | —                                                                      | The "named exception" mis-cites ADR-0017, and the option space omits `recipe-workers`              | [deferred](#11a6)      |
| `11.A-7`      | 11-adversarial-004-011-split.md        | —                                                                      | The ruling stopped at spec.md; the tasks still build the retired channel                           | [deferred](#11a7)      |
| `11.A-8`      | 11-adversarial-004-011-split.md        | —                                                                      | "sourceType declared by the surface, never inferred" conflates three different things              | [deferred](#11a8)      |
| `11.A-9`      | 11-adversarial-004-011-split.md        | —                                                                      | "Show it disabled" and "do not show it" are both MUST for the same control                         | [deferred](#11a9)      |
| `14.P-14`     | 14-adversarial-premises.md             | The                                                                    | ADR-0019 answers one real problem with a five-part normative spine                                 | [rejected](#14p14)     |
| `15.A-1`      | 15-adversarial-food-recipe-model.md    | —                                                                      | The shared ownerless catalog is the single root design error with four symptoms                    | [fixed](#15a1)         |
| `15.A-2`      | 15-adversarial-food-recipe-model.md    | —                                                                      | "A recipe is a method, not a substance" conflates dish-type with recipe-instance                   | [rejected](#15a2)      |
| `15.A-3`      | 15-adversarial-food-recipe-model.md    | —                                                                      | "One-directional" and "single writer" are already false in practice                                | [deferred](#15a3)      |
| `15.A-4`      | 15-adversarial-food-recipe-model.md    | —                                                                      | The opaque `food_id` has no stable meaning under shell semantics, and a collision is unrecoverable | [deferred](#15a4)      |
| `15.A-5`      | 15-adversarial-food-recipe-model.md    | —                                                                      | Recipes should pin an immutable nutrition snapshot at resolution time                              | [rejected](#15a5)      |
| `16.A-1`      | 16-adversarial-live-reference.md       | —                                                                      | One bad catalog write corrupts every referencing recipe, with no signal or audit                   | [deferred](#16a1)      |
| `16.A-2`      | 16-adversarial-live-reference.md       | —                                                                      | The system has a live reference AND a stale denormalized copy simultaneously                       | [deferred](#16a2)      |
| `16.A-3`      | 16-adversarial-live-reference.md       | —                                                                      | Is the decision implementable downstream? 006 defeats the attack; 009 does not                     | [deferred](#16a3)      |
| `16.A-4`      | 16-adversarial-live-reference.md       | —                                                                      | Retroactive mutation of Article 9 data is an integrity and accountability problem                  | [deferred](#16a4)      |
| `16.A-5`      | 16-adversarial-live-reference.md       | —                                                                      | Steelman the rejected option, and price the loss                                                   | [rejected](#16a5)      |
| `16.A-6`      | 16-adversarial-live-reference.md       | —                                                                      | `addByName` writes a caller's raw typed string as the shared catalog's permanent global name       | [fixed](#16a6)         |
| `23.S-1`      | 23-adversarial-security-new-surface.md | Now                                                                    | The control that makes untrusted image bytes safe lives in a superseded branch                     | [deferred](#23s1)      |
| `23.S-10`     | 23-adversarial-security-new-surface.md | Now                                                                    | The substrate's producer-authentication design has no credential to implement it                   | [deferred](#23s10)     |
| `23.S-11`     | 23-adversarial-security-new-surface.md | Now                                                                    | The shared ownerless catalog has no Unicode discipline, so its dedup key is trivially bypassed     | [fixed](#23s11)        |
| `23.S-12`     | 23-adversarial-security-new-surface.md | Now                                                                    | Upload preflight validates the client's claims, and the S3 key uses the Clerk `sub`                | [deferred](#23s12)     |
| `23.S-2`      | 23-adversarial-security-new-surface.md | Now                                                                    | Recognition time is unbounded by any shipped control                                               | [rejected](#23s2)      |
| `23.S-3`      | 23-adversarial-security-new-surface.md | Now                                                                    | Cost is the strongest available attack, and both bounding controls are absent                      | [deferred](#23s3)      |
| `23.S-4`      | 23-adversarial-security-new-surface.md | Now                                                                    | No Lambda in this account has reserved or maximum concurrency                                      | [deferred](#23s4)      |
| `23.S-5`      | 23-adversarial-security-new-surface.md | Now                                                                    | Tesseract downloads its language model from a public CDN with no integrity check                   | [rejected](#23s5)      |
| `23.S-6`      | 23-adversarial-security-new-surface.md | Now                                                                    | Adopting tesseract.js adds a network-touching postinstall to deploy-credentialed CI jobs           | [rejected](#23s6)      |
| `23.S-7`      | 23-adversarial-security-new-surface.md | Now                                                                    | Tesseract decodes BMP in-process via an unmaintained decoder                                       | [rejected](#23s7)      |
| `23.S-8`      | 23-adversarial-security-new-surface.md | Now                                                                    | The image allowlist admits HEIC, which the installed toolchain cannot decode                       | [deferred](#23s8)      |
| `23.S-9`      | 23-adversarial-security-new-surface.md | Now                                                                    | A device-declared raw-text channel inverts FR-025 and bypasses both gates                          | [deferred](#23s9)      |
| `24.A-1`      | 24-adversarial-revised-design.md       | —                                                                      | "Per-domain async processors" is a taxonomy, not a pattern, and its scaling claim is false         | [fixed](#24a1)         |
| `24.A-2`      | 24-adversarial-revised-design.md       | —                                                                      | Where exactly is the convergence seam?                                                             | [deferred](#24a2)      |
| `24.A-3`      | 24-adversarial-revised-design.md       | —                                                                      | D2's platform asymmetry: one user action, three different products                                 | [fixed](#24a3)         |
| `24.A-4`      | 24-adversarial-revised-design.md       | —                                                                      | Does the raw-text channel weaken provenance?                                                       | [fixed](#24a4)         |
| `24.A-5`      | 24-adversarial-revised-design.md       | —                                                                      | Does D6 still hold once ADR-0019 shrinks?                                                          | [fixed](#24a5)         |
| `24.A-6`      | 24-adversarial-revised-design.md       | —                                                                      | D3 narrows 011, but the correction UI's API still has no home                                      | [deferred](#24a6)      |
| `24.A-7`      | 24-adversarial-revised-design.md       | —                                                                      | D4: "nutrition is a LIVE REFERENCE" — against what?                                                | [rejected](#24a7)      |
| `24.A-8`      | 24-adversarial-revised-design.md       | —                                                                      | D5's four substrate properties fight, and one stream cannot be both groupings                      | [fixed](#24a8)         |

## Reports with no enumerable findings

Design, research and narrative documents — recommendations and open questions rather than numbered findings. **Not** counted by R3.4.

- `10-import-ux.md`
- `17-message-substrate.md`
- `18-adversarial-scope.md`
- `20-adversarial-test-strategy.md`
- `21-adversarial-performance.md`
- `22-adversarial-reliability.md`
- `25-feasibility.md`
- `26-schema-delta.md`
- `27-product-lens.md`
- `28-research-messaging-aws.md`
- `29-research-messaging-priorart.md`

## Residual work this pass opened or left standing

Recorded here because a residual with no row is exactly the failure this exercise exists to prevent.

- **Confusable folding on the catalog name is NOT implemented.** 16.A-6 / 23.S-11 shipped Unicode _hygiene_
  — NFKC, format-character removal, control separation, collapse. A Cyrillic `о` still keys distinctly from
  a Latin `o`, so a homograph can still mint a second row that renders identically. Closing it needs a
  UTS #39 confusables table, which is a library decision (library-first gate), not a regex.
  **Trigger:** before any import channel writes catalog names in bulk — feature 004.
- **`CREATE INDEX CONCURRENTLY` cannot run, and the runner carve-out is deliberately NOT built.** All three
  migration runners wrap each file in `BEGIN`/`COMMIT`. With no production traffic the plain `CREATE INDEX`
  lock is milliseconds, so every index this burn-down defers (09.F-DB4, 09.F-DB10) is specified as plain.
  **Trigger:** when production traffic exists — then the runner needs a statement-level carve-out, and the
  round-1 suggestion to copy food's `CREATE DATABASE` shape is wrong: that call lives in `ensureDatabase`,
  outside `runMigrations` entirely.
- **Two `DROP INDEX` recommendations (09.F-DB12, 09.F-DB15) are blocked on measurement, not on effort.**
  Neither review captured a plan. **Trigger:** `EXPLAIN (ANALYZE, BUFFERS)` on a representative dataset.
- **`reservedConcurrentExecutions` (23.S-4) is unallocated across all 19 Lambdas.** The property is trivial;
  the NUMBER is not, because the setting is simultaneously a floor and a cap, `0` silently disables a
  function, and sixteen of the nineteen share one Postgres instance. **Trigger:** before 011's OCR worker —
  see the entry for the allocation shape and the gate that should carry it.
- **A shipped P0 was found while verifying, not while reviewing.** `FoodsModule` never provided
  `FetchQueueDao`, which `AdminMetricsService` has taken since U9, so the food API could not boot at all
  under `emitDecoratorMetadata`. It was invisible because Nest answers a DI failure with `process.abort()`,
  which vitest reports only as "Worker exited unexpectedly" — 58 integration tests had been silently not
  running. Fixed, with `abortOnError: false` at the boot call so the next one is legible. **No finding in
  any of the 31 reports names it**, which is the strongest available argument for 07.F-T4's missing
  tier-wiring guard and 07.F-T11's `passWithNoTests`.

## Dispositions

One entry per finding, in index order. A `rejected` row names a reason a reviewer can check without
reading code; a `deferred` row names a trigger — a unit, a spec, or a measurable condition — not a date.

<a id="01fr1"></a>

### `01.F-R1` — fixed

**Nutrient projection picks kJ over kcal and saturated fat over total fat**

Closed by U8 `dd692c49`. The substring selector is gone from the recipe service — `ingredients.service.ts:61-72` is now a `DELETED HERE (KTD-3 / plan U10)` marker naming its replacement, and food's selector matches on all three of basis + canonical name + unit (`food-service/src/foods/nutrition/nutrientSelection.ts:96-107`, with `calories: { name: 'Energy', unit: 'kcal' }` pinned in `labelNutrientMap.ts:51`). Rows written before the drop still hold old values; that is U10 part 2, not this finding.

<a id="01fr2"></a>

### `01.F-R2` — deferred

**`resolve`'s converge-only guard is read-then-act with no compare-and-swap**

Premise true: `ingredients.service.ts:418-424` reads then acts, and `IngredientsDal.updateResolution` writes under `WHERE id = $1` alone. Its stated forward rationale is void — ADR-0019 §4's producer-assigned sequence was WITHDRAWN by the 2026-08-16 amendment (`0019:181-201`). The second scenario it describes is already gone (U10 part 1 emptied `UpdateResolutionInput` of nutrition). What remains is a real shared-catalog race needing a conditional UPDATE plus a concurrency integration test.

**Trigger:** U14 — the same pass that asserts ADR-0019's single-writer-per-group precondition for `ingredients`. Do not land it before U10 part 2, which reshapes the surrounding branch.

<a id="01fr3"></a>

### `01.F-R3` — deferred

**Ingredients `search`/`suggest` bypass their own published query schema**

True: `ingredients.controller.ts:119-120` and `:163-164` take raw-string `@Query`, hand-parse via `parseLimit` (`:81-89`) and raise `BadRequestException` — a code absent from `recipeErrorCodeSchema`, so a typed client cannot narrow it. The authored contract already exists, unused, at `ingredients.schema.ts:186-194`, and every sibling controller uses a `createZodDto` query DTO. Not taken in this pass because the file is being rewritten concurrently by U10 part 2.

**Trigger:** The first new `:id`/query route in recipe-service ingredients (003/004 both touch them), or immediately after U10 part 2 lands.

<a id="01fr4"></a>

### `01.F-R4` — deferred

**Publishing an empty stored draft raises off-contract `BAD_REQUEST`, untested**

True: `recipes.service.ts:692` throws `BadRequestException` while the schema half of the same rule raises `VALIDATION_FAILED` (`recipes.schema.ts:154`/`:197`), and the message appears in no test in any tier. Same off-contract class as 01.F-R3; same reason for not taking it here — `recipes.service.ts` is being rewritten concurrently by U10 part 2.

**Trigger:** Bundle with 01.F-R3, after U10 part 2.

<a id="01fr5"></a>

### `01.F-R5` — deferred

**No machine credential exists for a background import to call food**

True and deliberate today: `config.types.ts:403-407` records that there is NO `FOOD_SERVICE_TOKEN`, and every `FoodServiceClients` factory takes a user `CallerToken`. The plan already prices it — the erasure token cannot simply gain an audience, because its claims model erasure of one owner and its key lives only in the webhook Lambdas — so this is a new capability token, designed as such, and it blocks nothing in U1–U12. Same item as 11.A-3 and 13.A-9.

**Trigger:** The service-credential ADR, required before the first background (non-request-scoped) recipe→food call — i.e. before feature 004's import spine is implemented.

<a id="01fr6"></a>

### `01.F-R6` — deferred

**Import-scale ingredient resolution is one food call per name, unbounded**

True: `ingredients.service.ts:304-318` makes one `addByName` call per name and neither recipe package calls food's `/batch`. The batching shape is already proven on the read side by U10 part 1's `FoodNutritionGateway` + `GET /foods/nutrition?ids=`. There is no bulk caller today, so this is a design gap in unbuilt work rather than a live defect.

**Trigger:** Feature 004's bulk-import processor, via U14 — `admitManyByName` is a processor-side primitive with no caller until then.

<a id="01fr7"></a>

### `01.F-R7` — rejected

**Status envelope has no package that can author and publish it**

The premise is false on both halves at HEAD. A shared, zod-authored cross-package contract exists at `packages/shared/messaging/src/OutboundMessage.ts:65-67` (U4 `e728c289`) and is importable by `recipe-workers`; and the clause it wanted a home for was withdrawn — ADR-0019 `:181-201` now states the envelope carries no sequence, because the stream record is a doorbell and consumers re-query the group.

<a id="01fr8"></a>

### `01.F-R8` — deferred

**`addByFoodId` can regress a settled shared row to a non-terminal status**

True: `ingredients.service.ts:232-237` advances an existing row to the observed status with no anti-regression guard. The short-circuit that would otherwise blunt it is gated on `existing.caloriesPer100g`, a field U10 part 2 deletes — so fixing it now would write the same branch twice. 01.F-R2's conditional UPDATE closes this site as a side effect.

**Trigger:** U10 part 2 (which deletes the `caloriesPer100g` clause), then 01.F-R2's CAS predicate under U14.

<a id="01fr9"></a>

### `01.F-R9` — deferred

**Five docstrings cite a bare `FR-047` that now names two requirements**

True: exactly five unprefixed citations (`ingredients.controller.ts:51`, `FoodServiceClients.factory.ts:46`, `ingredients.service.ts:34`, `foodCatalog.gateway.ts:36`, `auth/CallerToken.ts:49`) against `specs/004-recipe-importing/spec.md:12-18`, which mandates the `004-` prefix. Prefixing now would pin ids the respec is about to renumber.

**Trigger:** U13 — apply against the respec'd requirement ids in the same pass.

<a id="01fr10"></a>

### `01.F-R10` — deferred

**Two swallowed-exception sites log via `console.error`, not the Nest `Logger`**

True: `recipes.service.ts:484` and `versions.service.ts:256` are the only two non-deliberate sites in `src`. A two-line change, but both files are being rewritten concurrently by U10 part 2, and the severity-classifier consequence the report cites lives in `identity-webhooks`, not here.

**Trigger:** The next edit to either file after U10 part 2 lands.

<a id="01adr0019"></a>

### `01.ADR-0019` — deferred

**Recipe-service readiness verdict for hosting the import spine**

Two of the four not-ready rows are void: the §4 supersession-key row was withdrawn (`0019:181-201`) and the §1 one-processor premise it graded against was replaced by per-domain processors converging at recipe creation (`0019:211-234`). The surviving rows are 01.F-R5 and 01.F-R6, both deferred with their own triggers. The §2/§5 ready verdicts are unaffected.

**Trigger:** U14 — re-grade §1 and §4 against the amendment there.

<a id="02ff1"></a>

### `02.F-F1` — fixed

**Auth load shedder's per-source map is keyed by a spoofable header and never evicted**

Fixed in this pass. `AuthLoadShedder.recordFailure` now prunes the source's own ring to the rolling window AND evicts the bucket map down to `maxTrackedSources` (default 50,000) least-recently-failed-first, with `trackedSources()`/`trackedFailures()` making both bounds assertable; four adversarial unit tests cover a 10,000-key flood, a real flooder surviving eviction, ring growth over time, and aged-out eviction. The class docstring now records why the rightmost `X-Forwarded-For` hop is NOT the fix (ADR-0020's edge would collapse every request into one bucket).

<a id="02ff2"></a>

### `02.F-F2` — deferred

**Admission shed strands committed `PENDING` rows with no queue row**

True: `foods.service.ts` commits `createByName` before `admission.admit` can throw, and nothing sweeps a `food` row that has no `fetch_queue` row. U9's proposed reorder is recorded in the plan as WITHDRAWN AS IMPOSSIBLE, and it cannot simply be undone: the reactivation branch clears `tombstoned_at` irreversibly, so this needs a designed compensating action, not a reordering. Two mitigations did land in U9 `062bcb4b` — a real `AWAITING_RETRY` state and an operator requeue endpoint.

**Trigger:** U14 / ADR-0019 §5 shells — binding once bulk import creates shells at `FOOD_MAX_QUEUE_DEPTH`. Measurable now: a non-zero count for `food` rows in `PENDING` with no `fetch_queue` row.

<a id="02ff3"></a>

### `02.F-F3` — rejected

**Food's events go to stdout; no bus adapter and no SDK exist**

False at HEAD. `worker/main.ts:87` builds the emitter over `resolvePublisher()`, which returns a `DynamoPublisher` when `MESSAGE_TABLE_NAME` is set (U5/U6 `1fb5f2e3`), and `@aws-sdk/client-dynamodb` is declared in both `package.json` and `prod.package.json`. The alarms half is closed too: the tombstone and retry-budget alarms publish to `FoodAlarmTopic`, subscribed as of U11 `bcb1dfae`. Residual broom — the superseded EventBridge bus and its three grants are still declared but read by nothing; delete them in the next food-stack deploy window (U16/U17).

<a id="02ff4"></a>

### `02.F-F4` — deferred

**Food client parses a non-JSON error body outside the try, throwing a raw `SyntaxError`**

True: `packages/clients/food-service/src/client.ts:371` calls `JSON.parse(text)` in the `return` AFTER the `try/catch/finally`, so the ALB's HTML `503` during every deploy — and its default `404 text/plain` (ADR-0003) — reaches the recipe service as a `SyntaxError`, making `isFetchUnavailableError` false and skipping every recovery branch. The sibling client already solved it once (`clients/recipe-service/src/client.ts:254-260`'s `safeJson`), so the fix is to copy a rule that exists rather than invent one.

**Trigger:** Next change to `packages/clients/food-service` — take it with 02.F-F5 and 02.F-F8, which are the same statement and its missing test.

<a id="02ff5"></a>

### `02.F-F5` — deferred

**The ALB-HTML client test cannot emit a non-JSON body, so it proves nothing**

True: `clients/food-service/src/__tests__/client.test.ts:52-56`'s `stubFetch` `JSON.stringify`s unconditionally, so the test whose docstring describes an ALB HTML `503` actually passes valid JSON. It is the test that would have caught 02.F-F4 and is red only once a raw-body stub exists.

**Trigger:** Same change as 02.F-F4 — it is that fix's red test.

<a id="02ff6"></a>

### `02.F-F6` — deferred

**Change-refresh rescans the same 1,000 oldest rows forever, never the rest**

True: `dao/foodSources.dao.ts:168-190` ends `ORDER BY fs.food_id LIMIT $1` with no cursor, offset or age predicate, while its docstring claims stable paging. The harm is conditional on a catalogue size the review did not measure, and the fix adds an index — which under the standing ruling needs `EXPLAIN (ANALYZE, BUFFERS)` evidence and a plain `CREATE INDEX`.

**Trigger:** When live-origin RESOLVED backing items exceed `DEFAULT_SCAN_LIMIT` (1,000) — visible as `ChangeRefreshResult.scanned` pinned at the limit. Owned by feature 003 FR-032; decide with 02.F-F7 in one change.

<a id="02ff7"></a>

### `02.F-F7` — deferred

**`FOOD_STALE_THRESHOLD_DAYS` is boot-validated and documented but read by nothing**

True: the only two occurrences in the repo are its definition (`config/env.schema.ts:84`) and the default assertion in its own test. It is the knob 02.F-F6's fix would consume, so resolving it separately either deletes what that fix needs or wires a predicate it has not shaped.

**Trigger:** Same trigger as 02.F-F6 — wire-or-delete decided in that change.

<a id="02ff8"></a>

### `02.F-F8` — deferred

**`Retry-After` parsed with a bare `Number()`, so an HTTP-date yields `NaN`**

True: `clients/food-service/src/client.ts:372` has no finiteness guard, so a legal HTTP-date `Retry-After` (RFC 9110 §10.2.3) produces `NaN`, which survives the `??` that would otherwise fall through to the envelope's own value. No shipped consumer reads the field yet, and it is the same statement as 02.F-F4.

**Trigger:** Same change as 02.F-F4.

<a id="02adr0019"></a>

### `02.ADR-0019` — deferred

**Food-service readiness verdict for shells and superseding per-item status**

Two of the five change items are closed and one must NOT be built: the emit path is done (see 02.F-F3), and the supersession key the report called the largest gap was rejected by decision — ADR-0019 `:181-201` replaces it with consumer-side most-recent-by-timestamp, so the proposed `version integer` column on `food` is now forbidden rather than owed. Items 1 (02.F-F2), 2 (status-vocabulary mapping, where `UNRESOLVED` has no §4 member) and 5 (per-transition emission) remain. The §5 half needs nothing.

**Trigger:** U14 — it owns the vocabulary mapping and the emission point; 02.F-F2 is the blocker it must sequence first.

<a id="03fu1"></a>

### `03.F-U1` — deferred

**Rename without an id falls through to CREATE on web, silent no-op on mobile**

Live: `CollectionFormContainer.tsx:81-93` guards and then falls through to `createCollection.mutate`, and `CollectionFormScreen.tsx:57-59` has no `else`, because `mode` and `collectionId?` are independent props. Not reachable today — both call sites always pass an id — so it is a latent illegal state, and the fix is the discriminated union that makes it unrepresentable rather than another runtime branch.

**Trigger:** The next change to either collection form. Verify by `CollectionFormContainerProps` becoming `{ mode: 'create' } | { mode: 'rename'; collectionId: string }`; 03.F-U5 and 03.F-U13 are the same edit.

<a id="03fu2"></a>

### `03.F-U2` — deferred

**No keyboard avoidance on any authoring or search surface but the three Clerk screens**

Live: `automaticallyAdjustKeyboardInsets` appears only in `login.tsx:150`, `signup.tsx:88` and `profile.tsx:81`; `RecipeEditor.tsx:167-171` carries only `keyboardShouldPersistTaps`. Real, but every affected surface is a mobile layout claim that cannot be confirmed without a device.

**Trigger:** The on-device / Maestro pass. Change: `automaticallyAdjustKeyboardInsets` on `RecipeEditor.tsx:167`, `RecipeList.native.tsx:112`, `RecipeDiscoveryList.native.tsx:126`/`:217`, `RecipeFilterBar.native.tsx:310`.

<a id="03fu3"></a>

### `03.F-U3` — deferred

**The FAB overlaps the last recipe card by 56pt**

Live and computable from tokens rather than measured: `RecipeList.native.tsx:267` places a 56pt FAB at `bottom: spacing[5]` while `:292` gives the card list `paddingBottom: spacing[5]` (24). Scope is correct — no other list positions an absolute control.

**Trigger:** The on-device / Maestro pass. Change: hoist `FAB_SIZE = 56` and set the list's `paddingBottom` to clear it.

<a id="03fu4"></a>

### `03.F-U4` — deferred

**The recipe-detail error state renders with zero styling, including an unstyled Retry**

Live: `RecipeDetailContainer.tsx:147-152` renders `div`/`p`/`button` with no `className` while the loading branch beside it is styled and four other controls in the same file use `buttonSurfaceClass` (which carries the `min-h-11` touch floor). Not taken here because `packages/apps/commise` is outside this pass's scope and the component tier it needs is a web-app suite this session did not otherwise touch.

**Trigger:** The next change to `RecipeDetailContainer.tsx`, or feature 004's import UI, whichever lands first — with the vitest component test asserting the retry control carries the touch floor.

<a id="03fu5"></a>

### `03.F-U5` — deferred

**A rename seed-fetch error renders a blank but functional rename form**

Live: `CollectionFormContainer.tsx` reads only `isLoading` and `data?.name` (falling back to `''`), never `isError`, though `toDetailQueryView` already exists in `features/core/src/queryStatus.ts:81` and is used by the recipe detail container.

**Trigger:** Same edit as 03.F-U1 — same file, same function.

<a id="03fu6"></a>

### `03.F-U6` — deferred

**"Remove {title}" is the visible label and cannot shrink, crushing the title**

Live on both leaves: `CollectionMemberRow.tsx:54-63` renders the full `removeRecipe` string with `shrink-0` next to a `flex-1` title, and the native mirror sets `flexShrink: 0`. The fix is a short visible label with the long string kept on `aria-label`/`accessibilityLabel`.

**Trigger:** The on-device / Maestro pass plus a 375px Playwright width — both tiers are needed because the web and native leaves fail differently.

<a id="03fu7"></a>

### `03.F-U7` — deferred

**The photo-queue failure reason is white-on-`#F5F5F5` (~1.08:1) and clipped**

Live, and provable from raw hex without a device: `RecipePhotoManager.native.tsx:255-263` gives `itemError` `palette.white` with no plate, over a `palette.pearl` placeholder, inside a cell that is `overflow: 'hidden'` with no line clamp — in exactly the client-rejection case the message exists to explain. The sibling `statusBadge` in the same file already has the plate to copy.

**Trigger:** The next change to `RecipePhotoManager.native.tsx`, or feature 011's correction UI. Change: give `itemError` the `statusBadge` plate and add `numberOfLines`.

<a id="03fu8"></a>

### `03.F-U8` — deferred

**The native photo grid is three columns at every width, with ~21pt controls**

Live: `cell: { width: '31%' }` unconditionally, against web's `grid-cols-2 … sm:grid-cols-3`, and four control styles at `paddingVertical: 4` with no `minHeight`. A width-dependent layout claim.

**Trigger:** The on-device / Maestro pass. Change: `useWindowDimensions()` for a two-column break below 400pt, plus `minHeight: 44` on the four control styles.

<a id="03fu9"></a>

### `03.F-U9` — deferred

**The web bottom tab bar has a fixed 64px height six labels can overflow**

Live but INFERRED, not measured: `HomeTabBar.tsx:53` is a fixed `h-[calc(4rem+…)]` with six `flex-1` items and no `truncate`, and the narrowest Playwright viewport in the suite is 375px. The report concedes it did not observe the wrap.

**Trigger:** Measurable now: add a 360x740 case to the bar-containment assertion in `recipeHomeResponsive.spec.ts:203-217`. If it fails, `h-` becomes `min-h-`; if it passes, reject the finding on that evidence.

<a id="03fu10"></a>

### `03.F-U10` — deferred

**The native recipe-card title is unclamped where web has `line-clamp-2`**

Live: `RecipeCard.native.tsx:118-122` renders a bare `Text`, and `numberOfLines` appears nowhere in the recipe tree, while web clamps at `RecipeCard.tsx:174`. A one-prop parity gap.

**Trigger:** Bundle with the next `RecipeCard.native` change, or the on-device pass.

<a id="03fu11"></a>

### `03.F-U11` — deferred

**~26-32pt hand-rolled Pressables bypass the `@commise/ui` 44pt touch floor**

Live across eleven call sites, each re-verified. One supporting claim in the report is FALSE at HEAD — `CollectionActions.native.tsx:18` and `RecipeDeleteDialog.native.tsx:22` do import `Button` — so the rationale is overstated, but the defect stands.

**Trigger:** The on-device / Maestro pass, destructive and navigational controls first.

<a id="03fu12"></a>

### `03.F-U12` — deferred

**Wizard submit-failure text is unstyled and flush against x = 0**

Live: `RecipeEditor.tsx:147-149` renders an unstyled alert outside the `ScrollView` that supplies the 16pt gutter, and the stylesheet has no `error` entry. `RecipePhotoManager.native.tsx:238` is the convention to converge on.

**Trigger:** Bundle with 03.F-U2 — same file, same on-device pass.

<a id="03fu13"></a>

### `03.F-U13` — deferred

**The mobile collection form submits an untrimmed or empty name; web rejects it**

Live: `CollectionFormScreen.tsx:50-60` passes the raw name to the mutation with only a generic `saveError` for feedback, while web guards and submits `trimmed`. The rule exists twice and disagrees; `collections/model.ts` exports no name predicate for either to share.

**Trigger:** Same edit as 03.F-U1 — lift `normalizeCollectionName`/`isCollectionNameValid` into `collections/model.ts` so both platforms share one rule.

<a id="03fu14"></a>

### `03.F-U14` — deferred

**Three `[locale]` routes export hard-coded English `Metadata`**

Live, and a genuine CLAUDE.md localization-gate violation: six English literals across `account/page.tsx:8-11`, `profile/page.tsx:8-11` and `settings/page.tsx:8-11`, when `[locale]/layout.tsx:19-24` already shows the correct `generateMetadata` pattern. An independent scan confirms these six are the ONLY hard-coded user-facing strings in `features/*`, `web/src`, `mobile/src` and `ui/src`. Latent only because `SUPPORTED_LOCALES` is `['en']`.

**Trigger:** Measurable: a second tag entering `SUPPORTED_LOCALES` (`i18n/src/locales.ts:18`). Fix earlier if a web pass has room — three `generateMetadata` functions and six message keys.

<a id="03fu15"></a>

### `03.F-U15` — deferred

**The wizard footer row cannot wrap; templated Prev/Next collide at 360pt**

Live: `Wizard.native.tsx:515` declares no `flexWrap` while the `topBar` and `railRow` in the same stylesheet both do — and `railRow`'s own comment documents this exact failure. Widths are computed from tokens, not measured.

**Trigger:** The on-device / Maestro pass at 360pt with the longest localized step names. Change: `flexWrap: 'wrap'` plus a `rowGap`.

<a id="03fu16"></a>

### `03.F-U16` — deferred

**The USDA badge sits in the search row and never shrinks, squeezing the input**

Live: `mobile/src/components/IngredientPicker.tsx:425-442` puts a no-shrink badge inside a no-wrap row (RN defaults `flexShrink: 0`), where web places the badge outside the input row. The residual input width is computed, not measured.

**Trigger:** The on-device / Maestro pass. Change: move the badge to its own meta row, or give it `flexShrink: 1` with `numberOfLines={1}`.

<a id="04fi1"></a>

### `04.F-I1` — deferred

**The accepted service roster is nine against eight reserved ephemeral ALB slots**

True: `packages/infra/alb/src/listenerPriority.ts:74` reserves `EPHEMERAL_SERVICE_SLOTS = 8` against a roster of nine drawn from ADR-0017's amendment, ADR-0019 §3 and the 012/013/014 specs. NOT live — ADR-0003:96 records that the allocator fails loudly at synth, which is the designed behaviour.

**Trigger:** The PR appending a ninth entry to `EPHEMERAL_SLOT_ORDER` (`listenerPriority.test.ts:80` reds first), or U13 recording the re-cut in ADR-0003.

<a id="04fi2"></a>

### `04.F-I2` — deferred

**006's V-Model prescribes listener bands above the 50,000 ALB ceiling**

True: `specs/006-meal-planning/plan.md:648-650` and four V-Model artifacts specify 50000-69999 bands against `ALB_MAX_LISTENER_PRIORITY = 50_000`.

**Trigger:** U13 — the plan names it verbatim ("006's per-PR bands exceeding the priority ceiling").

<a id="04fi3"></a>

### `04.F-I3` — deferred

**ADR-0003 records only the adjustable rules quota, not the target-group one**

True: ADR-0003:99 cites the 100-rule adjustable quota and nothing anywhere records target-groups-per-ALB, which is also 100 and is NOT adjustable. Not binding today (two per-PR services), so this is a documentation defect that will only bite when the roster grows. Same subject as 13.A-2.

**Trigger:** The fourth per-PR-deployed service registering in `EPHEMERAL_SLOT_ORDER`, or 04.F-I1's re-cut — whichever first.

<a id="04fi4"></a>

### `04.F-I4` — deferred

**ECR repos have no lifecycle policy, and teardown's ECR sweeps match nothing**

True on both halves: six bare `create-repository` calls and zero `put-lifecycle-policy` in `.github/`, and all three stacks use `fromRepositoryName`, so the teardown script's ECR clauses match nothing. A cost and hygiene defect, not a correctness one.

**Trigger:** U16/U17 — the next units to open the service stacks and `DataStack`. Measurable earlier: any `kitchensink-*` ECR repo crossing 10 GB.

<a id="04fi5"></a>

### `04.F-I5` — deferred

**Sandbox deploy jobs hold prod-capable static keys, and ECR tags are MUTABLE**

True: no `image-tag-mutability` anywhere in `.github/` (so ECR's MUTABLE default stands on the same repos prod pulls from) and org-level static keys in `sandbox-deploy.yml:70-73`. `_ci.yml:21` already names the fix. IMMUTABLE is NOT a quick win on its own — it breaks ADR-0010's ensure-exists re-push.

**Trigger:** The OIDC migration already named at `.github/workflows/_ci.yml:21` and in `docs/CI_ARCHITECTURE.md`.

<a id="04fi6"></a>

### `04.F-I6` — deferred

**`workflow_dispatch` yields the image tag `pr--<sha>` and a bogus web origin**

True: `sandbox-deploy.yml:732` lacks the dispatch fallback that the two neighbouring expressions already carry, and `:1026` passes `--web-origin` unconditionally. A one-expression fix, but in a workflow file another session is editing.

**Trigger:** The next `workflow_dispatch` of `sandbox-deploy.yml` with `service: recipe` — it reproduces on the first run.

<a id="05fs1"></a>

### `05.F-S1` — deferred

**004's plan, tasks and V-Model still ship the Textract OCR channel at launch**

True: `specs/004-recipe-importing/tasks.md:551` still reads "T-018 · OCR channel … ships at launch", with four more sites in `plan.md` and two in the V-Model requirements.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions. It names this item verbatim.

<a id="05fs2"></a>

### `05.F-S2` — deferred

**011 still builds a stateful `digitization_jobs` service with its own save path**

True: `digitization_jobs` appears seven times in `011/plan.md` and three in `spec.md`, and neither `plan.md` nor `tasks.md` mentions ADR-0019 or bulk import at all.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions. It names this item verbatim.

<a id="05fs3"></a>

### `05.F-S3` — deferred

**006's spec answers "which service owns 006" both ways, and its tasks pick the wrong one**

True: `006/spec.md:38` says its own deployable while `:538-546` says no new deployable is created, and `tasks.md:516` asserts a foreign key its own C-006-002 forbids. `tasks.md` is dated 2026-06-02 and cannot cover an August decision.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions.

<a id="05fs4"></a>

### `05.F-S4` — deferred

**005 and 006 both claim ALB base priority 400 and cite retired bands**

Was true; PARTLY OVERTAKEN in this branch — `a7105d95` (U13) repointed 005 and 006 at the allocator rather than at per-spec constants. The residual is the remaining retired-band prose.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions. Verify no spec states a numeric base priority.

<a id="05fs5"></a>

### `05.F-S5` — deferred

**007's data model declares foreign keys across three databases**

Was true at review time; OVERTAKEN in this branch by `fd70eaab` (U13), which drops the boundary-crossing keys from 007 and 009. Retained as a row so the verification is done rather than assumed.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions. Verify by `grep REFERENCES specs/007-grocery-lists/plan.md` returning no cross-database target.

<a id="05fs6"></a>

### `05.F-S6` — deferred

**009's FKs are cross-database, and ADR-0017's 006-009 rationale is stale**

Same pair as 05.F-S5: the FK half is addressed by `fd70eaab`; the stale ADR-0017 sentence — which still forbids the split its own amendment performs — is not.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions. The superseded-ADR half of its verification line.

<a id="05fs7"></a>

### `05.F-S7` — deferred

**004's import-spine requirements exist only as prose in spec.md**

True at review time: FR-046..051 appeared in `spec.md` alone while `plan.md:216` still listed three per-channel endpoints. Partly overtaken by `843e51d6` and `2275b4b1` (U13/U14), which gave the text channel a home and re-homed the OCR scenarios.

**Trigger:** U14 — its verification line is "tasks regenerate cleanly"; confirm the spine's requirements reach tasks.md.

<a id="05fs8"></a>

### `05.F-S8` — deferred

**011's spec says the premium OCR gate is both optional and binding**

True: `011/spec.md:53` says 011 ships ungated if 010 is not live, while `:83-87` inherits the gate as binding, against 004's MUST.

**Trigger:** U14 — mobile OCR classifies `imported_paid`, never `imported_physical`, which is what keeps the gate's enforcement point.

<a id="05fs9"></a>

### `05.F-S9` — deferred

**Governance ledgers GR-015/GR-016/GR-002 went stale within two days**

True: `governance-rules.md:815` still asserts no new deployable service is created, `:818` is contradicted by 013's own tasks, and `:118` names 006 as the holdout when 006 is clean and 003 is not.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions. The Current-State ledgers are in scope for the superseded-assertion sweep.

<a id="05fs10"></a>

### `05.F-S10` — deferred

**GR-011's AC-011-b is unmet — only 003 declares a 014 dependency**

True: no 014 dependency row exists in 001/004/005/008/009/011; the sole hit is `003/spec.md:260`, while ADR-0019 adds 004 and 011 as producers.

**Trigger:** U14 — "014 absorbs U7's doorbell contract in full" is the pass that must record its producers.

<a id="05fs11"></a>

### `05.F-S11` — deferred

**The cross-feature FR registry is missing every 2026-08-14 citation**

True: `cross-feature-FR-index.md` carries three 004 rows and none of 011's six, and the deferral note in `governance-rules.md:188-192` still stands although 005 and 006 have landed. Same gap 11.A-4's residual names.

**Trigger:** U14 — the respec pass that lands 004's and 011's citations.

<a id="05fs12"></a>

### `05.F-S12` — deferred

**003's spec and plan document the deprecated bare `/v1/foods` as canonical**

True (count corrected to 47 lines vs 3): `003/spec.md` documents the bare prefix as canonical when `foods.controller.ts` serves it only as an ADR-0011 deprecated alias.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions. ⚠️ needs U13's file scope widened to `specs/003-usda-food-data/**` and GR-002's ledger, neither of which the plan currently lists.

<a id="05fs13"></a>

### `05.F-S13` — deferred

**Four features' task lists leave requirements untraced, 006 worst**

True: `006/tasks.md` is dated 2026-06-02 and cannot cover August requirements, and `011/tasks.md` contains zero references to FR-021a/FR-021b.

**Trigger:** U14 — its verification line is "tasks regenerate cleanly".

<a id="05fs14"></a>

### `05.F-S14` — deferred

**Six new ALB-attached deployables are declared against five free slots**

True, and the same arithmetic as 04.F-I1: six deployables named across 005, 006, ADR-0019, 011, 012 and 013 against five free ephemeral slots, with none of 011/012/013 stating a priority.

**Trigger:** Same as 04.F-I1 — the ninth `EPHEMERAL_SLOT_ORDER` entry, or U13's roster re-cut.

<a id="05fs15"></a>

### `05.F-S15` — deferred

**The cross-feature consistency report still describes a pre-code portfolio**

True: `cross-feature-consistency-report.md:5` still asserts that no implementation code exists, and `:29` assigns photo storage and OCR to 004 against ADR-0019:74-76.

**Trigger:** U13 — documents only; the plan scopes it to the hard spec contradictions. A dated "superseded in part" banner is sufficient.

<a id="06fd1"></a>

### `06.F-D1` — deferred

**Handle-sync producer and consumer disagree on bounds, and drops are silent**

True: identity publishes `z.string().max(100).optional()` while `recipe-workers` requires `.trim().min(1).max(100)`, and `idpPayload.schema.ts:65` bounds each name component independently so the join can reach 201; the consumer `continue`s instead of reporting a batch item failure. Tightening the producer is a wire-contract change (CONTRACT_HASH), not a one-character fix.

**Trigger:** 06.F-D7's single-authoring move, sequenced by U14 — fixing the bound without unifying the authorship writes the same rule twice again.

<a id="06fd2"></a>

### `06.F-D2` — deferred

**GDPR erasure leaves the avatar photograph readable in S3, two ways**

True at HEAD, and U2 closed only identity's own path. `avatarObjectStore.ts:41-61` deletes without `VersionId` against a `versioned: true` bucket with no lifecycle rules, so every prior version stays readable while the store logs success; and `identity-webhooks` contains no S3 client at all, so the webhook-triggered erasure deletes no avatar even though `profileScrubPolicy` asks for it. Real privacy defect, in a package outside this pass's scope.

**Trigger:** U16/U17 (the next units to open the media origin), or sooner — required before any user is deleted from the Clerk dashboard. Same residual as 19.P-11.

<a id="06fd3"></a>

### `06.F-D3` — deferred

**Admin suspend/unsuspend have no lifecycle guard, so erased users resurrect**

True: `admin.service.ts:64-77` and `:79-95` each hold one precondition, while the sibling `reactivateUser` at `:118-124` carries exactly the tombstoned/erased guard they lack — so an admin unsuspend can switch a user back on after erasure and silently remove them from both sweeps. Eight lines, symmetric with a method in the same file.

**Trigger:** The next identity-service change, or the first non-owner `admin:users` credential — whichever first. Not taken here only because identity was outside this pass's scope.

<a id="06fd4"></a>

### `06.F-D4` — deferred

**The erasure fan-out parses responses unsafely and fails OPEN on food**

True: `erasureFanout.ts:158` casts an unparsed body, and `erasureReconciliation.ts:67`'s `?? 0` reads an unreadable response as clean, then stamps `reconciled_at` so the identity leaves the sweep. `identity-webhooks` declares no `@kitchensink/schema-*` dependency, which is why the published shapes are not used. ADR-0015 decision 4 names this file.

**Trigger:** Any change to either published erasure response schema, or the first `ErasureIncomplete` alarm (subscribed as of U11) that lacks `deletedRequesterRows`.

<a id="06fd5"></a>

### `06.F-D5` — deferred

**The avatar presign returns a `publicUrl` that answers 403 to everyone**

True in code: the controller composes a bucket URL while `DataStack.ts:330` blocks all public access and no distribution construct exists yet. Not verified against a running stage.

**Trigger:** U16/U17 — the units that introduce the first distribution and a configured CDN origin for media.

<a id="06fd6"></a>

### `06.F-D6` — deferred

**A Lambda deployable imports another deployable service's source**

True and pre-existing on `main`: `identity-webhooks` depends on `@kitchensink/identity-service` and imports from it, and the dependency gate is blind to it by scope. Not a runtime defect; a boundary defect.

**Trigger:** 06.F-D7's move of the handle-sync publisher into `identity-core` — the same edit deletes both the import and the dependency.

<a id="06fd7"></a>

### `06.F-D7` — deferred

**The only live bus contract is declared twice, in two different mechanisms**

True: `identity-core/src/handleSync.ts:11` is a bare TypeScript interface with no zod, while `recipe-workers/src/common/messages.schema.ts:130-141` authors an independent zod for the same message. ADR-0019 and GR-015 §15-b.4 forbid exactly this.

**Trigger:** U14 — "014 absorbs U7's doorbell contract in full" is where the substrate's message shapes get a single author.

<a id="06fd8"></a>

### `06.F-D8` — deferred

**The failed-enqueue residual note understates the cross-service exposure**

True and documentation-only: `deletionEnqueue.error.ts:22-27` records only the JWT nuisance, while neither recipe nor food carries an account-status gate, so an unbanned session keeps full access to both.

**Trigger:** The deferred Clerk-ban convergence sweep the note itself names.

<a id="06fd9"></a>

### `06.F-D9` — deferred

**The "one display-name rule" exists twice and the two disagree on whitespace**

True: `identityWebhook.ts:36`'s `buildDisplayName` and `identity-core/src/displayName.ts`'s `deriveDisplayName` are two authors of one rule, used on two different paths.

**Trigger:** The identity-core consolidation in 06.F-D6/06.F-D7 — one move settles all three.

<a id="06fd10"></a>

### `06.F-D10` — deferred

**Two erasure-path docstrings describe an unbuilt system that is built**

True and comment-only: `tombstoneSweep.ts:44` calls the deletion worker's erasure branch "a no-op that logs" and `:114-115` calls the erasure reconciliation "(unbuilt)", while both handlers exist and are scheduled. Same class as 19.P-12.

**Trigger:** The next edit to `tombstoneSweep.ts` — cheapest carrier is 06.F-D2's webhook-path fix.

<a id="06fd11"></a>

### `06.F-D11` — deferred

**The dev-auth bypass gates on `NODE_ENV`, not the repo's stage predicate**

True: `auth.middleware.ts:56-58` gates on `NODE_ENV` while the repo has `isDeployedStage` for exactly this, and the bypass is held closed only by `IdentityServiceStack.ts:219` hard-setting `NODE_ENV: 'production'`. One config change away from armed. Same class as 08.F-SEC8, which is the recipe service's live version of it.

**Trigger:** `NODE_ENV` ceasing to be set unconditionally at `IdentityServiceStack.ts:219`; fix with 08.F-SEC8 so one rule covers both services.

<a id="07ft1"></a>

### `07.F-T1` — deferred

**The whole mobile vitest E2E tier tests a function defined inside the test file**

True: `mobile/tests/e2e/auth.test.ts` imports only `vitest` and declares its own `deriveAuthState`, and it is the only file the mobile e2e config matches — so the CI job named "E2E (mobile — Vitest)" is a permanent green over no production code. Must be fixed together with 07.F-T2: alone it leaves the tier double-collected.

**Trigger:** Paired with 07.F-T2, before any new mobile e2e spec lands (feature 004's import flow is the next). Fix: import the real `deriveAuthState` from `src/hooks/useAuth`.

<a id="07ft2"></a>

### `07.F-T2` — deferred

**Mobile's default test glob swallows the E2E tier**

True: `mobile/vitest.config.ts:10` includes `tests/**/*.test.ts` with no `exclude` key, so the e2e tier also runs inside the unit task — which §7 forbids. Every other package in the repo excludes it.

**Trigger:** Paired with 07.F-T1 — one line, but it must land with the import fix or the tier still proves nothing.

<a id="07ft3"></a>

### `07.F-T3` — deferred

**A tautological "performance" spec runs in the default Test job**

True: `identity/tests/perf/latencyPerf.test.ts` has five tests that each assert a local literal against itself, zero imports beyond `vitest`, and is collected by the default config. CLAUDE.md forbids counting it toward the mandate; the real budgets live in `tests/load/*.load.js`.

**Trigger:** The next identity-service change — delete the file and say so, per the deletion rule.

<a id="07ft4"></a>

### `07.F-T4` — deferred

**No guard holds vitest tiers to CI, though the same failure has happened twice**

True: zero of the 68 conformance guards reference `test:integration` or `test:e2e`, though sibling guards exist for k6, Maestro and the heavy-e2e gate, and `_ci.yml` records the class recurring twice.

**Trigger:** Before the first new vitest tier lands — 004's import spine and 014's consumer each add one. Model it on the k6 wiring guard, which already discovers its subjects from the filesystem.

<a id="07ft5"></a>

### `07.F-T5` — deferred

**The visual-regression gate is inert: `ARGOS_ENABLED` is not set**

True: the variable exists in no repo/org variable list, and its only consumer's job declares no `environment:`, so the comparison never runs. Not a §7.1 tier, so this is a wasted gate rather than a mandate breach; the off-state is documented in place.

**Trigger:** An ops action (link the Argos project and set the variable) or, failing that, deletion of the spec and upload steps when feature 004's two-platform UI lands.

<a id="07ft6"></a>

### `07.F-T6` — deferred

**identity-webhooks is a deployable HTTP API with no k6 tier**

True: it has no `tests/load/` at all, while food, identity and recipe do — and the k6 wiring guard is structurally blind to it, because it asserts non-vacuity only where `tests/load/` already exists. §7.1 requires k6 per deployable service.

**Trigger:** Feature 014, or the next identity-webhooks change; the guard half rides with 07.F-T4.

<a id="07ft7"></a>

### `07.F-T7` — deferred

**The web last-resort error boundary is tested only for its Sentry side effect**

True: `web/tests/globalError.test.tsx` is 18 lines with a single `captureException` assertion and nothing about the `<html>/<body>` wrapper Next requires of a global error boundary. Mobile's equivalent is covered.

**Trigger:** The next `@commise/web` change, or feature 004's UI — two assertions.

<a id="07ft8"></a>

### `07.F-T8` — deferred

**recipe-service's DB pool config has zero tests while its stated mirror has them**

True: `recipe-service/src/database/poolConfig.ts` is referenced by no test file, while `food-service/src/database/__tests__/poolConfig.test.ts` exists and is the module it says it mirrors.

**Trigger:** Feature 004's bulk-import endpoint, which is what makes pool churn and per-connection RDS-IAM refresh matter — copy food's test first.

<a id="07ft9"></a>

### `07.F-T9` — deferred

**Two committed Maestro flows are executed by nothing**

True and BOUNDED: the two flows are enumerated in `maestroFlowSelection.test.ts:245`'s `KNOWN_UNRUN_FLOWS`, and the same guard fails the build on a NEW dead flow — so the debt is fenced rather than growing.

**Trigger:** Promote them into `FLOW_PLAN` on the next `heavy-e2e`-labelled PR touching home or discovery; 004's import entry point qualifies.

<a id="07ft10"></a>

### `07.F-T10` — rejected

**The only Playwright spec that talks to a real backend is gated on an unset env var**

The premise is true and the posture is deliberate and documented twice — `recipeLive.spec.ts:12` declares itself opt-in and `_ci.yml:985` names the variable and states that it stays skipped. §7.1 requires a Playwright test per user story (32 specs exist), not a live-backend tier; the live contract gate is the two `src/__integration__/` client suites plus the `contract-drift` job under ADR-0014.

<a id="07ft11"></a>

### `07.F-T11` — deferred

**`passWithNoTests: true` turns a broken include glob into a green tier**

True, and WORSE than reported — ten configs, not five. The correct posture already exists in the repo (`mobile/vitest.e2e.config.ts:7` and `identity-webhooks/vitest.e2e.config.ts:12` both set `false`), and this is the mechanical enabler of the dark-tier failure `_ci.yml:744-749` already records once.

**Trigger:** One word per config on the nine service tiers that provably have at least one spec; leave the two `ui` configs until their file count is checked. Take it with 07.F-T4's guard, which is what stops it recurring.

<a id="07ft12"></a>

### `07.F-T12` — deferred

**Coverage is never measured anywhere**

True: no `thresholds` in any vitest config and no `--coverage` in any workflow, so §7's pyramid and the "every UI state" rule are unenforceable claims. `test:mutation` is likewise never invoked.

**Trigger:** Same change as 07.F-T4's guard — seed it as a ratchet against a committed baseline, the way the boundaries baseline already works.

<a id="07ft13"></a>

### `07.F-T13` — deferred

**Non-UI libraries and clients have unit tests only; §7.1 requires both tiers**

True for all fifteen named packages. The risk half is concrete: `shared/identity-db` ships three DAOs against two unit tests, and `clients/usda` validates an untrusted upstream shape with one unit test while both peer clients have `src/__integration__/` suites.

**Trigger:** Two triggers: the DAO and USDA tiers ride the next identity-erasure and USDA-pipeline changes; the general rule needs an owner ruling in §7.1 on what integration means for a pure-function package.

<a id="07ft14"></a>

### `07.F-T14` — rejected

**`packages/schemas/*` have no test script, so `turbo run test` skips them**

The premise is true and the conclusion contradicts the recorded design: under ADR-0014 and §15.2 these packages are a literal COPY of zod authored and tested in the owning service, so a per-package spec would be a second representation of one rule. The posture is already guarded by `generatedSchemaPackages.test.ts`, the `contract-drift` CI job and `wireContractConsumers.test.ts`.

<a id="07ft15"></a>

### `07.F-T15` — deferred

**No end-to-end coverage of the async PENDING to RESOLVED transition on either platform**

True: of 32 web specs the one that asserts "Resolved" does so on a line the mocked admit already returned resolved, and no Maestro flow matches the status vocabulary at all. §7.1 requires both per story.

**Trigger:** Feature 004's import UI — one Playwright spec serving PENDING then RESOLVED across two route fulfilments, plus the Maestro mirror, written BEFORE that surface ships.

<a id="07ft16"></a>

### `07.F-T16` — deferred

**Cross-platform parity gap on the exact component 004 will duplicate**

True: `mobile/src/components/IngredientStatusPoller.tsx` is referenced by no test file while its web twin has five cases; the same sweep finds three more unreferenced mobile components. §14.1 lockstep parity.

**Trigger:** Feature 004's two-platform import UI — the `.native.test.tsx` lands in the same change, per the new test-first law.

<a id="08fsec1"></a>

### `08.F-SEC1` — fixed

**Load shedder keyed on a spoofable header and never evicted — memory-exhaustion DoS**

Same defect as 02.F-F1 and fixed with it: `AuthLoadShedder.recordFailure` now prunes its own ring to the rolling window and evicts the bucket map to `maxTrackedSources` least-recently-failed-first, with the count assertable via `trackedSources()`. Covered at unit (four adversarial cases), integration and e2e (a 250-request key-rotating flood must stay `401` and keep serving a legitimate caller) and by a new k6 scenario, `tests/load/authFlood.load.js`.

<a id="08fsec2"></a>

### `08.F-SEC2` — deferred

**`PATCH /foods/{id}` `candidateIds` is unbounded and un-deduped, draining the USDA hour**

True: `foods.schema.ts:447` is `z.array(z.string()).min(1)` with no `.max()` and no dedup, inside a `strictObject` that bounds its other fields, and resolves are never admitted or shed. A cap alone is insufficient — without `new Set()` the amplification survives.

**Trigger:** The next food-service contract change (a `.max()` moves `CONTRACT_HASH`, so it must ride a regeneration). Take it with 08.F-SEC4, same route.

<a id="08fsec3"></a>

### `08.F-SEC3` — deferred

**`sharp` 0.34.5 decodes attacker-supplied bytes in-process against live libvips CVEs**

True and confirmed by `npm audit --omit=dev` today; the advisory's fix is 0.35.3, which a `^0.34.5` caret can never reach, and no workflow runs `npm audit` at all. Native and semver-major, so it needs its own change with the photo-confirm integration and e2e tiers re-run.

**Trigger:** This branch's dependency-hygiene pass, with 08.F-SEC9 — bump both manifests and add `npm audit --omit=dev --audit-level=high` to CI in the same change.

<a id="08fsec4"></a>

### `08.F-SEC4` — deferred

**`PATCH /foods/{id}` has no authorization beyond authenticated, and records no actor**

True: the sibling `/refetch` route checks `FOOD_ADMIN_SCOPE` and this one checks nothing, while its docstring argues only about whether to RECORD a requester (a privacy question), never about who may act. Whether that is the product rule is not mine to decide.

**Trigger:** An owner ruling: if resolve-by-any-user is intended, write it at the route with an actor in the log; otherwise gate it on the existing `fetch_requesters` row.

<a id="08fsec5"></a>

### `08.F-SEC5` — deferred

**zod v4 `z.url()` accepts any scheme, so `avatarUrl`/`sourceUrl` admit `javascript:`/`data:`**

True and REPRODUCED against the installed zod 4.4.3: `z.url()` accepts `javascript:`, `data:text/html`, `file://` and a link-local address. Both sites are user-supplied and one is documented as rendered into an image source.

**Trigger:** Feature 004 — its import URL becomes `sourceUrl` and gates the fetcher's input. Fix both sites with a protocol-restricted `z.url({ protocol: /^https$/ })` BEFORE 004 merges.

<a id="08fsec6"></a>

### `08.F-SEC6` — deferred

**Nine collections routes pass an unvalidated path param into a uuid column**

True: nine bare `@Param` sites against a `uuid` column, where every sibling controller uses `ParseUUIDPipe` — so a malformed id becomes a Postgres `22P02` and a 500 with a stack, which ADR-0015 §5 forbids. The mechanism is inferred, not executed. Not taken here because `collections.controller.ts` is in the file set another session is editing.

**Trigger:** The next recipe-service change after U10 part 2 — the pipe on all nine plus one real-stack `400` case, since the existing mocked test cannot reach the driver.

<a id="08fsec7"></a>

### `08.F-SEC7` — deferred

**Unbounded `ParseIntPipe` writes an out-of-int4-range `versionNumber` into an integer column**

True: two bare `ParseIntPipe` params against an `integer` column, while `recipe-core` already exports `INT4_CEILING` for body fields. Same ADR-0015 §5 rule and the same inferred-not-executed status as 08.F-SEC6.

**Trigger:** Same change as 08.F-SEC6 — a bounded zod param DTO, with the storage-capacity test extended to path params.

<a id="08fsec8"></a>

### `08.F-SEC8` — deferred

**recipe-service alone leaves the dev-auth bypass armed on deployed non-prod stages**

True: `RecipeServiceStack.ts:201` sets `NODE_ENV: 'production'` only on prod, while identity and food hard-set it everywhere — and `auth.middleware.ts:49-54` returns a full principal with no token when `NODE_ENV !== 'production'` and a user id is configured. Latent only because that variable appears in no infra file or workflow.

**Trigger:** Before recipe-service gets a production origin — U17 cuts prod DNS and locks the ALB security group. Gate on `STAGE` (already in scope at that line) and add the synth test. Fix with 06.F-D11 so one rule covers both services.

<a id="08fsec9"></a>

### `08.F-SEC9` — deferred

**Web runs Next 15.5.19 with HIGH Server-Action and image advisories**

True and confirmed by `npm audit --omit=dev` today, with a non-major fix available; the App Router Server-Action path is live per ADR-0001's 2026-07-28 update, and no workflow runs an audit.

**Trigger:** Same change as 08.F-SEC3 — but a `@commise/web` bump needs a real `next build`, not just a typecheck, so it cannot ride a one-line dependency PR.

<a id="08fsec10"></a>

### `08.F-SEC10` — deferred

**food-service has no rate limiting, CORS policy or security headers**

True: `main.ts` is 44 lines with no `enableCors` and no throttler, where recipe-service has `ThrottlerModule.forRoot`, a global user throttler and a CORS policy. Food's only control is the load shedder — which is now bounded (02.F-F1) but is a DoS defence, not an authorization or origin control.

**Trigger:** U16/U17 — food gets a CloudFront origin and a locked ALB security group there; port the throttler guard and the CORS policy in the same change.

<a id="08fsec11"></a>

### `08.F-SEC11` — deferred

**Collections return 403 where recipes deliberately return 404**

True: `collections.service.ts:399-411` raises a not-owner 403 while `recipes.service.ts:880-892` returns 404 with the anti-oracle rationale written out in place, and `cloneCollection` already follows the recipe rule. A one-line change that moves an observable status code, so it needs its contract and e2e assertions in the same commit.

**Trigger:** The next recipe-service change after U10 part 2 — bundle with 08.F-SEC6/SEC7, which touch the same controllers.

<a id="08fsec12"></a>

### `08.F-SEC12` — deferred

**Search filters and recipe steps/dietary flags carry no upper bound**

True: the text and list filter schemas bound neither string, array nor element, and `steps`/`dietaryFlags` are unbounded while their siblings in the same schema carry `MAX_*` constants.

**Trigger:** Feature 004's payload bounds — it lands `MAX_*` constants in `recipe-core` anyway; add `MAX_RECIPE_STEPS` and `MAX_DIETARY_FLAGS` and bound the two filters there.

<a id="08fsec13"></a>

### `08.F-SEC13` — deferred

**Avatar upload never re-validates the uploaded bytes; the photo path does**

True: the presign validates the client's claimed type and size and there is no confirm endpoint, while recipe photos sniff magic bytes and HEAD the object. Low exploitability (the signed `Content-Type` is pinned) but two standards for one requirement.

**Trigger:** U16 — the edge unit owns the media origin's response headers, and `X-Content-Type-Options: nosniff` there covers the recipe path too; add the residual-risk note at the controller in the same change.

<a id="08fsec14"></a>

### `08.F-SEC14` — deferred

**Three route families hand-roll parsing that ADR-0015 requires in the pipe**

True: five `requireId` calls and a `boundedNames` call in food-service, and two raw `@Query` params with a local `parseLimit` in recipe-service ingredients. No exploitable defect today — `requireId` does check ULID shape — so this is conformance debt, and it is one forgotten call away from 08.F-SEC6. Same subject as 01.F-R3.

**Trigger:** The first new `:id` or query route in either controller (003 and 004 both touch them) — param and query DTOs, plus identity's metadata-discovering param-validation test copied across.

<a id="09fdb1"></a>

### `09.F-DB1` — deferred

**The single-writer rule holds today, but nothing records why**

Premise verified TRUE at HEAD — recipe reaches food only over HTTP, and the only `food` insert is `FoodDao.createByName` — so there is nothing to fix. The ask is to record the four invariants that keep it true, which is documents-only work.

**Trigger:** U14 — the invariants land in `specs/004-recipe-importing/**` beside the bulk-import processor that would be the first thing to threaten them.

<a id="09fdb2"></a>

### `09.F-DB2` — deferred

**A shed enqueue leaves a permanently-PENDING orphan shell**

True; same defect as 02.F-F2, seen from the data side. The row is committed in its own transaction before admission can throw, and no sweep looks for a `food` row without a `fetch_queue` row.

**Trigger:** U14; or sooner, a non-zero result from `SELECT count(*) FROM food f WHERE f.status='PENDING' AND NOT EXISTS (SELECT 1 FROM fetch_queue q WHERE q.food_id=f.id)`.

<a id="09fdb3"></a>

### `09.F-DB3` — deferred

**`ingredients` can represent four illegal placeholder states**

True as a schema gap and NOT reachable today: only two ingredient CHECK constraints exist, but no writer produces an illegal state — the two insert paths write both columns or neither. Defence-in-depth that needs a repair migration over production rows, so it is not a free addition.

**Trigger:** A per-class violation count against production first, then a `NOT VALID` constraint plus `VALIDATE CONSTRAINT` in its own migration, with the integration test the new test-first law requires for a schema change.

<a id="09fdb4"></a>

### `09.F-DB4` — deferred

**The status projection has no index and no freshness anchor**

True: none of the four `ingredients` indexes covers `food_resolution_status`, and the table has no `updated_at`. The query it would serve is ADR-0019 §5's, which is not built.

**Trigger:** U14 — index plus a `status_updated_at` column ship with the import status read path, as a plain `CREATE INDEX` (the runners wrap each file in BEGIN/COMMIT).

<a id="09fdb5"></a>

### `09.F-DB5` — deferred

**Nothing exists for per-recipe bulk-import status**

True: no import-job, import-batch or import-entity table exists anywhere in any service. Spec-level, not code-level.

**Trigger:** U13 then U14 — the tables land in `specs/004-recipe-importing/plan.md` before anything creates them.

<a id="09fdb6"></a>

### `09.F-DB6` — deferred

**Unresolved and failed shells are published to every user's ingredient typeahead**

True and LIVE — not a bulk-import hypothetical: `IngredientsDal.search` filters on relevance only, with no status and no owner predicate, while food's own search hard-filters `status = 'RESOLVED'` in both branches. The recipe copy is the only unguarded one. Same surface as 19.P-4 and 12.A-10. Not taken here because `ingredients.dal.ts` is being rewritten concurrently by U10 part 2.

**Trigger:** The next recipe-service change after U10 part 2 — one predicate, plus the DAL integration test asserting a PENDING placeholder is absent from the hits.

<a id="09fdb7"></a>

### `09.F-DB7` — deferred

**Recipe-side status transitions are unguarded and carry no sequence**

Half-confirmed: the write is `WHERE id = $1` alone, but no out-of-order writer exists — KTD-4 rules that the recipe service does not consume food events, so only the read-then-write pull paths write. Same site as 01.F-R2 and 12.A-3.

**Trigger:** U14 — the CAS predicate now; a sequence only if recipe ever becomes a push consumer, which ADR-0019's amendment currently forbids.

<a id="09fdb8"></a>

### `09.F-DB8` — deferred

**No status history exists, and the one field that could explain a failure is cleared on retry**

True: the ingredients schema carries no error or attempt column. The recommendation targets `import_entities`, which does not exist (09.F-DB5).

**Trigger:** U14 — lands with `import_entities`.

<a id="09fdb9"></a>

### `09.F-DB9` — deferred

**A never-resolvable name is re-enqueued forever, and bulk import makes it a queue flood**

True: terminal rows reactivate past their TTL with no failure counter and no permanent-failure state. At today's volume a slow drip; the escalation is conditioned on the 1,000-recipe import that does not exist.

**Trigger:** U14 (a consecutive-failure counter plus parse-before-enqueue); or `fetch_queue` depth reaching `FOOD_MAX_QUEUE_DEPTH`.

<a id="09fdb10"></a>

### `09.F-DB10` — deferred

**`recipe_versions.created_by` has no index**

True: the table has exactly three indexes and none covers `created_by`, while the handle fan-out updates `WHERE created_by = $1` inside the rename transaction over rows that each carry a full JSONB snapshot. `recipe_ratings.user_id` documents the identical reasoning, so this applies an existing decision rather than making a new one.

**Trigger:** The next recipe-service migration after U10 part 2 — a plain `CREATE INDEX` (not `CONCURRENTLY`), with the integration test against a real database that a schema change now requires.

<a id="09fdb11"></a>

### `09.F-DB11` — deferred

**The handle fan-out cannot use the partial `idx_recipes_owner_id`**

True and cost-only: the index is partial on `deleted_at IS NULL` and the fan-out predicate has no `deleted_at` term, so the planner cannot prove coverage. Both candidate fixes carry a decision code cannot make — adding the predicate means a restored tombstone may keep a stale handle, and the alternative is a second index on the hottest table.

**Trigger:** An owner ruling on the stale-handle trade, then the same migration as 09.F-DB10. `schema/account.ts:129-133` is the precedent for the second-index option.

<a id="09fdb12"></a>

### `09.F-DB12` — deferred

**Two `recipes` indexes no longer match the shipped read predicate**

`EXPLAIN (ANALYZE, BUFFERS)` evidence on a representative dataset — the standing owner ruling forbids shipping a `DROP INDEX` without a measured plan.

**Trigger:** `EXPLAIN (ANALYZE, BUFFERS)` evidence on a representative dataset — the standing owner ruling forbids shipping a `DROP INDEX` without a measured plan.

<a id="09fdb13"></a>

### `09.F-DB13` — deferred

**`recipe_ingredients` denormalizes a flag with nothing keeping it in sync, and accepts negatives**

Both halves true: `is_user_entered` is duplicated from the parent row, and the only CHECK is on quantity, so the four user-override macro columns accept negatives. NOT superseded by KTD-3, which explicitly keeps those columns as user overrides.

**Trigger:** The CHECK constraint on the next recipe-service migration (violation count first); the denormalization ruling at U14, since 004's import path is the first non-human writer of those rows.

<a id="09fdb14"></a>

### `09.F-DB14` — deferred

**28 of the 29 foreign keys 007 and 009 assert cannot exist**

True at review time — none of the referenced tables exists, and the references cross three separate logical databases. OVERTAKEN in this branch by `fd70eaab` (U13), which drops them.

**Trigger:** U13 — the plan names this verbatim; verify by grepping both plans for a cross-database `REFERENCES`.

<a id="09fdb15"></a>

### `09.F-DB15` — deferred

**`food_status_idx` is the wrong shape for any shell sweep or shell-status scan**

`EXPLAIN (ANALYZE, BUFFERS)` evidence on a representative dataset — the standing owner ruling forbids shipping a `DROP INDEX` without a measured plan.

**Trigger:** `EXPLAIN (ANALYZE, BUFFERS)` evidence on a representative dataset — the standing owner ruling forbids shipping a `DROP INDEX` without a measured plan.

<a id="09fdb16"></a>

### `09.F-DB16` — deferred

**The food contract has a batch WRITE but no batch STATUS READ**

True after U8 and U10: the controller has `POST /batch` and now `GET /nutrition`, but status is still single-id. A design risk rather than a defect — ADR-0019 §5 makes the recipe-side projection the primary read.

**Trigger:** U14 — only binding once a bulk import creates thousands of shells.

<a id="19p1"></a>

### `19.P-1` — fixed

**"Erase my account" never reaches identity or Clerk; it erases the recipe domain only**

Closed by U2 `67fea871`. Identity exposes `POST /api/v1/users/me/erasure`; `UsersService` erases the row, deletes the avatar and enqueues both the Clerk delete and the cross-service fan-out; and both apps call it through the shared `useEraseAccount` hook.

<a id="19p2"></a>

### `19.P-2` — deferred

**On-device OCR relocates the retention obligation rather than reducing it**

Premise confirmed and documents-only: 011's C-005 and FR-036 key the purge to the `raw_ocr_json` COLUMN, which exists nowhere in the tree, so an on-device path leaves the obligation with no anchor.

**Trigger:** U14 — re-key C-005/FR-036/NFR-008 from a column to a data category, carrying the two owner decisions the finding names.

<a id="19p3"></a>

### `19.P-3` — deferred

**D1 and D2 create two processing operations, two retention regimes and two disclosures**

Contradiction confirmed: `011/spec.md:213` retains the original photo in S3 for archive while `004/spec.md:318-321` requires that no image outlive the draft. Neither is built.

**Trigger:** U13 (hard contradictions first), then U14.

<a id="19p4"></a>

### `19.P-4` — deferred

**A user's raw typed ingredient string becomes a permanent, ownerless, globally-searchable row**

Every limb verified live. The FOOD half is now closed — the catalog's global name and dedup key are canonicalized (16.A-6). The RECIPE half is not: `IngredientsService.addByName` still writes the caller's string to `ingredients.name` and its FTS vector, `IngredientsDal.search` publishes it with no status or owner predicate (09.F-DB6), the table has no owner column, and the erasure worker deliberately skips it — a skip that is pinned by an integration test. Not taken here because those exact files are being rewritten concurrently by U10 part 2.

**Trigger:** Two triggers: the search predicate and name-reconciliation-on-RESOLVED ride the next recipe-service change after U10 part 2; the `created_by` column and erasure wiring need the owner's retention ruling, with 19.P-5, at U13/U14.

<a id="19p5"></a>

### `19.P-5` — deferred

**The freeform dedup index makes the first typist the permanent global owner of a string**

True: a unique index on `lower(name) WHERE is_user_entered` makes the first freeform row a platform-wide singleton that other users' recipes then depend on. The fix needs the same `created_by` column and the same retention ruling as 19.P-4's second limb.

**Trigger:** U13/U14 with 19.P-4 — an owner ruling on retention for a row other users' recipes now reference.

<a id="19p6"></a>

### `19.P-6` — deferred

**D4's live nutrition reference silently rewrites a data subject's historical health record**

NOT superseded by KTD-3, and this is the distinction that matters: P-6 agrees a recipe's nutrition should be live — which is exactly what KTD-3 implements — and asks only that a LOGGED or PLANNED consumption be snapshotted. That artifact is `meal_plan_entries.nutrition_snapshot`, owned by 006/009, and 006 is now its own deployable, so the recipe service cannot carry it.

**Trigger:** Feature 009 via U13/U14 — scope D4's wording to recipe display and preserve `nutrition_snapshot` with a `computed_at`.

<a id="19p7"></a>

### `19.P-7` — deferred

**Dropping Textract changes the processor set, and nothing in the repo records one**

True: there is no `docs/privacy/`, no Article 30 register, no processor list and no privacy policy anywhere in the tree. A document to author, not a code path.

**Trigger:** Before the first real production user (the plan's calibration is pre-launch, no production users), or the first Article 9 feature — whichever first. It also closes the 2026-06-15 Sentry DPA item.

<a id="19p8"></a>

### `19.P-8` — rejected

**Privacy is sold, not defaulted: photo import is premium-only and free recipes cannot be private**

⛔ WITHDRAWN by owner ruling — not a defect. `recipes/domain/visibilityPolicy.ts` is a pure policy module implementing the specified C-004 product rule deliberately: private is allowed for `user_created` only when premium, for `imported_public` only when premium AND substantively edited, and `imported_physical`/`imported_paid` are private-only (paid may never be public). It gates the TRANSITION rather than existing state, so a lapsed premium user's private recipes are never force-flipped. The photo-import half is settled the other way by U14, which classifies mobile OCR output as `imported_paid`.

<a id="19p9"></a>

### `19.P-9` — rejected

**The `recipes` table defaults to `visibility = 'public'`, `status = 'published'`**

`'public'` is the CORRECT default under the same C-004 matrix that settles 19.P-8: the majority class (`user_created`, free tier) is public-only, so a `'private'` default would contradict the evaluator. `status = 'published'` is documented in place at `schema/recipes.ts:96-99` as the NOT NULL default chosen because every pre-`0013` row was published. No contrary evidence was found.

<a id="19p10"></a>

### `19.P-10` — deferred

**The Article 15/20 export covers the recipe domain only**

True: the export members are recipe-domain only and identity exposes no export handler, so a subject-access request returns part of the data. Closing it is a new identity aggregator leg — the read-direction mirror of the fan-out U2 landed.

**Trigger:** The identity export leg, required by the first production user or the first Article 15 request, whichever comes first.

<a id="19p11"></a>

### `19.P-11` — deferred

**Avatar objects survive a webhook-triggered erasure**

Half-closed by U2: the product path now goes through identity, which deletes the avatar. The residual is exactly the case named — a Clerk-dashboard `user.deleted` for an account that was never closed in-app, where `identity-webhooks` has no S3 client at all while `profileScrubPolicy` declares `removeAvatarObject: true`. Same residual as 06.F-D2's second path.

**Trigger:** Required before any user is deleted from the Clerk dashboard; carried with 06.F-D2.

<a id="19p12"></a>

### `19.P-12` — deferred

**Privacy-critical documentation asserts the opposite of the shipped code, in both directions**

All four confirmed stale, and U2 created a fifth (`AccountEraseForm.tsx:6` still documents the endpoint the control no longer calls). Five one-line edits, in three packages this pass did not otherwise touch — and the artifact a regulator reads first. Same class as 06.F-D10.

**Trigger:** The next change in each package; carried with 06.F-D10, whose cheapest carrier is 06.F-D2's webhook fix.

<a id="19p13"></a>

### `19.P-13` — deferred

**The mobile app declares no camera purpose strings and no iOS privacy manifest**

True, and correctly NOT fixable now: `mobile/app.json`'s `ios.infoPlist` carries only URL types, and declaring a purpose string for a capability the app does not use would itself be a false declaration.

**Trigger:** The commit that adds the camera/OCR plugin for 004/011 — the strings and `PrivacyInfo.xcprivacy` must land in that same PR, since it is a store-submission blocker.

<a id="11a1"></a>

### `11.A-1` — deferred

**The post-parse tail is not identical; the 004/011 seam is drawn too early**

⚠️ Report 11 states its verdicts about the CLAIM UNDER ATTACK, the inverse of reports 12/13 — so `SURVIVES` there means the attack FAILED. This attack landed. The ADR half is answered: ADR-0019's §1 amendment replaces "one bulk import processor" with per-domain processors converging at recipe creation. The spec half is untouched — 004 still says one processor, and 011 still inherits a delete-the-image rule that contradicts its own retain-it requirement.

**Trigger:** U14 — 004's FR-047 and 011's "What 011 inherits" section.

<a id="11a2"></a>

### `11.A-2` — deferred

**"The image service owns NO database" cannot hold**

Unchanged: `011/spec.md:65-74` says it owns no database while its own plan and tasks create `digitization_jobs` in RDS. ADR-0006 makes a logical database free, so the fix is naming an owner, not building one. Same contradiction as 13.A-7.

**Trigger:** U13 — the plan names it verbatim ("011's plan still building a stateful service with its own save path").

<a id="11a3"></a>

### `11.A-3` — deferred

**The 011→004 handoff names no principal, and `imported_physical` is forgeable**

The classification half is ruled: U14 has mobile OCR classify `imported_paid`, never `imported_physical`, so the premium gate keeps a server-observed enforcement point. The credential half is the same one-way door as 01.F-R5 and 13.A-9, and the plan prices it explicitly as a new capability token that blocks nothing in U1–U12.

**Trigger:** U14 for the classification; the service-credential ADR before the first background recipe→food call.

<a id="11a4"></a>

### `11.A-4` — rejected

**Making 011 depend on 004 creates no new critical path**

The attack failed on evidence the report names itself — `specs/v1-launch-plan.md` already had 004 in M1 and 011 in M2, so the dependency adds no ordering. Its residual (no `cross-feature-FR-index.md` row for 004's FR-047/048/050) is carried by 05.F-S11, not here.

<a id="11a5"></a>

### `11.A-5` — deferred

**Steelman: 004 keeps the pipe and 011 keeps the depth — and it wins**

The attack landed on the ADR's one-line rejection: `011/spec.md:26` says the differentiator is the correction UX, not owning the OCR call, and ADR-0019 §3 was NOT amended by U3 (only §1 and §4 were). U14's on-device-first OCR moves this way but appears in neither spec yet.

**Trigger:** U14 — 011's ownership-of-the-photo-channel section, and ADR-0019 §3.

<a id="11a6"></a>

### `11.A-6` — deferred

**The "named exception" mis-cites ADR-0017, and the option space omits `recipe-workers`**

The attack landed: ADR-0017 contains no CPU-shaped/bursty or vendor-dependency flip criterion, yet `011/spec.md:66-70` claims the exception on that ADR's own criteria. U3 established the correct house style — withdraw the reasoning, state the owner's authority — but applied it only to 006. `packages/services/recipe-workers` exists and is still unevaluated as the alternative home.

**Trigger:** U14 — restate as an owner ruling, or adopt `recipe-workers`/Lambda per 13.A-6.

<a id="11a7"></a>

### `11.A-7` — deferred

**The ruling stopped at spec.md; the tasks still build the retired channel**

The attack landed and is PARTLY OVERTAKEN in this branch by `843e51d6` and `2275b4b1` (U13/U14), which stop 004 shipping OCR at launch and re-home its scenarios. 011's tasks still drive `digitization_jobs`.

**Trigger:** U13 — `specs/011-recipe-digitization/tasks.md` is the remaining half.

<a id="11a8"></a>

### `11.A-8` — deferred

**"sourceType declared by the surface, never inferred" conflates three different things**

The attack landed: 004's FR-047 authorises what its own FR-025 forbids (source type set ONLY by the server from the channel it observed), while FR-019 sets format by magic bytes. Three concepts, one field name.

**Trigger:** U14 — 004's FR-047 wording, in the same pass that lands the raw-text channel.

<a id="11a9"></a>

### `11.A-9` — deferred

**"Show it disabled" and "do not show it" are both MUST for the same control**

The attack landed: `004/spec.md:203-210` and `:285-289` give contradictory MUSTs for the premium-gated photo method, and `011/spec.md:53` adds a third position.

**Trigger:** U13 — scoped to contradictions first.

<a id="12a1"></a>

### `12.A-1` — fixed

**The producer-assigned sequence is a counter the design never sites, and it collides**

The field no longer exists: U7 `622a03bd` records in `specs/014-notification-service/spec.md:1196` that FR-045 and the `supersedes` field of FR-026 are withdrawn, and ADR-0019's §4 amendment replaces the producer sequence with consumer-side most-recent-by-timestamp. Nothing needs siting, and only 014's own service-assigned sequence remains.

<a id="12a2"></a>

### `12.A-2` — fixed

**FR-045 is self-contradictory and permits the regression it exists to prevent**

Withdrawn rather than patched: `014/spec.md:1236` states FR-045 is superseded in full by C-8 (U7 `622a03bd`). The redelivery hazard is answered structurally by KTD-2's doorbell — the consumer re-queries an ordered group, so a redelivered `processing` is never observed as current.

<a id="12a3"></a>

### `12.A-3` — deferred

**The DB projection — the declared source of truth — is written unguarded**

The race premise is retired by KTD-4 (the recipe service does not consume food events, so there is one writer), but the write is still a bare `UPDATE … WHERE id = $1` where food's own `setStatus` gates on legal priors. Same site as 01.F-R2 and 09.F-DB7.

**Trigger:** The CAS predicate at the next recipe-service change after U10 part 2; the ADR-0019 §4 status-vocabulary mapping at U14.

<a id="12a4"></a>

### `12.A-4` — deferred

**The ADR requires a dual write and no outbox; the emitter already loses events**

The SILENT half is fixed — U4 `e728c289` made the swallow an explicit contract with a mandatory sink, wired to a warning log. The LOSS half is not, and is a recorded consequence of R1.1's fire-and-forget producers: a failed `PutItem` still loses the message, and D2 rejected an outbox with a stated flip condition.

**Trigger:** The first consumer (014), at U14 — that is when a lost message becomes observable to a user.

<a id="12a5"></a>

### `12.A-5` — fixed

**Nobody can emit the per-food-item message, and the codebase already recorded that**

Designed out. KTD-4 forbids requester identity in the substrate (it would recreate the user↔food linkage outside food's erasure boundary), and consumers subscribe by KTD-2's group key instead. Shipped in `1fb5f2e3`: the emitter keys messages on `groupType: 'food'` plus the internal food id, with no recipient.

<a id="12a6"></a>

### `12.A-6` — deferred

**§4's premise is false (a poll ships) and puts unbuilt 014 on the critical path**

Both facts hold: `refreshStatus` surfaces non-terminal status today, and no notification service exists. The missing piece is the bounded aggregate read — 004's plan still specifies no import-status endpoint. Same as 13.A-8.

**Trigger:** U14 — 004 gains the aggregate read surface, and its acceptance must be satisfiable with 014 absent.

<a id="12a7"></a>

### `12.A-7` — rejected

**The shell entry breaches the food database's single-writer rule**

The attack failed and the report says so. Provenance foreign keys confine substance to the source pipeline: every nutrient, portion and field-provenance row binds to a `food_sources` row whose `source` enum has exactly one member. A caller creates a NAME, never a substance. (The name half is a real and separate finding — 16.A-6 — and is now fixed.)

<a id="12a8"></a>

### `12.A-8` — deferred

**Nobody owns the garbage: shells are never deleted, and the catalog is ownerless**

True at HEAD: there is no `DELETE FROM food` anywhere in the service, the normalized-name unique index is platform-global, and no food table has an owner column. The upstream half (a caller's raw string becoming the global name) is now fixed; the lifecycle half is not.

**Trigger:** U14 — 004's shell lifecycle and per-import cap; feature 003 owns the food-side reclamation.

<a id="12a9"></a>

### `12.A-9` — deferred

**The bulk case fights food's fairness machinery, and demand weighting collapses**

Unchanged: the queue still computes per-requester demand against a demotion threshold and orders by distinct-requester count, so a bulk importer demotes itself and every shell sorts into the bottom band. No spec states the bulk principal or its queue class.

**Trigger:** U14 — 004 must name the bulk principal and give bulk-origin shells their own lane.

<a id="12a10"></a>

### `12.A-10` — deferred

**The typeahead leak is real, but it is the recipe placeholder, not the food shell**

Live and correctly attributed: `IngredientsDal.search` filters on query text only, while food's search hard-filters `RESOLVED` in both branches. Same defect as 09.F-DB6 and 19.P-4's third limb.

**Trigger:** The next recipe-service change after U10 part 2 — see 09.F-DB6.

<a id="12a11"></a>

### `12.A-11` — rejected

**Lock contention and index bloat at 1,000 recipes**

The attack failed and the report withdraws it: a per-name transaction-scoped advisory lock serializes same-name adds, identical names collapse via `ON CONFLICT`, the batch endpoint is capped, and five indexes over ~10^4 rows is not a bloat scenario. Its own guidance is "nothing on these grounds".

<a id="13a1"></a>

### `13.A-1` — deferred

**The portfolio is already a distributed monolith, and nothing in the tree counts it**

True: six service directories and three schema packages ship, while seven more deployables are committed to in accepted specs and ADRs — and no document carries the roster or a running total, so every exception is argued locally. U3 wrote ADR-0020, but that is the edge topology, not the roster.

**Trigger:** U13 — the portfolio respec is where a roster with a running total belongs, before the next deployable is accepted.

<a id="13a2"></a>

### `13.A-2` — deferred

**The binding ALB ceiling is target groups (non-adjustable), and the repo documents the other one**

True: ADR-0003:99 and CLAUDE.md both name the 100-rule ADJUSTABLE quota as the limit, when target-groups-per-ALB is also 100 and is not adjustable, and one service costs one of each. Same subject as 04.F-I3. Partly overtaken: `a7105d95` (U13) already repointed 005's hard-coded priority at the allocator.

**Trigger:** U13 — correct both sentences with the roster; the synth-time assertion the report also wants is new work, not a defect fix.

<a id="13a3"></a>

### `13.A-3` — fixed

**Extracting 006 before implementation draws a boundary with zero access-pattern data**

The figure is no longer load-bearing: ADR-0017's 2026-08-16 amendment (U3 `e9d0c639`) withdraws the argument that quoted it — "Fact 2 … proves too much … an argument that would justify extracting every feature cannot justify extracting exactly one" — and states the cost that was never priced.

<a id="13a4"></a>

### `13.A-4` — deferred

**"007, 009 and 010 are unchanged" is false — cross-database FKs remain**

Was true; OVERTAKEN in this branch by `fd70eaab` (U13), which drops the boundary-crossing keys. Retained so the verification is performed rather than assumed. Same subject as 09.F-DB14 and 05.F-S5/S6.

**Trigger:** U13 — verify no cross-database `REFERENCES` remains in 007's or 009's plan or tasks.

<a id="13a5"></a>

### `13.A-5` — fixed

**The amendment's premise is circular, and it ignored the better argument in 006's own spec**

ADR-0017's 2026-08-16 amendment (U3 `e9d0c639`) deletes it in terms: "Fact 1 … was self-citation. It cited ADR-0019 … written in the same session hours earlier by the same author." The byproduct is resolved too — 006's plan now records the corrected reasoning and names the deployable consistently.

<a id="13a6"></a>

### `13.A-6` — deferred

**An always-on ALB-fronted service is the wrong compute shape for bursty OCR**

True: ADR-0019 §3 was not amended, so 011's spec still specifies an ALB-fronted service while 011's own plan specifies presign → S3 → SQS → Lambda. U14's on-device-first OCR goes further than the attack asked and must reconcile both.

**Trigger:** U14 — ADR-0019 §3 and 011's "What 011 builds".

<a id="13a7"></a>

### `13.A-7` — deferred

**"It holds no persistent state" is incompatible with what 011 actually requires**

The same live contradiction as 11.A-2, from the infrastructure side: 011's spec says no database while its plan creates `digitization_jobs`, `raw_ocr_json` and a 90-day purge.

**Trigger:** U13 — assign the tables a named home and withdraw the no-database sentence.

<a id="13a8"></a>

### `13.A-8` — deferred

**FR-048/049's user-visible value cannot ship, and the degraded path is asserted**

Verified: no notification service exists and 004's plan specifies no import-status endpoint, so the requirement's value is gated on unbuilt work with no stated fallback. Same as 12.A-6, and now stronger, since KTD-3a and KTD-4 make polling the designed path rather than a stopgap.

**Trigger:** U14 — 004's spec and plan must state "ships with polling; 014 upgrades it to push".

<a id="13a9"></a>

### `13.A-9` — deferred

**ADR-0019 adds cross-service edges that nothing in this system can authenticate**

True and recorded rather than resolved: the plan states that background recipe→food calls have no service credential, that the erasure token cannot simply gain an audience, and that a new capability token is needed. `FoodServiceClients` still exposes only user-token factories. Same one-way door as 01.F-R5 and 11.A-3.

**Trigger:** The service-credential ADR, before the first background recipe→food call — i.e. before 004's import spine is implemented.

<a id="13a10"></a>

### `13.A-10` — deferred

**The per-PR ephemeral model multiplies every service, and every ADR prices it as additive**

True: no document sums the roster's per-PR and production cost, which is the same gap as 13.A-1, and ADR-0020 adds none. The precedent exists and is uncopied — ADR-0016 rejected one cache per PR on exactly this arithmetic.

**Trigger:** U13 — the same roster document as 13.A-1, carrying the production-on-demand, sandbox-Spot and per-PR × concurrency sums.

<a id="14p1"></a>

### `14.P-1` — rejected

**ADR-0019 claims no spec described in-flight import status**

The attack was not supported — the report's own verdict. It concedes that status existed in three places and that the real gap was PUSH delivery plus a uniform stage vocabulary, which is what ADR-0019 §4 supplies. No artifact is falsified.

<a id="14p2"></a>

### `14.P-2` — rejected

**"Nothing to hang a resolving status on" is a false motivation**

The attack was not supported — the report's own verdict. It grades §5's design SUPPORTED precisely because it is already shipped — `ingredients` carries `food_id` and `food_resolution_status` behind a database CHECK. A re-worded motivation changes no code.

<a id="14p3"></a>

### `14.P-3` — rejected

**`sourceType` whitelisting inverts 004's server-observed rule**

The attack was not supported — the report's own verdict. as an ADR defect, and the enforcement point it worries about is already ruled: U14 has mobile OCR classify `imported_paid`, never `imported_physical`, so the premium gate keeps a server-observed channel. The spec wording is carried by 11.A-8.

<a id="14p4"></a>

### `14.P-4` — rejected

**"011's image service owns NO database" contradicts 011's own job requirements**

The attack was not supported — the report's own verdict. as a NEW defect — it is the same contradiction 11.A-2, 13.A-7 and 05.F-S2 already carry, and it is an explicit U13 item. Rejecting it here loses no work.

<a id="14p5"></a>

### `14.P-5` — rejected

**The deployable exception cites ADR-0017 flip conditions that do not exist**

The attack was not supported — the report's own verdict. It is a rationale-provenance complaint rather than a defect; ADR-0019 §3's exception survived U3's amendment untouched, and ADR-0017 records that the 011 question was left open for the owner. The substantive half is carried by 11.A-6.

<a id="14p6"></a>

### `14.P-6` — rejected

**"One additional deployable" undercounts the session's new services**

The attack was not supported — the report's own verdict. It is an arithmetic quibble in a costs paragraph, and each deployable it counts is named in its own document, so nothing is hidden. The real roster gap is carried by 13.A-1.

<a id="14p7"></a>

### `14.P-7` — rejected

**ADR-0017's amendment overstates its two "engineering facts" for 006**

The attack was not supported — the report's own verdict. (verdict WEAK); it concedes the decision is the owner's and that the admission its trigger had not fired is honest. U3's later amendment withdrew both facts anyway — see 13.A-3 and 13.A-5.

<a id="14p8"></a>

### `14.P-8` — rejected

**The five-stage vocabulary is a fourth vocabulary, not "one contract"**

The attack was not supported — the report's own verdict. as stated: the five stages are the CLIENT-FACING progress vocabulary, and 014's stage/consumer contract was rewritten wholesale by U7. Mapping the remaining stage names is 004/011 spec work already scoped to U13/U14.

<a id="14p9"></a>

### `14.P-9` — rejected

**Supersession needs a producer-assigned monotonic sequence**

The attack was not supported — the report's own verdict. and it is now moot: the sequence was withdrawn outright by U7 and recorded in ADR-0019's amendment, so supersession is consumer-side most-recent-by-timestamp and the two-`sequence` name collision it feared cannot occur.

<a id="14p10"></a>

### `14.P-10` — rejected

**"Everything after parsing is identical" is false**

The attack was not supported — the report's own verdict. (verdict WEAK — "the design is sound"), and the exact phrasing it attacks was replaced: ADR-0019's amendment drops "one processor" for per-domain processors converging at recipe creation. Carried substantively by 11.A-1.

<a id="14p11"></a>

### `14.P-11` — rejected

**004's transfer clause asserts inheritance without amending 011**

The attack was not supported — the report's own verdict. as work to do here; reconciling the 004↔011 retention, quota and premium-gate text is exactly U13's contradictions-first pass plus U14's reaper and `imported_paid` classification.

<a id="14p12"></a>

### `14.P-12` — rejected

**011 does build a second path to a saved recipe**

The attack was not supported — the report's own verdict. as a new defect — the same item as 14.P-4 and 11.A-2. The two-pre-creation-records ambiguity is a named U13 item, and U14 keeps 011's jobs with a 3-day reaper.

<a id="14p13"></a>

### `14.P-13` — rejected

**004's tasks, plan and V-Model still specify OCR at launch**

The attack was not supported — the report's own verdict. as an ADR defect; the stale downstream is a named U13 item, and this branch has already begun it (`843e51d6`). Carried by 05.F-S1 and 11.A-7.

<a id="14p14"></a>

### `14.P-14` — rejected

**ADR-0019 answers one real problem with a five-part normative spine**

The attack was not supported — the report's own verdict. — the report grades the RULING itself SUPPORTED. Its remedy (split the ADR) was overtaken by U3, which amended §1 and §4 in place rather than splitting the document.

<a id="14p15"></a>

### `14.P-15` — rejected

**Every document cites an "owner ruling" with no clarifications record**

The attack was not supported — the report's own verdict. (verdict WEAK in isolation); the ruling record now exists as the plan's decision ledger (KTD-1..KTD-7 plus the round-1/round-2 revision history), which the amended ADRs cite by name.

<a id="15a1"></a>

### `15.A-1` — fixed

**The shared ownerless catalog is the single root design error with four symptoms**

The thesis and the proposed cure are refuted by the report itself (three independent causes; per-line overrides already exist), and its kcal/kJ sub-finding is closed by U8. The one surviving item — the caller-authored shared display name — is FIXED in this pass: `foodName.ts` canonicalizes both the catalog's global label and its dedup key. The recipe-side placeholder name is a different row (19.P-4).

<a id="15a2"></a>

### `15.A-2` — rejected

**"A recipe is a method, not a substance" conflates dish-type with recipe-instance**

Owner ruling: the recipe→food write-back was DECIDED NO on 2026-08-08 (feature 001 T150, restated in CLAUDE.md's deliberate-decisions section). The report's own verdict disputes only the recorded rationale, not the conclusion, and the ruling stands as written — including its two accepted consequences.

<a id="15a3"></a>

### `15.A-3` — deferred

**"One-directional" and "single writer" are already false in practice**

The strong form is REFUTED and re-verified at HEAD: recipe reaches food only over HTTP, and every status advance goes through a guarded conditional UPDATE. What survives is one false sentence in a normative ADR — ADR-0019:133 still says "exactly one writer" while a shell's identity comes from a caller-supplied name. KTD-3 does not touch it.

**Trigger:** U14 — the same pass that writes 011's single-writer-per-group invariant; restate §5 as sole write AUTHORITY and sole VALUE author.

<a id="15a4"></a>

### `15.A-4` — deferred

**The opaque `food_id` has no stable meaning under shell semantics, and a collision is unrecoverable**

Two of the four sub-findings are moot under KTD-3/U10 — the recipe side no longer stores nutrition, so nothing can go stale. Two are unchanged: terminal-row reactivation reuses the same id, and the crosswalk-collision wedge is un-precheckable because `findFoodIdByExternalKey` still has exactly one caller, the search path.

**Trigger:** Before feature 004's bulk add-by-name channel ships; or sooner, if a foreign-key violation on the provenance constraint appears in food-service logs.

<a id="15a5"></a>

### `15.A-5` — rejected

**Recipes should pin an immutable nutrition snapshot at resolution time**

Superseded by KTD-3 (owner ruling, 2026-08-15): food owns nutrition outright and the recipe side holds a LIVE REFERENCE with a stale-then-absent cache — the pinned snapshot is the explicitly rejected option. Its own reframing (that today's model is an ACCIDENTAL snapshot) is answered by U10 part 1, which removed the copy. The legitimate snapshot case — a LOGGED consumption — is 19.P-6, not this.

<a id="16a1"></a>

### `16.A-1` — deferred

**One bad catalog write corrupts every referencing recipe, with no signal or audit**

Three of the four legs are closed — the accumulating write is gone, the kcal/kJ non-determinism is closed by U8, and the status write now touches only the link status. What survives is the ruling's own price, which KTD-3 does not answer: no nutrient history and no operator containment or rollback on the food side, where the only mutating admin action is `refetch`.

**Trigger:** Before feature 009 ships — the first consumer that records a past-dated nutrition value and therefore needs "what was it, and when did it change".

<a id="16a2"></a>

### `16.A-2` — deferred

**The system has a live reference AND a stale denormalized copy simultaneously**

Half-landed by U10 part 1: the stored lead figure and its three write sites are deleted and the GDPR export no longer ships it. Still open: the search DAL still SELECTs a column that is now never written, the drop migration is written but DO-NOT-RUN gated, and `recipe-core/src/nutrition.ts:66-69` still carries the "can never disagree" claim the plan says to rewrite.

**Trigger:** U10 part 2 — the five ordered steps in the plan's status ledger, then run the migration.

<a id="16a3"></a>

### `16.A-3` — deferred

**Is the decision implementable downstream? 006 defeats the attack; 009 does not**

The 006 half is DEFEATED by 006's own spec, which reaches the owner's ruling independently. The 009 half survives and KTD-3 does not answer it: `nutrition_compliance` has `created_at` but no `computed_at`, so a closed past day can silently change. 009 is not built, so nothing is in breach today.

**Trigger:** U13's respec of 009 — record the forward-vs-recorded boundary and add `computed_at` plus closed-day immutability before 009 is implemented.

<a id="16a4"></a>

### `16.A-4` — deferred

**Retroactive mutation of Article 9 data is an integrity and accountability problem**

WEAKENED by its own verdict — not unlawful, and 009 does not exist, so there is no present violation. Its one SHIPPED item is already fixed: the account export no longer ships the stale lead figure. The rectification and accountability residue rides on 16.A-1's history and 16.A-3's `computed_at`.

**Trigger:** Same as 16.A-3 — U13's respec of 009, before it ships.

<a id="16a5"></a>

### `16.A-5` — rejected

**Steelman the rejected option, and price the loss**

Superseded by KTD-3 (owner ruling, 2026-08-15) — the pinned snapshot is the rejected option and the live reference is the ruling. The guardrail costs it prices honestly are not lost: they are carried by 16.A-1 and 16.A-3.

<a id="16a6"></a>

### `16.A-6` — fixed

**`addByName` writes a caller's raw typed string as the shared catalog's permanent global name**

Fixed in this pass for the SHARED CATALOG, which is what the finding names. `foodName.ts` owns one canonical form (NFKC, drop format characters, separate on controls, collapse, trim) and the dedup key is that form lowercased, so `food.name` and `food.normalized_name` are derived from one sanitized string at the write point; an invisible-only name is refused with the code the pipe already uses for the empty string. Verified at unit, integration and e2e, and mutation-checked — reverting the sanitizer to a bare `trim()` reds 15/3/2 tests across the three tiers. The RECIPE-side placeholder name (`ingredients.name`) is a separate row: 19.P-4.

<a id="23s1"></a>

### `23.S-1` — deferred

**The control that makes untrusted image bytes safe lives in a superseded branch**

The surface does not exist on this branch: `tesseract`, `OcrProvider` and any image-upload route return zero hits across the tree AND the lockfile. A risk in an unbuilt surface is not a live defect. Both spec defects are unchanged: 011's spec still says Sharp is not required, and its module design still declares a byte cap and a minimum dimension with no maximum.

**Trigger:** Before 011 implements the image-upload read path — the byte → magic-byte → pixel → re-encode control and one reconciled cap, at U14.

<a id="23s2"></a>

### `23.S-2` — rejected

**Recognition time is unbounded by any shipped control**

The premise was withdrawn by owner ruling: D6 reverts to AWS Textract as the default OCR provider, quoting this report's own 16.8s and 37s measurements. Textract is an async HTTP poll — the seam the existing timeout and hard-deadline budgets were written for — so the in-process WASM abort problem does not arise. The residual is a doc edit inside U14.

<a id="23s3"></a>

### `23.S-3` — deferred

**Cost is the strongest available attack, and both bounding controls are absent**

Both halves verified: 011 still ships ungated until 010 is live, and `CostGuardrailsStack` has a budget and an anomaly subscription but NO budget ACTION — it can only email. Not live, because no OCR endpoint exists and there is no production traffic.

**Trigger:** Before any OCR or image endpoint is reachable — resolve 011's ungated question at U14, and add Budgets Actions before the account carries user-driven per-request spend.

<a id="23s4"></a>

### `23.S-4` — deferred

**No Lambda in this account has reserved or maximum concurrency**

TRUE and live: zero occurrences of `reservedConcurrent` in the tree against 19 declared functions, so an OCR flood — or any fan-out — would starve identity provisioning, the GDPR erasure workers and the log forwarder from one shared pool. Named as a U12 priority fix and NOT taken here, because the correct change is not the property but the allocation: `reservedConcurrentExecutions` is simultaneously a floor and a CAP, `0` silently disables a function, and sixteen of the nineteen are VPC-attached to one Postgres instance, so the honest ceiling is derived from `dbPoolMax x concurrency <= max_connections - reserved` rather than picked. That derivation needs the per-stage instance class, which this pass did not establish.

**Trigger:** Before any high-fan-out Lambda deploys — i.e. before 011's OCR worker, whose own architecture document already promises reserved concurrency with no number. Land it as a repo-wide Aspect in `packages/infra/security` (whose test already ships a deliberately non-compliant fixture) that requires a declared, NON-ZERO reserve and exempts the two CDK-owned custom-resource framework functions, plus per-stack numbers asserted the way the workers stack already asserts VPC attachment on every function.

<a id="23s5"></a>

### `23.S-5` — rejected

**Tesseract downloads its language model from a public CDN with no integrity check**

The subject was never adopted and is now rejected by owner ruling D6; `tesseract.js` appears in no lockfile, so there is no runtime model download on any shipped or decided path.

<a id="23s6"></a>

### `23.S-6` — rejected

**Adopting tesseract.js adds a network-touching postinstall to deploy-credentialed CI jobs**

Same premise reversal (D6) — the dependency is in no lockfile. Its provider-independent half (no `npm audit` in any workflow) is a real finding, but it is 08.F-SEC3's, not this one's, and is dispositioned there.

<a id="23s7"></a>

### `23.S-7` — rejected

**Tesseract decodes BMP in-process via an unmaintained decoder**

Dead with its parent (D6); no `tesseract.js` dependency exists. The report's own measurement already downgraded it (peak RSS flat at ~47 MB, "this is not a memory bomb"), and the media-type allowlist omits BMP.

<a id="23s8"></a>

### `23.S-8` — deferred

**The image allowlist admits HEIC, which the installed toolchain cannot decode**

The surface does not exist on this branch: `tesseract`, `OcrProvider` and any image-upload route return zero hits across the tree AND the lockfile. A risk in an unbuilt surface is not a live defect. The allowlist is spec text only, and the toolchain fact (the installed libvips ships AOM, so `.avif` but not HEVC-HEIC) has no consumer on this branch.

**Trigger:** Before 011's upload endpoint accepts a file — the HEIC decision written into 011's spec and module design at U14, with the typed-input rule that makes passing the original bytes through fail to compile.

<a id="23s9"></a>

### `23.S-9` — deferred

**A device-declared raw-text channel inverts FR-025 and bypasses both gates**

The provenance-inversion half is SETTLED by owner ruling D7 — the raw-text channel classifies `imported_paid`, never `imported_physical`, so the premium gate keeps its enforcement point and the no-caller-declared-provenance rule is not inverted. Unsettled: the channel's own import-channel member, its quota rule, and blob parsing limits (total and per-line caps, NUL, C0 controls, unpaired surrogates, normalization). This branch has begun it (`843e51d6`).

**Trigger:** U14 — "004 gains a first-class raw-text channel"; the member, quota and parsing rules land with it.

<a id="23s10"></a>

### `23.S-10` — deferred

**The substrate's producer-authentication design has no credential to implement it**

Three of the four sub-claims are fixed: producers authenticate by IAM scoped to `dynamodb:PutItem` on one table ARN (asserted in the food stack's own test), the swallow-and-continue event seam was DELETED rather than deprecated, and the missing supersession key was withdrawn by U7. Two residuals: 014's spec still grants a registered producer authority to address ANY user with no recipient binding, and its codebase analysis still asserts an EventBridge rule that U4 made false.

**Trigger:** U14 — bind publish authority to a recipient scope and correct the analysis, before any 014 consumer code is written.

<a id="23s11"></a>

### `23.S-11` — fixed

**The shared ownerless catalog has no Unicode discipline, so its dedup key is trivially bypassed**

Fixed in this pass, jointly with 16.A-6: `foodName.ts` applies NFKC, removes format characters (zero-width, BOM, soft hyphen, bidi overrides), turns control characters into separators, collapses and trims — and the dedup key is that same form lowercased, so the measured bypass set (ZWSP, fullwidth, RTL override, NUL) now collapses onto one key. Asserted at unit, integration and e2e and mutation-checked. ⚠️ EXPLICITLY OUT OF SCOPE and recorded in the module's own docstring: confusable folding (a Cyrillic homograph still keys distinctly) needs a UTS #39 confusables table, which is library work, not a regex.

<a id="23s12"></a>

### `23.S-12` — deferred

**Upload preflight validates the client's claims, and the S3 key uses the Clerk `sub`**

The surface does not exist on this branch: `tesseract`, `OcrProvider` and any image-upload route return zero hits across the tree AND the lockfile. A risk in an unbuilt surface is not a live defect. Both are spec text in 011's module design; no upload endpoint exists, so no object is keyed wrongly today. The counter-rule already exists in the repo — food's requester resolution refuses a `sub` fallback.

**Trigger:** Before 011 mints its first presigned URL — move key derivation to the app-user ULID and restate the preflight as a UX fast-fail, at U14.

<a id="24a1"></a>

### `24.A-1` — fixed

**"Per-domain async processors" is a taxonomy, not a pattern, and its scaling claim is false**

ADR-0019's §1 amendment (U3 `e9d0c639`) replaces "one bulk import processor" with per-domain processors that converge at recipe creation, and makes NO independent-scaling claim — so the assertion food's advisory lock forbids is gone. The contract-not-base-class ask is the recorded ruling D8. Its proposed outbox element is only partly adoptable: D2 rejected an outbox deliberately, with a stated flip condition.

<a id="24a2"></a>

### `24.A-2` — deferred

**Where exactly is the convergence seam?**

Still open: ADR-0019 names the seam but neither its mechanism nor its principal, and the plan records the same gap — the recipe→food call from a background processor has no service credential. Same one-way door as 01.F-R5, 11.A-3 and 13.A-9.

**Trigger:** Before any cross-deployable recipe-creation call is implemented; a wire credential is a one-way door, so the mechanism and principal must be written down first.

<a id="24a3"></a>

### `24.A-3` — fixed

**D2's platform asymmetry: one user action, three different products**

Reverted on exactly this evidence: owner ruling D6 makes Textract the default again, citing that ML Kit's handwriting API reads stylus strokes rather than photographs and that Tesseract scores 30-55% on cursive. The escalation shape the finding demanded is the recorded answer — on-device first, falling back to Textract on low confidence, with the failure mode named (wrong but confident) and a manual re-run escape hatch required. The parity contract rides U14.

<a id="24a4"></a>

### `24.A-4` — fixed

**Does the raw-text channel weaken provenance?**

The exact sentence the finding asked for is the ruling: D7 classifies the text as `imported_paid`, never `imported_physical`, so the premium gate keeps its enforcement point and the no-caller-declared-provenance rule is not inverted. Its remaining item (the channel's quota rule) is tracked by 23.S-9 rather than duplicated here.

<a id="24a5"></a>

### `24.A-5` — fixed

**Does D6 still hold once ADR-0019 shrinks?**

ADR-0017's 2026-08-16 amendment does what the finding demanded: it withdraws the two engineering facts, prices the cost that was never priced (co-location's cascade retires 006's orphan handler; extraction reinstates it), and records the decision as the owner's. Same amendment as 13.A-3 and 13.A-5.

<a id="24a6"></a>

### `24.A-6` — deferred

**D3 narrows 011, but the correction UI's API still has no home**

Unchanged: 011's package table still names a NestJS service beside the Lambda, its tasks still scaffold that package, and T-011 still creates the `digitization_jobs` migration inside it. Same gap as 11.A-2 and 13.A-7.

**Trigger:** U13 then U14 — assign `digitization_jobs`, `raw_ocr_json` and the 90-day purge a named home (a logical database behind API Gateway plus Lambda is free under ADR-0006) and withdraw the no-database sentence.

<a id="24a7"></a>

### `24.A-7` — rejected

**D4: "nutrition is a LIVE REFERENCE" — against what?**

Superseded before implementation. KTD-3 makes food the sole owner and drops the recipe-side replica entirely (the written migration removes all seven columns), so `resolved_at`, a food-item version and a guarded update have nothing left to protect — items 2 and 3 are moot by construction. Item 4 (the "can never disagree" claim) is resolved by U10 part 2 and is carried by 16.A-2.

<a id="24a8"></a>

### `24.A-8` — fixed

**D5's four substrate properties fight, and one stream cannot be both groupings**

Built as two things, with every contradiction answered in the tree: grouping is KTD-2's two-field key with a ULID-suffixed sort key; latest-in-group-wins is declared CONSUMER-side by 014's C-8, which withdraws the producer sequence and states the single-writer-per-group precondition; the two stores are kept separate by C-10; and KTD-4 keeps 014 from subscribing to food at all, which is what honours the recipient-impossibility the report cited. Durability: the swallowing emitter is deleted, and the outbox was considered and rejected with a stated flip condition.
