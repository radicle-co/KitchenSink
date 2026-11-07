# Business Plan: Commise

## AI-Powered Cooking Platform — From Fridge to Table

**Date**: June 6, 2026 (last updated 2026-10-29)
**Status**: June 2026 draft, partly superseded. The decisions in force are in [Current decisions (2026-10-29)](#current-decisions-2026-10-29). Sections marked "Superseded" are kept as history.
**App Name**: Commise
**Company Name**: TBD (in progress)
**Monorepo**: KitchenSink (internal codename)
**Related**: [Business research, 2026-10](./research/business/README.md), [Competitive analysis](./competitive/README.md), [V1 Launch Plan](../specs/v1-launch-plan.md), [AI Enhancement Plan](./ai-enhancement-plan.md). `competitive-analysis-v2.md` is corrupted. See the [competitive README](./competitive/README.md).

---

## Current decisions (2026-10-29)

These are the owner's business and product decisions of 2026-10-27 to 2026-10-29. They replace the June 2026 text
where the two differ. Each item links to the spec, ADR or research file that records it.

### Plans and prices

| Plan                  | Price                            | AI uses a month                       |
| --------------------- | -------------------------------- | ------------------------------------- |
| Free                  | None                             | 3                                     |
| Pro                   | $9.99 a month or $99.99 a year   | 30                                    |
| Pro with AI           | $19.99 a month or $199.99 a year | 300 (100 during the trial)            |
| Pro Household         | $14.99 a month or $149.99 a year | 30 for each member                    |
| Pro with AI Household | $29.99 a month or $299.99 a year | 300, one pool for the whole household |

- Every paid plan has a 14-day trial. A household holds up to 6 accounts.
- One call to the model is one AI use. A weekly meal plan made in one call is one use.
- Free keeps up to 50 private recipes. Paid plans have no limit.
- Sources: the [010 plan register](../specs/010-subscriptions/spec.md#plan-register),
  [005 FR-015a](../specs/005-ai-integration/spec.md) (one call is one use), the household rules in
  [017](../specs/017-recime-parity/spec.md) (FR-034l and FR-034n), and
  [ADR-0073](./architecture/decisions/0073-free-tier-private-slots.md) (50 private recipes).
- Price evidence: [priceEvaluation.md](./research/business/priceEvaluation.md) and
  [mv2/priceEvidence.md](./research/business/mv2/priceEvidence.md).

### Payments

Cooks pay through the App Store on iPhone, Google Play on Android, and Stripe on the web. RevenueCat joins the three
into one record of who has paid. Recorded in
[ADR-0075](./architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md). The evidence is in
[paymentDecisionBrief.md](./research/business/paymentDecisionBrief.md).

### Launch scope

Every feature spec ships at launch except [015 publishing rewards](../specs/015-publishing-rewards/spec.md) and
[018 chef program marketplace](../specs/018-chef-program-marketplace/spec.md). Those two follow after their blockers
clear. Beta can lack some features. This is an owner ruling of 2026-10-27. No spec records it yet.

### Positioning

- Pro is the like-for-like match to competitor subscriptions. It matches the features of Samsung Food+: a pantry with
  use-by dates, AI meal plans on Pro's 30 uses, and household sharing. AI waste optimization stays in Pro with AI only.
  See the [010 plan register](../specs/010-subscriptions/spec.md#plan-register).
- Pro with AI is an extra tier that competitors do not sell.
- Commise has no in-app ads on any plan.
- The competitor evidence is in [mv2/compSubs.md](./research/business/mv2/compSubs.md),
  [mv2/compIndie.md](./research/business/mv2/compIndie.md) and
  [marketAnalysisV2.md](./research/business/marketAnalysisV2.md).

### Growth

- The growth specs are 021 to 025:
    - [021 public discovery and sharing](../specs/021-public-discovery-and-sharing/spec.md)
    - [022 marketing site and waitlist](../specs/022-marketing-site-and-waitlist/spec.md)
    - [023 referrals and growth measurement](../specs/023-referrals-and-growth-measurement/spec.md)
    - 024 Cook with me. It is drafted on a separate branch, so it is not linked here yet.
    - [025 international launch](../specs/025-international-launch/spec.md)
- Visibility is aggressive from launch (owner, 2026-10-28). Paid acquisition, creators, PR and launch moments start at
  launch. They do not wait for conversion to pass a gate. A spend limit and payback rules control the cost.
- Ideas and their evidence: [acquisitionIdeas.md](./research/business/acquisitionIdeas.md) and
  [conversionIdeas.md](./research/business/conversionIdeas.md).

### Content review

At launch the founder reviews flagged content. A paid part-time backup covers for the founder. A half-time reviewer
is hired after review volume reaches a set trigger. Recorded in
[ADR-0076](./architecture/decisions/0076-founder-reviews-at-launch-with-a-paid-backup.md) and
[016](../specs/016-legal-compliance-framework/spec.md) (FR-053h and FR-053i).

### Recipe rights

- Cooks keep the copyright in what they write.
- A recipe imported from someone else's web page stays private, or shows to anyone as a linked facts card that points
  to the source. _(Amended 2026-11-03, owner ruling, ADR-0082: the facts of any recipe are free, so the card is open
  to signed-out readers. It stays `noindex` by house rule. A cook can publish their own "Adapted by you" version.
  Counsel review is owed before launch (`016-FR-050`).)_
- The research is [recipeOwnershipResearch.md](./research/business/recipeOwnershipResearch.md) and
  [linkedCardResearch.md](./research/business/linkedCardResearch.md). Both are research, not legal advice. The spec
  changes for these rulings (2026-10-29) are being written into specs 016, 020 and 021.

### Evidence rule

Market, conversion and growth figures come only from cited market data. Where no data exists, the figure is marked GAP
and gets a test, not a guess. See [conversionStudy.md](./research/business/conversionStudy.md) and the
[business research README](./research/business/README.md).

---

## 0. NAMING

### The Problem

- "KitchenSink" is the monorepo name, not the product. A different company ([trykitchensink.com](https://trykitchensink.com)) already has 13K downloads with that name.
- "Commise" is saturated: Commise® (commise.app), The Commise App, SousApp, Commise AI, plus generic AI "commise" positioning from Mise and others.
- **Chosen name: Commise** — distinctive, trademarkable, evokes "mise en place" (the French cooking term for having everything in its place before you start). "Com-" (together/complete) + "mise" (put in place). The act of preparing your kitchen to cook.

### Naming Criteria

| Criterion                     | Why                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| **Not "commise"**             | Saturated. 5+ competitors use it.                                                              |
| **Not "kitchen"**             | Overused (KitchenPal, KitchenSink competitor, Samsung Food/Whisk originally "Kitchen Stories") |
| **Made-up or whimsical**      | Paprika-style. Arbitrary = stronger trademark. Zero search competition.                        |
| **Evokes cooking/food**       | Subconsciously cooking-related without being literal                                           |
| **Available .com + .app**     | Both must be available or cheaply acquirable                                                   |
| ** pronounceable in English** | 2-3 syllables max                                                                              |

### Naming Decision: Commise ✅

**Chosen**: **Commise** (com-MEESE)

| Criterion                 | Assessment                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Evokes cooking**        | "Mise en place" — the foundational cooking practice of having everything organized before you start                             |
| **Not "commise"**         | ✅ Zero competitors use this name                                                                                               |
| **Not "kitchen"**         | ✅                                                                                                                              |
| **Made-up / distinctive** | ✅ Portmanteau — strong trademark protection                                                                                    |
| **Pronounceable**         | ✅ 2 syllables: com-MEESE                                                                                                       |
| **Search competition**    | ✅ "Commcise" (2 m's) is a fintech/Euronext company in a completely different space. "Commise" (1 m) has no app store conflicts |
| **Domain availability**   | We own commise.app. commise.com is a future purchase. Still to check: commise.ai, getcommise.com                                |

**Company name**: TBD — waiting on decision. Options: Commise Inc., Commise Labs, Commise Kitchen. Recommendation: keep it simple — **Commise Inc.** (or LLC).

**Brand positioning**: "Everything in its place" — Commise organizes your cooking life. Your recipes, your pantry, your meals, your grocery runs. All in one place.

### Original Naming Research (Reference)

<details>
<summary>Click to expand original shortlist from naming research</summary>

| Name         | Evokes             | Pronunciation | Trademark Strength              | Vibe                             |
| ------------ | ------------------ | ------------- | ------------------------------- | -------------------------------- |
| **Parslia**  | Parsley (herb)     | PAR-slee-ah   | ⭐⭐⭐⭐⭐ (invented word)      | Warm, organic, approachable      |
| **Stewdio**  | Stew + Studio      | STEW-dee-oh   | ⭐⭐⭐⭐⭐ (clever portmanteau) | Creative, playful, maker-focused |
| **Garnisha** | Garnish (plating)  | gar-NEESH-ah  | ⭐⭐⭐⭐⭐ (invented word)      | Elegant, sophisticated, foodie   |
| **Braisely** | Braise (technique) | BRAYZ-lee     | ⭐⭐⭐⭐⭐ (invented word)      | Comfort, slow cooking, warmth    |
| **Savorra**  | Savor (taste)      | sah-VOR-ah    | ⭐⭐⭐⭐ (invented word)        | Rich, indulgent, sensory         |

### My Recommendation (SUPERSEDED — Commise chosen)

~~**Parslia** or **Braisely**~~ → **Commise** selected.

</details>

**Company name**: Same as app name. Simple. Commise Inc. / Commise LLC.

**Decision needed**: ~~Pick one.~~ ✅ Commise chosen. ~~I can validate domain availability and do a preliminary USPTO trademark search before you commit.~~

---

## 1. EXECUTIVE SUMMARY

> **Superseded 2026-10-29** for plans, AI cost and revenue. See [Current decisions](#current-decisions-2026-10-29).

**What**: Commise — a full-stack AI cooking platform that knows what's in your fridge, generates validated recipes, plans your meals, builds smart grocery lists, and orders ingredients for delivery — all powered by the user's own AI key (zero inference cost).

**Why now**: $1.6B market growing 13.4% CAGR. No winner-take-all. ChatGPT + Instacart integration just launched (Dec 2025) creating a massive distribution channel. 30+ fragmented competitors but none combine pantry tracking + AI recipe generation + grocery ordering + cooking education in one app.

**How we win**:

1. **Feature depth** (14 features vs competitors' 4-6)
2. **BYOK AI** (zero inference cost — every competitor pays per generation)
3. **ChatGPT Custom GPT** (200M+ weekly users as distribution channel)
4. **Instacart commission** (5% of every grocery cart ordered through the app)
5. **USDA-validated recipes** (quality moat — ChatGPT fails 12-36% of the time)

**Ask**: Solo founder, bootstrapped. Seeking to validate product-market fit before raising.

---

## 2. MARKET OPPORTUNITY

> **Superseded 2026-10-29.** See [marketAnalysisV2.md](./research/business/marketAnalysisV2.md).

### Market Size

| Metric                      | Value                      | Source             |
| --------------------------- | -------------------------- | ------------------ |
| Global AI recipe market     | $1.6B (2025)               | Research & Markets |
| CAGR                        | 13.4%                      | Research & Markets |
| US household food waste     | $2,300/year avg            | USDA               |
| Total US food surplus       | $380B/year                 | ReFED              |
| ChatGPT weekly active users | 200M+                      | OpenAI             |
| Instacart monthly shoppers  | 80M+ (via Chicory network) | Instacart          |

### Why There's No Winner Yet

- **SideChef** — $7M raised, 6 features, no pantry
- **Jow** — 7M users, but no AI generation, no pantry, no depth
- **Samsung Food** — 500K MAU, but Samsung-dependent, no pantry, no AI gen
- **Clove AI** — 50K users, pantry + expiry, but no grocery ordering, no meal planning, iOS only
- **Kitchen Sink** (competitor) — 13K downloads, has Instacart, but no pantry, no nutrition, solo founder ceiling

**Nobody has pantry + AI + grocery + cooking mode + nutrition + community in one app. That's the gap Commise fills.**

### Target User

**Primary**: 25-45 year-old working professionals who cook 3-5 nights/week, are tired of "what's for dinner?", waste food regularly, and use ChatGPT or AI tools in their daily life.

**Secondary**: Home cooks who want to digitize family recipes, learn cooking skills, or eat healthier with less mental effort.

**NOT targeting**: Professional chefs, restaurants, or meal kit subscribers (different market).

---

## 3. PRODUCT STRATEGY

### 3.1 The 14-Feature Roadmap

> **Superseded 2026-10-29.** Launch scope is in [Current decisions](#current-decisions-2026-10-29). Each feature is a spec under [`specs/`](../specs/).

Already specced in detail. Summary:

| Phase            | Milestone | Features                                         | What Ships                                        |
| ---------------- | --------- | ------------------------------------------------ | ------------------------------------------------- |
| **Foundation**   | M0-M1     | Auth, Recipes, USDA Data, Recipe Import          | Core recipe management with validated ingredients |
| **Surfaces**     | M2-M3     | Recipe Digitization, Cooking Mode, Grocery Lists | Photo-to-recipe, hands-free cooking, smart lists  |
| **Beta Launch**  | M4        | Meal Planning                                    | → **Public Beta**                                 |
| **AI Layer**     | M5        | AI Integration, Nutrition Planning               | BYOK AI recipes, macro/micro tracking             |
| **Monetization** | M6        | Subscriptions                                    | → **1.0 Launch** with paywall                     |
| **Community**    | M7-M8     | Creator Profiles, Cooking School, Notifications  | Network effects post-1.0                          |

### 3.2 The Moat (What Competitors Can't Copy)

| Moat                   | Detail                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pantry data**        | Real inventory with expiry dates. Users invest time entering their kitchen. Switching cost = high. Commise's pantry is the deepest in market (expiry, quantities, partials). |
| **BYOK AI**            | Zero inference cost. Competitors burn cash on every generated recipe. We're profitable at any scale.                                                                         |
| **USDA validation**    | Recipe quality scores backed by nutritional science. Trust compound over time.                                                                                               |
| **Custom GPT channel** | First cooking app in ChatGPT's GPT Store with pantry intelligence. Land grab.                                                                                                |
| **Creator flywheel**   | Creator profiles + Cooking School = UGC that gets better with scale.                                                                                                         |

### 3.3 What We're NOT Building (Anti-Scope)

| NOT doing                  | Why                                                             |
| -------------------------- | --------------------------------------------------------------- |
| Our own grocery delivery   | We're not a logistics company. Use Instacart's API.             |
| Meal kit shipping          | Infrastructure-heavy, low-margin. Not our business.             |
| Restaurant POS/integration | B2B market, different sales cycle.                              |
| Social network / feed      | Kills early retention. Ship when 50K+ MAU.                      |
| Hardware / smart kitchen   | Samsung owns this. Don't fight them.                            |
| Video content production   | Tasty/Joshua Weissman territory. We organize, we don't produce. |

---

## 4. GO-TO-MARKET STRATEGY

> **Superseded 2026-10-29.** See the growth items in [Current decisions](#current-decisions-2026-10-29) and [acquisitionIdeas.md](./research/business/acquisitionIdeas.md).

### 4.1 Phase 1: Beta Launch (Months 1-4)

**Goal**: Ship core features, validate product-market fit, reach 5,000 beta users.

| Channel                    | Tactic                                                                                                                      | Cost    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Product Hunt**           | Launch on PH with "AI cooking app that knows your fridge" positioning                                                       | Free    |
| **Reddit**                 | r/cooking, r/mealprep, r/eatcheapandhealthy, r/productivity — authentic posts about solving the "what's for dinner" problem | Free    |
| **Indie Hackers**          | Build in public. Share metrics. The Kitchen Sink (competitor) founder is on IH and got 13K downloads this way. Replicate.   | Free    |
| **App Store Optimization** | Keywords: "AI recipe generator", "pantry tracker", "meal planning", "grocery list"                                          | Free    |
| **Referral program**       | "Invite a friend, both get 5 extra AI recipes"                                                                              | Minimal |

**Success metrics (Month 4)**:

- 5,000 downloads
- 1,500 MAU (30% activation)
- 35% day-30 retention
- 4.5+ App Store rating

### 4.2 Phase 2: ChatGPT Distribution (Months 4-6)

**Goal**: Launch Custom GPT in ChatGPT's GPT Store. Turn ChatGPT's 200M+ users into a distribution channel.

**The Custom GPT**:

- Free to use (no paywall in ChatGPT)
- OAuth sign-in to the app (Feature 005 already specs this)
- Core loop: User describes what they want → GPT generates recipe → validates against pantry → creates smart grocery list → opens Instacart checkout
- Free tier: 10 recipes/month in ChatGPT. Upsell: "Download the app for unlimited recipes + pantry tracking + cooking mode"

**Why this works**:

- Zero customer acquisition cost (ChatGPT hosts the GPT)
- Instacart commission starts flowing immediately (5% of every cart)
- App download upsell from every GPT user

**Success metrics (Month 6)**:

- 20,000 Custom GPT users
- 5,000 grocery orders via Instacart (25% conversion)
- $25,500 Instacart commission (5% × $85 avg cart × 6,000 orders) + CPA bonuses
- 2,000 app downloads from GPT upsell

### 4.3 Phase 3: Growth (Months 6-12)

**Goal**: Scale to 200K MAU, activate creator flywheel, explore funding.

| Channel                       | Tactic                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| **GPT Store optimization**    | Reviews, featured placement, seasonal campaigns ("Thanksgiving planner")                 |
| **Content marketing**         | Blog: "How AI Recipe Apps Actually Work", "Stop Throwing Away $2,300/Year in Food"       |
| **Creator program**           | Food bloggers get free Premium + verified profiles. They bring their audience.           |
| **Partnerships**              | CPG brand sponsorships in recipes (SideChef proved this at $200M basket value, 15x ROAS) |
| **Instacart cross-promotion** | Instacart features the app in their marketplace (they want partners who drive orders)    |

### 4.4 Phase 4: Platform (Months 12-18)

**Goal**: Become the intelligence layer between any AI assistant and grocery delivery.

| Channel           | Tactic                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| **MCP Server**    | Launch KitchenSink MCP server for Claude, Gemini, and any MCP-compatible AI |
| **API platform**  | Open API for recipe publishers, food bloggers, nutrition apps               |
| **White label**   | Grocery retailers can embed the AI recipe engine in their own apps          |
| **International** | Expand beyond US (UK via Tesco/Sainsbury's API, EU via local partners)      |

---

## 5. REVENUE MODEL

> **Superseded 2026-10-29.** Plans, prices and AI uses are in [Current decisions](#current-decisions-2026-10-29) and the [010 plan register](../specs/010-subscriptions/spec.md#plan-register).

### 5.1 Three Revenue Streams

| Stream                   | Model                                                                                             | Month 6      | Month 12     | Month 18     |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------ | ------------ | ------------ |
| **Instacart Commission** | 5% of cart value from grocery orders placed through the app/GPT                                   | $8K/mo       | $100K/mo     | $300K/mo     |
| **Subscriptions**        | Freemium ($5.99/mo or $49.99/yr) — unlimited AI recipes, pantry tracking, nutrition, cooking mode | $600/mo      | $12K/mo      | $50K/mo      |
| **Creator / CPG**        | Sponsored recipes, verified creator profiles, brand partnerships                                  | $0           | $5K/mo       | $25K/mo      |
| **TOTAL**                |                                                                                                   | **$8.6K/mo** | **$117K/mo** | **$375K/mo** |

### 5.2 Revenue Assumptions (Conservative)

| Metric                    | Month 6  | Month 12 | Month 18 |
| ------------------------- | -------- | -------- | -------- |
| Total users (app + GPT)   | 25K      | 250K     | 750K     |
| Monthly grocery orders    | 1,500    | 20,000   | 60,000   |
| Average cart value        | $85      | $85      | $85      |
| Instacart commission rate | 5%       | 5%       | 5%       |
| Subscription conversion   | 5%       | 8%       | 10%      |
| ARPU (blended)            | $0.34/mo | $0.47/mo | $0.50/mo |

### 5.3 Why Instacart Dominates (Not Subscriptions)

Traditional app wisdom says "subscriptions = revenue." In cooking apps, that's wrong.

- **RevenueCat data**: Food apps see 2-5% subscription conversion, 25% day-30 retention
- **SideChef proved**: $200M annual grocery basket value with CPG advertising. The money is in the grocery flow, not the subscription.
- **Instacart pays 5%**: A user who orders groceries twice/month at $85/order generates **$8.50/month in commission** — more than a $5.99/month subscription.
- **The subscription is the upsell**, not the primary revenue. Free users who use Instacart generate more revenue than paid subscribers who don't.

### 5.4 Unit Economics

| Cost                     | Amount                    | Notes                                      |
| ------------------------ | ------------------------- | ------------------------------------------ |
| **AI inference**         | **$0**                    | BYOK model — users bring their own API key |
| **Hosting (AWS)**        | ~$200-500/mo at 25K users | Fargate + RDS + S3 + CloudFront            |
| **Instacart API**        | Free (they pay you)       | Developer Platform access is free          |
| **Auth0**                | Free tier (up to 25K MAU) | Then $35/mo                                |
| **App Store fees**       | 15-30% of IAP             | 15% via Small Business Program             |
| **Customer acquisition** | ~$0 (organic + GPT)       | Until Phase 3 paid marketing               |
| **Gross margin**         | **~90%+**                 | Near-zero variable cost per user           |

---

## 6. COMPETITIVE DEFENSE

> **Superseded 2026-10-29.** See [mv2/compSubs.md](./research/business/mv2/compSubs.md), [mv2/compIndie.md](./research/business/mv2/compIndie.md) and the [competitive README](./competitive/README.md).

### 6.1 Competitive Positioning Map

```
                        DEPTH (features)
                        ↑
        Samsung Food    |   ★ KitchenSink (you)
        (500K MAU)      |   (14 features)
                        |
    Jow                 |
    (7M users)          |   Clove AI
    (no pantry/AI)      |   (50K users)
                        |
    ────────────────────┼──────────────────→ SCALE (users)
                        |
    Kitchen Sink (comp) |   Mise (waitlist)
    (13K, has Instacart)|
                        |
        SideChef        |
        ($7M raised)    |
                        |
```

**You are in the top-right quadrant (depth) with a path to scale via Custom GPT. Nobody else is there.**

### 6.2 Defensive Moats (In Order of Strength)

1. **Pantry data lock-in** — Users invest hours cataloging their kitchen. Switching cost = data re-entry. Strongest moat.
2. **BYOK cost advantage** — Every competitor with hosted AI pays per generation. You don't. They can't price-match your free tier.
3. **Custom GPT first-mover** — If you're the first cooking GPT with pantry + Instacart, you own that slot in the GPT Store.
4. **USDA quality validation** — Technical moat. Competitors would need to integrate USDA food data + build confidence scoring. Months of work.
5. **Creator network effects** — Weak initially, strong at scale. More creators → more content → more users → more creators.

### 6.3 Kill Zone Analysis

| What could kill us                        | Probability                                                                                                         | Defense                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **ChatGPT adds pantry features**          | Low — ChatGPT is a general tool, not a vertical app. They'd need persistent state, which breaks their architecture. | Be the Custom GPT they call.                                                                   |
| **Instacart builds their own recipe app** | Medium — they already have recipe pages. But their core business is logistics, not content.                         | Be their highest-performing developer partner. Make it more valuable to keep you than compete. |
| **Jow adds pantry tracking**              | Medium — they have 7M users but no AI gen. Adding pantry is a feature, not a re-architecture.                       | Ship before they do. Your pantry is deeper (expiry, quantities, partials).                     |
| **Samsung adds AI generation**            | Medium — they have AI features in Food+ but not generation.                                                         | BYOK is structurally different. Samsung pays for inference. You don't.                         |
| **Apple/Google add cooking to OS**        | Low — they'd do health/nutrition, not recipe creation.                                                              | Not worth worrying about.                                                                      |

---

## 7. RISKS

| Risk                                       | Severity    | Mitigation                                                                                                          |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| ~~Name collision with trykitchensink.com~~ | ✅ RESOLVED | Product renamed to **Commise**. KitchenSink = monorepo only.                                                        |
| **Solo founder velocity**                  | 🟡 High     | 14 features is a lot for one person. Prioritize ruthlessly. Beta with 6 features, add rest post-launch.             |
| **Instacart changes commission terms**     | 🟡 High     | Don't depend solely on Instacart. Subscriptions + CPG + creator revenue as backup.                                  |
| **ChatGPT changes Custom GPT API**         | 🟡 High     | Build a thin adapter layer. If GPT actions change, only the adapter needs updating.                                 |
| **BYOK confusion**                         | 🟡 Medium   | Non-technical users won't know what an API key is. Offer a hosted AI tier ($2.99/mo) for users who don't want BYOK. |
| **User acquisition too slow**              | 🟡 Medium   | Double down on GPT Store. If organic is slow, run targeted ads on cooking subreddits ($500/mo test budget).         |
| **Recipe quality complaints**              | 🟡 Medium   | USDA validation + confidence scores visible to users. Never show a recipe below 80% confidence.                     |

---

## 8. 18-MONTH ROADMAP

> **Superseded 2026-10-29.** See the launch scope in [Current decisions](#current-decisions-2026-10-29).

### Months 1-4: Ship Beta

| Month | Milestone             | What Ships                                                 |
| ----- | --------------------- | ---------------------------------------------------------- |
| 1     | M0 Shire              | Auth (Auth0), dev/staging infra                            |
| 2-3   | M1-M2 Rivendell/Moria | Core recipes, USDA data, recipe import, photo digitization |
| 3-4   | M3 Rohan              | Cooking mode (hands-free), grocery lists                   |
| 4     | M4 Helm's Deep        | Meal planning → **BETA LAUNCH**                            |

**Beta scope**: 6 features (001, 002, 003, 004, 006, 007, 008, 011). Enough to be the best recipe app on the market.

### Months 5-6: AI + Custom GPT

| Month | Milestone   | What Ships                                                     |
| ----- | ----------- | -------------------------------------------------------------- |
| 5     | M5 Isengard | BYOK AI integration, nutrition planning                        |
| 5-6   | Custom GPT  | KitchenSink GPT in ChatGPT's GPT Store with Instacart ordering |
| 6     | M6 Gondor   | Subscriptions → **1.0 LAUNCH**                                 |

### Months 7-12: Growth + Community

| Month | What Ships                                            |
| ----- | ----------------------------------------------------- |
| 7-8   | Creator profiles, Cooking School (M7)                 |
| 9-10  | Notification service (M8), push campaigns             |
| 10-12 | GPT Store growth, CPG partnerships, content marketing |

### Months 12-18: Platform

| Month | What Ships                                  |
| ----- | ------------------------------------------- |
| 12-14 | MCP server for Claude/Gemini                |
| 14-16 | API platform for recipe publishers          |
| 16-18 | International expansion, white label pilots |

---

## 9. FUNDING STRATEGY

> **Superseded 2026-10-29.** Not maintained in this repository.

### Option A: Bootstrap (Recommended for Months 1-6)

- **Cost to beta**: ~$2,000-5,000 (AWS infra + App Store fees + domains)
- **Cost to 1.0**: ~$5,000-10,000 (adds Custom GPT development + marketing)
- **Revenue at Month 6**: ~$8.6K/mo (mostly Instacart commission)
- **Break-even**: Month 4-5

**Why bootstrap first**: Prove product-market fit before giving away equity. The Instacart commission model means revenue starts flowing once grocery orders start. No need for VC to cover AI inference costs (BYOK).

### Option B: Seed Round (Month 6-12, if needed)

**Raise when**: Product-market fit validated, 50K+ MAU, clear path to $100K MRR.

| Use of Funds          | %   | Amount (example $500K raise) |
| --------------------- | --- | ---------------------------- |
| Engineering (2 hires) | 50% | $250K                        |
| Marketing / growth    | 25% | $125K                        |
| Operations / legal    | 10% | $50K                         |
| Runway buffer         | 15% | $75K                         |

**Valuation target**: $3-5M pre-money (typical for solo founder with traction at seed).

### Option C: Never Raise

If Instacart commission + subscriptions cover costs and generate profit, there's no need to raise. The BYOK model means near-zero variable costs. This can be a profitable solo business at $50K MRR.

---

## 10. KEY METRICS & TARGETS

> **Superseded 2026-10-29** for conversion figures. See [conversionStudy.md](./research/business/conversionStudy.md).

### North Star Metric

**Weekly grocery orders through the app** — This measures the full funnel: user engagement → recipe generation → meal planning → grocery list → purchase. Every step working = a grocery order.

### Supporting Metrics

| Metric                | Month 4 (Beta) | Month 6 (1.0) | Month 12 |
| --------------------- | -------------- | ------------- | -------- |
| Downloads             | 5K             | 25K           | 500K     |
| MAU                   | 1.5K           | 15K           | 200K     |
| Day-30 retention      | 35%            | 40%           | 45%      |
| Weekly grocery orders | 0              | 500           | 20,000   |
| Instacart MRR         | $0             | $8K           | $100K    |
| Subscription MRR      | $0             | $600          | $12K     |
| Total MRR             | $0             | $8.6K         | $117K    |
| App Store rating      | 4.5+           | 4.7+          | 4.8+     |
| Custom GPT users      | 0              | 5K            | 50K      |
| NPS                   | 40+            | 50+           | 55+      |

---

## 11. IMMEDIATE NEXT STEPS

| #   | Action                                                                                    | Owner                 | Timeline                          |
| --- | ----------------------------------------------------------------------------------------- | --------------------- | --------------------------------- |
| 1   | ~~Pick a name~~                                                                           | ✅ **Commise** chosen | Done                              |
| 2   | **Register social handles**. We own commise.app. Buy commise.com later                    | Founder               | This week                         |
| 3   | **File intent-to-use trademark** for Commise with USPTO                                   | Founder/Lawyer        | Within 30 days                    |
| 4   | **Update all specs** to replace "Commise" / "KitchenSink" product references with Commise | Engineering           | Within 1 week                     |
| 5   | **Ship M0** (Auth0 authentication)                                                        | Engineering           | Week 1-2                          |
| 6   | **Apply to Instacart Developer Platform**                                                 | Founder               | Week 1 (approval takes 2-4 weeks) |
| 7   | **Apply to OpenAI GPT Store** (developer account)                                         | Founder               | Week 2                            |
| 8   | **Begin M1** (Core recipes + USDA data + recipe import)                                   | Engineering           | Week 3                            |
| 9   | **Review AI Enhancement Plan** and decide which features to fold into v1 vs v2            | Founder               | This week                         |

---

## 12. APPENDIX: COMPETITIVE FEATURE MATRIX

> **Superseded 2026-10-29.** See [mv2/compSubs.md](./research/business/mv2/compSubs.md) and [mv2/compIndie.md](./research/business/mv2/compIndie.md).

_Full 30+ competitor matrix available in [competitive-analysis-v2.md](./competitive-analysis-v2.md) Section 12.12_

**KitchenSink's unique combination** (no competitor has ALL of these):

| Feature                | KitchenSink  | Clove AI  | Kitchen Sink (comp) | Jow    | Samsung Food     | Mise (waitlist) |
| ---------------------- | ------------ | --------- | ------------------- | ------ | ---------------- | --------------- |
| AI Recipe Generation   | ✅ BYOK      | ✅ hosted | ✅ hosted           | ❌     | ❌               | ✅ hosted       |
| Pantry Tracking        | ✅           | ✅        | Partial             | ❌     | ❌               | ❌              |
| Expiry Alerts          | ✅           | ✅        | ❌                  | ❌     | ❌               | ❌              |
| Meal Planning          | ✅           | ❌        | ✅                  | ✅     | ✅               | ✅              |
| Grocery Ordering       | ✅ Instacart | ❌        | ✅ Instacart        | ✅ own | ✅ shopping list | ✅              |
| Cooking Mode           | ✅ voice     | ❌        | ❌                  | ❌     | 💰 paywall       | ✅ voice        |
| Nutrition Tracking     | ✅ USDA      | ❌        | ❌                  | ❌     | ✅               | ❌              |
| Recipe Quality Scores  | ✅           | ❌        | ❌                  | ❌     | ❌               | ❌              |
| Recipe Import          | ✅           | ❌        | ✅ TikTok/IG        | ❌     | ✅               | ❌              |
| Recipe Digitization    | ✅ OCR       | ❌        | ❌                  | ❌     | 💰 paywall       | ❌              |
| Creator Profiles       | ✅           | ❌        | ❌                  | ❌     | ✅ communities   | ✅ cookbooks    |
| Cooking School         | ✅           | ❌        | ❌                  | ❌     | ❌               | ❌              |
| Family Circles         | ✅           | ❌        | ❌                  | ❌     | ❌               | ❌              |
| Custom GPT Integration | ✅ planned   | ❌        | ❌                  | ❌     | ❌               | ❌              |
| BYOK (zero AI cost)    | ✅           | ❌        | ❌                  | ❌     | ❌               | ❌              |
| **Feature count**      | **14**       | **4**     | **5**               | **3**  | **6**            | **5**           |
