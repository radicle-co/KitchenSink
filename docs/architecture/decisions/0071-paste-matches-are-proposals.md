# 0071 — Paste matches are proposals

- **Status:** Accepted
- **Date:** 2026-10-25
- **Relates to:** [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md): the spend pool the review gate draws on.
  [ADR-0045](0045-ingredient-lookup-and-unresolved-foods.md): a binding holds no food name, food names it.
  [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md): the parse pipeline that lands each proposal.
  [ADR-0070](0070-catalog-ranking-head-noun-and-defaults.md): the ranking rungs, and the `default` rung for a bare noun.
  [ADR-0072](0072-bulk-recipe-import.md): bulk import, and what a spent budget does to a proposal.

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
2. **Two chains.** The settled chain `[curated, memo]` is settled evidence only. The paste matcher runs
   `[curated, memo, lexical]` and binds nothing. One guard holds both chains to the same precedence ladder. A cook who
   types a name binds nothing from the settled chain either (item 14). Only the version restorer still binds through it.
3. **A paste match is a proposal, stored in `recipe_parse_job_matches`.** One row per parsed line and food holds the
   proposed food, the tier that proposed it, its rung and margin, up to five candidates, the verdict key and where the
   review stands. It stores no food names. Names come from food at read time, as the caller. The foreign key is to the
   parse-job line, so deleting a job removes its matches. Account erasure deletes a cook's jobs, so it reaches this
   table too.
    - A row is current only while the line's stored digest and its current parse still give it. The row stores a
      judgement digest: the line digest, the food's phrase and the measure the editor saves. So an edited line, or the
      same text parsed into another food or measure, is matched again.
    - A write checks, as it runs, that the line still has the digest the match was computed for. The check takes no
      lock on the line. So a write that overlaps an edit can still land and replace a newer row. That is harmless: the
      view reads the line's digest now, ignores a row that does not match it, and the next call replaces it.
4. **`POST /api/v1/recipe-parse-jobs/{id}/matches` asks for matches.** It answers `202` with the job view. It is
   idempotent, owner-only (`404` for a stranger) and refused past the job's expiry. When newly parsed lines appear,
   the client calls it from its poll loop.
5. **The lexical shortlist runs for every proposal.** It supplies the candidates and the fact that a default applies.
   A curated or memo answer does not hide a default.
6. **An outage is never stored as "no match".** A tier that failed, a food service that did not answer, or a switched
   off catalog writes no row. The next call retries.
    - The matcher works under one deadline of 2.8 seconds. A wave of four foods starts only if its searches can
      finish before the last second, which is kept for the food read, the saves, the claim and the send. Every leg
      ends with the deadline. The catalog searches, the food read and the send take it as an abort signal. Each database
      call is awaited through a bound that stops the wait. The database cannot cancel a pool wait, so the request stops
      waiting and the call finishes in the background. Reads and saves are simply left. A claim that lands late is
      released at once, because nobody will send it.
    - The whole handler works under a second deadline of 3.5 seconds. The controller's fresh read of the job and the
      job view's reads end with it. If the fresh job read cannot finish, the view is built from the job the matcher
      already read. What the view could not read shows as no match, and the next poll repairs it. If not even the
      matcher's first read of the job finishes in time, the request fails as an internal error and the client retries.
    - The worst case. Every request first passes the global erasure-lock guard, which reads the database and may wait
      for a pool connection for at most the pool's 5 second connection timeout. That one wait happens before the
      request's clock starts, so it is the one wait nothing here bounds. It is the same wait the read path budgets
      (`READ_RESPONSE_HEADROOM_MS`). After it, every leg is bounded: the handler answers within 3.5 seconds, and the
      matcher's 2.8 seconds plus a 0.25 second cap on waiting for a release fits inside that. So the worst case is
      5 + 3.5 = 8.5 seconds. A named margin of 1 second for the response brings it to 9.5, strictly under the client's
      10 second timeout. `parseJobMatchesBudget.test.ts` asserts this against the client's own constant.
    - The env schema refuses a catalog search timeout above 750 milliseconds. Above it, no wave could start inside the
      deadline and a paste would match nothing, silently.
    - A call that leaves proposals unmade writes a log line and one `paste-proposals-unmade` count, dimensioned by stage.
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
    - **A spent budget is not retried on this path** (owner ruling, 2026-10-26). When the prod ceiling refuses the
      review, or the LLM parse leg of a parse-job line, the worker records the refusal instead of returning the message
      to the queue. The parse leg lands the CRF reading alone. The review records a `budgetSpent` outcome under its
      verification key and its spend period. That outcome is not a verdict. Within its period it blocks a resend, the
      way an exhausted attempt does, and the next period sends the review again. ADR-0072 §10 holds the full rule.
8. **A send is claimed, and a claim is a lease.** Nothing is sent for a proposal whose verdict is on record and asked
   identity. A row already sent sends nothing.
    - A claim names the row's digest and verdict key. A failed send releases only its own claim. One caller can never
      clear another caller's claim.
    - A claim older than the queue's delivery bound (90 seconds times 361 receives, about nine hours) was lost if no
      verdict that asked identity is on record and no attempt is exhausted or recent. The next call claims it and
      sends it again. This holds the case where a worker took an attempt and then lost its verdict write: that old,
      unfinished attempt blocks nothing, and the worker's own attempt allowance bounds the resends. An exhausted attempt
      is final, and a recent one means the worker may still be running.
    - A proposal always has a review: owed, or refused. A request the gate can never take is refused, and the refusal
      is stored: a blank line, an over-long line, or a message the queue's contract refuses. It is never claimed, so it
      is not retried on every poll. A proposed food that food cannot name is stored as no proposal, with the food kept as a
      candidate. The table refuses a proposal with no review, because it would read as waiting for a review nothing sends.
    - An aborted send may already be accepted by the queue. The client gave up waiting, which is not a failure. The
      claim is released and the next call sends again. The duplicate is free: the worker's keyed claim pays for one
      verdict per key.
    - A contained test principal (ADR-0040) gets its proposals stored, but no review is sent for them. The save path's
      verification producer follows the same rule.
9. **The state is derived at read time.** One classifier, `identityReadingOf`, says what a stored verdict means for the
   food. The paste view and a saved line's badge both derive from it, each with its own exhaustive mapping. Neither
   reads the verdict's columns itself. The readings are:

    | Reading      | A verdict that                                                                         |
    | ------------ | -------------------------------------------------------------------------------------- |
    | `unasked`    | Never asked identity. It says nothing about the food.                                  |
    | `agree`      | Itemized identity as agree at medium or high certainty, or a joint `verified`.         |
    | `contradict` | Itemized identity as disagree at high certainty.                                       |
    | `doubt`      | Itemized identity as disagree below high certainty.                                    |
    | `hedged`     | Itemized identity as agree at low certainty. The hedge is kept, not promoted.          |
    | `abstain`    | Itemized identity as abstain.                                                          |
    | `unreadable` | Has no itemized identity: an unreadable model reply, or a joint disagree not itemized. |

    The paste view is `matchStateOf`, a pure policy applied in this order:

    | State         | When                                                                                                                          |
    | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
    | `default`     | A candidate sits on the `default` rung, whatever answered (or nothing did), whatever the gate said.                           |
    | `noMatch`     | Nothing proposed and no candidates.                                                                                           |
    | `needsChoice` | Nothing proposed, but candidates exist.                                                                                       |
    | `needsChoice` | The spend ceiling refused the review (`budgetSpent`). Curated, memo and exact-name proposals too. Reason `reviewBudgetSpent`. |
    | `confident`   | A curated mapping. A `contradict` keeps it confident and adds the note `reviewDisagreed`.                                     |
    | `needsChoice` | A memo or lexical proposal read `contradict` or `doubt`.                                                                      |
    | `confident`   | A memo, a lexical proposal read `agree`, or an exact-name rung with no readable verdict.                                      |
    | `needsChoice` | A lexical proposal read `abstain` or `hedged`, or one the gate refused, gave up on or was not asked.                          |
    | `checking`    | A lexical proposal awaiting review.                                                                                           |
    - **The two surfaces differ in one direction, and on purpose.** Asking the cook before a bind is cheap. So the paste
      view asks on `doubt`, `hedged`, `abstain` and `unreadable`. Badging a line the cook has already bound is a
      warning. So a saved line shows the AMBIGUOUS badge only for `contradict` (under a contradicted band) and
      `abstain`, and keeps its catalog status for `doubt`, `hedged` and `unreadable`. A contradicted band still
      withholds nutrition on a saved line whatever the reading. `contradict` is the only reading that adds
      `reviewDisagreed` to a curated mapping, because a low-certainty disagreement is noise, not a reason to look at
      curation.
    - **An unreadable reply is a review that gave up.** On paste it reads `reviewUnchecked`, like an exhausted review.
      It never reads `checking` forever, and it does not read as an abstention.
    - **An exact name is a confident match** (owner ruling). It stays confident when its review was refused, gave up
      or was never asked, or came back unreadable. A review that disagrees (`contradict` or `doubt`), abstains or
      hedges still overrides it, because the cook should look when the gate spoke against the food.
    - **A spent budget surfaces every food** (owner ruling, 2026-10-26). While the ceiling refuses this path, nothing
      reviews the parse or the match. So a proposal whose review reads `budgetSpent` is `needsChoice`, with the reason
      `reviewBudgetSpent`. This holds for curated mappings, remembered matches and exact names too. A match on a
      CRF-only phrase can be a match to the wrong words. A `default` line stays `default`, and a line with no proposal
      stays `noMatch` or `needsChoice`. The proposed food stays a candidate, so keeping it is one pick. While the budget is
      spent, no line binds without the cook, in any mode (owner ruling, second round). That covers the editor and all
      three bulk import modes. ADR-0072 §10 holds the bulk detail. Matching gets worse
      past the budget, by decision.
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
14. **A name typed in the editor never binds what a tier remembers** (owner rulings 2026-11-03, after devil's advocate
    M2). A memo is written from any cook's saved line. Cook A pastes `milk`, keeps the default and saves, and the gate
    agrees, so the memo says `milk` means the default. If by-name then bound that memo, cook B would get it with no
    choice made. So five answers now only PROPOSE: the cook's own earlier correction, a staff ruling, two cooks
    agreeing, a memo, and an exact catalog name. The version restore keeps binding what the version defined. The
    importer tries to match and shows the result for the cook to confirm or change.
    - `GET /api/v1/ingredients/by-name/proposals?name=` returns what the settled chain remembers, strongest source
      first (`ownCorrection`, `staffRuling`, `corroborated`, `remembered`). It is a read that writes nothing. Names
      come from food as the caller. A food food will not show is dropped, so the answer is always `200` and an empty
      list reveals nothing about another cook's private food. The `source` key is an open string.
    - The add field shows the proposals as its first options, tagged "Suggested". None is active when the list opens, so
      Enter alone picks nothing. The pick binds through `by-food` or `by-food-variant`, which check admission again.
    - `POST /api/v1/ingredients/by-name` asks food alone and consults no tier. It still binds a food that food itself
      answers `RESOLVED`, because pressing "Find nutrition for X" is the cook's own act.
    - The version restorer calls `IngredientsService.addByNameThroughCascade`. That method is for the restorer only.
    - The proposals are not the paste matcher's: they run the settled chain alone (two local reads), so the field adds no
      catalog search. The field's own list already shows the catalog's hits for the typed text.

## Consequences

- By-name binds no catalog guess and no remembered answer. It asks food's add by name, which can resolve later through
  its source fan-out. A build that shipped before item 14 still expects a memo to bind there: it now gets a pending
  or unresolved line, the same shape as a miss.
- The cookbook import tool reaches by-name only after both its food searches find nothing, so after item 14 it gets
  food-only behaviour. Its measured match rates shift a little.
- The save path no longer grants band skips or stores pending re-drives, and no line renders `pending-verification`.
  The wire values `verification_pending` and `PENDING_VERIFICATION` stay in the contract, unproduced. A later cleanup
  decides whether they go.
- The band subsystem is dormant by decision. Band statistics do not move, and no band earns or loses a skip, until a
  producer names a band key.
- A verdict key is the key of the message that is sent. The worker and the matcher derive it the same way, so a
  verdict lands where the job view reads it. The editor saves `2 tbsp` as `tbsp`, and the matcher keys `tbsp` too.
- A message SQS accepts and then loses leaves its row claimed with no verdict. The same holds for a worker that lost
  its verdict write. The line reads `checking` until a matches call arrives after the delivery bound, about nine hours
  later. That call claims and sends it again. If no such call arrives, the line reads `checking` until the job expires.
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
- Bulk import, `bound_by`, the import's derived `version` and flagged lines are decided in
  [ADR-0072](0072-bulk-recipe-import.md). Its route is `/api/v1/import`.

## Alternatives

- **Match in the parse worker.** It has no caller credential, and food search as a service identity is refused.
- **Keep the lexical tier in by-name, behind the pending state.** The pending state read a row every cook shares.
- **Keep the cascade in by-name and move only the editor to a new route.** The rebind route reaches the same method by
  name, so the cascade would still bind there. The split is made in the service instead: the plain method asks food
  alone, and the restorer's method keeps the cascade.
- **A `mode` flag on by-name.** A boolean that picks between binding and proposing is the shape the standards reject. A
  separate read route has a different method, a different status and no writes.
- **Bind confident matches on the server, in the single-paste editor flow.** The editor binds through by-food
  admission, and the cook can still change the line before it is saved. This rejection covers that flow only. The
  bulk import modes of ADR-0072 bind with no editor in front of the cook, by owner ruling.
- **Store food names on the match.** ADR-0045 keeps names out of the recipe database, so a renamed food shows as food
  says now.
