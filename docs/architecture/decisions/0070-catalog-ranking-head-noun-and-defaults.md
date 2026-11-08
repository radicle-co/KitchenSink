# 0070 — Catalog ranking reads the English head noun, and a bare noun's default is seed data

- **Status:** Accepted
- **Date:** 2026-10-25
- **Relates to:** [ADR-0051](0051-catalog-seed-is-a-deploy-step.md): the catalog seed, which carries the curated names.
  [ADR-0055](0055-remote-food-search-service.md): a curator fills a wording gap with a synonym.
  [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md): the one Bedrock grantee.

## Context

On 2026-10-25 a paste import into production parsed all eight lines of a French toast recipe correctly. It then
bound four of them to the wrong food: `milk` to milk crackers, `salt` to salt cod, `cinnamon` to cinnamon rolls and `bread`
to bread flour. Each came back to the client as `RESOLVED`.

The ranking ladder (`rankingTiers.ts`) lifts a row whose head term equals the query's head term. For a name with no
comma, `describeRankingName` took the FIRST word as the head. That rule read USDA's inverted names correctly
(`Flour, wheat`), and it also kept `Carob flour` out of the head rung for the query `flour`. The curated seed then
renamed 2,640 of its 2,642 roots into natural English, where the head noun is last: `milk crackers`, `1% milk`,
`ground cinnamon`. The first-word rule now crowned the modifier of every such name, so `milk crackers` sat on the
head rung for `milk` and `whole milk` did not.

The first-word rule also stood in for a second fact: what a bare noun means by default. The seed has no root named
`milk`, `salt` or `flour` on purpose. Decision D3 planned a consumption prior to choose
that default, and nobody built it. The owner also ruled on 2026-10-01 that the score uses text match only.

## Decision

1. **The head is the English head noun of the first comma segment.** Remove each bracketed group, cut a trailing
   standalone `in …` phrase, then take the last token of the text before the first comma. An inverted name keeps its
   head because its first segment is one word. The rule is `rankingHeadOf` in `recipe-core`. Its SQL mirror is the
   immutable `rank_head_of()` behind the generated column `food.rank_head` (migration 0025). The same rule reads a
   typed query, so the old asymmetry between names and queries is gone.
2. **`RANKER_VERSION` becomes `ladder-v4-head-noun`.** Every band re-earns its authority under the new ranker.
3. **A synonym is its own rung.** A query that equals a root's synonym ranks just below an equal name, so the
   curator's synonym loop (ADR-0055) can lift a root above other head-rung rows. Food publishes the rung on each
   ranked hit of the per-caller search, the server-to-server shape recipe-service reads, and recipe-service records
   that value instead of computing the rung a second time. That field reads a rung it does not know as absent, so the
   ladder can grow without failing an older reader. The shared catalog search, which clients read and the edge
   caches, publishes no rung: it carries only `isDefault` (decision 4). The authored search publishes neither.
4. **A bare noun's default is a separate seed kind, `defaultFor`, with a `default` rung just below `synonym`.** It is
   not a synonym, because food treats a synonym as the food itself. A synonym `milk` on whole milk binds whole milk
   with no cook involved. A default term is excluded from that identity rule: it lives in its own column,
   `food.default_terms` (migration 0027), which catalog-name identity never reads. The seed refuses a default term
   whose ranking key is any root's name key, any synonym key, or another default term's key, across every root. It
   does not refuse a key twice among names and synonyms: 22 keys repeat within one root (`coriander seed` and
   `coriander seeds`), and that redundancy names one food. No key is shared by two roots.
5. **The ten defaults are owner rulings of 2026-10-25:** salt → table salt, pepper → black pepper, milk → whole milk,
   flour → all-purpose flour, cinnamon → ground cinnamon, rice → long-grain white rice, nutmeg → ground nutmeg,
   peppercorns → black peppercorns, endive → Belgian endive and oatmeal → rolled oats. The last four were synonyms and
   are now only defaults, so a cook can choose another food. Bread, cream and oil get none. The owner also ruled that
   defaults serve imports. The UI can show which choice is the default, but it never selects that choice for the
   cook. This is a recorded exception to the 2026-10-01 text-only ruling: a default is matched by text, but a curator
   chose it.

## Consequences

- Carob flour now ranks as a flour. Which flour a bare `flour` means is the `default` rung's job, not the head rule's.
- Each new rung shrinks one rung's share of the normalized score (2/12 with five rungs, 2/16 with seven). The lexical
  tier's margin bands are therefore measured in rung units, not absolute scores, so a one-rung lead stays in the top
  band as the ladder grows.
- Every search order moves, in the picker, in progressive search and in the lexical resolution tier. The judgement
  set is re-run and re-baselined.
- Known names the rule still reads wrongly: `Cream of Wheat`, `cream of tartar`, `hearts of palm`, brand-led comma
  names such as `Kraft Foods, …`, and two `bone-in, skin-on chicken …` names whose head reads as `in`. None of them
  is a bare-noun default, and each can take a synonym.
- Never replace `rank_head_of` in place. A stored generated column keeps the value it computed at the last write of
  each row. A later change adds a new function and runs `SET EXPRESSION`.
- A default ranks first in a list and carries a label. The UI never selects it for the cook. How a paste import asks
  the cook to choose is a separate decision.

## Alternatives

- **Keep the first-word rule.** It is wrong for almost every curated name.
- **Last word with no defaults.** Bare nouns land on the shortest head-rung name: 1% milk, sea salt, 00 flour.
- **The D3 consumption prior.** It needs a change to the 2026-10-01 ruling for the score itself, and nothing measures
  it yet.
- **Defaults as plain synonyms.** A synonym binds the default with no choice, which the owner ruled out.
- **A numeric confidence threshold on the lexical tier.** It stays refused (R16, R17): a made-up number is not
  evidence.
