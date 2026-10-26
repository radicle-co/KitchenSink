# 0071 — Paste matches are proposals

- **Status:** Accepted
- **Date:** 2026-10-25
- **Relates to:** [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md): the spend pool the review gate draws on.
  [ADR-0045](0045-ingredient-lookup-and-unresolved-foods.md): a binding holds no food name, food names it.
  [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md): the parse pipeline that lands each proposal.
  [ADR-0070](0070-catalog-ranking-head-noun-and-defaults.md): the ranking rungs, and the `default` rung for a bare noun.

## Context

On 2026-10-25 a paste import into production bound four of eight lines to the wrong food. `milk` became milk
crackers, and `salt` became salt cod. Three faults let that happen.

1. **The by-name path bound a ranked guess.** `POST /api/v1/ingredients/by-name` ran the lexical tier. That tier
   proposes its top catalog hit on any non-empty list, and the by-name path binds what it is given.
2. **Its safety net read a shared row.** A lexical bind was held as "pending" until the review gate agreed. The
   pending state was read from the latest resolution event on the line's binding. A binding row is shared by every
   cook who bound that food. One cook's later curated bind of food X marked another cook's wrong lexical line
   as settled.
3. **The paste wire carried no matches.** Rule R19 forbade food ids on the parse-job wire, so the editor matched
   each pasted line by name, through the same by-name path.

The owner ruled on 2026-10-25. Six nouns have a seeded default, and the UI shows it but never selects it. Paste
import binds only confident matches, and the cook can change them. Default, doubtful and unmatched lines need an
explicit pick. The review gate checks every paste match, whatever its measured error rate.

## Decision

1. **Matching runs in recipe-service, as the cook.** Food search is made as the caller or not at all (issue #120,
   R20). The parse worker holds no caller credential, so it does not match.
2. **Two chains.** By-name runs `[curated, memo]`, settled evidence only, and binds. The paste matcher runs
   `[curated, memo, lexical]` and binds nothing. One guard holds both chains to the same precedence ladder.
3. **A paste match is a proposal, stored in `recipe_parse_job_matches`.** One row per parsed line and food holds the
   proposed food, the tier that proposed it, its rung and margin, up to five candidates, the verdict key and where the
   review stands. It stores no food names. Names come from food at read time, as the caller. The foreign key is to the
   parse-job line, so deleting a job removes its matches. Account erasure deletes a cook's jobs, so it reaches this
   table too.
    - A row is current only while the line's stored digest and its current parse still give it. The row stores a
      judgement digest: the line digest, the food's phrase and the measure the editor saves. So an edited line, or the
      same text parsed into another food or measure, is matched again.
    - A write lands only while the line still has the digest the match was computed for. A slow call cannot overwrite
      a newer row.
4. **`POST /api/v1/recipe-parse-jobs/{id}/matches` asks for matches.** It answers `202` with the job view. It is
   idempotent, owner-only (`404` for a stranger) and refused past the job's expiry. When newly parsed lines appear,
   the client calls it from its poll loop.
5. **The lexical shortlist runs for every proposal.** It supplies the candidates and the fact that a default applies.
   A curated or memo answer does not hide a default.
6. **An outage is never stored as "no match".** A tier that failed, a food service that did not answer, or a switched
   off catalog writes no row. The next call retries.
    - Work per call is bounded by one deadline of 4.5 seconds. If the searches of a wave of four foods can finish in
      time, the wave starts. The food read and the send to the queue carry the same deadline. With the view's own name read,
      the request stays inside the client's 10 second timeout.
7. **The review gate checks each proposal once.** The message carries a parse-job origin and `unattributed`
   evidence, so identity is always asked. No `ingredientPhrase` is sent, so the worker writes no memo from a paste.
    - **Earned autonomy (D1) is suspended for every line, not only for paste lines.** No producer sends a band key, so
      no band is observed and no band skip is granted. The worker records an observation, and reads band authority,
      only for a `ranked` message that names its own band. It never looks a band up from the shared resolution
      events. The band tables and the revocation drain stay for now. A later release contracts them.
    - What can bring D1 back: the paste origin carrying the match row's rung, margin, query shape and ranker version
      as the message's band key. The worker already accepts that key.
    - **Spend.** Every curated and memo line on the save path now pays an identity call, because nothing skips
      identity any more. Each paste food pays one review. The review is attributed to a new call site,
      `paste-match-review`, inside ADR-0024's one pool. Outside production it is ungated (ADR-0024 §3).
8. **A send is claimed, and a claim is a lease.** Nothing is sent for a proposal whose verdict is on record and asked
   identity. A row already sent sends nothing.
    - A claim names the row's digest and verdict key. A failed send releases only its own claim. One caller can never
      clear another caller's claim.
    - A claim older than the queue's delivery bound (90 seconds times 361 receives, about nine hours), with no verdict
      and no attempt on record, was lost. The next call claims it and sends it again.
    - A request the gate can never take is refused, and the refusal is stored: an over-long line, or a message the
      queue's contract refuses. It is never claimed, so it is not retried on every poll.
    - A contained test principal (ADR-0040) gets its proposals stored, but no review is sent for them. The save path's
      verification producer follows the same rule.
9. **The state is derived at read time.** `matchStateOf` is a pure policy, applied in this order:

    | State         | When                                                                                                |
    | ------------- | --------------------------------------------------------------------------------------------------- |
    | `default`     | A candidate sits on the `default` rung, whatever answered (or nothing did), whatever the gate said. |
    | `noMatch`     | Nothing proposed and no candidates.                                                                 |
    | `needsChoice` | Nothing proposed, but candidates exist.                                                             |
    | `confident`   | A curated mapping. A gate contradiction keeps it confident and adds the note `reviewDisagreed`.     |
    | `needsChoice` | A memo or lexical proposal the gate contradicted on identity.                                       |
    | `confident`   | A memo, a lexical proposal the gate verified, or an exact-name rung awaiting review.                |
    | `needsChoice` | The gate abstained, refused the line, gave up, or was never asked for a contained principal.        |
    | `checking`    | A lexical proposal awaiting review.                                                                 |
    - Identity is read through one rule, `identityReadingOf`, which a saved line's status shares. A verdict that never
      asked identity is no verdict about the food. It does not accept or reject the proposal.
    - The proposal is shown as the line's match only in `checking` and `confident`. In every other state the wire's
      `proposed` is `null`, and the food stays one of the candidates.
    - The state enum is closed. A new fact becomes a new field or a new reason key, never a new state. The candidate
      list has no upper bound on the wire, so the server can change its own limit of five without breaking a client.
    - A late verdict never replaces a pick the cook made. That rule belongs to the client.

10. **R19 is amended.** A proposal can carry candidates, never a binding. The reviewed draft still binds through
    `POST /recipes` and by-food admission.
11. **No provenance is read from a shared binding row.** The save path declares `unattributed` for every line. A line
    with no verdict reports its catalog status. The resolution event writes stay, as telemetry. They record the tier
    only.
12. **The save path reads verdicts by key.** Before it enqueues, it drops each line whose verdict is already on
    record and asked identity. A pasted line whose proposal the gate judged is not paid for twice: the editor and the
    matcher read the line's measure with one function, `pastedLineMeasureOf`, so the two keys are equal.
13. **An identity abstention on a saved line shows the AMBIGUOUS badge** (owner ruling 2026-10-25). A quantity-only
    abstention keeps the catalog status. Nutrition still publishes. Only a contradiction withholds it.

## Consequences

- By-name no longer binds a catalog guess. A phrase neither settled tier knows falls through to food's own add by
  name, which can still resolve later through its source fan-out.
- The save path no longer grants band skips or stores pending re-drives, and no line renders `pending-verification`.
  The wire values `verification_pending` and `PENDING_VERIFICATION` stay in the contract, unproduced. A later cleanup
  decides whether they go.
- The band subsystem is dormant by decision. Band statistics do not move, and no band earns or loses a skip, until a
  producer names a band key.
- A verdict key is the key of the message that is sent. The worker and the matcher derive it the same way, so a
  verdict lands where the job view reads it. The editor saves `2 tbsp` as `tbsp`, and the matcher keys `tbsp` too.
- A message SQS accepts and then loses leaves its row claimed with no verdict. The line reads `checking` until a
  matches call arrives after the delivery bound, about nine hours later. That call claims and sends it again. If no
  such call arrives, the line reads `checking` until the job expires.
- A curated contradiction is counted once per row and verdict, however often the client polls. It signals that
  curation needs a look.
- **Known limitation: a model switch does not re-judge.** The verdict dedup is keyed on the verdict key alone, and so
  is the "gave up" read. A line verified under one model is not asked again under a newer one. The fix is to dedup
  by (key, current model id), which needs the current model id in recipe-service.

## Follow-ups

- Paste verdicts feed no memo and no band. The memo is not fed from a paste line even after the cook saves it, because
  the save path finds the verdict on record and sends nothing. Feeding the memo from a kept paste line, and carrying
  the band key on the paste origin, are the fixes.
- Outside production one gate Lambda runs at a time, so a proposal reads `checking` for about one gate call each.
- The `/api/v1/imports` resource, `boundBy`, a per-import version and flagged lines are a later step.

## Alternatives

- **Match in the parse worker.** It has no caller credential, and food search as a service identity is refused.
- **Keep the lexical tier in by-name, behind the pending state.** The pending state read a row every cook shares.
- **Bind confident matches on the server, in the single-paste editor flow.** The editor binds through by-food
  admission, and the cook can still change the line before it is saved. This rejection covers that flow only. The
  bulk import modes of the next step bind with no editor in front of the cook, by owner ruling.
- **Store food names on the match.** ADR-0045 keeps names out of the recipe database, so a renamed food shows as food
  says now.
