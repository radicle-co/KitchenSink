# Research: Monetizing the free visitor, and sharing it with the chef

**Feature**: [018-chef-program-marketplace](../spec.md) · **Question**: [`C-018-003`](../spec.md#c-018-003--how-a-free-visitor-generates-revenue-and-how-the-chef-shares-in-it)
**Researched**: 2026-08-26 · **Widened twice the same day on owner direction** — first _"I think this is too
narrow"_, then the service/retail/data/psychology reframing recorded in §1.2
**Status**: 5 questions, 6 payer groups, 27 options, 3 decisions. Owner ruling open.

---

## 1. The question, restated precisely

The owner asked: _"can we generate revenue from users going to the chef page and any public recipes the chef
has and share the money with the chef and us … this kind of touches the question of how to monetize free
users too."_ — then widened it: _"we're a service platform, a retail platform (we own lots of data that free
users generate that we can also use to monetize if we're creative and we provide recipes as the base
capability upon which all other capabilities are based). Maybe free users also make paid users more valuable
or they help other users more easily become paid users? Maybe we're giving too much to free users…"_

### 1.1 ⛔ It is five questions, and the first pass answered one of them

|         | Question                                                                                 | Kind of answer                                                                            |
| ------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Q-A** | How does a **visit that buys nothing** produce revenue?                                  | **Revenue** — new money from a third party                                                |
| **Q-B** | How do free users become **worth** something to a chef?                                  | **Allocation** — attribute the conversions they cause, pay from money that already exists |
| **Q-C** | What do free users **produce** that has value?                                           | **Asset** — the corpus, and the intent signal on top of it                                |
| **Q-D** | Do free users make **paid users more valuable**, and do they **manufacture** paid users? | **Compounding** — network effects, liquidity, social proof, referral                      |
| **Q-E** | Are we **giving too much away**? Where should the free tier stop?                        | **Design** — gating, trials, and the line between persuasion and manipulation             |

The first pass answered Q-A and touched Q-B. **Q-C, Q-D and Q-E are where the leverage is**, and Q-C in
particular changes what kind of company this is.

### 1.2 The reframe that matters most: we are UPSTREAM of the retailer

Retail media is the most profitable thing in retail. Retail media networks turn a retailer's first-party data
into **60–70% margin media businesses, against 5–10% on core retail** — which is why Chase and PayPal both
launched **Financial** Media Networks in 2024 on exactly the same logic: monetize the transaction data you
already hold. Commerce media is now a recognised category: advertising targeted using first-party transaction
data from platforms that are not retailers.

⚠️ **The asset those businesses monetize is _demonstrated purchase intent_. Ours is better positioned, and it
is generated overwhelmingly by free users.**

> A retailer knows **what you bought**. We know **what you are planning to cook on Thursday** — before the
> basket exists, before the store is chosen, and at the moment the ingredient list is still editable.

That is **pre-basket intent**, and it is more actionable than post-purchase data for exactly the reason
`FR-029`'s recipes make it: a recipe is a **shopping list that has not been written yet**. Substitution is
still possible; brand choice has not happened; the store is not yet selected. Every CPG dollar in retail media
is chasing a moment that has, by definition, already partly happened. Ours has not.

**This is the "retail platform" the owner is pointing at, and it reorders the whole catalogue:**

- It promotes what the first pass filed under "later" — CPG sponsorship (`3c`) and aggregated insights
  (`5c`) — into the **strategic core**, delivered through the **meal-intent** asset (`5e`) rather than as
  generic ad inventory.
- It makes grocery affiliate (`2a`) more than a revenue line: it is the **closed loop** that proves the
  intent signal converts, which is the only thing that makes the signal sellable at a premium.
- ⚠️ **It also raises the stakes on privacy dramatically**, and the delivery shape is already standard:
  **data clean rooms**, where two parties match and analyse overlapping audiences without either exposing raw
  records. Fewer than half — **48%** — of US retail media networks offer clean-room capability, which is
  described in the trade as white space. Anything we do here must be built that way from the start
  (`FR-062c`, `FR-062f`).

### 1.3 The asset inventory — what a free user actually produces

Ordered by how defensible and how sellable each is. ⚠️ **Sellability and legality are different columns**;
several of these are valuable and must never be sold.

| Asset                                                     | Produced by               | Value                                                                                                                                     | Constraint                                                                               |
| --------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Public recipe corpus**                                  | Free and paid users       | The base capability every other capability sits on; discovery, SEO, AI grounding, the chef surface                                        | `016-FR-010` licence is for **operating the service** — not for sublicensing (`FR-062a`) |
| **Meal intent** — what will be cooked, when, for how many | Overwhelmingly free users | ⚠️ **The crown jewel.** Pre-basket, pre-brand, pre-store                                                                                  | Consent, aggregation, clean room (`FR-062c`, `FR-062f`)                                  |
| **Structured ingredient resolution + nutrition**          | Derived from all users    | The hard part of the corpus; already built                                                                                                | `016-FR-032` classes it **confidential** — never exposed                                 |
| **Cook events, save rate, substitutions**                 | Free and paid             | The **>2% save rate is the strongest purchase-intent signal in food CPG content** — and a save is a first-party event we already generate | Aggregate only                                                                           |
| **Ratings, reviews, photos**                              | Mostly free               | Social proof that converts other users; corpus quality                                                                                    | Moderation cost (`016`)                                                                  |
| **Search and query stream**                               | Mostly free               | Unmet-demand signal — what people look for and do not find                                                                                | Highly sensitive; aggregate only                                                         |
| **Household composition, dietary constraints, allergens** | All users                 | Powerful targeting                                                                                                                        | ⛔ **Special-category-adjacent. Not a monetization asset. Do not.**                      |

⛔ **The bottom row is a hard stop, and it is the one a creative reading of "monetize the data" walks into
first.** Allergen and dietary data is health-adjacent; nothing in this feature may treat it as inventory.

---

## 2. The unit economics

The numbers that separate serious options from theatre. **Third-party rates are cited; the conversion and
engagement assumptions are labelled illustrative and are NOT claims about our users.** The product's own
recorded price is $6.99/month (`010-FR-041`).

### 2.1 What a free user is worth — and why the naive number is wrong

- **Consumer-app freemium converts at ~2.1%** (RevenueCat 2026, 115,000+ apps). Good self-serve freemium is
  3–5%; great is 8–12%; most verticals cluster 3–4%.
- Illustratively at 2.1% × $6.99/month, a free user carries **~$0.15/month of expected subscription value.**
- ⚠️ **That number is the floor, not the value**, and treating it as the value is the error behind "we give
  free users too much". §4 (Q-D) enumerates four further channels — corpus, liquidity, social proof and
  referral — that a free user also feeds. **A decision to tighten the free tier that is justified on the
  2.1% alone is being made on one fifth of the evidence** (`FR-058i`).

### 2.2 What a visit is worth under each Q-A mechanism

| Mechanism                                                   | Published rate                                                                          | Per unit                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Display ads, **generic** network                            | $2–$8 RPM                                                                               | **$0.002–$0.008 / view**                                                                            |
| Display ads, **premium** food network                       | $20–$50+ RPM                                                                            | **$0.02–$0.05 / view** — gated behind traffic minimums in the tens of thousands of monthly sessions |
| Retail-media display CPM                                    | ~$4.80                                                                                  | ~$0.005 / view                                                                                      |
| Retail-media **sponsored product** CPM                      | ~$18.50 (35–40% above general programmatic, on intent)                                  | ~$0.019 / view                                                                                      |
| **Instacart affiliate**                                     | **~3% of cart** (some tiers ~5% in a 7-day window; up to **$10 CPA** on a new customer) | **~$4.50 on a $150 basket**                                                                         |
| **Walmart affiliate**                                       | 1–4% standard by category; creator programme up to 18% on non-grocery                   | ~$1.50–$6 on a $150 basket                                                                          |
| Chef digital product                                        | ebooks **$12–$35**; courses **$97–$497**; meal plans **$7–$15/mo**                      | commission × price                                                                                  |
| Off-platform attributed commission (Etsy Offsite Ads shape) | 15% of an attributed sale                                                               | 15% × order                                                                                         |
| **Retail-media-grade first-party data**                     | —                                                                                       | **60–70% margins** on the media business built from it                                              |

⚠️ **The decision-relevant line**: one grocery conversion at ~$4.50 is worth **~90 views at a premium food
RPM and ~2,250 at a generic one**. **Commerce needs one to two orders of magnitude less traffic than
advertising** to produce the same money, at the smallest consent surface of any option — and display's strong
RPM is gated behind traffic minimums we will not clear for some time, leaving the low band, a **~6× haircut**
on the number that makes display look attractive.

### 2.3 What conversion design is worth (Q-E)

| Lever                                             | Evidence                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Hard paywall vs freemium                          | **10.7% vs 2.1%** trial-to-paid by day 35 — ~**5×**                                                                                      |
| Hard vs **soft** paywall (paywall view → payment) | Soft **out-converts hard by ~50%** (4.85% vs 3.34%)                                                                                      |
| Hard paywall LTV                                  | **+21% one-year LTV**, ~**8× revenue per install at D14**                                                                                |
| **Trial length**                                  | **17–32 day** trials convert at a median **45.7%**, versus **26.8%** for 3–7 day trials                                                  |
| Trial-format paywall screens                      | Beat visual-only layouts in **64.5%** of head-to-head tests                                                                              |
| **Running experiments at all**                    | Apps that experiment earn **up to 40× more revenue**                                                                                     |
| Referral programme                                | Median referral conversion **3–5%**, top quartile **8%+**; referrals convert **3–5× better than paid acquisition** at **~25% lower CAC** |
| Referral k-factor                                 | **0.2–0.4** without a programme; **0.5–0.8** with a good one                                                                             |
| Placement of the share prompt                     | Post-purchase popups and account widgets lift share rate **>30%**                                                                        |
| Review stars near a share button                  | **+10–15%** click-through                                                                                                                |

⚠️ **Read the top two rows together, because they contradict the obvious conclusion.** Hard paywalls convert
better _overall_ and produce higher LTV, but **soft paywalls convert better at the moment of the ask.** The
gap is a reach effect, not a persuasion effect: hard paywalls filter the audience before it arrives. For a
product whose corpus and network effects depend on reach (§4), **buying conversion by destroying reach is
buying the wrong thing.**

⚠️ **And the largest single lever in the table is not a paywall at all.** It is **experimentation (up to 40×)**
and **trial length (45.7% vs 26.8%)** — both of which are entirely honest and neither of which requires
taking anything away from anyone.

---

## 3. The payer axis — who writes the cheque

The productive axis is not the mechanism, it is **who pays**. Six payers; the first shortlist reached three.

|        | Payer                                            | What we sell them                             | Sales motion                       |
| ------ | ------------------------------------------------ | --------------------------------------------- | ---------------------------------- |
| **P0** | **Nobody — we reallocate money we already hold** | Nothing                                       | None                               |
| **P1** | **The visitor**                                  | Content, convenience, status, access          | Self-serve                         |
| **P2** | **The retailer**                                 | Purchase intent, delivered as a filled basket | Affiliate signup                   |
| **P3** | **The brand / advertiser**                       | Attention, context, and **pre-basket intent** | ⚠️ A sales function we do not have |
| **P4** | **The chef — our own seller**                    | Distribution, tooling, speed                  | Self-serve                         |
| **P5** | **Another business**                             | The engine, the corpus, the intent signal     | Partnerships / BD                  |

⚠️ **P4 was the largest miss.** At Etsy, seller-funded advertising is **~$985M/yr, +18% YoY, used by 40%+ of
active sellers, and the acknowledged driver of take-rate expansion to 25.7% (Q1 2026)**. At real marketplace
scale **the seller is a bigger and more willing payer than the visitor.**

⚠️ **P5 is where the owner's reframe lands.** The nearest analogue in this exact category — **Whisk, now
Samsung Food** — already sells CPG brands sponsored placement across **~500M monthly recipe impressions**
_and_ sells brands and grocers a **B2B recipe content-management tool** on a usage fee. Same asset class.

---

## 4. Q-D — do free users make paid users more valuable, and do they manufacture paid users?

**Yes, through five distinct channels, and only one of them is the 2.1% conversion rate.** Each is separately
measurable, and `FR-058i` requires all five to be measured before the free tier is tightened.

| #     | Channel                           | Mechanism                                                                                                                                                                                                                        | Evidence / note                                                                                                                                                                                                                                                                                                                               |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Direct conversion**             | A free user becomes a paid user                                                                                                                                                                                                  | ~2.1% (§2.1). The only channel the naive model counts.                                                                                                                                                                                                                                                                                        |
| **2** | **Corpus / data network effects** | Free users write the recipes, cook them, rate them, correct them. Search, discovery, ranking, AI grounding and nutrition accuracy all improve with volume — **for paying users too**.                                            | Data network effects: a product improves as it accumulates usage data, improving the experience for every subsequent user. **The corpus is the base capability every other capability sits on** — meal planning, grocery lists, cooking mode and nutrition are all functions _of_ it. Degrade corpus growth and you degrade the paid product. |
| **3** | **Marketplace liquidity**         | Free users are the **demand side** that makes chef supply worth having. A marketplace with no browsers has no sellers, and then has nothing to sell paid users either.                                                           | Liquidity is the marketplace success metric; low liquidity **is** the cold-start problem. `018`'s entire supply side depends on it.                                                                                                                                                                                                           |
| **4** | **Social proof**                  | Free users produce the ratings, reviews, photos and cook counts that convert _other_ users — free and paid.                                                                                                                      | Review stars near a share button lift CTR **10–15%**. `015-FR-007f`'s cook signal already generates the strongest version of this.                                                                                                                                                                                                            |
| **5** | **Acquisition / referral**        | Free users bring users. Referrals convert **3–5× better than paid acquisition at ~25% lower CAC**; k-factor moves from **0.2–0.4** to **0.5–0.8** with a real programme; share-prompt placement alone lifts share rate **>30%**. | ⚠️ **This is the highest-leverage under-built thing in the whole catalogue** — see `1h`.                                                                                                                                                                                                                                                      |

⛔ **The conclusion that matters for Q-E**: the value of a free user is
`conversion + corpus + liquidity + social proof + referral`. **A tightening decision justified on channel 1
alone is being made on one fifth of the evidence, and channels 2–5 are precisely the ones that shrink when
reach shrinks.** That is not an argument against ever gating — it is an argument for `FR-058i`.

---

## 5. Q-E — are we giving too much away? ⚠️ Yes, probably. Here is the line.

**The owner's instinct is supported by the data and the answer is not "no".** But two of the three things the
question named — FOMO and manufactured tension — sit on the wrong side of a line that is a **ratified
requirement in a sibling spec** and an **active enforcement area**, so the line has to be drawn precisely
rather than gestured at.

### 5.1 What the rules already say

- **`015-FR-027`** (ratified): the system MUST NOT use **artificial scarcity, countdown timers, false urgency,
  or manufactured social pressure**.
- **`015-FR-028`**: messaging MUST be **truthful and complete at the moment of the decision**.
- **`015-FR-029` / `016-FR-041`**: unpublishing must be as easy as publishing; cancelling must take no more
  interactions than subscribing.
- **`016-FR-044`**: terms must not be unfair within the applicable consumer regime in any market served.
- **`018-FR-061`**: this feature must not remove or degrade a capability a free user has today.

### 5.2 What the law says — and it is moving toward us, not away

- **EU DSA Art. 25** (applicable since 17 Feb 2024) explicitly prohibits designing or operating an interface
  in a way that **deceives or manipulates users, or materially distorts or impairs their ability to make free
  and informed decisions.** This is the first express codification of dark patterns in EU law.
- The **UCPD** reaches any unfair B2C commercial practice, including these.
- Amendments to the **Consumer Rights Directive** apply from **19 June 2026**; a **Digital Fairness Act** is
  anticipated as a legislative initiative in **Q4 2026**.
- ⚠️ **This is actively enforced, not theoretical**: an FTC/ICPEN/GPEN sweep found **75.7% of 642 sites and
  apps used at least one dark pattern, 66.8% two or more** — which is exactly the population regulators
  select from.
- 🎯 **The decisive distinction, taken from the enforcement guidance itself**: a note about a **genuine,
  time-limited offer can be legitimate**; it becomes a violation when the urgency is **invented, or simply
  resets after it expires**. **Truthfulness of the information is decisive.**

⚠️ `016-FR-048` puts v1 in the **US only**, so DSA Art. 25 does not yet bind. But `016-FR-048b` requires
obligations whose cost is a **seam rather than a capability** to be built to the strictest regime among target
markets **now** — and an interface pattern is a seam: retrofitting honesty into a conversion funnel means
rebuilding the funnel and re-earning the trust it spent.

### 5.3 The line, stated as a rule

> **Every pressure signal must be TRUE, VERIFIABLE, and NON-RESETTING.** If the fact would still be true with
> the counter removed, the counter is honest. If the counter _creates_ the fact, it is a dark pattern.

| ✅ Legitimate — and high-yield                                                                         | ⛔ Forbidden by `015-FR-027`, DSA Art. 25, UCPD                      |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| A **real quota** that actually exists and is stated up front ("3 of your 5 AI generations this month") | A quota that quietly shrinks, or resets to create a new deadline     |
| A **real deadline** that happens once ("your trial ends Thursday")                                     | A countdown that resets on reload or on a new session                |
| **Real loss** — a reverse trial where the user genuinely had the capability                            | Manufacturing loss by removing something they already had (`FR-061`) |
| **Real scarcity** — a chef's cohort genuinely has 30 seats                                             | "Only 3 left!" on an unlimited digital good                          |
| **Real social proof** — "cooked 4,214 times" because it was                                            | Fabricated or unsourced activity counts                              |
| **Real friction removal** — showing the value before the ask                                           | Confirmshaming, obstructed cancellation, pre-checked consent         |

### 5.4 ⭐ The recommendation for Q-E: a reverse trial, and stop looking for a dark pattern

**The reverse trial is the best fit for this product in the entire catalogue, and it is entirely honest.**
Every new user starts with **full premium access for a window**, then drops to free. _"They experience the
ceiling before the floor, and the downgrade itself becomes the upgrade prompt."_

Four reasons it fits this product specifically:

1. **Cooking value compounds over weeks, not days.** Meal planning, grocery lists, cooking mode and nutrition
   only demonstrate their worth across a plan-shop-cook cycle. A 3–7 day trial cannot show it — and the data
   agrees: **17–32 day trials convert at 45.7% versus 26.8%.**
2. **The loss is real**, so the urgency is truthful. Nothing is invented, nothing resets, and it happens once.
3. **It preserves reach**, unlike a hard paywall — so channels 2–5 in §4 keep working. This is the crucial
   difference: a hard paywall buys the 5× conversion figure by **destroying the corpus, liquidity, social
   proof and referral engine** that make the paid product good.
4. ⛔ **It does not violate `FR-061`.** `FR-061` forbids taking away what a free user **has today**. A reverse
   trial changes what a **new** user is **given at the start** — and the end of a disclosed, one-time trial is
   not a removal. ⚠️ **This distinction is load-bearing and must be respected exactly**: applying a reverse
   trial retroactively to existing free users **would** be a removal, and is forbidden.

And the two levers larger than any gating change, both free of ethical and legal risk: **run experiments at
all** (up to **40×** revenue difference) and **get trial length right** (**45.7% vs 26.8%**).

⚠️ **Where the free tier probably IS too generous, concretely.** `010-FR-040` gives the free tier unlimited
public recipes, unlimited importing, manual meal planning, grocery lists and cooking mode — and `015`'s D4a
is on track to hand free users **private recipes** as well. The honest reading: the free tier is being asked
to be simultaneously the corpus engine, the acquisition engine **and** a complete product. **The place to gate
is where marginal cost is real and value is high — AI generation, automation, multi-week planning horizon,
nutrition depth, export and scale — never the core plan-shop-cook loop the corpus depends on.** ⛔ And any
change must run `FR-058i`: measure all five channels first, because four of them shrink when reach shrinks.

---

## 6. The catalogue — 27 options across six payers

### P0 — Reallocation and design (no new payer)

- **0a. Chef pool from subscription revenue, allocated by attributed engagement.** Precedents: X pays on
  **Verified Home Timeline impressions from Premium subscribers only** — engagement by _paying_ users,
  explicitly not ad-funded; YouTube **55/45**; Substack **10%**; TikTok above a 50% base.
  ⚠️ **Pro-rata versus user-centric is the unresolved design question** (`FR-058b`) — the music industry has
  argued it for a decade. **User-centric is the only form legible to the payer**: _"your subscription went to
  the chefs you cooked from."_ ⚠️ It is a **cost line, not a revenue line**; fund it on measured lift.
- **0b. Attribution-only recognition (no money).** Cheapest thing in the catalogue, the prerequisite for `0a`,
  and valuable alone. `015-FR-007f`'s cook signal is the pattern it extends. **`FR-058f`: build regardless.**
- **⭐ 0c. Reverse trial.** §5.4. The highest-value, lowest-risk conversion change available.
- **0d. Trial-length and paywall experimentation.** Up to **40×** revenue difference between apps that
  experiment and apps that do not; trial-format screens win **64.5%** of head-to-heads. Not a mechanism — a
  discipline — and it beats every mechanism here.

### P1 — The visitor pays

- **1a. Chef digital products** — resolved into the spec (`FR-029`). Market pricing: ebooks **$12–$35**,
  courses **$97–$497**.
- **1b. Chef meal-plan subscriptions** — **$7–$15/month** in the creator market. ⛔ v2 (Assumption 8).
- **1c. Tips / micropayments** — `012-FR-031`…`033` already specify a tip jar. Nano-payment designs remove
  per-decision friction (Fountain.fm per-minute streaming payments; Wavlake passive boosts; Brave's BAT).
  ⚠️ A rounding error nearly everywhere it has been tried. Ship it; do not model revenue on it.
- **1d. Gifting** — a paid user's goodwill converted into a new user. Value is acquisition, not revenue.
- **1e. Ticketed live cook-alongs** — live food formats reportedly earn **3–5× the per-post revenue of static
  content**. ⛔ `013` Phase 2.
- **1f. Print-on-demand cookbook** / **1g. chef merchandise** — ⛔ fulfilment, out of scope; `1f` also
  re-opens the licence question for a physical artefact.
- **⭐ 1h. A real referral programme.** ⚠️ **The highest-leverage under-built item in the catalogue.**
  Referrals convert **3–5× better than paid acquisition at ~25% lower CAC**; a good programme moves k-factor
  from **0.2–0.4 to 0.5–0.8**; share-prompt placement alone lifts share rate **>30%**. ✅ And it is
  **unowned**: `015` explicitly out-of-scopes _"rewarding any activity other than publishing a recipe (rating,
  cloning, commenting, **referring**)"_ — so a referral reward does not collide with `015-FR-007`'s
  non-monetary rule, which governs **publishing** rewards only. ⛔ It must still respect `FR-063` (nothing in
  `015`'s recognition layer becomes purchasable or earnable this way).

### P2 — The retailer pays

- **⭐ 2a. Grocery affiliate / shoppable ingredients, shared with the chef.** Best revenue per visit (§2.2),
  smallest consent surface, already in the business plan, and `007` already contemplates Walmart and Instacart
  adapters. ⚠️ **`007` records that no partner API access is confirmed** — the option's one real risk, and it
  is a dependency risk, not a design risk. **It is also the closed loop that makes `5e` sellable.**
- **2b. Equipment / pantry affiliate** — small, additive, near-zero cost once `2a` exists.
- **2c. Meal-kit / specialty-grocer affiliate** — higher commission, weaker intent match.
- **2d. Retailer-funded default placement** — ⚠️ a commercial thumb on a functional default; the line where
  commerce starts behaving like advertising. `FR-062` labelling applies.

### P3 — The brand / advertiser pays

- **3a. Programmatic display advertising.** §2.2 arithmetic; **largest consent surface of any option**
  (`016-FR-007` per-purpose consent, `016-FR-008` age basis, data-sharing disclosure, unbudgeted ad-tech
  vendors). ⛔ **Highest cost at exactly the scale where it pays least.**
- **3b. Contextual in-recipe commerce (Chicory model)** — sponsored placements inside the recipe beside the
  ingredient list, routing to a retailer basket; **5,200+ recipe sites** (Warner Bros. Discovery, Martha
  Stewart, Food52), ~**110M shoppers/month**. Targets the recipe, not the person — **much smaller surface than
  `3a`**. **This is the ad option to reconsider first, not display.**
- **⭐ 3c. Platform-sold CPG sponsorship on the intent signal.** US retail media projected **$69.33bn in 2026
  (+17.9%)**; CPG allocating **39%** of ad budgets; off-site growing at twice on-site's rate; the 2026 pattern
  is explicitly _"sponsored retail media living inside a recipe, right next to the ingredient list."_
  ⚠️ **The >2% save rate is the strongest purchase-intent signal in food CPG content — and a save is a
  first-party event we already generate.** ⛔ Needs a sales function that does not exist.
- **3d. Brand-funded recipe challenges / collections** — the format brands most want; `FR-062`-labellable
  without touching ranking.
- **3e. Brand-funded chef residencies** — how food media actually monetizes. A relationship business.

### P4 — The chef pays

- **⭐ 4a. Chef-sold sponsorship at the same commission.** Near-free; reuses this feature's own listing,
  commission and ledger machinery; needs one labelling rule.
- **4b. Seller-funded promoted placement (Etsy Ads model).** ~**$985M/yr**, **+18% YoY**, **40%+** of sellers,
  the driver of take-rate expansion to **25.7%**. ⛔ **Directly contradicts `FR-014` and `FR-058d`.** See §7.2.
- **4c. Off-platform attributed commission (Etsy Offsite Ads shape).** **15%** on a sale attributed within a
  window. Aligns incentives; **does not touch on-platform ranking**; requires fronted ad spend.
- **4d. A chef Pro subscription (tooling, not reach).** ✅ Already in the recorded business plan, whose
  pricing table lists _"Creator | Revenue share + optional subscription"_. ⚠️ **Must sell capability, never
  placement** (`FR-062b`) — otherwise it is `4b` wearing a subscription.
- **⭐ 4e. Reduced commission as a paid upgrade.** `013-FR-010` already defines two rates (20%/80% standard,
  15%/85% pro); this makes the second purchasable. Legible, and free of the placement hazard.
- **4f. Seat-limited chef cohorts / drops.** **Real** scarcity — a live cohort genuinely has N seats — so it
  is on the legitimate side of §5.3's line. Pairs with `1e`.

### P5 — Another business pays

- **⭐ 5e. Meal-intent commerce media, delivered through a clean room.** §1.2. **The strategic core of the
  owner's reframe**: sell CPG brands access to _pre-basket_ intent — privacy-preserving, aggregate,
  clean-room-matched — with the affiliate loop (`2a`) as the closed-loop proof that the signal converts.
  Retail media earns **60–70% margins** on exactly this class of asset, and **<48% of RMNs offer clean rooms**.
  ⚠️ Requires consent design, counsel, and a sales function; ⛔ and it must never become `5c`'s careless form.
- **5a. Recipe / nutrition engine licensing (B2B SaaS)** — Whisk's precedent is exact: a recipe CMS sold to
  brands and grocers on a usage fee. A different company motion.
- **5b. White-label recipe experience for a retailer** — the same asset sold as a surface, not an API.
- **5c. Aggregated, anonymized food-trend insights** — ⚠️ attractive and **genuinely dangerous**: one careless
  step from selling user data, must clear `016-FR-007`, and `016-FR-032` already classes derived signals
  (ingredient-resolution mappings, confidence scores, dedup keys, ranking signals) as **confidential and not
  to be exposed**. Aggregate-only, non-re-identifiable, consented — assume counsel (`FR-062c`).
- **5d. ⛔ Corpus / AI-training licensing.** Headline numbers are real — Wiley **$49M** FY2026 (**$110M**
  lifetime); News Corp/OpenAI reported **~$250M/5yr**; aggregators exist (News/Media Alliance–ProRata at a
  **50%** revenue share; Perplexity's Publishers Program on a reported **$42.5M** pool). **Three conclusive
  blockers**: (1) `016-FR-010`'s licence is for **"operating, securing, improving and promoting the
  service"** — not sublicensing for third-party training, so it needs a licence amendment and, honestly,
  **per-user opt-in**; (2) `016`'s recorded posture is **"we license _in_, not out"**, `016-FR-033` forbids
  open publication and `016-FR-030`'s anti-extraction term exists to keep others out; (3) the deals go to the
  largest publishers. **Recorded as `FR-062a`: out of scope.**

### Explicitly rejected

|                                                                                                                          | Why                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Selling user data**                                                                                                    | Incompatible with `016` and with the product's trust promise. Not a candidate at any price.                                                         |
| **Monetizing allergen / dietary / household-composition data**                                                           | ⛔ Health-adjacent and special-category-adjacent. Not inventory. Not at any margin.                                                                 |
| **Paywalling public recipes**                                                                                            | Reverses `001-FR-004` and the whole of `015`'s thesis.                                                                                              |
| **Degrading the free tier retroactively**                                                                                | Forbidden by `FR-061`. The ~5× hard-paywall figure is exactly the temptation this refuses — and it buys conversion by destroying §4's channels 2–5. |
| **Invented urgency, resetting countdowns, fabricated scarcity or social proof, confirmshaming, obstructed cancellation** | `015-FR-027`, `015-FR-028`, `016-FR-041`, `016-FR-044`; **DSA Art. 25**; UCPD. §5.3.                                                                |
| **Making chef _standing_ purchasable**                                                                                   | `FR-063`. (Distinct from `4b`, which sells placement — §7.2.)                                                                                       |
| **Monetizing `015`'s recognition layer**                                                                                 | `015-FR-030`, `FR-063`.                                                                                                                             |
| **Interstitials / forced-view ads mid-cook**                                                                             | Actively hostile in the one context where the product must be reliable — hands busy, timer running.                                                 |

---

## 7. The three decisions this reduces to

### 7.1 Which mechanisms ship, and in what order (`C-018-003a`)

**Now — nothing here needs a new payer relationship, a sales function, or a legal amendment:**

1. **`0b` attribution-only recognition** — the prerequisite for the pool, valuable alone, un-gated (`FR-058f`).
2. **`0c` reverse trial** + **`0d` experimentation discipline** — the largest conversion levers available,
   both entirely honest (§5.4), and neither takes anything from anyone.
3. **`1h` a real referral programme** — the highest-leverage under-built item; `015` explicitly leaves
   referral rewards unowned.
4. **`2a` grocery affiliate, shared with the chef** — the revenue lead, and the closed loop `5e` needs.
5. **`4a` chef-sold sponsorship** and **`4e` reduced commission as a paid upgrade** — near-free, reusing this
   feature's own machinery.

**Next — needs the measurement the "Now" tier produces:**

6. **`0a` the chef pool**, allocated **user-centrically**, funded on measured lift against the ~2.1% baseline.
7. **`4c` off-platform attributed commission** — promoted placement's revenue without touching ranking.
8. **`4f` seat-limited cohorts** with `1e`.

**Strategic — the owner's reframe, and the largest prize on the page:**

9. **`5e` meal-intent commerce media through a clean room**, with **`3c` platform-sold CPG sponsorship** as
   the sales expression of it and **`3b` contextual in-recipe commerce** as the vendor-shaped fallback if
   `2a`'s partner API access does not land. ⚠️ Needs consent design, counsel, and a sales function — but it
   is the only option whose margin structure (**60–70%**) is categorically different from everything else
   here, and the asset it monetizes is generated overwhelmingly by **free users**.

**Not without reopening a ratified decision:** `3a` display advertising at current scale; `5d` corpus/AI
licensing (`FR-062a`); `5c` in any un-consented form (`FR-062c`); and everything in the rejected table.

### 7.2 ⚠️ Is ranking for sale? (`C-018-003b`)

`FR-014` requires the discovery ranking rule to be stated and identical for every chef; `FR-058d` forbids any
mechanism from altering it. **Seller-funded promoted placement (`4b`) violates both — and it is the largest
and fastest-growing revenue line in the closest comparable marketplace.** The specification currently answers
"no" by implication rather than by decision, which is not good enough for a trade this size.

| Position                               | Means                                                                                                                                                                   | Costs                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Ranking integrity is absolute**      | `FR-014` / `FR-058d` stand. `4b` permanently out.                                                                                                                       | Forgoes Etsy's take-rate engine. Buys a discovery surface a buyer can trust without reading the fine print. |
| **Promotion permitted but segregated** | Paid placement only in **clearly demarcated, labelled slots** that never mix into or re-order organic results. `FR-014` / `FR-058d` amended to say **organic** ranking. | Most of the revenue, most of the trust. The discipline must be enforced by test, not intent.                |
| **Promotion blended and labelled**     | The Etsy / Amazon model.                                                                                                                                                | Highest yield. Makes discovery a paid surface — a different product than `FR-013`–`FR-017` describe.        |

⚠️ **Middle path**: `4c` off-platform attributed commission captures much of `4b`'s revenue **without touching
on-platform ranking at all**, and survives even the absolute position.

### 7.3 ⚠️ Where does the free tier stop? (`C-018-003c` — new)

The owner's question — _"maybe we're giving too much to free users"_ — is supported by the data and the answer
is **not "no"**. But it resolves into three sub-decisions with very different risk:

| Sub-decision                              | Recommendation                                                                                                                                                                                                                                                                                                 | Risk                                                                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Should the free tier be narrower?**     | **Probably yes, at the margin.** `010-FR-040` currently gives the free tier unlimited public recipes, unlimited importing, manual planning, grocery lists and cooking mode — and `015`'s D4a adds private recipes. It is being asked to be corpus engine, acquisition engine **and** complete product at once. | ⛔ Gated on `FR-058i`: measure all five §4 channels first, because four shrink with reach.                                                                                                                                                |
| **Where should new gates go?**            | Where **marginal cost is real and value is high** — AI generation, automation, multi-week planning horizon, nutrition depth, export, scale. ⛔ **Never the core plan-shop-cook loop**, which is what the corpus and the referral engine run on.                                                                | Low, if `FR-061` is respected: gate what is **new**, never remove what free users **have**.                                                                                                                                               |
| **May we use urgency, tension and FOMO?** | **Only the true kinds.** §5.3's rule: every pressure signal must be **TRUE, VERIFIABLE and NON-RESETTING**. Reverse trial, real quotas, real deadlines, real cohort seats, real cook counts — all legitimate and all high-yield.                                                                               | ⛔ Invented or resetting urgency and fabricated scarcity are forbidden by `015-FR-027` and prohibited outright by **DSA Art. 25**; 75.7% of surveyed sites use at least one dark pattern, which is the population regulators select from. |

⭐ **And the finding that should settle the tone of this decision**: the two largest levers in all of the
conversion evidence are **running experiments at all (up to 40×)** and **getting trial length right (45.7% vs
26.8%)** — neither of which requires manufacturing anything, taking anything away, or going anywhere near
that line.

---

## 8. The dimensions the monetization frame does not reach

⚠️ **The first four passes asked "how do we make money." Four further dimensions decide whether the answer
survives contact with a real marketplace.** Each of these produced requirements in the spec.

### 8.1 Chef-side viability — the power law, and the honesty it forces

Creator income is not merely unequal; it is **winner-take-almost-everything**:

| Finding                                                                  | Figure               |
| ------------------------------------------------------------------------ | -------------------- |
| Share of platform-derived revenue captured by the **top 1%** of creators | **~97%**             |
| Creators earning **> $100k/yr**                                          | **~4%**              |
| Creators earning **< $15k/yr**                                           | **~50%**             |
| Of ~300M self-identified creators, those earning enough to go full-time  | **~4M ≈ 1.3%**       |
| Top 1% vs bottom 90% combined                                            | Top 1% earn **more** |

**Three consequences, all of which changed the spec:**

1. ⛔ **An "earn money as a chef" pitch is an earnings claim about an outcome almost nobody reaches**
   (`FR-003a`). The FTC has an active earnings-claims rulemaking expected to cover **money-making
   opportunities generally, not only MLMs**, requiring substantiation to be produced on request — and its
   2026 enforcement targets exactly the pattern of aspirational imagery plus an income implication. **The
   honest pitch is the terms — commission, payout, controls — never a number.**
2. ⭐ **It strengthens the case for the pool (`0a`) specifically.** Direct sales pay a handful of chefs and
   **nothing** to everyone else. An engagement-attributed pool is the only mechanism in this catalogue whose
   distribution is not winner-take-all by construction (`FR-058a-i`).
3. **It argues for curation over open enrolment.** A small roster of chefs who can actually sell beats a large
   roster that cannot — which is also what makes `FR-003b`'s identity verification affordable.

### 8.2 The cold start — an empty directory is a state, not an edge case

A marketplace's hardest problem is the first hundred sellers, and every tempting fix here is forbidden by a
requirement already written: auto-enrolling creators violates `FR-001` (standing is an explicit recorded
transition); back-filling the directory with public recipes violates `FR-013` (only active standing appears);
implying a roster that does not exist violates `FR-003a`. **`FR-014a`: the correct answer to an empty
directory is a seeded roster of genuinely admitted chefs, not a fuller-looking page.**

### 8.3 ⛔ Fraud — the guarantee moved the entire attack surface onto us

`FR-032a`'s buyer guarantee is the right buyer decision and it makes the platform the party who pays first.
Digital goods are the **preferred** target, not an incidental one: no shipping delay means **instant value**,
and the goods cannot be recovered.

| Threat                          | Evidence                                                                                                                                                    | Control                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Refund / policy abuse**       | Has **displaced payment fraud as merchants' top-reported threat**; the most common form is a false claim the item **was never received (52% of merchants)** | `FR-075` — a stated abuse limit, and **consult our own delivery record before paying**, which for an instantly-delivered digital good actually disproves the claim |
| **Card testing / enumeration**  | **+175% YoY**; low-value digital goods are ideal because a successful authorization validates a stolen credential instantly                                 | `FR-078` — rate-limit and alarm on failed-authorization patterns; not a conversion problem                                                                         |
| **Self-dealing / cash-out**     | Buying your own listing with a stolen instrument and withdrawing the proceeds turns a marketplace into a laundering rail                                    | `FR-076` — detect and block the chef as economic beneficiary of their own listings                                                                                 |
| **Seller default after payout** | Every guaranteed refund on a disbursed sale is an unsecured debt from a chef who may never earn again                                                       | `FR-039a` — a **rolling reserve**, the single cheapest control against both abuse and default                                                                      |
| **AI-assisted claims**          | Generated receipts, damage images and identity documents make false claims cheap at volume                                                                  | `FR-081` — prefer evidence **we** generate over evidence the claimant supplies                                                                                     |
| **Sanctioned counterparties**   | Strict liability                                                                                                                                            | `FR-079` — screen at onboarding **and on a cadence**                                                                                                               |

⚠️ **And the control on the controls**: `FR-080` requires every fraud action that withholds money or restricts
an account to produce a readable reason, an appeal, and a record. Fraud systems that act silently are how
legitimate sellers are lost.

### 8.4 ⛔ Payment rails — a 20% commission is not 20%

| Layer                                        | Take                                                 |
| -------------------------------------------- | ---------------------------------------------------- |
| Apple / Google in-app purchase               | **30%**, or **15%** under a small-business programme |
| Our commission (`013-FR-010`, inherited)     | **20%**                                              |
| **Chef's residual on a stacked mobile sale** | **~50%**                                             |

`FR-073` and Constitution Principle VIII require every user-facing surface on **both** web and mobile in the
same release, so mobile economics are not optional.

✅ **v1 survives this because v1 is US-only.** App Store Review Guideline **§3.1.1(a)**: the entitlements
_"are **not required** for developers to include buttons, external links, or other calls to action in their
**United States storefront** apps,"_ while every other storefront prohibits them absent IAP or the External
Purchase Link Entitlement. `016-FR-048` configures v1 to the US market. **The trap is the first non-US
storefront** (`FR-084`).

⛔ **And a non-obvious edge that lands on `C-018-003b`**: Apple's guidance expressly names **buying advertising
to display in the same app** — _"sales of boosts for posts in a social media app"_ — as requiring in-app
purchase. **Seller-funded promoted placement is therefore IAP-bound on mobile** (`FR-085`), which changes both
its economics and whether it can satisfy `FR-073` at all.

### 8.5 Commission benchmarks — we are at the high end

| Platform                               | Take                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| Ko-fi                                  | **0%** one-time sales; 5% memberships                                                  |
| Buy Me a Coffee                        | 5% flat                                                                                |
| Substack · Gumroad                     | **10%**                                                                                |
| Patreon                                | **8–12%**                                                                              |
| Kajabi · Teachable · Thinkific · Podia | **0% of revenue** — flat **$69–$399/month**                                            |
| **Ours today (`013-FR-010`)**          | **20%**                                                                                |
| Etsy _effective_                       | 25.7% — ⚠️ physical goods + payments + **seller-funded ads**, not a content commission |

⭐ **A fourth shape the catalogue implies and the spec has not costed**: a **flat chef subscription instead of
a commission** (the Kajabi/Teachable shape) — 0% of revenue for $X/month. It inverts who bears the risk, it is
`4d`/`4e` taken to its conclusion, and it interacts with `C-018-003b`: **a platform that takes no commission
has a much stronger reason to sell promotion.** That is `C-018-004`.

### 8.6 ⛔ The contradiction inside this repo — resolve it, do not average it

The owner's Q-E instinct is _"maybe we're giving too much to free users."_ This repo's own competitive
analysis ([`02-gap-analysis-and-strategy.md`](../../../docs/competitive/02-gap-analysis-and-strategy.md),
**P4**/**D5**) concludes the **inverse**: _"hold or raise price, and buy the position with a far more generous
free tier,"_ with **nutrition-truth free** because it is the proof of the differentiator. Its supporting
findings hold up:

- **We are at price parity, not above** — ReciMe runs a tested **$29.99–$99** range; the $39.99 figure is a
  gifting SKU an earlier revision mistook for their price.
- **Our pipeline costs more** (frame OCR + vision inference vs caption scraping), so price-matching loses
  money on the power users who generate word of mouth. `ADR-0024` exists because inference cost already binds.
- **The "$60–80 category ceiling" anchors to a failing category** — MacroFactor is **$71.99/yr with no free
  tier**; MyFitnessPal Premium+ is **$99.99/yr**.
- **"No forced subscription" is the #9 stated churn reason** in competitor users' own words; **D23** proposes
  a one-time / lifetime tier, with Paprika ($29.99 once), Recipe Fox ($10 once), Copy Me That ($65 lifetime)
  and Crouton ($24.99 once + optional sub) as proven shapes.

⚠️ **The reconciliation, which is the actual recommendation**: be **more** generous on the differentiator and
the core loop — nutrition truth, privacy (D4a), the plan-shop-cook cycle — and **raise price and gate volume,
AI and inference, automation, planning horizon, export and household seats**. "Give less" and "give more"
point at **different things**: less unlimited breadth, more depth of the thing that proves we are right. ⛔ It
is emphatically **not** a general tightening, which `FR-058i` forbids deciding without measurement and which
the competitive evidence says would surrender the position. **And `FR-058h-i` removes nutrition from the gate
list outright** — an earlier revision of the competitive document made exactly that mistake and corrected
itself.

---

## 9. Beyond monetization — four dimensions that decide whether any of it works

### 9.1 ⛔ Why would anyone pay for a recipe? — the premise, tested

`001-FR-004` makes every public recipe readable by any signed-in user and `001-FR-005` makes it cloneable, and
the open web is saturated with free recipes. **The premise survives, but not in the shape it was assumed.**

| Finding                                       | Figure                                          |
| --------------------------------------------- | ----------------------------------------------- |
| Global cookbook sales                         | **> $4bn**                                      |
| Paper cookbook market                         | **~$7.7bn (2024) → ~$11.8bn (2032)**, 6.2% CAGR |
| Cookbooks as a share of book publishing       | **~27%**                                        |
| Cookbook buyers who still prefer **physical** | **~70%**                                        |
| Specialty-diet digital collections vs general | reportedly outsell by **~300%**                 |

**That market exists entirely inside a world of free online recipes**, so free substitutes are not the
objection they appear to be. ⚠️ **But what is bought is not a recipe.** The stated reasons are curation and
credibility, variety, step-by-step reliability, findable ingredients, design, and the author's voice — a
**bounded, opinionated, trustworthy set**. A recipe is a commodity; a collection is a product.

⭐ **And the highest-converting axis is a CONSTRAINT, not a cuisine.** This is where the platform can build
what the free web structurally cannot: a constraint that is **machine-verified** against resolved ingredients
and USDA nutrition rather than asserted by an author. `FR-087` makes the collection the primary sellable unit;
`FR-088` requires the claim to be verified — a **safety** requirement before a commercial one, since an
allergen claim on a paid product is physical-harm exposure. ⚠️ The 70% physical preference also strengthens
print-on-demand (`1f`), which remains out of scope on fulfilment grounds.

### 9.2 ⛔ Households — the collision neither spec can see

`017-FR-030`…`017-FR-034` make a household first-class with a seat count and scope meal plans to it
(`017-FR-031`). `FR-029a` makes a purchased recipe **private to the buyer**. **A household meal plan can
therefore reference a recipe the other members cannot read** — a day-one support ticket that neither `017` nor
`018` can see from its own side.

Resolved **household-scoped** (`FR-092`) on three grounds: `017-FR-030` makes every user a household, so there
is no "no household" branch; planning and grocery lists are already household-scoped, so account-scoping
breaks the workflow the purchase exists to serve; and a per-person licence on a family's dinner is
unenforceable and hostile. ⛔ **The consequence is stated rather than hidden: one sale can serve a household of
six**, and `FR-046` must disclose the scope so a chef prices for it knowingly.

### 9.3 ⛔ Instrumentation — `FR-058i` was an unenforceable control

`FR-058i` forbids narrowing the free tier until all five value channels are measured. **Nothing specified how
any of them is measured**, which is the exact shape of a control that reads green because nothing is checking.
`FR-096`–`FR-099` fix it, and two lines carry the weight:

- ⛔ **`FR-098` — an unmeasured channel reports as UNMEASURED, never as zero.** A dashboard showing four
  channels and a silent zero _looks_ like five were measured; `FR-058i` would read satisfied while being
  violated in fact.
- ⚠️ **`FR-097` — the attribution window and multi-touch rule must be stated, never defaulted.** Last-touch is
  what appears when nobody chooses, and it systematically under-credits the **corpus** and **social-proof**
  channels, which are early-touch by nature — and which are precisely the channels a tightening would destroy.

### 9.4 ⭐ Earned ranking is not bought ranking

Etsy reports that Star Sellers _"made more in sales and got more listing views, on average, than similar
non-Star Sellers,"_ and that the badge _"can boost the quality score of listings in search."_ **That is a
ranking effect obtained by behaviour, not by payment** — compatible with `FR-014`'s "stated and identical for
every chef" so long as the criteria are published and objective, and it delivers much of promoted placement's
_discovery_ benefit at none of its trust cost.

⛔ **This narrows `C-018-003b` materially**: the question is not _"may ranking ever vary"_ but _"may ranking be
**bought**."_ ⚠️ Recorded failure mode: Etsy sellers widely describe the Star Seller thresholds as
unattainable, which converts a motivator into a demotivator and a support burden — `FR-005b` requires criteria
attainable by a good chef with modest volume. **A tier nobody can reach is worse than no tier.**

---

## 10. Sources

- [The State of Subscription Apps 2026 — RevenueCat](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- [2.1% vs 10.7%: the paywall data that changes the strategy](https://neoads.substack.com/p/hard-paywalls-convert-less-but-earn)
- [Hard Paywall vs Freemium 2026 — Airbridge](https://www.airbridge.io/en/blog/hard-paywall-vs-freemium-2026)
- [Hard Paywall vs Soft Paywall vs Freemium: Which Converts Best? — Airbridge](https://www.airbridge.io/en/blog/hard-vs-soft-paywalls)
- [What does a high-performing paywall look like in 2026? — Adapty](https://adapty.io/blog/high-performing-paywall-2026/)
- [Freemium vs Free Trial vs Hard Paywall (2026) — vMobify](https://vmobify.com/blog/freemium-vs-free-trial)
- [Freemium Conversion Rate Benchmarks 2026 — Artisan Strategies](https://www.artisangrowthstrategies.com/blog/freemium-conversion-rate-benchmarks)
- [iOS free-to-paid conversion benchmarks in 2026 — AppsOps](https://appsops.store/blog/ios-free-to-paid-conversion-benchmarks-2026)
- [Digital Fairness Act Unpacked: Dark Patterns — Osborne Clarke](https://www.osborneclarke.com/insights/digital-fairness-act-unpacked-dark-patterns)
- [Regulating dark patterns in the EU: Towards digital fairness — European Parliament Think Tank](https://epthinktank.eu/2025/01/14/regulating-dark-patterns-in-the-eu-towards-digital-fairness/)
- [Back to the Future-Proof: Four Reforms for the Better Regulation of Dark Patterns under the UCPD and Art. 25 DSA — European Journal of Risk Regulation](https://www.cambridge.org/core/journals/european-journal-of-risk-regulation/article/back-to-the-futureproof-four-reforms-for-the-better-regulation-of-dark-patterns-under-the-unfair-commercial-practices-directive-and-article-25-of-the-digital-services-act/B2C04326235DD360A456762AEB5BAB76)
- [Dark Patterns in E-commerce Promotions: Urgency Without Misleading — Consentmo](https://www.consentmo.com/blog-posts/dark-patterns-in-e-commerce-promotions-shopify-merchants-urgency-without-misleading)
- [Avoid Dark Patterns: Privacy Compliance Best Practices — Usercentrics](https://usercentrics.com/knowledge-hub/dark-patterns-and-how-they-affect-consent/)
- [First-Party Shopper Data in Retail Media: 2026 Playbook — Osmos](https://www.osmos.ai/blog/first-party-data-in-retail-media-the-complete-targeting-guide)
- [Future of Retail Media 2026: Marketplaces, RMNs & FMNs Decoded — Osmos](https://www.osmos.ai/blog/future-of-retail-media-retailers-becoming-media-networks)
- [Commerce media: what is it? And what is the opportunity? — Decentriq](https://www.decentriq.com/article/commerce-media)
- [FAQ on data clean rooms — eMarketer](https://www.emarketer.com/content/faq-on-data-clean-rooms-how-retail-media-driving-adoption-marketers-demand-proof)
- [Publishers, social platforms and commerce media networks are staking their claim to first-party data — Digiday](https://digiday.com/sponsored/publishers-social-platforms-and-commerce-media-networks-are-staking-their-claim-to-first-party-data/)
- [Etsy Statistics 2026: Revenue, Sellers, Buyers & GMS Data — Skillademia](https://www.skillademia.com/statistics/etsy-statistics/)
- [How Etsy Ads Work in 2026 and When to Turn Them Off — ListingView](https://listingview.io/blogs/how-etsy-ads-work-in-2026-and-when-to-turn-them-off)
- [How much Etsy takes from a sale — full fee breakdown (2026)](https://www.gelato.com/blog/how-much-does-etsy-take-from-a-sale)
- [Referral Program Benchmarks: What's a Good Conversion Rate in 2026? — ReferralCandy](https://www.referralcandy.com/blog/referral-program-benchmarks-whats-a-good-conversion-rate-in-2025/)
- [Referral Program Statistics & Benchmarks 2026 — Rivo](https://www.rivo.io/blog/referral-program-statistics)
- [Viral Coefficient (K-Factor): Formula and a Good Benchmark — Farabiulder](https://farabiulder.com/blog/viral-coefficient-k-factor)
- [Pricing for Network Effects: When More Users Create More Value — Monetizely](https://www.getmonetizely.com/articles/pricing-for-network-effects-when-more-users-create-more-value)
- [Marketplace Network Effects: Building Self-Growing Platforms — CS-Cart](https://www.cs-cart.com/blog/marketplace-network-effects/)
- [User-Generated Data Network Effects and Market Competition Dynamics — Fordham IPLJ](https://ir.lawnet.fordham.edu/iplj/vol34/iss1/1/)
- [Food Blog Income Streams in 2026: Ads, Brand Deals & Beyond](https://www.jupiter.co/blog/how-food-bloggers-make-money)
- [Instacart Affiliate Program for Food Bloggers: How Shoppable Recipes Pay](https://www.jupiter.co/blog/instacart-affiliate-for-food-creators)
- [Instacart Affiliate Programs — Instacart](https://www.instacart.com/company/affiliate)
- [Instacart Affiliate Program Review 2026 — CommissionDex](https://commissiondex.com/programs/instacart-affiliate/)
- [Walmart Affiliate Program: Rates, Rules & Payouts 2026](https://www.argil.ai/blog/walmart-affiliate-program-cd8f1)
- [Walmart Creator Program: Requirements and Commission](https://creatorflow.so/blog/walmart-creator-program/)
- [Chicory — Publishers](https://chicory.co/publishers)
- [Chicory Enables Contextual Commerce on Warner Bros. Discovery Recipe Sites](https://chicory.co/blog-feed/warner-bros-discovery-recipe-sites-join-chicory-contextual-commerce-platform)
- [CPG Retail Marketing 2026: The $69B Retail Media Playbook — Jetfuel](https://jetfuel.agency/cpg-retail-marketing-strategy-2026/)
- [Retail Media Network Monetization for Retailers: CPM to P&L — Osmos](https://www.osmos.ai/blog/media-retail-network-roas-monetization-2026)
- [Whisk launches AI-powered sponsored product platform for CPG brands — Netimperative](https://www.netimperative.com/2019/09/19/whisk-launches-ai-powered-sponsored-product-platform-for-cpg-brands/)
- [Whisk Launches B2B Content Management Tool to Structure and Organize Recipe Data — The Spoon](https://thespoon.tech/whisk-launches-b2b-content-management-tool-to-structure-and-organize-recipe-data/)
- [How CPG Brands Are Using AI to Develop New Recipes — SideChef](https://www.sidechef.com/business/recipe-ai/cpg-brands-using-ai-recipe-innovation)
- [How Cooking Creators Make Money on YouTube (2026) — vidIQ](https://vidiq.com/blog/post/how-cooking-experts-make-money-youtube/)
- [How to turn recipes into a digital product in 2026 — Member Kitchens](https://memberkitchens.com/updates/how-to-turn-recipes-into-a-digital-product)
- [Micro-Event Monetization Playbook for Creators in 2026 — socialmedia.live](https://socialmedia.live/micro-event-monetization-playbook-2026)
- [Creator Revenue Sharing — X Help](https://help.x.com/en/using-x/creator-revenue-sharing)
- [X Expands Creator Earnings in 2026: New Revenue Sharing Model Explained](https://medium.com/write-a-catalyst/x-expands-creator-earnings-in-2026-new-revenue-sharing-model-explained-31a9a079161c)
- [Creator Monetization Models 2026: Complete Guide — Communipass](https://communipass.com/blog/creator-monetization-in-2026-the-5-models-that-actually-generate-recurring-revenues/)
- [AI Content Licensing for Publishers: What's Available in 2026 — Neuro Media](https://newormedia.com/blog/ai-content-licensing-for-publishers/)
- [Publisher AI Licensing Deals: The 2026 Numbers — CASRAI](https://casrai.org/news/scholarly-publisher-ai-licensing-deals-2026)
- [A timeline of the major deals between publishers and AI tech companies in 2025 — Digiday](https://digiday.com/media/a-timeline-of-the-major-deals-between-publishers-and-ai-tech-companies-in-2025/)
- [The Future of Content Monetization Is Tiny, Transparent and Customer-First — CMSWire](https://www.cmswire.com/digital-experience/beyond-ads-why-cx-leaders-should-care-about-nano-payments/)
- [Micropayments, Tipping & On-Chain Social — Lumos Business](https://lumosbusiness.com/micropayments-tipping-on-chain-social/)
- [App Review Guidelines — Apple Developer](https://developer.apple.com/app-store/review/guidelines/)
- [Selling Digital Goods Outside the App Store: A 2026 Compliance Playbook — Dodo Payments](https://dodopayments.com/blogs/digital-goods-outside-app-store)
- [App Store & Google Play Policy Changes 2026 — AppsOnAir](https://www.appsonair.com/blogs/2025-mobile-app-store-policy-updates)
- [Best Creator Monetization Platforms (2026 Comparison) — Creator Economy Tools](https://creatoreconomytools.com/creator-monetization-platforms)
- [12 Best Patreon Alternatives for Serious Creators in 2026 — Circle](https://circle.so/blog/patreon-alternatives)
- [10 Creator Platforms Ranked by Real Payouts (2026) — Talkspresso](https://talkspresso.com/blog/creator-economy-platforms-which-pay)
- [27 Creator Economy Income Distribution Statistics — Archive](https://archive.com/blog/creator-economy-income-statistics)
- [Creator Economy Statistics 2026 — Circle](https://circle.so/blog/creator-economy-statistics)
- [The State of the Creator Economy (2026)](https://thecreatoreconomy.com/post/the-state-of-the-creator-economy-2026)
- [Key Fraud Takeaways From the 2026 MRC Report — Chargeback Gurus](https://www.chargebackgurus.com/blog/fraud-statistics-from-mrc-report)
- [Signifyd 2026 State of Fraud Report](https://www.signifyd.com/news-releases/state-of-fraud-report/)
- [Driven by AI, customers now rival criminals for fraud — Ravelin](https://www.ravelin.com/blog/ravelin-fraud-survey-2026-press-release)
- [Fraud Prevention For Digital Commerce — Sift](https://sift.com/blog/fraud-prevention-digital-commerce-retail-ecommerce/)
- [Online Marketplace Fraud Risk Identification Checklist for AML/CFT](https://amluae.com/wp-content/uploads/2025/08/Online-Marketplace-Fraud-Risk-Identification-Checklist-for-AML-CFT.pdf)
- [FTC Proposes Rule Changes and New Rule to Deter Deceptive Earnings Claims](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-proposes-rule-changes-new-rule-deter-deceptive-earnings-claims-multilevel-marketers-money-making)
- [Earnings Claim Rule: Notice of Proposed Rulemaking — FTC](https://www.ftc.gov/system/files/ftc_gov/pdf/r111003earningclaimsnprm01132025.pdf)
- [FTC Income Claims Crackdown Signals Rising Risk for Affiliates and Influencers — Kronenberger Rosenfeld](https://kr.law/news/article-detail/ftc-income-claims-crackdown-on-mlm-participant-signals-rising-risk-for-affiliates-and-influencers)
- Internal: [`docs/competitive/02-gap-analysis-and-strategy.md`](../../../docs/competitive/02-gap-analysis-and-strategy.md) — P4, D5, D18, D23
- [Cookbook Sales Statistics: Market Data Report 2026 — Gitnux](https://gitnux.org/cookbook-sales-statistics/)
- [Paper Cook Books Market Size, Share, Trends & Forecast — Verified Market Research](https://www.verifiedmarketresearch.com/product/paper-cook-books-market/)
- [Digital Recipe Consumption Market Size, Share, Trends & Forecast — Verified Market Research](https://www.verifiedmarketresearch.com/product/digital-recipe-consumption-market/)
- [17 Digital Recipe Collections That Sell Like Crazy — Red Cheeks Girl](https://redcheeksgirl.com/digital-recipe-collections-that-sell/)
- [What is the "Star Seller" Badge? — Etsy Help](https://help.etsy.com/hc/en-us/articles/4403058372503-What-is-the-Star-Seller-Badge)
- [5 Star Sellers Share the Impact of the Badge on Their Shops — Etsy Seller Handbook](https://www.etsy.com/seller-handbook/article/1099574425189)
- [The Etsy Star Seller Program — Why it is Unattainable — Fera](https://fera.ai/blog/posts/etsy-star-seller-program-is-unattainable)
- Internal: [`specs/017-recime-parity/spec.md`](../../017-recime-parity/spec.md) — FR-030…FR-034 (household, seats)
