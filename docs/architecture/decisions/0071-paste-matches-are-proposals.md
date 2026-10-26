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
   proposed food, the tier that proposed it, its rung and margin, up to five candidates, and the verdict key. It
   stores no food names. Names come from food at read time, as the caller. The foreign key is to the parse-job line,
   so deleting a job removes its matches. Account erasure deletes a cook's jobs, so it reaches this table too.
4. **`POST /api/v1/recipe-parse-jobs/{id}/matches` asks for matches.** It answers `202` with the job view. It is
   idempotent, owner-only (`404` for a stranger) and refused past the job's expiry. When newly parsed lines appear,
   the client calls it from its poll loop.
5. **The lexical shortlist runs for every proposal.** It supplies the candidates and the fact that a default applies.
   A curated or memo answer does not hide a default.
6. **An outage is never stored as "no match".** A tier that failed, a food service that did not answer, or a switched
   off catalog writes no row. The next call retries. Work per call is bounded: waves of four, for about four seconds.
7. **The review gate checks each proposal once.** The message carries a parse-job origin and `unattributed`
   evidence, so identity is always asked. The paste path never skips identity. This is an exception to earned
   autonomy (D1). Spend is attributed to a new call site, `paste-match-review`, inside ADR-0024's one pool.
   No `ingredientPhrase` is sent, so the worker writes no memo from a paste.
8. **A send is claimed.** A verdict already on record sends nothing. A row already sent sends nothing. A failed send
   releases its claim for the next call.
9. **The state is derived at read time.** `matchStateOf` is a pure policy, applied in this order:

    | State         | When                                                                                            |
    | ------------- | ----------------------------------------------------------------------------------------------- |
    | `noMatch`     | Nothing proposed and no candidates.                                                             |
    | `needsChoice` | Nothing proposed, but candidates exist.                                                         |
    | `default`     | A candidate sits on the `default` rung, whatever answered and whatever the gate said.           |
    | `confident`   | A curated mapping. A gate contradiction keeps it confident and adds the note `reviewDisagreed`. |
    | `needsChoice` | A memo or lexical proposal the gate contradicted on identity.                                   |
    | `confident`   | A memo, a lexical proposal the gate verified, or an exact-name rung awaiting review.            |
    | `needsChoice` | The gate abstained, refused an over-long line, or gave up.                                      |
    | `checking`    | A lexical proposal awaiting review.                                                             |

    The state enum is closed. A new fact becomes a new field or a new reason key, never a new state. A late verdict
    never replaces a pick the cook made. That rule belongs to the client.

10. **R19 is amended.** A proposal can carry candidates, never a binding. The reviewed draft still binds through
    `POST /recipes` and by-food admission.
11. **No provenance is read from a shared binding row.** The save path declares `unattributed` for every line. A line
    with no verdict reports its catalog status. The resolution event writes stay, as telemetry.
12. **The save path reads verdicts by key.** Before it enqueues, it drops each line whose verdict is already on
    record. A pasted line whose proposal the gate judged is not paid for twice.

## Consequences

- By-name no longer binds a catalog guess. A phrase neither settled tier knows falls through to food's own add by
  name, which can still resolve later through its source fan-out.
- The save path no longer grants band skips or stores pending re-drives, and no line renders `pending-verification`
  or the shortlist-spread `AMBIGUOUS` badge. The wire reason `verification_pending` stays in the contract, unproduced.
- The verdict key matches the save path only where the editor saves the parse's own measure. The editor saves the
  measure in the cook's words, so `2 tbsp` saves unit `tbsp` while the parse says `tablespoon`. Then the save path
  asks again.
- A curated contradiction is counted once per read, not once per mapping. It signals that curation needs a look.
- A message SQS accepts and then loses leaves its row claimed with no verdict. That line reads `checking` until the
  job expires.

## Follow-ups

- Paste verdicts feed no memo and no band. The parse-job origin lacks the rung, margin, query shape, ranker version
  and default flag. Carrying them on the origin is the fix.
- Outside production one gate Lambda runs at a time, so a proposal reads `checking` for about one gate call each.
- The `/api/v1/imports` resource, `boundBy`, a per-import version and flagged lines are a later step.

## Alternatives

- **Match in the parse worker.** It has no caller credential, and food search as a service identity is refused.
- **Keep the lexical tier in by-name, behind the pending state.** The pending state read a row every cook shares.
- **Bind confident matches on the server.** The editor binds through by-food admission, and the cook can still change
  the line before it is saved.
- **Store food names on the match.** ADR-0045 keeps names out of the recipe database, so a renamed food shows as food
  says now.
