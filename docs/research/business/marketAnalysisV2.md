# Commise business plan: market section, version 2

> **Note (2026-10-29).** This is a dated research file, copied as it was written. Owner rulings made after it
> supersede its recommendations. The decisions in force are in
> [`docs/business-plan.md`](../../business-plan.md#current-decisions-2026-10-29) and the
> [010 plan register](../../../specs/010-subscriptions/spec.md#plan-register).
>
> Since this was written, Pro gained 30 AI uses a month, a pantry with use-by dates and household sharing
> (section 13.2 items 1 and 2 are therefore settled).

Prepared 2026-10-27 by the CPO agent. Research and writing only. No repository file was changed.
Every derived number below is printed by a model script that is kept privately and is not published.

Working files behind this report (in the `mv2/` folder beside this file):

- `inventory.md`: our feature inventory, 104 capability rows, plan and build status for each.
- `compSubs.md`: 11 subscription competitors, row by row, with quotes and URLs.
- `compIndie.md`: 10 indie and one-time competitors, row by row, with quotes and URLs.
- `aiAndMarket.md`: AI pricing in the category, the 2025 top grossers, crowding, and AI-tier attach rates.
- `needs.md`: the user-needs database tested against current apps and our specs.
- `checklist.md` (not published): the 28 shared capability rows (C01 to C28) every matrix uses.

Labels:

- **[P]** primary source: the company's own page, store listing, help center or filing.
- **[S]** secondary source: press, analyst or aggregator.
- **[D]** derived: arithmetic on cited inputs, shown or printed by the model.
- **[R]** owner ruling.
- **[Inference]** a reasoned reading of sources, not a stated fact.
- **[Unconfirmed]** seen only in a weak source or a search summary.
- **GAP** no data exists. The best proxy is named.

All web pages were fetched on 2026-10-27 unless a line says otherwise.

---

## What changed from v1

1. **The headline "our prices are 2 to 3 times the category" is reframed. It is not deleted.** The price ratios are
   still facts. Pro at $99.99 a year is 2.5 times ReciMe Plus ($39.99), 1.67 times Samsung Food+ ($59.99) and 2.04
   times Plan to Eat ($49) [D]. v2 adds what each plan contains. Once features are matched, Pro still costs 1.4 to 2.0
   times the cheapest app or pair of apps that covers the same jobs [D, section 7].
2. **Our feature set is now compared like for like.** v2 counts every feature in specs 001 to 020 as a launch offering
   (owner ruling, 2026-10-27: "everything will be built around launch (not necessarily beta)") [R]. Build status is kept
   only to show what beta will lack.
3. **Free plans are now compared.** Our Free plan is among the most generous in the category. It gives away most of
   what competitors charge for [D, section 8].
4. **Two owner premises are tested.** (a) Pro matches competitor paid plans. Mostly true row by row, and Pro is ahead on
   some rows. But Pro is behind on AI and on grocery ordering. (b) No competitor sells an AI tier like Pro with AI. True
   for the tier SHAPE, with one open case (Honeydew). Not true for the AI FEATURES (sections 5 and 6).
5. **A new finding the brief did not ask for.** The step from Free to Pro is very small. It is the smallest of any
   freemium competitor checked [D, section 8]. Pro also gets fewer platform AI uses than Free (0 against 3) [R].
6. **A new section on unmet needs.** Current apps fail specific, documented needs. The evidence that they are weak
   overall is not there. No cited data links fixing a need to switching, retention or conversion. That is a GAP, so
   it moves no number (section 9).
7. **Numbers that changed.**
    - SAM at our prices: v1 $52M to $199M. v2 **$52M to $217M** [D]. The change is a Pro with AI add-on segment of
      **$0.7M to $17.9M** a year, sized from cited AI-tier attach rates (section 10).
    - Conversion: v1 used the freemium median as the base. v2 uses a **band from P10 to the median**, with ReciMe's own
      first year (0.4% of registered users paying) inside it. The top-quartile rate is no longer used for our plan,
      because our free plan is generous (section 8).
    - Revenue per payer: v1 $8.33 to $12.86 a month. v2 **$8.44 to $9.93** [D], because the cited attach rates for an AI
      tier are lower than the mix v1 borrowed from an earlier internal model (not published).
    - SOM at month 24: v1 "steady traction" $2K to $6K MRR. v2 **$0.2K to $4.8K MRR** across the low and mid traction
      curves, with the P10 rate as the new floor (section 11).
8. **What did not change.** The analyst-report review, the bottom-up chain, the observed-spend leg, the US market
   reconciliation ($50M to $250M), the follow-on markets, growth comparables and the paid-acquisition arithmetic. Those
   sections of v1 still hold. They are summarized in section 12 and not repeated in full.
9. **New since v1.** Mealime's closure is confirmed [P]. Sensor Tower has published no 2026 Food and Drink post, so the
   newest grosser data is still Q4 2025 [P, sitemap check]. Paprika 4 is moving to a subscription [P].

---

## 1. Executive summary

- **The market is crowded.** Google Play's Food and Drink category holds **131,285 apps** [S, 42matters, 27 Oct 2026].
  A recipe-only count and an iOS count are GAP. Revenue is concentrated. In Q4 2025, ReciMe and NYT Cooking together
  earned about 9 to 14 times the next three apps combined [D on Sensor Tower estimates, section 2].
- **Premise (a), Pro is the like-for-like match, mostly holds.** Row by row, Pro has more than or the same as ReciMe
  Plus, Plan to Eat, AnyList, Copy Me That, Deglaze and Paprika on most rows [D]. Pro is behind Samsung Food+ on five
  known rows. Pro is behind almost every AI-carrying paid plan on AI, because Pro has no platform AI.
- **Premise (b), no one sells an AI tier like Pro with AI, holds for the shape only.** No recipe app found sells a
  non-AI paid plan with a dearer AI plan above it [P across 30+ listings]. Honeydew is an open case [Unconfirmed]. But
  the AI features themselves are common and cheaper. Samsung Food+ sells "AI-personalized weekly meal plans" at $6.99
  a month [P]. ReciMe Plus includes an AI assistant [P]. Plan to Eat includes an AI suite [P].
- **Pro's price, feature-matched.** Pro costs $5.71 per covered capability row per year. Competitor paid plans cost
  $0.96 to $3.53 per row [D]. A single app (Plan to Eat $49, Samsung Food+ $59.99, Deglaze Pro $49.99) or a pair
  (ReciMe Plus + AnyList household, $54.98) already covers Pro's core jobs [D]. Pro is 1.4 to 2.0 times those.
- **Our Free plan is a competitor-grade paid plan for $0.** It scores 16.5 of 21 known rows. The best competitor free
  plan scores 11.5 (Copy Me That, capped at 40 recipes) [D]. The step from Free to Pro adds 1.0 row. ReciMe, Samsung
  Food and Deglaze add 5.5 to 6.5 rows [D]. Our real paywall is the cap of 50 private recipes, which every captured
  cookbook, paid-site or bulk import uses (004-FR-028) [R].
- **What that does to conversion.** A generous free plan points down. RevenueCat finds freemium apps convert at 2.1%
  against 10.7% for hard paywalls [S]. No study measures how generosity within freemium moves the rate: GAP. v2 plans
  on a band from P10 (0.3% at day 35) to the median (2.1%), not the median alone.
- **Pro with AI as a segment.** Cited attach rates for an AI tier above a paid base run from about 1.3% (Google One,
  [Inference]) to 9% (Duolingo Max, [S]). That gives a US add-on segment of **$0.7M to $17.9M a year** [D]. Duolingo is
  now moving its main AI feature into its cheaper tier [P], and Microsoft and Notion folded AI into base plans. The
  direction of the market is against a separate AI tier.
- **Unmet needs are real but narrow.** Imports that go wrong, shared lists that lose items, lists that do not merge,
  allergen filters that leak, ads over the step, and collections lost or locked in each recur across many apps and
  years (desk research, no interviews). The same apps rate 4.8 to 4.9 on hundreds of thousands of ratings. Two
  high-ranked needs have no spec at all (allergen avoid list, cost).
- **Revised numbers.** US paid market $50M to $250M (unchanged). SAM at our prices **$52M to $217M**. SAM at today's
  category prices **$21M to $119M** (unchanged). SOM at month 24 with no budget: **$0.2K to $4.8K MRR** on the low and
  mid traction curves, **$4.1K to $42K MRR** only on a ReciMe-style breakout [D].

Confidence: **Medium** on features and prices (primary pages, but many "?" cells). **Low** on conversion, AI attach
and SOM. What would raise it is in section 13.

---

## 2. How crowded the market is

| Measure                               | Value                                                                                                              | Source                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Play Food and Drink apps       | **131,285** (130,973 free, 312 paid)                                                                               | [S] [42matters](https://42matters.com/google-play-statistics-and-trends), page data dated 2026-10-27. Includes delivery, restaurant and wine apps                                                          |
| iOS Food and Drink apps               | **GAP.** Fewer than 185,833 (the smallest of 42matters' top 7 iOS categories)                                      | [S] [42matters iOS](https://42matters.com/ios-apple-app-store-statistics-and-trends)                                                                                                                       |
| Recipe or meal-planning apps only     | **GAP.** No Appfigures, AppMagic or Sensor Tower count found                                                       |                                                                                                                                                                                                            |
| Share of revenue held by the top apps | **GAP.** Proxy below                                                                                               |                                                                                                                                                                                                            |
| Proxy: top 2 vs next 3, US, Q4 2025   | ReciMe ($543K a week) + NYT Cooking ($382K) = $925K against #3 to #5 at $68K to $103K. **About 9 to 14 times** [D] | [S] [Sensor Tower Q4 2025](https://sensortower.com/blog/2025-q4-unified-top-5-food-and-drink-revenue-us-602e0a75241bc16eb808976d). The two top figures are from different weeks, so this is an upper bound |
| Size of the #5 slot                   | About $15K to $40K a week                                                                                          | [S] same series, 2025                                                                                                                                                                                      |
| 2026 grosser data                     | **GAP.** Sensor Tower's sitemap (1,511,102 URLs) holds no 2026 Food and Drink post                                 | [P] sitemap check, `aiAndMarket.md` Part 2                                                                                                                                                                 |

Recipe apps in the US top 5 grossers in every 2025 quarter: ReciMe (#1), NYT Cooking (#2), America's Test Kitchen.
Gronda appears in Q4. Vivino and Seed Oil Scout fill the other slots and are not recipe apps [S].

Exits: Mealime "will be discontinued as of October 21, 2026" [P, [mealime.com/closing](https://www.mealime.com/closing)].
Yummly shut in December 2024 (v1 section 5). Paprika 4 says "premium features will require a subscription" after its
beta [P, [Paprika blog, 28 Sep 2026](https://www.paprikaapp.com/news/2026/09/28/paprika-4-is-now-in-open-beta/)].

**Reading.** Many apps, very few earners. One app (ReciMe) took most of the subscription growth in 2025. The long tail
earns little.

---

## 3. Our plans and feature inventory

### 3.1 The three plans [R]

From the plan register in `specs/010-subscriptions/spec.md` and `specs/005-ai-integration/spec.md` FR-015 to FR-015f.

|                                          | Free                                         | Pro                                          | Pro with AI                                     |
| ---------------------------------------- | -------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| Price                                    | $0                                           | $9.99 a month or $99.99 a year, 14-day trial | $19.99 a month or $199.99 a year, 14-day trial  |
| Private recipes                          | Up to 50 (ADR-0073). Drafts use no slot      | No limit                                     | No limit                                        |
| Public recipes                           | Unlimited                                    | Unlimited                                    | Unlimited                                       |
| Every import channel                     | Yes. Private results use a slot (004-FR-028) | Yes                                          | Yes                                             |
| Bulk import                              | 200 recipes a rolling day                    | 1,000 a rolling day                          | 1,000 a rolling day                             |
| Platform AI uses                         | 3 single-call uses a month                   | **None**                                     | 300 a month (100 in the trial)                  |
| Own AI keys                              | Never                                        | Yes, several, in an order the cook sets      | Yes, after the allowance, with an on/off switch |
| Auto meal plans, food-waste optimization | No                                           | No                                           | Yes, only here                                  |
| Trainer nutrition plans for clients      | No                                           | Yes                                          | Yes                                             |
| Parse, match and review AI               | Yes, operating cost                          | Yes                                          | Yes                                             |
| Online grocery ordering                  | Not on any plan until a store partner exists |                                              |                                                 |

What Pro adds over Free, exactly: more than 50 private recipes, a private copy of a public import after an edit,
trainer nutrition planning, own AI keys, and 1,000 bulk imports a day instead of 200 (`inventory.md` section d).

### 3.2 Launch offering against the shared checklist

Values: Y = included. Limited(n) = capped. N = not offered. "?" = sources conflict.

| Row                                   | Free                              | Pro                                   | Pro with AI                   | Spec                                                                         | Beta has it?                             |
| ------------------------------------- | --------------------------------- | ------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| C01 URL import                        | Y                                 | Y                                     | Y                             | 004-FR-008                                                                   | No                                       |
| C02 Social video import               | Y                                 | Y                                     | Y                             | 017-FR-001 to FR-011b                                                        | No                                       |
| C03 Photo or scan (OCR, handwriting)  | Y, uses a private slot            | Y                                     | Y                             | 011                                                                          | No                                       |
| C04 Share sheet, browser extension    | Y                                 | Y                                     | Y                             | 017-FR-012 to FR-015                                                         | No                                       |
| C05 Bulk import, migration, export    | Limited(200 a day). Export Y      | Limited(1,000 a day)                  | Limited(1,000 a day)          | 004-FR-026, 017-FR-016 to FR-020                                             | Partial (export API only)                |
| C07 Private storage                   | Limited(50)                       | Y                                     | Y                             | 001-FR-003, ADR-0073                                                         | Yes                                      |
| C08 Public catalog, clone, ratings    | Y                                 | Y                                     | Y                             | 001-FR-004, FR-005, FR-013                                                   | Yes                                      |
| C09 Collections, search               | Y                                 | Y                                     | Y                             | 001-FR-006, FR-008                                                           | Yes                                      |
| C10 Editing, version history          | Y                                 | Y                                     | Y                             | 001-FR-001, FR-007b                                                          | Yes                                      |
| C11 Scaling, unit toggle              | Y                                 | Y                                     | Y                             | 017-FR-035, FR-026                                                           | Scaling yes, toggle no                   |
| C12 Cooking mode, timers, voice       | Y                                 | Y                                     | Y                             | 008, 017-FR-021 to FR-024                                                    | Partial                                  |
| C13 Manual meal planner               | Y                                 | Y                                     | Y                             | 006-FR-022                                                                   | No                                       |
| C14 Auto or AI meal plans             | Limited(3 uses, single-slot only) | Own key, single-slot only [Inference] | Limited(300 uses), full plans | 006-FR-025, FR-026                                                           | No                                       |
| C15 Food-waste planning               | N                                 | N                                     | Y                             | 006-FR-027                                                                   | No                                       |
| C16 Pantry                            | Limited ("already have", 7 days)  | Same                                  | Same                          | 007-FR-029                                                                   | No                                       |
| C17 Merged, aisle-sorted grocery list | Y                                 | Y                                     | Y                             | 007-FR-028, 017-FR-028                                                       | No                                       |
| C18 Household shared plans and lists  | ?                                 | ?                                     | ?                             | 017-FR-030 to FR-034. Seat count conflicts with 010's "no family plan in v1" | No                                       |
| C19 Grocery ordering                  | N                                 | N                                     | N                             | 007-FR-031, no partner                                                       | No                                       |
| C20 Nutrition per recipe (USDA)       | Y                                 | Y                                     | Y                             | 001-FR-007, 003                                                              | Yes                                      |
| C21 Nutrition goals                   | Y [Inference]                     | Y, plus trainer plans                 | Y                             | 009-FR-036 to FR-038                                                         | No                                       |
| C22 AI generation and changes         | Limited(3)                        | Own key only [Inference]              | Limited(300), then own key    | 005, 006, 009                                                                | No                                       |
| C24 Offline                           | Y                                 | Y                                     | Y                             | 019                                                                          | Partial. Offline start blocked on OQ-1   |
| C25 Platforms                         | Web, iOS, Android                 | Same                                  | Same                          | 001-FR-044                                                                   | Yes                                      |
| C26 Creators, courses, chef sales     | ? (bought per item)               | ?                                     | ?                             | 012, 013, 018                                                                | No. 015 stopped at the owner's stop line |
| C27 Ads on Free                       | N                                 | N                                     | N                             | 018 refuses display ads at v1                                                | Yes                                      |

### 3.3 What beta will lack against launch

From `inventory.md` section c. Of 104 capability rows, 30 are shipped in this branch, 11 partial, 57 specced only,
2 stopped (015) and 4 blocked. "Shipped" means in the branch tree, not deployed.

- **Planned for beta, not yet built:** URL and file import, the import chooser, Instagram caption import, recipe-text
  paste, the meal planner (006), grocery lists (007), step-by-step cooking mode with countdown timers (008), and photo
  OCR (011). Bulk import is parked on branch `fix/im-b3`.
- **Kept out of beta by the launch plan:** all AI (005), nutrition goals (009), subscriptions and billing (010),
  creator profiles (012), cooking school (013), notifications (014).
- **Written after the launch plan, counted at launch:** 016 legal, 017 ReciMe parity (video import, share sheet,
  extension, importers, export screen, aisles, household, voice, unit toggle), 018 chef marketplace, 019 offline
  start, 020 content source check. Dependencies: 015 is stopped at the owner's stop line. 019 offline start waits on
  OQ-1. Household seats wait on the 010 and 017 conflict.

**Beta today against the competitors.** The shipped core (recipe editing, collections, discovery, ratings, USDA
nutrition, scaling, keep-awake, paste a list) is roughly what a free recipe box offers. Beta has no URL import, no
video import, no planner and no grocery list. Every comparison below uses the launch set, as ruled. Read it as "what
we will offer", not "what we offer now".

---

## 4. Competitor feature and free-plan matrix

Full rows, quotes and URLs: `mv2/compSubs.md` and `mv2/compIndie.md`. This table keeps the facts that decide the
comparison.

### 4.1 Price, free plan and paywall

| App                        | Price (US)                                                                                                                            | Free plan includes                                                                                                                                                             | Behind the paywall                                                                                                                                        | AI and how it is priced                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ReciMe**                 | Plus $39.99 a year [P help center]. App Store IAPs $29.99 to $59.99. Monthly price not on any primary page [Unconfirmed]. 7-day trial | "up to 5 recipe imports per week", manual recipes, aisle-sorted lists, weekly meal plan, cookbooks [P]                                                                         | Unlimited imports incl. Instagram and TikTok, cookbook and handwriting scan, nutrition (beta), cooking mode, unit converter, PDF export, AI assistant [P] | "Ask ReciMe, your AI assistant" inside Plus [P]. No separate tier                                                                                                            |
| **Samsung Food**           | Food+ $6.99 a month, $59.99 a year [P App Store]                                                                                      | 240,000 public recipes, save from any site, weekly planner, shared shopping lists, 23 retailers, nutrition. Plan recommendations 3 days a week (2024) [P]. 3 photo imports [S] | "AI-personalized weekly meal plans", servings and swaps, Smart Cooking Mode, pantry, nutrition tracking [P]                                               | AI inside Food+ [P]. One paid tier                                                                                                                                           |
| **Plan to Eat**            | $5.95 a month, $49 a year (App Store $54.99). 14-day trial, no card [P]                                                               | None. "Why isn't there a free plan?" [P]                                                                                                                                       | Everything: clipper incl. Instagram and TikTok, photo scan, bulk import from Paprika and others, nutrition, leftovers [P]                                 | AI ingredient swaps, Beginner Mode, chatbot, AI vision reel import, AI nutrition [P blog and release notes]. Inside the one plan [Inference]. The App Store text names no AI |
| **NYT Cooking**            | $4.99 to $7.00 a period, $54.99 to $69.99 a year [P]                                                                                  | An unnumbered "selection" of recipes, Recipe Box saves, public notes. Ads on Play [P]                                                                                          | All recipes, folders, search, import from other sites, private notes, Cook Mode [P]                                                                       | None found [P]                                                                                                                                                               |
| **AnyList**                | Complete $9.99 a year, household $14.99 a year [P]                                                                                    | Lists, sharing, store ordering, recipes, merge of similar items, cooking mode, "Limit 5" web imports in total [P]                                                              | Unlimited import, scaling, photos, meal planning, web and Mac apps [P]                                                                                    | None [P]                                                                                                                                                                     |
| **Copy Me That**           | $1 a month, $12 a year, $65 lifetime [P]                                                                                              | "with all of its features, is free up to 40 recipes" [P]                                                                                                                       | Unlimited recipes only [P]                                                                                                                                | None [P]                                                                                                                                                                     |
| **Tasty**                  | Tasty+ $3.99 a month, $34.99 a year [P]                                                                                               | 10,000+ recipes, cooking mode, Walmart checkout, scaling [P]                                                                                                                   | Not confirmed (site unreachable)                                                                                                                          | "AI Botatouille: Powered by ChatGPT API". Tier unknown [P listing]                                                                                                           |
| **America's Test Kitchen** | $9.99 a month, $49.99 a year. Classes add-on [P]                                                                                      | None in the app [P]                                                                                                                                                            | Everything [P]                                                                                                                                            | None [P]                                                                                                                                                                     |
| **SideChef**               | $4.99 a month, $49.99 a year, 7-day trial [P]                                                                                         | 11,000+ recipes, planner, grocery list, retailer checkout [P]                                                                                                                  | Premium recipes, 800 classes [P]                                                                                                                          | RecipeGen AI beta (2024). Tier not stated [P]                                                                                                                                |
| **Kitchen Stories**        | 79.99 euro a year, 7.99 euro a month. US IAP $6.99 to $79.99 [P]                                                                      | 7,500+ recipes, cooking mode. Ads [P]                                                                                                                                          | Web and social saves, ingredient search, personal feed [P]                                                                                                | None named [P]                                                                                                                                                               |
| **Cookidoo**               | $65 a year ($74.99 in iOS app). 30-day trial [P]                                                                                      | Not stated                                                                                                                                                                     | All recipes, planner, created recipes [P]                                                                                                                 | AI assistant rolling out from 21 Sep 2026. Pricing link not stated [P]                                                                                                       |
| **Paprika 3**              | One-time per platform: iOS $4.99, Android $4.99, Mac $29.99, Windows $29.99 [P]                                                       | Android and Windows: all features, 50 recipes, no sync [P]. iOS and Mac paid upfront                                                                                           | Unlimited recipes and sync                                                                                                                                | None. Paprika 4 adds social import, scan, USDA nutrition and family logins, then a subscription at an unpublished price [P]                                                  |
| **Mela**                   | One-time: iOS $6.99, Mac $14.99 [P]                                                                                                   | Free download, cap not published [Unconfirmed]                                                                                                                                 | "all features"                                                                                                                                            | On-device import only [P]                                                                                                                                                    |
| **Pestle**                 | $2.99 a month, $24.99 a year, lifetime $39.99 or $49.99 [P]                                                                           | 15 recipes [S]                                                                                                                                                                 | Unlimited recipes                                                                                                                                         | Apple Intelligence on device [P]                                                                                                                                             |
| **Crouton**                | Plus $24.99 one-time. Discover $1.99 a month, $14.99 a year [P]                                                                       | 5 or 20 recipes [Unconfirmed]                                                                                                                                                  | Plus removes the cap. Discover adds AI import and substitutions [P, S]                                                                                    | AI in a separate cheaper subscription [P]                                                                                                                                    |
| **Recipe Keeper**          | Pro one-time: iOS $19.99, Mac $29.99, Android $19.99 [P]                                                                              | 20 recipes [S]                                                                                                                                                                 | Unlimited                                                                                                                                                 | None [P]                                                                                                                                                                     |
| **Honeydew**               | $6.99 a month, $39.99 a year. Plus, Pro and Premium names in IAPs [P]                                                                 | "a limited number of recipes" [P]                                                                                                                                              | Unlimited saves, advanced planning, household [P]                                                                                                         | AI planner and assistant. Split between Plus and Pro not documented [Unconfirmed]                                                                                            |
| **Deglaze**                | Pro $49.99 a year [P developer blog]                                                                                                  | 5 imports a week, unlimited saves from its own search and feed, household sharing free [P]                                                                                     | Planner, aisle sort, timers, scaling, AI assistant connector [P]                                                                                          | Links the cook's own ChatGPT or Claude inside Pro [P]                                                                                                                        |
| **Mealie**                 | Free, open source, self-hosted [P]                                                                                                    | Everything, no cap                                                                                                                                                             | None                                                                                                                                                      | Bring your own key, "any OpenAI-compatible API" [P]                                                                                                                          |
| **Ollie**                  | Free, $25 a month, $100 a month [P]                                                                                                   | 50 AI messages a month [P]                                                                                                                                                     | 150 or 1,000 messages [P]                                                                                                                                 | AI-native message tiers                                                                                                                                                      |
| **Mealime**                | Closed 21 Oct 2026 [P]                                                                                                                |                                                                                                                                                                                |                                                                                                                                                           |                                                                                                                                                                              |

### 4.2 Coverage scores [D]

Scoring: 22 functional rows (C01 to C05, C07 to C22, C24). Has it = 1, limited = 0.5, no = 0. Unknown cells ("?")
are left out, and the count of unknowns is shown. Leaving unknowns out lowers a competitor's score, so the price per
row figures below lean in Pro's favour.

| Plan                                            | Score    | Known rows | Unknown | Yearly price | Price per covered row |
| ----------------------------------------------- | -------- | ---------- | ------- | ------------ | --------------------- |
| Commise Free                                    | 16.5     | 21         | 1       | $0           | n/a                   |
| **Commise Pro**                                 | **17.5** | 21         | 1       | $99.99       | **$5.71**             |
| Commise Pro with AI                             | 19.5     | 21         | 1       | $199.99      | $10.26                |
| Samsung Food+                                   | 17.0     | 17         | 5       | $59.99       | $3.53                 |
| Plan to Eat                                     | 16.5     | 20         | 2       | $49.00       | $2.97                 |
| ReciMe Plus                                     | 14.5     | 17         | 5       | $39.99       | $2.76                 |
| Deglaze Pro                                     | 14.5     | 19         | 3       | $49.99       | $3.45                 |
| Paprika 3 (all four platforms, one-time $69.96) | 13.0     | 22         | 0       | one-time     | n/a                   |
| Copy Me That Premium                            | 12.5     | 20         | 2       | $12.00       | $0.96                 |
| AnyList Complete                                | 11.0     | 18         | 4       | $14.99       | $1.36                 |
| Copy Me That Free (40 recipes)                  | 11.5     | 20         | 2       | $0           | n/a                   |
| Samsung Food Free                               | 10.5     | 17         | 5       | $0           | n/a                   |
| Deglaze Free                                    | 9.0      | 19         | 3       | $0           | n/a                   |
| AnyList Free                                    | 8.5      | 18         | 4       | $0           | n/a                   |
| ReciMe Free                                     | 7.0      | 16         | 6       | $0           | n/a                   |
| Plan to Eat (no free plan)                      | 0        | 22         | 0       | $0           | n/a                   |

A row count treats every row as equal. A cook does not. This is a breadth measure, not a value measure. It is not
the headline. The stack view in section 7 is.

---

## 5. Premise (a): Pro matches competitor paid plans like for like

The owner's statement: "our Pro is the equivalent subscription match to all the other services" [R].

### 5.1 Row by row [D]

Rows unknown on either side are skipped.

| Pro against                | Pro has more                                                                     | Same | Pro has less                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------- |
| ReciMe Plus ($39.99)       | 3: bulk import and export (C05), public catalog (C08), nutrition goals (C21)     | 12   | 2: grocery ordering (C19), AI (C22)                                                           |
| Samsung Food+ ($59.99)     | 0                                                                                | 11   | 5: AI meal plans (C14), use-by planning (C15), pantry (C16), grocery ordering (C19), AI (C22) |
| Plan to Eat ($49)          | 3: public catalog (C08), single-slot AI suggestions (C14), nutrition goals (C21) | 14   | 2: leftovers planning (C15), AI (C22)                                                         |
| AnyList Complete ($14.99)  | 6: C08, C14, C16, C20, C21, C22                                                  | 10   | 1: grocery ordering (C19)                                                                     |
| Copy Me That Premium ($12) | 5: C12, C14, C21, C22, C24                                                       | 14   | 0                                                                                             |
| Deglaze Pro ($49.99)       | 2: pantry flag (C16), nutrition goals (C21)                                      | 15   | 1: AI (C22)                                                                                   |
| Paprika 3 (one-time)       | 7: video (C02), scan (C03), catalog (C08), C14, nutrition (C20), C21, C22        | 13   | 1: pantry (C16)                                                                               |

Samsung Food+ has five rows Samsung does not document (video import, capture surfaces, export, private storage,
offline). Pro may be ahead on some of them. They cannot be scored.

### 5.2 Where Pro is genuinely ahead, from the specs

These are differences the row scores understate, each tied to a spec and to competitor evidence:

- **Web parity.** ReciMe's web app lists Meal Plans and Grocery Lists as "Coming Soon" [P]. Our specs make
  single-platform work a defect (001-FR-044a) [R].
- **Portability.** ReciMe states "We do not offer any 'sharing' functionality" [P], and its staff say there is no bulk
  import and no export (`needs.md`, r/recime, [V-grade forum]). Our specs include migration from Paprika, AnyList,
  Copy Me That and ReciMe, and a lossless round-trip export (017-FR-016 to FR-020).
- **Nutrition you can check.** ReciMe calls its nutrition "still in beta" [P]. Ours is USDA-backed with an honest
  "incomplete" flag (001-FR-007, ADR-0021), and it ships today.
- **No ads.** NYT Cooking and Kitchen Stories show ads [P]. We refuse display ads at v1 (018) [R].
- **Trainer nutrition plans** (009-FR-038). No competitor checked offers this. It is a niche row.

### 5.3 Where Pro is behind

- **AI.** ReciMe Plus, Samsung Food+, Plan to Eat, Deglaze Pro and Honeydew all include AI in their one paid plan
  [P]. Pro includes no platform AI. Its only AI is the cook's own key, and few cooks hold a developer API key
  (`freeTierAiResearch.md` section 3.7: no uptake data anywhere, GAP). On this row, Pro is less than every AI-carrying
  competitor at 40% to 80% of the price.
- **Pro gets fewer AI uses than Free.** Free gets 3 a month. Pro gets 0 [R]. A Free cook who upgrades to Pro loses
  their AI. This looks like a packaging defect, not a positioning choice. Recommend the owner rule on it.
- **Grocery ordering.** Samsung Food (23 retailers), NYT Cooking (Instacart), AnyList, Tasty and SideChef offer it [P].
  We offer it on no plan until a store partner exists [R].
- **Pantry and use-by planning.** Samsung Food+ and Paprika have a real pantry [P]. We spec only a 7-day "already
  have" flag (007-FR-029).
- **Household.** Samsung Food, AnyList, Deglaze (free) and Paprika 4 share across a household [P]. Our household plan
  is "?" until the seat-count conflict between 017-FR-034 and 010 is ruled.

### 5.4 Verdict on premise (a)

**Mostly holds on breadth. Does not hold on AI.** Pro is a fair like-for-like match for ReciMe Plus, Plan to Eat and
Deglaze Pro on capture, library, planning and lists, and it is ahead on portability, web parity and checkable
nutrition. It is behind Samsung Food+, and behind every AI-carrying paid plan on AI, at 1.7 to 2.5 times their price.
It is a match only once beta is behind us: today's beta has none of the capture, planning or list features.

---

## 6. Premise (b): no competitor sells an AI tier like Pro with AI

The owner's statement: "Pro with AI is an offering other apps don't have" [R].

### 6.1 What the evidence shows

| App                                                             | How it sells AI                                                                                           | Source                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Samsung Food                                                    | "AI-personalized weekly meal plans" inside Food+ at $6.99 a month. Use-by-date planning. Vision AI pantry | [P] App Store, Samsung newsroom 29 Aug 2024 |
| ReciMe                                                          | "Ask ReciMe, your AI assistant" inside Plus at $39.99 a year                                              | [P] help center                             |
| Plan to Eat                                                     | AI swaps, Beginner Mode, chatbot, AI vision import, AI nutrition, in its one plan                         | [P] blog 19 Nov 2025, release notes 2026    |
| Deglaze                                                         | Connects the cook's own ChatGPT or Claude inside Pro ($49.99 a year)                                      | [P] App Store                               |
| Honeydew                                                        | "AI meal planner". Sells Plus, Pro and Premium. What Pro adds is not documented                           | [P] list, [Unconfirmed] split               |
| Crouton                                                         | AI import in Discover ($14.99 a year), which is cheaper than its non-AI Plus unlock                       | [P], [S]                                    |
| Kitchen Stories                                                 | "Generate perfect dishes from leftovers to reduce food waste". Tier not stated                            | [P] App Store                               |
| Ollie                                                           | AI-native. $25 and $100 a month, both AI, differing by message count                                      | [P] ollie.ai/pricing                        |
| DishGen                                                         | AI-native credit tiers. Premium $72 a year, Pro $159 a year                                               | [P]                                         |
| MyFitnessPal                                                    | Premium+ above Premium adds meal planning. AI Coach is in both                                            | [P] listing, [S] 9to5Mac 16 Jun 2026        |
| Mealie                                                          | Bring your own key                                                                                        | [P] docs                                    |
| NYT Cooking, AnyList, Copy Me That, ATK, Paprika, Recipe Keeper | No AI                                                                                                     | [P]                                         |

### 6.2 Verdict on premise (b)

**The tier shape holds. The feature claim does not.**

- No recipe or meal-planning app found sells a non-AI paid plan with a dearer AI plan above it. That shape is ours
  alone among the 30+ apps checked [P across listings].
- Honeydew is the one open case. If its "Pro" is an AI tier above "Plus", the claim fails [Unconfirmed].
- The features inside Pro with AI are not unique. AI meal plans (Samsung Food+, Honeydew), leftover and use-by help
  (Samsung Food+, Kitchen Stories, Plan to Eat) and AI assistants (ReciMe, Plan to Eat, Tasty) are already sold, almost
  always inside one plan that costs $40 to $60 a year.
- AI-native apps already sell AI at or above our price: Ollie at $25 and $100 a month [P].
- Fair wording: "Few recipe apps, possibly none, put AI in its own higher tier." Not: "No other app offers AI meal
  plans or food-waste help."

**Why the shape may be rare.** The wider market is moving AI into base plans, not above them. Duolingo: "we will move
Video Call to be part of the Super Duolingo tier" [P, Q4 FY25 letter, 26 Feb 2026]. Microsoft added Copilot to
Personal and Family for $3 more and kept no-AI "Classic" plans [P, 16 Jan 2025]. Notion retired its stand-alone AI
add-on for new buyers [Unconfirmed]. Being alone in a shape is not proof the shape works.

---

## 7. What Pro's price means once features are matched

### 7.1 The price ratio, kept

|                                             | Pro $99.99 is  |
| ------------------------------------------- | -------------- |
| ReciMe Plus $39.99                          | 2.50 times [D] |
| Plan to Eat $49                             | 2.04 times [D] |
| Samsung Food+ $59.99                        | 1.67 times [D] |
| NYT Cooking top SKU $69.99                  | 1.43 times [D] |
| RevenueCat Health and Fitness median $39.94 | 2.50 times [D] |

### 7.2 Stacks that cover Pro's launch jobs [D]

The jobs: capture from web, video and scan, an unlimited library, a planner, a merged list, a shared list, nutrition,
and web plus iOS plus Android.

| Stack                                    | Yearly cost | Pro is                       | Pro with AI is | What the stack has that Pro lacks     |
| ---------------------------------------- | ----------- | ---------------------------- | -------------- | ------------------------------------- |
| Plan to Eat alone                        | $49.00      | 2.04 times                   | 4.08 times     | AI suite, leftovers                   |
| Deglaze Pro alone (household free)       | $49.99      | 2.00 times                   | 4.00 times     | AI connector                          |
| ReciMe Plus + AnyList Complete household | $54.98      | 1.82 times                   | 3.64 times     | AI assistant, grocery ordering        |
| Samsung Food+ alone                      | $59.99      | 1.67 times                   | 3.33 times     | AI meal plans, pantry, 23 retailers   |
| Paprika 3 on all four platforms          | $69.96 once | 1.43 times the one-time cost | 2.86 times     | Pantry. No video or scan import in v3 |

**Which competitors Pro replaces for a cook who pays for several apps.** A cook paying for ReciMe Plus (capture) and
AnyList Complete household (shared lists, planner) would replace both with Pro at 1.82 times their combined cost. A
cook paying for NYT Cooking is buying editorial recipes, which we do not have, so Pro does not replace it. How many
cooks pay for more than one recipe app is **GAP**. The only signal is one review: "paying 4+ subscriptions to do so is
frankly silly" (Mealime, App Store, 2024, `needs.md` rank 7, [V-grade]). That is an anecdote, not a rate.

### 7.3 Reading

Feature matching narrows the gap but does not close it. On breadth, Pro costs $5.71 per covered row against $0.96 to
$3.53 for paid competitors [D]. On jobs, one competitor app at $49 to $60 already covers Pro's core, and it includes
AI that Pro lacks. The case for Pro at $99.99 rests on what the row counts cannot price: portability, web parity, data
you can check, and no ads. No cited data shows cooks pay a premium for those. **Price elasticity in this category is
still GAP** (v1 section 10).

---

## 8. Our Free plan against competitor free plans, and the conversion proxy

### 8.1 The comparison [D]

| Free plan                           | Score (of known rows) | Main cap                                              | Step up to first paid plan                         |
| ----------------------------------- | --------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| **Commise Free**                    | **16.5 of 21**        | 50 private recipes. Bulk 200 a day. 3 AI uses a month | **+1.0 row** (bulk 1,000 a day, unlimited private) |
| Copy Me That Free                   | 11.5 of 20            | 40 recipes in total                                   | +1.0 row (unlimited recipes)                       |
| Samsung Food Free                   | 10.5 of 17            | 3-day plan recommendations, 3 photo imports           | +6.5 rows                                          |
| Deglaze Free                        | 9.0 of 19             | 5 imports a week                                      | +5.5 rows                                          |
| AnyList Free                        | 8.5 of 18             | 5 web imports in total                                | +2.5 rows                                          |
| ReciMe Free                         | 7.0 of 16             | 5 imports a week                                      | +6.5 rows                                          |
| Paprika 3 (Android, Windows)        | all features          | 50 recipes, no sync                                   | unlimited and sync                                 |
| Pestle, Recipe Keeper, Crouton      |                       | 15 [S], 20 [S], 5 or 20 [Unconfirmed] recipes         | unlimited                                          |
| Plan to Eat, America's Test Kitchen | no free plan          |                                                       | everything                                         |

**Readings.**

1. Our Free plan gives away the rows ReciMe, Samsung Food and Deglaze charge for: unlimited capture channels,
   cooking mode, unit conversion, scan import, nutrition and a planner. It is the broadest free plan in the set.
2. The step from Free to Pro is the smallest of any freemium app with a broad free plan. Only Copy Me That has an
   equally small step, and its whole paywall is a recipe cap.
3. Our real paywall is also a recipe cap. Every recipe a Free cook keeps from a cookbook scan, a paid site, a
   rights-limited link or a bulk import must be private and uses one of 50 slots (004-FR-028) [R]. Video imports
   probably do too [Inference]. So for a cook who captures from elsewhere, Free behaves like Paprika's 50-recipe free
   version or Copy Me That's 40. For a cook who writes and publishes their own recipes, Free has no cap.
4. ReciMe keeps every saved recipe private on every plan [P]. Our Free plan is public by default with 50 private
   slots. `needs.md` flags this as a trust tension (FR-019, "know up front what keeping recipes will cost").

### 8.2 What that does to the conversion proxy

| Evidence                                          | What it says                              | Source                                                                                                   |
| ------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Freemium vs hard paywall, day-35 download-to-paid | 2.1% against 10.7%                        | [S] RevenueCat 2026, via `conversionStudy.md` section 0                                                  |
| Freemium distribution, day 35                     | P10 0.3%, median 2.1%, P75 4.5%, P90 8.2% | [S] same                                                                                                 |
| ReciMe's first paywall year                       | about 0.4% of registered users paying     | [D] $60K ARR at about $40 against 400K users (SmartCompany, 18 Dec 2023), `conversionStudy.md` section 3 |
| Generosity within freemium vs conversion          | **GAP.** No study found                   |                                                                                                          |
| Fixing a specific pain vs conversion              | **GAP** (section 9)                       |                                                                                                          |

**Direction: down.** The cross-app gap between freemium and hard paywall says the more a free user gets, the less
often they pay. Our free plan sits at the generous end of freemium. Within freemium there is no gradient data, so no
factor is applied.

**What v2 does.** It replaces v1's single base (median) with a band:

| Paying share of cumulative registered users | Month 12 | Month 24                      |
| ------------------------------------------- | -------- | ----------------------------- |
| P10 (new floor)                             | 0.24%    | 0.16% to 0.20%                |
| ReciMe's first year (category data point)   | 0.4%     | 0.4% (held flat, [Inference]) |
| Median (v1 base, now the top of the band)   | 1.7%     | 1.1% to 1.4%                  |

Sources: `conversionStudy.md` section 6 [D on RevenueCat inputs]. The top quartile (4.5% at day 35) is no longer used
for our plan. It is still used at market level in SAM (section 10), because the market's paying share does not depend
on our free plan.

**What would move the band up.** A cap that bites earlier for heavy users, a Pro plan that includes some platform AI,
or our own cohort data. Each is the owner's call.

---

## 9. A crowded market with weak choices: how current apps serve the top needs

Source: `mv2/needs.md`, built from `docs/research/userNeeds/` (109 records), the two competitive docs, the owner
feedback register and the specs. **Desk research only. Nobody was interviewed or watched.** The app reviews were
filtered to 3 stars or fewer. Grades are the database's own: `validated` means S or M evidence, or V evidence from
three independent places. `reported` means less. A need holding any reported record is not called validated.

Evidence codes: S study or survey with method and sample. M industry survey with a commercial owner. V people's own
words. X expert writing.

### 9.1 How badly current apps serve the top needs

| Rank | Need                                                         | Grade                                                     | How current apps fail it (selected, with source type)                                                                                                                                                                                                                                     | Evidence against                                                                                                                                   | Commise feature (FR)                                                                                                                                                     | Status                                                              |
| ---- | ------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1    | Reach the recipe and the step without the page fighting back | Validated                                                 | Mostly websites: 70.6% avoid recipe sites as frustrating (M, Allspice 2026, n=354, vendor-run). In apps (V): Samsung Food "full page ads that take over every 10-15 seconds", NYT Cooking shows ads to paying subscribers, ReciMe freezes on scroll                                       | Apps are the workaround for websites. Allspice is vendor-run                                                                                       | No display ads (018). Ingredients and steps never hidden (owner rulings R1 to R3). Offline (019)                                                                         | Ad-free detail and keep-awake shipped. Offline start blocked (OQ-1) |
| 2    | Trust that the recipe, the list and the filters are correct  | All five validated                                        | Import errors in five apps (V): ReciMe "the steps had become distorted", Crouton reads "1 and 1/2 cups" as 1/2 cup, Samsung Food amounts "do not match". Lists drop servings or items in four apps. ReciMe nutrition 86 kcal against about 567 on one recipe (reportedly patched)         | Frequency unknown. The 2026 cluster is mostly one company. Paprika and Mealime total amounts correctly                                             | Draft review with confidence (004-FR-015), two-engine parse (ADR-0026), cook-reviewed matches (ADR-0071), versions (001-FR-007b), USDA nutrition with an incomplete flag | Several shipped                                                     |
| 3    | Be safe for allergies and diets                              | **Not validated as a whole** (MP-006 and CK-018 reported) | Filters that leak (V, five apps): Tasty suggests gluten to a gluten-free user, Kitchen Stories shows shrimp under "meatless", Mealime cannot add a custom allergen                                                                                                                        | Other Mealime reviewers praise its filters. Counts are keyword hits. Several quotes are old                                                        | Diet filter (001-FR-006), diet criteria in AI (005-FR-016). **No personal avoid list or filter guarantee in any FR**                                                     | Coverage gap                                                        |
| 4    | Decide tonight's meal within real limits                     | All nine validated                                        | Repetition is a stated cancel reason (V): Mealime "we're going to cancel", Eat This Much repeats with variety settings on. ReciMe's "quick" filter shows long recipes                                                                                                                     | **Strong.** About six in ten non-planners do not find deciding a burden (S, Ducrot 2017, n=40,554). Meal kits and Mealime are praised for this job | Time and ingredient filters (001-FR-006), AI generation (005-FR-016), slot suggestions (006-FR-025), auto plans (006-FR-026, Pro with AI only)                           | Search shipped. AI and planner specced                              |
| 5    | Keep every recipe, find it again, never lose it              | All six validated                                         | Social import fails in four apps (V): Paprika, ReciMe ("missed over half"), Mela, Pestle. Yummly taken offline (X). Mela sync "deleted all my data". ReciMe has no bulk import or export (V, staff on r/recime). Paywall is ReciMe's largest complaint bucket (about 40 posts, no method) | Many are content with a card box. ReciMe still holds 4.8 on 322K ratings                                                                           | URL, video, scan, share sheet, extension, migration, lossless export (004, 011, 017-FR-001 to FR-020)                                                                    | Paste and export API shipped. Rest specced                          |
| 6    | The right fact at the right moment while cooking             | Not validated as a whole (CK-029 reported)                | Kitchen Stories removed the side-by-side ingredients. Pestle hides amounts behind a tap. Mealime loses the timer. Cookidoo removed the full view (V)                                                                                                                                      | Apps already keep the screen on and are praised. Amounts in steps did not cut errors (S, Buykx 2013, 24 cooks)                                     | Cooking mode (008), multiple timers, step ingredients, voice (017-FR-021 to FR-024)                                                                                      | Keep-awake, check-off shipped. Rest specced                         |
| 6+   | Cook with confidence                                         | Not validated as a whole                                  | **Almost no app-specific evidence**                                                                                                                                                                                                                                                       | 62% call themselves very confident (M, Instacart 2025)                                                                                             | Cooking school (013). **No FR for risky steps or rescue**                                                                                                                | Specced                                                             |
| 7    | Share the household work with one trusted list               | All five validated                                        | "The single most repeated complaint in shared-list app reviews" (V, AnyList, Out of Milk, OurGroceries, Bring!, Samsung Food, 2018 to 2026). Mela and Crouton share only on Apple. NYT has no shared folders                                                                              | A Plan to Eat household says sharing works. Frequency unknown                                                                                      | Household model (017-FR-030 to FR-034), Circles (011-FR-031)                                                                                                             | Specced. Plan "?"                                                   |
| 8    | Recover fast when the day or the store changes               | Not validated as a whole (GL-017 reported)                | Paprika makes rescheduling slow. Samsung Food's send-to-retailer "no longer works" (V)                                                                                                                                                                                                    | 70% kept to their plan by moving meals (M, vendor, n=120)                                                                                          | Move or swap entries (006-FR-023a)                                                                                                                                       | Specced                                                             |
| 9    | Use what is at home without tracking stock                   | All four validated                                        | Samsung Food's paid ingredient search does not rank by what you have. Paprika pantry needs manual entry (V)                                                                                                                                                                               | Checking stock was not linked to less waste (S, Janssens 2019, n=211)                                                                              | "Already have" flag (007-FR-029), waste optimization (006-FR-027)                                                                                                        | Specced                                                             |
| 10   | Make every recipe fit the cook                               | All five validated                                        | ReciMe "locks things like basic unit conversion behind a premium subscription" (V). Cookidoo removed metric for some users. Mealime scales to 2, 4 or 6 only                                                                                                                              | NYT's converter is praised                                                                                                                         | Scaling (017-FR-035), unit toggle (017-FR-026)                                                                                                                           | Scaling shipped                                                     |
| 11   | A complete, merged list in store order                       | All four validated                                        | NYT Cooking "1 stick of butter written in four different places". ReciMe's merge is iOS-only (staff). AnyList and OurGroceries fix the order (V)                                                                                                                                          | Paprika and Mealime merge matching names                                                                                                           | Merged list (007-FR-028), aisles (017-FR-028, FR-029)                                                                                                                    | Specced                                                             |
| 12   | Know the cost before committing                              | All four validated                                        | No prices in list apps (V): Bring!, AnyList, OurGroceries. No app shows a plan's cost                                                                                                                                                                                                     | Out of Milk has prices. Budget may be stated more than felt                                                                                        | **No FR for price or cost**                                                                                                                                              | Coverage gap                                                        |

### 9.2 Where our differentiation is strong and where it is weak

**Strong** (a named competitor fails in a documented way, and we have a concrete FR or code):

1. **Data you can trust** (rank 2). Failures span five apps and several years. Several of our answers are already in
   code. This is the strongest position.
2. **No ads** (rank 1). A whole complaint class we avoid by a standing decision.
3. **Portability** (rank 5). ReciMe has no export or bulk import. We spec both, but only the export API ships.
4. **Merged, store-ordered lists** (rank 11) and **web parity**. Specced only.
5. **Household sharing** (rank 7). The most repeated complaint in shared-list apps. Specced only, plan unresolved.

**Weak:**

1. **Allergy safety** (rank 3). Ranked third, with no FR for an avoid list or a guarantee. The largest gap between
   rank and coverage.
2. **Cost** (rank 12). No FR at all.
3. **Deciding tonight** (rank 4). Real need, strong counter-evidence, and our answer (AI, planner) is not built.
4. **Social video capture** (rank 5). It is ReciMe's wedge and our largest unbuilt item.
5. **Our own trust tension.** Public by default with 50 private slots, against ReciMe's private-by-default.

**Plain answer to the owner's point.** Supported: current apps leave specific, real needs unmet, across many apps and
years. Not supported: that apps are weak overall. The same apps rate 4.8 to 4.9 on hundreds of thousands of ratings,
and the complaints come from low-star reviews and self-selected forums. Not supported at all: that fixing a need makes
people switch, stay or pay.

### 9.3 How the differentiation affects the numbers

| Possible effect                                | Cited market data?                                                                                                           | Change to the model                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Higher conversion from solving a specific pain | **GAP.** No source ties a fix in a recipe app to conversion                                                                  | None                                                       |
| Better retention from solving a specific pain  | **GAP.** Nearest: meal-kit 6-month retention 16% to 28% (Second Measure 2016, no method, "not M" in the database)            | None                                                       |
| Switching from competitors                     | **GAP.** Nearest: ReciMe complaint buckets on r/recime, approximate counts, no method. Paprika is the most cited destination | None                                                       |
| Share of a crowded market                      | **GAP.** No revenue-concentration data beyond the Sensor Tower proxy                                                         | None                                                       |
| Need sizing (not uplift)                       | 43% of French adults never plan meals, 2.53% of planners take ideas from apps (S, Ducrot 2017)                               | A ceiling on what is asked of an app. Not used as an input |

Three figures in `docs/competitive/02GapAnalysisAndStrategy.md` have no source and must not be used: "AI meal planners
understate real grocery cost by 21 to 29%", "daily logging retains far better than weekly planning", and "AnyList
sustains 4.9 stars on 5 people and $120K of funding" (`needs.md` section b).

**No uplift is added on judgement.** The differentiation is a reason to run the soft-launch tests in section 13, not
an input to SAM or SOM.

---

## 10. Market size and the Pro with AI segment

### 10.1 Unchanged from v1

| Leg                                                            | US paid recipe and meal-planning spend a year |
| -------------------------------------------------------------- | --------------------------------------------- |
| Top-down, narrow (Market.us US 2024)                           | $239M [S]                                     |
| Bottom-up at today's category prices                           | $21M to $119M [D]                             |
| Observed: top three recipe apps' app-store spend + NYT Cooking | about $47M to $104M [D]                       |
| **Reconciled US paid market**                                  | **about $50M to $250M**                       |

Chain [D]: 134.79M households [P, FRED] × 91% smartphone [P, Pew 2026] = 122.7M. × 20% to 36% recipe-app use [S] =
24.5M to 44.2M. × 2.1% to 4.5% paying [S, proxy] = **515k to 1.99M paying households**. The broad analyst family
($1.6B to $1.7B for the US) includes advertising and is not addressable. Full detail: v1 sections 1 to 3.

### 10.2 Pro with AI as an add-on segment

**Attach-rate evidence for an AI tier above a paid base:**

| Analog                                           | Attach                                                                                                  | Source                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Duolingo Max (AI tier above Super)               | "Max is now 9% of our subscribers" after about 2.5 years. "It's underperforming our lofty expectations" | [S] Q3 2025 earnings call auto-transcript, 5 Nov 2025. No filing states a share. Earlier calls about 5% to 8% [Unconfirmed] |
| Google One AI plan ($19.99, above 2 TB at $9.99) | "millions" of 150M subscribers. Read as 2M or more: **about 1.3%**                                      | [S] Reuters via MarketScreener, 15 May 2025. The 1.3% is [Inference]                                                        |
| ChatGPT paying users                             | 50M of 900M weekly users, about 5.6%                                                                    | [S] TechCrunch, 27 Feb 2026. Free to paid, not a tier above paid. Context only                                              |
| Recipe-app AI attach                             | **GAP**                                                                                                 |                                                                                                                             |

**Counter-signals:** Duolingo is moving Video Call into Super [P]. Microsoft kept no-AI Classic plans [P]. AI apps earn
41% more per payer ($30.16 against $21.37 a year) but keep annual payers worse (21.1% against 30.7%) [S, RevenueCat
2026 via TechCrunch]. The `freeTierAiResearch.md` surveys found half of US smartphone owners would not pay extra for AI
[S, CNET/YouGov].

**Segment size [D]:**

|                                            | Low               | High              |
| ------------------------------------------ | ----------------- | ----------------- |
| Attach rate                                | 1.3% (Google One) | 9% (Duolingo Max) |
| Paying households (market proxy)           | 515k              | 1.99M             |
| Pro with AI households                     | 6.9k              | 179k              |
| Add-on value (uplift $100 a year over Pro) | **$0.69M**        | **$17.9M**        |
| Full Pro with AI revenue ($199.99)         | $1.37M            | $35.8M            |

The high end needs every paying recipe-app household to also accept our price, then 9% of them to take the AI tier.
The low end is the more defensible planning figure until our own data exists.

**A second segment this does not count.** Cooks who pay for AI-native meal planners (Ollie, DishGen) but not for a
recipe app. Its size is **GAP**. Ollie reports 50K+ families (Aug 2025) and about 90K mid-2026 [S], with no paying
split.

### 10.3 Revised SAM [D]

| SAM measure                                   | v1            | v2                        |
| --------------------------------------------- | ------------- | ------------------------- |
| At today's category prices                    | $21M to $119M | $21M to $119M (unchanged) |
| If those payers paid Pro yearly               | $52M to $199M | $52M to $199M (unchanged) |
| **At our prices, Pro plus a Pro with AI mix** | not computed  | **$52.2M to $216.6M**     |

What the new framing changes and what it does not. The owner's framing makes Pro a substitute for the same paid
plans, so the paying households are the same 515k to 1.99M. The framing does not show those households will pay 1.7
to 2.5 times today's price. "At our prices" still assumes they do. That is the elasticity GAP. The dollars the market
spends today are the category-price row.

Follow-on markets (v1 section 4, unchanged): UK, Canada and Australia add about 39% of US households. The EU adds
about 1.5 times but needs localisation.

---

## 11. Revised SOM, months 12 and 24, no paid budget [D]

Inputs: the v1 traction curves (unchanged, v1 section 7.2), the conversion band in section 8.2, and revenue per payer
of **$8.44 to $9.93 a month** (low: all yearly Pro with 1.3% on Pro with AI. High: 53% yearly and 47% monthly, with
9% on Pro with AI).

| Curve (registered users at m24)            | Month 12 MRR: P10 / ReciMe 0.4% / median       | Month 24 MRR: P10 / ReciMe 0.4% / median                   | Month 24 ARR range |
| ------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------- | ------------------ |
| Traction-low, RecipeIQ pace (18,000)       | $182 to $215 / $304 to $358 / $1,292 to $1,520 | $243 to $358 / $608 to $715 / $1,672 to $2,503             | $2.9K to $30.0K    |
| Traction-mid, ReciMe pre-breakout (34,286) | $347 to $409 / $579 to $681 / $2,461 to $2,894 | $463 to $681 / $1,158 to $1,362 / $3,184 to $4,767         | $5.6K to $57.2K    |
| Traction-high, ReciMe breakout (304,638)   | same as mid at m12                             | $4,116 to $6,051 / $10,289 to $12,103 / $28,295 to $42,359 | $49.4K to $508K    |

**Against the base rate.** RevenueCat: the median subscription app makes about $72 a month one year after launch, and
17.3% reach $1K a month within two years [S, v1 section 7.1]. On the P10 and ReciMe rows, even the mid curve stays
near or below $1K MRR at month 24. Only the median rate, or a breakout, clears it.

**Share of SAM.** Month-24 ARR of $2.9K to $508K is **0.001% to 0.97%** of the $52M to $217M SAM [D].

**Change from v1.** v1's "steady traction" SOM was $2K to $6K MRR at month 24. v2 is $0.2K to $4.8K on the low and
mid curves. The floor fell because a generous free plan points to the low end of freemium conversion. The ceiling fell
because cited AI-tier attach rates (1.3% to 9%) are lower than the mix v1 took from an earlier internal model (not published).

The paid-acquisition arithmetic in v1 section 8 is unchanged in method. At the lower revenue per payer it gets
slightly worse: LTV/CAC stays at or below about 1 at median conversion and sourced CPIs.

---

## 12. Carried from v1 without change

- Analyst reports: low grade, no checkable method, two families about 8 times apart (v1 section 1).
- Bottom-up chain and its stated gaps (v1 section 2).
- Observed spend from Sensor Tower, 2023 to 2025 (v1 section 3). Still the newest data: no 2026 post exists.
- Follow-on markets (v1 section 4).
- Growth comparables and curves, with the survivorship warning (v1 section 7).
- Acquisition benchmarks and LTV inputs (v1 section 8).
- Sources not to use (v1 section 11), plus the three unsourced figures in section 9.3 above.

---

## 13. Risks, uncertainties and next steps

### 13.1 The biggest uncertainties

1. **Willingness to pay $99.99 for a plan that matches $40 to $60 competitors.** Feature matching narrows the gap but
   leaves Pro at 1.4 to 2.0 times the cheapest covering stack, without the AI those stacks include. Elasticity: GAP.
2. **Whether a generous Free plan starves Pro.** The Free to Pro step is 1.0 row. The 50-slot cap is the only lever for
   most cooks. Generosity-to-conversion data: GAP.
3. **Whether an AI tier above a paid tier sells in recipes.** Nobody else sells this shape. The best analog (Duolingo
   Max, 9%) is being folded into the base tier.
4. **Launch scope against beta.** Every comparison assumes the full launch set. Beta has no capture, planner or list.
   Capture from social video is the category's proven wedge and our largest unbuilt item.
5. **Unmet needs do not yet translate into numbers.** No cited data links a fixed need to switching, retention or
   paying.

### 13.2 Product calls for the owner (my recommendations)

1. **Fix the Pro AI anomaly.** Pro gets 0 platform AI uses while Free gets 3. At minimum give Pro the same 3. Better,
   test Pro with a small allowance, because every AI-carrying competitor at $40 to $60 includes AI. Owner decision,
   with `cfo-1` for cost (the cost of 3 to 10 uses is small per `aiCostModel.md`).
2. **Decide the household plan.** It is rank 7 in the needs database and free at Deglaze and Samsung Food. Resolve
   the 017-FR-034 and 010 conflict before pricing is final.
3. **Close the two coverage gaps or say why not.** Allergen avoid list (rank 3) and cost (rank 12). Route to `pm-1`
   for spec work and `staff-ux-engineer` for the experience.
4. **Price test in the soft launch.** $59.99 against $99.99 yearly for Pro, as v1 proposed. Feature matching makes
   this more important, not less.
5. **Instrument the Free-to-Pro step.** Track slot exhaustion and the share of Free cooks who reach 50 private recipes.
   That is the paywall, and it is the one conversion input we can measure first. Route to `ts-1`.
6. **Do not market "the only app with AI meal plans".** It is false (Samsung Food+, Honeydew). "AI in its own tier"
   is true today but is not a benefit a cook buys.

### 13.3 What would raise confidence

- A paid Sensor Tower or Appfigures pull for the category (revenue totals and concentration, 2026 data).
- Honeydew's Plus and Pro split, to settle premise (b).
- Primary pages for Samsung Food (blocked), Tasty+ and ReciMe's monthly price.
- Our own soft-launch cohorts: day-35 paid share, slot exhaustion, Pro with AI take rate, and a price test.
- Interviews, which the needs database has never had, aimed at synthesis question 6: "Which of these problems do
  people pay to solve?"

Confidence: **Medium** on features and prices (primary pages, many "?" cells, beta far from launch). **Medium** on the
US market size (unchanged). **Low** on conversion, AI attach and SOM.
