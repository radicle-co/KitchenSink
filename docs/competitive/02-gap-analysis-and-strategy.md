# Commise vs ReciMe — Gap Analysis and Strategy to Win

**Date**: 2026-08-21
**Spec baseline**: PR #91 branch `chore/code-quality-enforcement-phase-1-2` @ `70087eab` — 14 feature specs, ~200 FRs
**Code baseline**: same commit — what is actually deployed, not what is written down
**Companion**: [`01-recime-teardown.md`](./01-recime-teardown.md)

---

## 0. The verdict, stated plainly

**We do not currently have a plan that beats ReciMe. We have a plan that beats a different company.**

Our portfolio is designed as an _integrated household cooking platform_ — recipes, planning, grocery,
nutrition, creators, education, notifications, all governed by a rigorous contract and provenance model. That
is a good long-run thesis and much of the engineering underneath it is genuinely better than theirs.

But ReciMe does not compete on that axis at all. They won **one job** — _get the recipe out of the video_ —
and they won it so decisively that 373,000 people rated them 4.7–4.8★. Against that specific job, our
14-feature portfolio currently offers: **nothing**. Not "less" — the capability does not appear in any
requirement in any of our specs.

Three things follow, and they are the whole document:

1. **We must win their wedge, not route around it.** A better meal planner does not take a ReciMe user.
2. **We must stop charging for the thing they give away free** — privacy — and start charging for the things
   they charge for, priced below them.
3. **We should attack the half of the category nobody has solved** (nutrition truth, cost truth, household
   truth) rather than the half ReciMe already owns adequately.

---

## 1. Reality check — spec'd is not shipped

Before any gap analysis, the honest state of the build:

| Feature                                                          | Spec'd           | **Shipped**                                                                   |
| ---------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| 001 Recipes / collections / ratings / search / versions / photos | ✅               | ✅ **live** (`recipe-service`, `@commise/features-recipes`, web + mobile)     |
| 002 Auth (Clerk)                                                 | ✅               | ✅ live                                                                       |
| 003 USDA food data                                               | ✅               | ✅ **live** (`food-service` — golden record, crosswalk, resolution lifecycle) |
| **004 Recipe importing**                                         | ✅ 906-line spec | ❌ **nothing built** — no import module exists in `recipe-service`            |
| 005 AI integration                                               | ✅               | ❌                                                                            |
| 006 Meal planning                                                | ✅               | ❌                                                                            |
| 007 Grocery lists                                                | ✅ (6 FRs)       | ❌                                                                            |
| 008 Cooking mode                                                 | ✅ (4 FRs)       | ❌                                                                            |
| 009 Nutrition planning                                           | ✅ (4 FRs)       | ❌                                                                            |
| 010 Subscriptions                                                | ✅               | ❌                                                                            |
| 011 Digitization (OCR)                                           | ✅               | ❌                                                                            |
| 012 / 013 / 014 Creators / school / notifications                | ✅               | ❌                                                                            |

**Our entire competitive position against ReciMe today is: a recipe box you have to type into by hand.**
That is the product ReciMe's free tier gives away, minus the import.

⚠️ **Undocumented shipped behaviour.** `ServingScaleControl` / `servingScale.ts` (recipe scaling) and
`cookingProgress.ts` / `useCookingProgress.ts` are **implemented with no FR anywhere in `001`**. Scaling is a
headline ReciMe feature we apparently already have and have not written down. That drift should be closed in
either direction deliberately.

---

## 2. Feature gap matrix

`✅` shipped · `📝` specified only · `❌` absent from every spec · `⚠️` specified but structurally blocked

| Capability                                                | ReciMe                                                                                                        | Commise                                                                              | Gap severity                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Import from TikTok / Reels / YouTube / Facebook video** | ✅ signature                                                                                                  | ❌ **nothing**                                                                       | 🔴 **CRITICAL**                                                                 |
| Import from Instagram (caption)                           | ✅                                                                                                            | ⚠️ `004-FR-009` — caption-only, **gated on a Meta app approval that does not exist** | 🔴 CRITICAL                                                                     |
| Import from Pinterest                                     | ✅                                                                                                            | ❌                                                                                   | 🟠 High                                                                         |
| Import from website URL                                   | ✅                                                                                                            | 📝 `004-FR-008`                                                                      | 🟠 High (unbuilt)                                                               |
| Import from screenshot                                    | ✅                                                                                                            | 📝 via `011`                                                                         | 🟠 High (unbuilt)                                                               |
| Import from cookbook photo / handwriting (OCR)            | ✅ Plus                                                                                                       | 📝 `011` (Textract)                                                                  | 🟡 Medium                                                                       |
| Paste raw text                                            | ✅ Plus                                                                                                       | 📝 `004-FR-052`                                                                      | 🟡 Medium                                                                       |
| Bulk / structured file import                             | ❌ none found                                                                                                 | 📝 `004-FR-019`, `FR-026` (1,000/file)                                               | 🟢 **we win**                                                                   |
| Migration from Paprika/AnyList                            | ❌ informal only                                                                                              | 📝 partial                                                                           | 🟢 opportunity                                                                  |
| Browser extension                                         | ✅ 30K users                                                                                                  | ❌                                                                                   | 🟠 High                                                                         |
| Share-sheet capture                                       | ✅ primary path                                                                                               | ❌ not specified                                                                     | 🔴 **CRITICAL**                                                                 |
| Cookbooks / collections                                   | ✅ free                                                                                                       | ✅ **shipped**                                                                       | 🟢 parity                                                                       |
| Search / tags / filters                                   | ✅                                                                                                            | ✅ shipped (`001-FR-006`)                                                            | 🟢 parity                                                                       |
| Serving scaling                                           | ✅ free                                                                                                       | ✅ shipped (**unspecified**)                                                         | 🟢 parity                                                                       |
| Unit conversion metric ⇄ imperial                         | ✅ Plus                                                                                                       | ❌ **absent from every spec**                                                        | 🟠 High                                                                         |
| Recipe versioning / history                               | ❌                                                                                                            | ✅ shipped (`001-FR-007b`, 10 versions + S3 archive)                                 | 🟢 **we win**                                                                   |
| Concurrent-edit conflict resolution                       | ❌                                                                                                            | ✅ shipped (`001-FR-007c`, 409 + merge UI)                                           | 🟢 **we win**                                                                   |
| Meal plan calendar                                        | ✅ free, **1 week only**                                                                                      | 📝 `006` — **90-day range**, 4 slots, swap, orphan handling                          | 🟢 **we win on paper**                                                          |
| Meal plan templates / reuse                               | ❌                                                                                                            | 📝 `006-FR-028`                                                                      | 🟢 **we win on paper**                                                          |
| Grocery list w/ aisle sort                                | ✅ free                                                                                                       | 📝 aisle grouping is in `007`'s **plan**, **not in any FR**                          | 🟠 High                                                                         |
| Grocery list **duplicate merge**                          | ❌ **known failure**                                                                                          | 📝 `007-FR-028` explicitly requires dedup + summed quantities                        | 🟢 **we win — target this**                                                     |
| Pantry / "already have"                                   | ❌                                                                                                            | 📝 `007-FR-029` + `user_pantry_items` (7-day TTL) in plan                            | 🟢 opportunity                                                                  |
| Household / family sharing                                | ⚠️ cookbook invite ships **broken** (delivers empty cookbook); no household account model                     | ❌ **`007` US-009 has NO FR**; `006-FR-022` says "no sharing model"                  | 🔴 **CRITICAL — nobody wins**                                                   |
| **Bulk import / export (portability)**                    | ❌ **staff-confirmed absent** — a 2,000-recipe Paprika backup cannot be imported; no JSON/CSV export          | 📝 `004-FR-019/026` bulk file import (1,000/file); export unspecified                | 🟢 **we win — and their users are asking out loud**                             |
| Dark mode                                                 | ❌ confirmed absent                                                                                           | ❌ unspecified                                                                       | 🟠 cheap win                                                                    |
| Android feature parity                                    | ❌ **staff-confirmed** iOS-first: smart grocery combine, tags, offline, icon customisation, ingredient search | ✅ `001-FR-044a` makes single-platform work a **blocking defect**                    | 🟢 **we win structurally**                                                      |
| Accessibility                                             | ⚠️ no audit, no dark mode, no evidence of Dynamic Type/TalkBack                                               | ✅ `NFR-003`/`NFR-004` on **every** feature                                          | 🟢 **we win structurally**                                                      |
| Real-time collaborative lists                             | ❌                                                                                                            | ❌                                                                                   | 🔴 open category gap                                                            |
| Grocery delivery / checkout                               | ✅ in-app, partner unnamed                                                                                    | 📝 `007-FR-031` handoff URL, **premium**                                             | 🟡 Medium                                                                       |
| Nutrition per recipe                                      | ✅ Plus — **unsourced, "beta", likely LLM**                                                                   | ✅ **shipped, USDA-backed** (`003` + ADR-0021)                                       | 🟢 **WE WIN — biggest asset**                                                   |
| Nutrition targets / macro plan                            | ❌                                                                                                            | 📝 `009` (4 FRs)                                                                     | 🟢 opportunity                                                                  |
| Health-app sync (Apple Health)                            | ❌                                                                                                            | ❌                                                                                   | 🔴 open category gap                                                            |
| Cook mode                                                 | ✅ Plus                                                                                                       | 📝 `008` — **4 FRs**: steps, nav, timers, wake-lock                                  | 🟡 at best parity                                                               |
| Voice / hands-free cooking                                | ❌                                                                                                            | ❌                                                                                   | 🟠 open gap                                                                     |
| In-cook ingredient check-off                              | ❌                                                                                                            | ✅ shipped (`useCookingProgress`, unspecified)                                       | 🟢 quiet win                                                                    |
| AI recipe generation                                      | ✅ Gemini                                                                                                     | ⚠️ `005-FR-016` **BYOK — user supplies their own API key**                           | 🔴 **CRITICAL**                                                                 |
| AI cooking assistant                                      | ✅ "Ask ReciMe", Plus                                                                                         | ❌                                                                                   | 🟠 High                                                                         |
| Pantry photo → recipe                                     | ✅ (competition entry; live status unverified)                                                                | ❌                                                                                   | 🟡 Medium                                                                       |
| Web app                                                   | ✅ beta — **cannot plan or shop**                                                                             | ✅ **full Next.js app, parity is a governing rule**                                  | 🟢 **WE WIN**                                                                   |
| Android                                                   | ✅ 1M+ installs                                                                                               | 📝 Expo app exists, feature-thin                                                     | 🟡                                                                              |
| Mac / visionOS                                            | ✅ (iPad-compat mode)                                                                                         | ❌                                                                                   | 🟢 low value                                                                    |
| Export / portability                                      | ✅ PDF only (Plus)                                                                                            | ✅ GDPR erasure shipped; export not specified                                        | 🟡 opportunity                                                                  |
| Localization                                              | 5 languages                                                                                                   | ✅ `@commise/i18n` enforced by FR on every feature                                   | 🟢 **we win structurally**                                                      |
| **Public recipe library / discovery**                     | ❌ **deliberately none — a ceiling on network effects, SEO, and their own creator ambition**                  | ✅ shipped                                                                           | 🟢 **we win — but see §3, `imported_public` is the liability, not the library** |
| Creator profiles / monetisation                           | 🔶 "Creator Partnerships", early                                                                              | 📝 `012` + `013`                                                                     | 🟢 opportunity                                                                  |

---

## 3. The four structural problems in our plan

Ranked by how much damage each does. These are not feature requests — each is a decision already written into
a spec that will lose against ReciMe as written.

### 🔴 P1 — We have no video import, and no share-sheet. This is the whole game.

**The gap:** `TikTok` appears **once** in the entire `specs/` tree, in a `012-creator-profiles` research file.
YouTube appears only in `013-cooking-school` and the executive market doc. `004-recipe-importing` — our
906-line import spec — covers URL, structured file, paste, and Instagram-caption. `004-FR-009` states outright
that "video-only or image-only posts without recipe text are unsupported and the user MUST be told so."

**Why this is fatal as written:** a ReciMe user's entire relationship with the product is _see a Reel → tap
share → it's in my cookbook_. We have specified neither the input (video) nor the gesture (share sheet). A
user cannot even begin to switch.

**Compounding it:** `004-FR-009` is gated on an approved Meta application (D-002). Meta does not grant that
for this use case at our stage. So our **only** social channel is blocked behind a credential we probably
cannot get, and it would only read captions if we did.

**What to do — and the version that beats them rather than matching them.** Their pipeline is
caption → audio → source-site lookup, with **no visual tier**. Add the fourth tier they don't have:

1. Caption / description text
2. Audio transcription
3. **Frame sampling + on-screen text OCR** ← the tier that reads silent, text-overlay TikToks they fail on
4. **Vision model over sampled frames** for ingredients and technique shown but never said
5. Source-site lookup as fallback
6. **Every extracted quantity resolved against our USDA food service**, with per-field confidence

That is not incremental. Android Police watched ReciMe **fail an entire video** and **silently drop a step**
that tiers 3–4 would have caught. Ship this and the head-to-head review writes itself.

**Also non-negotiable: a share-sheet extension on iOS and Android, and a browser extension.** Their Chrome
extension has 30K users on its own. Capture must be one tap from inside the app the recipe lives in.

---

### 🔴 P2 — We charge for privacy. They give it away. This is a product, trust, AND legal problem.

**The rule as written:** `001-FR-003` — "System MUST default new user-created recipes to public visibility.
Premium users MAY set their own original recipes to private. **Free-tier users' recipes are always public.**"
`010-FR-040` restates it. `001-FR-004`/`FR-005` let any authenticated user view and clone public recipes.

**Three separate failures stack here.**

1. **Product.** A recipe box is an intimate object — family recipes, a grandmother's card, a diet you're not
   telling people about. ReciMe's answer is "yours, private, always, free." Ours is "everyone can read and
   copy it unless you pay $6.99/month." That is the worst possible thing to meter, and it is metered against a
   competitor who doesn't meter it at all.
2. **Trust.** A new user's _first_ action produces a public artifact. There is no benign framing for that.
3. **Legal — and this is the serious one.** ReciMe's copyright defence rests on exactly one fact, which they
   state explicitly: no central library, everything private, personal clipping only. Our spec does the
   opposite. `004-FR-011` classifies web/Instagram imports as `imported_public`; `001-FR-004` makes them
   viewable by any authenticated user; `001-FR-005` makes them cloneable. **We would be operating a public,
   searchable, cloneable library of recipes imported from other people's websites and social posts.** Our
   upstream rigour — `robots.txt` handling, the paywalled-source blocklist, source attestation — is real and
   better than theirs, and the visibility layer gives all of it back. Food bloggers are an organised and vocal
   constituency about exactly this.

**⚠️ Three questions, separated — the first correction to this document (2026-08-21).**
An earlier revision of P2 collapsed three separable decisions into one verdict, and got the recommendation
wrong as a result. They are:

| Question                                             | Verdict                                        |
| ---------------------------------------------------- | ---------------------------------------------- |
| **(a) Should we have a public recipe layer at all?** | **Ours is BETTER than theirs.** See below.     |
| **(b) Should public be the default?**                | Weak — a mental-model mismatch, but survivable |
| **(c) Should privacy be behind the paywall?**        | **Wrong** — and independent of (a) and (b)     |

**(a) The public layer is a strategic asset ReciMe structurally cannot copy.** Their private-only stance is a
ceiling, not just caution: no network effects (the landscape sweep found _no_ product in this category has
them, and ReciMe forgoes the only mechanism that produces them); a single acquisition channel, TikTok, which
is also their core product dependency; no owned SEO or discovery surface; `001-FR-013` ratings would be inert;
and — decisively — **their own stated ambition contradicts their own defence.** They run a "Creator
Partnerships" page and have described a "Substack for cooking" vision, which is unbuildable on a corpus where
nothing may be published. To pursue it they must break the stance that currently protects them. We do not have
that problem. **Do not give this up.**

**(b) is a UX flaw, not a strategic one.** And the shipped rule is more considered than a summary suggests —
`visibilityPolicy.ts` implements the C-004 matrix, under which `imported_physical` and `imported_paid` are
**private-only at every tier** (`imported_paid` may never be public). A photographed recipe card or cookbook
page is already private for everyone. What is public is: recipes the user typed, and recipes imported from
public web/Instagram sources.

**(c) is the actual defect, and it is separable.** "Free-tier user-created recipes are public-only" is not a
default — it is a **prohibition**; a free user cannot choose privacy at all. Nothing about the public-library
strategy requires that. A thriving public corpus, a public default, and a free user's ability to flip the
switch are fully compatible.

**And the legal exposure — restated adversarially (2026-08-21), because the first version was both too
breezy and missed the biggest item.**

_Where the first version was too reassuring:_

- **"Ingredient lists are largely uncopyrightable" is US-only and partial.** That is _Publications Int'l v.
  Meredith_ (**7th Cir.** 1996) plus Copyright Office Circular 33 — not universal, and Meredith itself carves
  out "substantial literary expression". **Photos are unambiguously protected, and `004-FR-008` extracts photo
  URLs.** Step prose is a grey area. We ship in five-plus locales; Australia has no fair use at all, only fair
  dealing.
- **`NFR-008` sanitisation is NOT a copyright mitigation.** It is an XSS control. Stripping markup does nothing
  about copying the text. Citing it here was a category error.
- **`robots.txt` compliance is NOT a mitigation either — our own spec says so.** `004-FR-023` carries an
  explicit finding, proven against gutenberg.org, that robots.txt compliance is not terms-of-use compliance.
  The earlier draft cited the mitigation while ignoring our own refutation of it in the same requirement.
- **The clone chain multiplies republication.** `001-FR-005`: a clone of a public-source import **stays
  public**. One import becomes N public copies. ReciMe has zero of this.

_The item the first version missed entirely, and it is the largest:_

- ⚠️ **DMCA §512 safe harbour — we do not currently qualify.** Safe harbour requires a **registered agent**
  with the Copyright Office, a **repeat-infringer policy**, notice-and-takedown, and no direct financial
  benefit from infringing activity we control. Our specs place DMCA **only in `012` creator-profiles**. There
  is no registered agent, no repeat-infringer policy, and no takedown flow specified for the main recipe
  corpus. **Operating a public library of user-imported content without safe harbour is materially worse than
  operating one with it** — and fixing it is cheap, requires no product decision, and does not wait on
  D4a/D4b. This is **D24**, and it should be done regardless of what is decided about visibility.

_And the counter-argument, in the other direction — the severity may be overstated:_

- **Nobody has sued anyone here.** Copy Me That has run a public clipper for years; Paprika, Whisk/Samsung
  Food and Pinterest all import. The realistic exposure is **DMCA notices and food-blogger PR damage**, not
  litigation. The business risk is real; the litigation risk is speculative. The earlier draft presented them
  as one thing.
- **ReciMe's own posture is not the gold standard it was made out to be.** Their Terms take an _"irrevocable…
  reproduce, distribute, publicly display… prepare derivative works"_ licence on User Content, which sits
  badly against "we never republish"; and their privacy policy names no AI processor while Google's own page
  confirms user content reaches Gemini, which sits badly against "visible only to the individual user." They
  are better positioned **on the republication axis specifically**, and shakier elsewhere.

**Recommendation (revised — supersedes "flip everything to private"):**

1. **Keep the public library for `user_created`.** It is the flywheel and the thing they cannot match.
2. **Un-gate privacy from the paywall.** Free users may set their own recipes private. Monetise volume, AI,
   nutrition depth and household seats — what ReciMe monetises.
3. **Make `imported_public` private-to-the-importer by default**, public only by deliberate act (ideally with
   creator participation). This is where the legal delta actually lives, and it is a targeted fix rather than
   a wholesale retreat.

This keeps the asset and removes the liability. It remains an owner decision — (2) removes the free tier's
only current paywall lever, which is why P4's re-pricing has to land alongside it.

---

### 🔴 P3 — BYOK is not a consumer AI strategy

**As written:** `005-FR-015` requires users to "configure their preferred AI provider… by securely storing
their own API credentials (BYOK model)." `005-FR-016` calls _the user's_ provider. Scenario 4: no key
configured → we walk them through provider setup.

**The problem.** ReciMe's AI just works — Gemini, invisible, included. Ours asks a home cook to create an
OpenAI account, generate an API key, understand token billing, and paste a secret into a cooking app. The
mainstream conversion rate on that flow is approximately zero. Our own
`executive/05-business-plan.md` already concedes BYOK "may add setup friction for household users" and lists
testing it as an open question — that question is answered by the competitor.

**We already have the mechanism to fix it.** ADR-0024 specifies a **Bedrock** inference path with a
reserve-then-settle spend ceiling — a real, engineered, first-party AI cost-control system. That is the
platform-managed allowance `005` should be built on.

**Recommendation.** Invert the model: **platform-managed inference is the default and the product**; BYOK
becomes an optional power-user escape hatch for people who want unlimited or their own model. Metered
generously on free, unlimited on paid. Keep `005-FR-018`'s external-agent OAuth — meeting users inside
ChatGPT is a genuinely differentiated bet ReciMe has not made.

---

### 🔴 P4 — We are priced 50% above the leader, for less, with no way to charge on mobile

**Price.** `010-FR-041`: **$6.99/month, $59.99/year**, 14-day trial. ReciMe: **$39.99/year** (two first-party
sources), 7-day trial. AnyList — the collaboration leader — is **$9.99–$14.99/year**. The category's
mass-market ceiling is ~$60–80/yr, and we have placed ourselves at it while shipping less.

**⚠️ CORRECTION (2026-08-21) — an earlier revision of this section was wrong twice. Both corrections below.**

**Correction 1: the "$39.99 vs $59.99" comparison does not hold.** ReciMe has **no single price**. Their
gift-card page ($39.99/yr) is a **gifting SKU**, routinely discounted; their help article hedges explicitly
("depends on your plan and your country or region of purchase"); and the **App Store IAP ladder lists $59.99
twice**. Adapty's paywall data confirms they run **multiple A/B-tested price points**, and user reports span
$49.99, ~$60 and "$99/year". The honest statement is that **they run a tested range of roughly $29.99–$99**.
Against their $59.99 SKU we are at **parity**, not 50% above. The earlier claim selected the bottom of their
range and treated it as their price.

**Correction 2: Apple DOES permit external web checkout — in the US.** App Store Review Guidelines §3.1.1(a),
current text: _"These entitlements are **not required** for developers to include buttons, external links, or
other calls to action in their **United States storefront** apps… In all other storefronts, **except for the
United States storefront, where this prohibition does not apply**, apps and their metadata may not include
buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than
in-app purchase."_ So `executive/04-product-plan.md`'s IAP non-goal is **viable in the US** — ReciMe's own
market is 75% US — and **wrong for every other storefront**, which needs IAP or the commission-bearing
StoreKit External Purchase Link Entitlement.

**Two further arguments against the original "re-anchor cheaper" recommendation:**

- **It ignores our own COGS.** P1 adds frame OCR and vision inference. That is materially more expensive per
  import than ReciMe's caption-scraping. They can afford a low price _because their pipeline is cheap_.
  Matching a cheap-pipeline competitor's price with a far more expensive pipeline loses money on precisely the
  power users who generate word of mouth. ADR-0024 exists because we already know inference cost binds.
- **The "$60–80 category ceiling" anchors to a failing category.** In the same research: MacroFactor charges
  **$71.99/yr with no free tier at all**; MyFitnessPal Premium+ is **$99.99/yr**. And AnyList at $9.99/yr —
  cited earlier as a price anchor — is a 5-person, ~$2M-ARR lifestyle business. Citing it argues for becoming
  one.

**Revised recommendation.** The surviving claim is narrow: **do not price above them while shipping less.**
The likely correct move is the _inverse_ of the original — **hold or raise price, and buy the position with a
far more generous free tier**, with **nutrition-truth free** because it is the proof of the differentiator.
(The original recommendation gated nutrition behind premium while calling it our sharpest differentiator —
free users would never experience the reason to choose us.) Payment rails: **external web checkout for the US
storefront, IAP everywhere else.**

---

## 4. What we already have that they cannot easily answer

Five real assets. Two are shipped.

### 4.1 🟢 USDA-backed nutrition — shipped, and it is our sharpest weapon

Their nutrition names no source and is self-labelled **beta**; the best-evidenced read is an LLM estimate,
and users report it reads low. Ours is a **shipped, source-agnostic golden-record food service** (`003`) with
per-field provenance, a source crosswalk, `pg_trgm` fuzzy matching, an explicit
`PENDING/UNRESOLVED/RESOLVED/NOT_FOUND/FAILED` lifecycle, candidate disambiguation, and — per ADR-0021 — a
batched per-recipe nutrition projection with an honest `isComplete` flag and an `unaccounted` state that
refuses to invent a number.

**That last property is the marketing.** We can say _"we tell you when we don't know."_ They cannot, because
an LLM always produces a number. **"Nutrition you can actually trust — every number traced to USDA, and we
show you when we're unsure"** is a claim they cannot make without rebuilding their data layer.

### 4.2 🟢 Web + mobile parity is a governing rule, not an aspiration

`001-FR-044a` makes single-platform work a **blocking defect**. Their web app is beta and **cannot meal-plan
or make a grocery list**. Desktop meal planning is a real job — Plan to Eat built a whole business on it.

### 4.3 🟢 Recipe integrity: versioning, conflict resolution, erasure

`001-FR-007b` (10 versions + indefinite S3 archive), `001-FR-007c` (optimistic concurrency, 409 + side-by-side
merge, explicit refusal to last-write-wins), full GDPR erasure with rating re-derivation (`001-FR-013b`).
ReciMe has **no version history**, and has at least one report of a user losing all 30 recipes on upgrade.
"Your recipe box is never silently lost or overwritten" is a durable trust claim.

### 4.4 🟢 Import provenance and rigour

`004`'s `sourceType` classification, attestation-plus-citation for non-public sources, admin-governed
paywalled-domain blocklist, robots.txt handling, SSRF defence, sanitisation before persistence, per-field
confidence on every draft. This is genuinely better engineering than theirs — **provided P2 is fixed**, it
becomes a _creator-friendly_ story rather than a liability.

### 4.5 🟢 Depth already specified where they are thin

90-day plans vs their 1 week. Templates vs none. Explicit dedup-and-sum in `007-FR-028` vs their known
merge failure. These are on paper only — but they are the right paper.

---

## 5. Where the whole category is weak — the disruption vectors

Nobody in ~20 products researched owns these. Ranked by defensibility.

**V1 — Nutrition truth.** No app publishes a validated accuracy benchmark for _recipe-derived_ nutrition.
ReciMe's is beta and unsourced; Plan to Eat users report calories "wildly off". **We are already built for
this.** Cheapest vector, highest credibility, uses a shipped asset.

**V2 — The plan → cook → log bridge.** There is **no interoperability anywhere** between meal planning and
nutrition logging. MyFitnessPal's public API has been dead since 2019. Plan a week, get zero logging credit.
Daily logging retains far better than weekly planning — owning the bridge means owning the higher-frequency
habit. `009` is 4 FRs today; this is where it should go, plus Apple Health / Health Connect.

**V3 — Cost truth.** AI meal planners understate real grocery cost by **21–29%** because Walmart publishes no
pricing API and Kroger's is partial. Nobody — including ChatGPT — plans against real local prices. This is a
data-acquisition problem, which makes it _durable_ if solved. Budget-constrained meal planning is a genuine
unserved job.

**V4 — The household as the unit.** AnyList sustains 4.9★/80K ratings on 5 people and $120K of funding purely
on real-time shared lists. ReciMe's household story is contradictory at best. **Ours is worse: `006-FR-022`
says "Plans are private to their owner; there is no sharing model in this feature," and `007`'s US-009
household sharing user story has no FR behind it at all.** Every AI-native newcomer is bolting sharing onto a
single-user product later. Designing household-first from the start is a structural advantage none of them
has.

⚠️ **One correction to circulating analysis:** ChatGPT's grocery integration (Instacart, DoorDash, Target,
Uber — announced **Oct 10, 2025**) is a **handoff**, not in-chat checkout — users are prompted to "launch the
Uber Eats app to complete their orders"
([Grocery Dive](https://www.grocerydive.com/news/chatgpt-instacart-doordash-uber-target-grocery-delivery/802554/)).
It terminates in the same place `007-FR-031` does. The substitution threat is real in the _plan-and-list_
middle of the funnel; it has **not** closed the last mile.

---

## 5A. What their own users are asking for — the shortest path to their churn

Every item below is drawn from **r/recime, ReciMe's own company-run subreddit**, or from verbatim App Store
reviews. This is a demand list they have published for us. Ranked by how cheap it is for us to serve.

| #   | What their users want                                                                              | Our position                                                         | Cost to us                      |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| 1   | **Android parity** — the most frequent independent ask                                             | `001-FR-044a` already makes one-platform work a **blocking defect**  | **Already paid for**            |
| 2   | **Bulk export (JSON/CSV) and bulk import** — staff say bulk import "isn't supported at the moment" | `004-FR-019/026` covers import (1,000/file); export is **D14**       | Low                             |
| 3   | **Working household/cookbook sharing** — theirs delivers an empty cookbook                         | Nothing specified — **D10/D18**                                      | High, but it's the moat (§5 V4) |
| 4   | **Grocery duplicate-item merging** — iOS-only for them                                             | `007-FR-028` **already requires** dedup + summed quantities          | Already specified               |
| 5   | **Dark mode**                                                                                      | Unspecified — **D21**                                                | Low                             |
| 6   | **Desktop/web parity for planning and shopping**                                                   | Our web app is real; theirs cannot plan or shop                      | **Already paid for**            |
| 7   | **Custom / renameable / reorderable aisle categories**                                             | Aisles aren't even an FR yet — **D9**                                | Low                             |
| 8   | **Offline access** — theirs is grocery-list-only, iOS-only                                         | Unspecified — **D22**                                                | Medium                          |
| 9   | **No forced subscription** — "I'm so sick of subscriptions"                                        | We have no answer — **D23**                                          | Pricing decision                |
| 10  | **Reliability** — a month-long search bug, a multi-platform import outage                          | Our test mandate (`§7.1`) is genuinely stricter than most teams ship | Already paid for                |

**Read the top of that list carefully: items 1, 4, 6, and 10 are things our existing specs and standards
already give us for free.** We are not being asked to out-innovate them on those — only to ship.

### The positioning that falls out of it

Their vulnerability is not their import quality. It is **trust decay among their best users**: a rebrand their
loyalists hated, a paywall that meters the marketed feature, a discount dark pattern that rewards trying to
leave, no way to get your data out, and an Android tier that pays full price for less.

That points at a sharp, honest counter-position:

> **Your recipes, private by default, on every platform, and yours to take with you.**

Every clause is a specific thing they fail at, every clause is cheap for us, and — critically — **none of it
requires beating them at video import.** It is the flanking move that runs while D1 is being built.

⚠️ **Do not over-rotate on Reddit.** Their storefront numbers are excellent and verified: 4.8★/278K and
4.65★/94.8K. The vocal minority is a _window_, not a collapse.

---

## 6. Concrete spec deltas

What actually has to change in `specs/`. Each is a real edit, not a theme.

### Must, before any launch that claims to compete

| #   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Owner spec    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| D1  | **New FR: video import** — TikTok, Instagram Reels, YouTube (Shorts + long), Facebook. Five-tier waterfall: caption → audio transcript → **frame OCR** → **vision over sampled frames** → source-site fallback                                                                                                                                                                                                                                               | `004`         |
| D2  | **New FR: share-sheet capture** on iOS and Android as a first-class channel of `004-FR-046`'s chooser                                                                                                                                                                                                                                                                                                                                                        | `004`         |
| D3  | **New FR: browser extension** (Chrome first)                                                                                                                                                                                                                                                                                                                                                                                                                 | `004`         |
| D4a | **Un-gate privacy from the paywall** — amend `001-FR-003` and the C-004 matrix in `visibilityPolicy.ts` so a free-tier user MAY set their own `user_created` recipe private. Keep public as the default.                                                                                                                                                                                                                                                     | `001` / `010` |
| D4b | **Make `imported_public` private-to-the-importer by default**; public only by deliberate act. Leaves `001-FR-004`/`FR-005` intact for `user_created`, which is the flywheel worth keeping                                                                                                                                                                                                                                                                    | `001` / `004` |
| D5  | **Amend `010-FR-040/041`**: privacy leaves the paywall; premium becomes import volume + AI depth + household seats. **Do NOT re-anchor to $39.99** — ReciMe's price is a tested $29.99–$99 range, and our pipeline costs more. Hold or raise price; buy the position with free-tier generosity. **Make per-recipe nutrition FREE** — it is the proof of the differentiator and gating it means free users never meet the reason to switch                    | `010`         |
| D6  | **Payment rails: external web checkout for the US storefront (permitted, no entitlement, no commission — §3.1.1(a)); IAP for all other storefronts.** Amend the non-goal in `executive/04-product-plan.md` to say this rather than removing it wholesale                                                                                                                                                                                                     | `010`         |
| D24 | **⚠️ Register a DMCA agent and adopt a repeat-infringer policy for the MAIN recipe corpus.** §512 safe harbour requires a registered agent, a repeat-infringer policy, and notice-and-takedown. Our specs put DMCA **only in `012` creator-profiles**. Running a public library of user-imported content _without_ safe harbour is materially worse than running one with it — and this is cheap, requires no product decision, and does not wait on D4a/D4b | `001` / `004` |
| D7  | **Invert `005-FR-015/016`**: platform-managed inference (ADR-0024 / Bedrock) is default; BYOK is the optional escape hatch                                                                                                                                                                                                                                                                                                                                   | `005`         |
| D8  | **Un-gate `004-FR-009` from Meta**: reach Instagram through user-initiated share-sheet capture rather than the Graph API                                                                                                                                                                                                                                                                                                                                     | `004`         |

### Should, to reach parity

| #   | Change                                                                                                                                                                                                                                                                            | Owner spec         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| D9  | **Lift aisle grouping into an FR** — it lives only in `007`'s plan/product-spec today                                                                                                                                                                                             | `007`              |
| D10 | **Give `007` US-009 (household list sharing) real FRs**, or delete the user story                                                                                                                                                                                                 | `007`              |
| D11 | **New FR: unit conversion metric ⇄ imperial** — absent from every spec; ReciMe charges for it                                                                                                                                                                                     | `001`              |
| D12 | **Write FRs for shipped behaviour**: serving scaling, in-cook ingredient check-off                                                                                                                                                                                                | `001` / `008`      |
| D13 | **Expand `008` beyond 4 FRs**: multiple concurrent timers, voice/hands-free, keep-awake with screen dimming, step-level ingredient surfacing                                                                                                                                      | `008`              |
| D14 | **New FR: recipe export** (JSON + PDF) — portability as a trust claim against a category that locks users in                                                                                                                                                                      | `001`              |
| D15 | **New FR: migration importers** for Paprika / AnyList / Copy Me That / ReciMe PDF — the switching cost is the moat we break, and ReciMe's staff have confirmed they cannot do it                                                                                                  | `004`              |
| D21 | **Dark mode** as a platform requirement — they don't have one, users ask, and this is a kitchen app used at night                                                                                                                                                                 | `001` / UX handoff |
| D22 | **Offline read + cook** — recipe detail and cook mode must work with no network once loaded. `008`'s spec currently poses this only as an unanswered "Edge Case"                                                                                                                  | `008`              |
| D23 | **Evaluate a one-time-purchase or lifetime tier.** "Subscription fatigue" is a _stated_ churn reason, and users are leaving for Recipe Fox ($10 once) and Paprika ($29.99 once). Copy Me That's $65 lifetime and Crouton's hybrid $24.99-once-plus-optional-sub are proven shapes | `010`              |

### Strategic, to win rather than match

| #   | Change                                                                                                                                                                                                    | Owner spec            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| D16 | **Nutrition accuracy as a published, tested claim** — benchmark suite, `unaccounted` surfaced in UI, "traced to USDA" as positioning                                                                      | `003` / `009`         |
| D17 | **Plan → cook → log bridge**: cooking a planned recipe writes a nutrition log; Apple Health / Health Connect sync                                                                                         | `009`                 |
| D18 | **Household as a first-class entity** across `006`/`007` — shared plans, real-time shared lists, seats in the subscription                                                                                | `006` / `007` / `010` |
| D19 | **Cost-aware planning** — per-recipe and per-plan cost estimates against real local prices                                                                                                                | `007`                 |
| D20 | **Resolve the `004-FR-020` null-quantity finding** ("salt to taste" is unrepresentable against the shipped schema) — it will be hit constantly by video imports, where quantities are frequently unstated | `004` / `001`         |

---

## 7. Sequencing

The current milestone ladder (`v1-launch-plan.md`) puts AI at `M5` and subscriptions at `M6`, with importing
inside `M1`. Against ReciMe that ordering under-weights the only thing that matters.

**Proposed re-ordering, smallest verifiable increment first:**

**Run two tracks in parallel.** Track A is the wedge; Track B is the flank (§5A), which is cheap, uses assets
we already have, and does not wait on Track A.

**Track B — the flank (start immediately, low cost):** dark mode; recipe export (JSON + PDF); migration
importers from Paprika/AnyList/Copy Me That; hold the line on Android parity and accessibility that
`001-FR-044a`/`NFR-003`/`NFR-004` already mandate. Every one of these is a thing ReciMe users are publicly
asking ReciMe for and not getting.

**Track A — the wedge:**

1. **Ship capture.** `004` video import + share sheet + URL, private by default, USDA-resolved
   ingredients, per-field confidence. **Nothing else.** This is the whole competitive test: can a ReciMe user
   paste a Reel and get a better result than ReciMe gives them? Measure import success rate against a fixed
   corpus that includes the cases they fail — silent ASMR, text-overlay, comment-recipes, multi-recipe posts.
2. **Prove the quality claim.** Nutrition accuracy benchmark published; `unaccounted` visible in the UI.
3. **Then the loop** — plan, list (with real dedup and aisles), cook mode.
4. **Then household** — shared plans and real-time shared lists.
5. **Then monetise** — IAP, re-anchored pricing, privacy free.

`012` creator profiles / `013` cooking school / `014` notifications stay after all of it. They are expansion
bets against a competitor we have not yet beaten at their own game.

---

## 8. Open decisions for the owner

These change the work materially and are not mine to make.

1. **Private by default?** (D4) — flips a core assumption of `executive/05-business-plan.md`'s recipe-graph
   growth flywheel, and removes the free tier's only paywall lever. **My recommendation: yes.** The product,
   trust, and legal arguments all point the same way, and the current rule loses on all three against this
   competitor.
2. **Platform-managed AI vs BYOK?** (D7) — real COGS exposure at a sub-$40/yr price, which ADR-0024 exists to
   bound. **Recommendation: platform-managed default, BYOK optional.**
3. **Price re-anchor and IAP?** (D5/D6) — accepts Apple's 15–30% cut. **Recommendation: yes; there is no
   mobile business without it.**
4. **How aggressive on video import?** Tiers 3–4 (frame OCR + vision) are where we beat them and where the
   inference cost sits. Needs a cost model against ADR-0024's ceiling before committing.
5. **Household as a first-class entity, or per-feature sharing?** (D18) — a one-way-door data-model decision;
   retrofitting it later is what every competitor is currently doing badly.
6. **Do we keep a public recipe library at all?** If yes, it needs an explicit legal position — ReciMe's
   defence does not transfer to us. Verified first-hand: their recipes are _"automatically marked as Private…
   not shared publicly within the app or with other users."_
7. **A one-time-purchase or lifetime tier?** (D23) — "subscription fatigue" is a _stated, quoted_ churn reason
   from ReciMe's own subreddit, and the destinations are one-time-purchase apps. It caps LTV and complicates
   COGS on AI features. **Recommendation: model it, don't commit yet** — but it is the sharpest wedge against a
   competitor whose pricing is their most-complained-about attribute.
8. **Do we run Track B (§5A flank) now, in parallel with the import build?** **Recommendation: yes.** It is
   mostly work our own standards already require, and it gives us something true to say about ReciMe users'
   actual grievances months before video import lands.

---

## 9. What is NOT a gap — don't chase these

- **Mac and visionOS.** ReciMe's are iPad-compatibility flags, not native apps. No user chose them for it.
- **"10 million users."** Marketing arithmetic. Do not benchmark against it.
- **Release cadence.** Their 25 releases since March 2026 carry boilerplate notes and a cosmetic rebrand.
  Tempo ≠ velocity.
- **Curated recipe library.** They deliberately don't have one and it hasn't hurt them.
