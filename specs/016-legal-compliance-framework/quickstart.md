# Quickstart — Validating the Legal Compliance Framework

**Feature**: [016](./spec.md) · **Plan**: [plan.md](./plan.md) · **Contracts**: [contracts/legal-api.md](./contracts/legal-api.md)

How to prove each slice actually works. This is a validation guide, not an implementation guide — shapes live
in [data-model.md](./data-model.md) and [contracts/](./contracts/legal-api.md).

## Prerequisites

Node 24 (the shell defaults to 18 — prefix with the v24 nvm bin or vitest and the husky hooks fail), Docker
for Postgres, and Clerk **sandbox dev** keys for the browser tiers. `pk_live` is domain-locked and cannot run
against localhost.

⚠️ **Do not run the Playwright suite locally while CI is running.** Both drive the same Clerk dev instance and
its rate limit is shared — proven to turn a green CI run red on the same commit.

```bash
npm install
npm run build
```

---

## Slice 1 — the licence exists and is recorded (US1, P1)

Nothing else in the feature is worth running until this passes: it is what makes every public-corpus feature
already in the portfolio lawful.

```bash
npm run test --workspace=packages/services/identity           # unit: acceptancePolicy, licenceGrant
npm run test:integration --workspace=packages/services/identity  # against a real Postgres
```

**What proves it**, and each of these fails if the code is subtly wrong rather than obviously broken:

| Claim                                   | How it is proven                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceptance cannot be skipped            | Create an account, call a content-creating endpoint without accepting → rejected. `FR-001`                                                          |
| The record survives a document revision | Accept v1, publish v2, assert the v1 row is still readable and still names v1. `FR-002`                                                             |
| Append-only is real                     | Attempt an update and a delete through the DAL → **no such path exists**; attempt it in SQL in the integration test → assert the service never does |
| Declining degrades, never deletes       | Decline a material revision → read and export still work, publish is blocked, account intact. `FR-006`                                              |
| Unaccepted content is not displayable   | Second account requests the first's recipe before acceptance → not served. `FR-012`                                                                 |

**The mutation check for this slice**: break `acceptancePolicy.ts` so it returns "current" for an outdated
version. Slice 1's tests must go red. If they stay green they are asserting something already true.

Browser and device:

```bash
npm run test:e2e --workspace=packages/apps/commise/web       # Playwright: acceptance gate, re-acceptance
# mobile: .maestro/legal/acceptance-flow.yaml  (emulator or device)
```

---

## Slice 2 — notices arrive, are decided, and can be proven (US2, P1)

```bash
npm run test --workspace=packages/services/identity-webhooks
npm run test:integration --workspace=packages/services/identity
```

**The intake must be reachable without an account** — that is the whole point, so test it as a stranger:

```bash
curl -sS -X POST "$WEBHOOK_BASE/api/v1/notices" \
  -H 'content-type: application/json' \
  -d '{"reporter":{"name":"A Rightsholder","email":"x@example.com"},
       "target":{"contentType":"recipe","contentId":"<id>"},
       "grounds":"copyright","statement":"..."}'
# expect 202 + a reference
```

| Claim                                       | How it is proven                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acknowledgement is fast enough              | Time from first arrival to reference in hand < 3 min. `SC-002`                                                                                                                  |
| A declined notice is still recorded         | Trip the rate limit → assert a row in `declined` **with a reason**, not an absence. `FR-024`, [R8](./research.md#r8)                                                            |
| Clones are reached                          | Publish, clone ×3, action a notice → assert `derived_copies_actioned` and that the clones were actioned. Removing only the original **is not compliance**. `FR-022`             |
| The tally terminates                        | Accrue strikes to the threshold → account terminated, trail retained. `FR-020`                                                                                                  |
| 015's ledger is reversed                    | Action a notice against a rewarded publication → assert the grant is reversed. `FR-023`                                                                                         |
| The statement goes out on **both** channels | Action a notice, assert `statement_in_app_at` **and** `statement_email_at` are both set. Either alone is a defect, not a partial success. `FR-018a`, `SC-003`                   |
| A failed email is not silently "delivered"  | Force an SES failure: `statement_email_at` stays null, `email_attempts` increments, the retry runs, an alert fires. An unreachable uploader is a compliance exposure. `FR-018b` |
| A bounce is not success                     | Simulate a bounce after provider acceptance, assert it reopens as undelivered rather than staying counted                                                                       |
| The deadline follows the grounds            | Submit `copyright` and `terms_violation`, assert `decision_due_at` is +24h and +7d, both from acknowledgement. `FR-017a`                                                        |
| Reclassification cannot buy time            | File as `other`, reclassify to `copyright`: the deadline shortens to 24h **from the original acknowledgement**. `FR-017b`                                                       |

Load, because the intake is public and unauthenticated:

```bash
npm run test:k6 --workspace=packages/services/identity-webhooks   # note: k6 open() is script-relative
```

⚠️ Maestro and k6 need the **`heavy-e2e`** PR label in CI, or they never run.

---

## Slice 3 — the reviewer can actually do the job (US8, P2)

The dashboard is the highest-risk surface in the feature for coverage theatre — a queue that renders is not a
queue that works. Test it **per state**, not per page.

```bash
npm run test --workspace=packages/apps/commise/web      # component tests, one per state
npm run test:e2e --workspace=packages/apps/commise/web  # Playwright: queue to delivered decision
```

| Claim                                  | How it is proven                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The queue surfaces urgency, not age    | Seed a 20h copyright notice and a 3-day terms notice, assert the copyright one sorts first. An age-sorted queue inverts this. `FR-053a`                    |
| An incomplete decision cannot be saved | Submit without an action, then without a ground, then without facts — each refused. There is no draft state. `FR-053b`                                     |
| Undelivered email is visible work      | A decision whose email failed shows as outstanding, not as done. `FR-053c`                                                                                 |
| The policy recommends, it does not act | Open an account at 3 live strikes, assert the recommendation shows and termination is still a separate deliberate act. `FR-053d`                           |
| Evidence is read-only                  | Attempt to edit an acceptance, a reporter's statement and a delivered statement of reasons — **no route exists**. Assert the absence, not a 403. `FR-053e` |
| Every action is attributed             | `decided_by` is the individual operator, and no shared credential can reach the routes. `FR-017`, `FR-053f`                                                |
| The scope is dedicated                 | A user with other admin capability but not the review scope is refused. `FR-053g`                                                                          |

**The mutation check**: change the queue sort from time-to-deadline back to age. The first row's test must go
red.

⚠️ **Blocked until `002` is amended** (A-11) — its Out of Scope currently excludes an admin UI.

---

## Slice 4 — the surfaces exist on both platforms, and records expire (US3, US4, P2)

```bash
npm run test --workspace=packages/apps/commise/web      # component tests: every state, not just the happy path
npm run test --workspace=packages/apps/commise/mobile
npm run test:e2e --workspace=packages/apps/commise/web
```

Reach every legal surface **in a non-English locale, with a screen reader**, and assert each renders its
effective date (`FR-049`, `NFR-007`). A hard-coded string must fail the build, not a review (`SC-006`).

Export and consent:

| Claim                                  | How it is proven                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Export is delivered                    | Request → receive a machine-readable artefact within the stated deadline, 100% completion. `SC-008`                                                    |
| Withdrawal degrades, not breaks        | Withdraw the special-category consent while a meal plan depends on it → the plan degrades and does not silently keep using the data. `FR-035`          |
| Retention is disclosed                 | Erase → the completion surface lists what was retained and why. `FR-037`                                                                               |
| Records expire on schedule             | Age a decision past 3 years, the sweep purges it. `FR-052a`, `SC-016`                                                                                  |
| A hold suspends the purge              | Place a legal hold, age past 3 years: it survives, and the reason and owner are readable. A hold with no reason is rejected at creation. `FR-052c`     |
| Reporter contact does not linger       | Close a counter-notice window, assert `reporter_name` and `reporter_email` are blanked while the notice, grounds and decision remain. `FR-052b`        |
| Erasure keeps evidence, drops the rest | Erase an account with strikes: acceptances, notices, decisions and strikes survive keyed by an opaque id; consents, age assurance and exports are gone |

---

## Slice 5 — the reproduction controls hold (US5, P2)

The assertion that matters here is **continuous, not a test run** (`SC-005`):

```bash
npm run test --workspace=packages/services/recipe-service   # includes the media-storage assertion
```

| Claim                                       | How it is proven                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No third-party media is stored              | Import through every channel → assert zero photographs, frames, stills, audio or source media in operator storage, **and zero persisted renditions**. `SC-005` |
| A sampled frame does not outlive extraction | Run a video import → assert the frame is gone when the operation ends. A frame that survives is a defect, not a cache. `FR-027f`                               |
| An extracted frame never becomes the image  | Import a video → assert the recipe's image is a reference or user-supplied, never an extracted still. `FR-027g`                                                |
| The source media is not kept                | Assert on both the success and the failure path. `FR-027h`                                                                                                     |
| Channels are classified                     | Every imported item records its channel as user-supplied or operator-retrieved. `FR-028`                                                                       |

---

## Slice 6 — disclosures (US6, US7, P3)

| Claim                                    | How it is proven                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Cancelling is no harder than subscribing | Count interactions both ways on both platforms. `SC-007`                                                |
| Disclosure precedes the charge           | The user must pass through it, not discover it. `FR-040`                                                |
| AI content is marked and labelled        | 100% carries a machine-readable marking **and** a visible label at display. `SC-010`, `GR-010` AC-010-e |
| The label tracks the current state       | Human-edit AI content → the label reflects what it is now, not its origin. `FR-046`                     |

---

## Full sweep before claiming done

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test
npm run test:integration --workspace=packages/services/identity
npm run test:e2e --workspace=packages/apps/commise/web
```

Web changes additionally need a real `next build` — App Router page-export and RSC rules only fail at build
time, and a build break skips every e2e job silently.

**Report which tiers ran and which did not.** A green unit suite reported as "verified" when the integration
tier was never written is a false status, and false status is worse than a known gap.

## What this quickstart cannot prove

- **The registered designated agent exists** (`FR-025`) — not software. Its three-yearly renewal is a
  monitored obligation with a named owner, and a lapse is a lapse in safe harbour.
- **The documents say the right thing** — counsel's work product. Slice 1 ships the machinery with placeholder
  content, and the machinery is fully testable without the words.
- **That our legal position is correct** — `FR-050` lists what counsel must confirm and what breaks if each
  assumption is wrong.
