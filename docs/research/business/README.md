# Business research: market, pricing, payments and recipe rights

This folder holds the business research behind the decisions of 2026-10-27 to 2026-10-29. Each file is a dated copy of
research written for the owner. The files are kept as written, with a few cuts for privacy (see below).

The decisions themselves are not here. They live in
[`docs/business-plan.md`](../../business-plan.md#current-decisions-2026-10-29), the
[010 plan register](../../../specs/010-subscriptions/spec.md#plan-register), the growth specs and the ADRs. When a file
here disagrees with those, the decision wins. A later ruling can overtake a file's recommendation.

## How to read the evidence

Most files tag every figure. **[P]** is a primary page, **[S]** a secondary page, **[D]** arithmetic on cited inputs,
**[R]** an owner ruling. **GAP** means no data was found. A number with no tag and no link is not evidence.

Market, conversion and growth figures in the business plan must come from cited market data like this. They are never
guesses.

## Files

### Market and competitors

| File                                             | Date       | What it holds                                                                                |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| [`marketAnalysisV2.md`](./marketAnalysisV2.md)   | 2026-10-27 | Market size, competitor features and prices, free plans, unmet needs, and market share (SOM) |
| [`mv2/compSubs.md`](./mv2/compSubs.md)           | 2026-10-27 | Competitor matrix: 11 subscription apps, row by row, with quotes and links                   |
| [`mv2/compIndie.md`](./mv2/compIndie.md)         | 2026-10-27 | Competitor matrix: 10 indie and one-time-purchase apps, row by row, with quotes and links    |
| [`mv2/aiAndMarket.md`](./mv2/aiAndMarket.md)     | 2026-10-27 | AI pricing in the category, the 2025 top-grossing apps, and how many people buy an AI tier   |
| [`mv2/priceEvidence.md`](./mv2/priceEvidence.md) | 2026-10-27 | Price tests and price data for the Pro price choice                                          |
| [`mv2/needs.md`](./mv2/needs.md)                 | 2026-10-27 | The user-needs database tested against current apps and our specs. Desk research only        |
| [`mv2/inventory.md`](./mv2/inventory.md)         | 2026-10-27 | Our own feature list, with the plan and build status of each feature                         |

### Pricing, conversion and AI

| File                                                   | Date       | What it holds                                                                                      |
| ------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------- |
| [`priceEvaluation.md`](./priceEvaluation.md)           | 2026-10-27 | Pro at $99.99 against the $59.99 class, feature by feature. The revenue projection is cut          |
| [`conversionStudy.md`](./conversionStudy.md)           | 2026-10-27 | What share of users pay and stay active, from published benchmarks                                 |
| [`freeTierAiResearch.md`](./freeTierAiResearch.md)     | 2026-10-27 | Whether to give Free plans AI, and how other apps handle it                                        |
| [`aiCostModel.md`](./aiCostModel.md)                   | 2026-10-27 | A rough cost of AI uses and hosting at 100,000 registered users                                    |
| [`paymentDecisionBrief.md`](./paymentDecisionBrief.md) | 2026-10-27 | How Commise takes payment: store billing, the web, and the fees. Research, not legal or tax advice |

### Growth

| File                                           | Date       | What it holds                                               |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------- |
| [`acquisitionIdeas.md`](./acquisitionIdeas.md) | 2026-10-28 | 41 ideas for downloads, sign-ups and reach, with the top 12 |
| [`conversionIdeas.md`](./conversionIdeas.md)   | 2026-10-28 | 32 ideas for conversion, retention and revenue per install  |

### Recipe rights

| File                                                         | Date       | What it holds                                                                          |
| ------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| [`recipeOwnershipResearch.md`](./recipeOwnershipResearch.md) | 2026-10-29 | Who owns a recipe, what rivals say, and how to spot copies. Research, not legal advice |
| [`linkedCardResearch.md`](./linkedCardResearch.md)           | 2026-10-29 | What a public card can show for a recipe from another site. Research, not legal advice |

## What was left out

These files are private and are not copied here. Some of the files above mention them by description only.

- The detailed financial plan, its models and scripts, and any revenue or break-even projection from them. This is
  why `priceEvaluation.md` has no section 3.1 or 3.2.
- Owner-private business material.
- Model scripts behind the derived numbers, and one working checklist (`checklist.md`).

## Adding to this folder

- Use camelCase file names. Hyphens are not allowed in new file names.
- Put the date the research was done at the top, and keep the source tags.
- Mark legal research "research, not legal advice".
- Check a file for private material before you add it. When you are not sure, leave it out.
