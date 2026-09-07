# ReciMe — Competitive Teardown

**Date**: 2026-08-21
**Subject**: ReciMe Pty Ltd (`recime.app`) — designated **primary competitor** by owner directive, 2026-08-21
**Method**: primary-source first. Every load-bearing number below was fetched from ReciMe's own
surfaces (site, help centre, gift-cards page, App Store, Play Store, Terms/Privacy/DMCA) or from an
independent hands-on test. Third-party review sites are cited only where no first-party source exists, and
are labelled. Claims that could not be verified are marked **UNVERIFIED** rather than smoothed over.
**Companion**: [`02-gap-analysis-and-strategy.md`](./02-gap-analysis-and-strategy.md)

---

## ⛔ Read this first — the two documents this one supersedes are CORRUPTED

`docs/competitive-analysis.md` and `docs/competitive-analysis-v2.md` (both dated June 2026) **must not be
used**. Commit `a53d09c9` (`chore: rename sous-chef → commise across entire codebase`) ran a blanket
string replacement over them and rewrote **competitors' product names**. The result is that both documents
now analyse a company called "Commise® (commise.app)" with a "Cookalong™" feature, and "Commise AI
(commiseai.com)" with a 5-recipe free tier — these are **SousChef® (souschef.app)** and **SousChefAI
(souschefai.com)**, not us. The v1 doc's summary table compares "commise.app" against itself. The phrase
"your kitchen's smartest commise" was "sous-chef".

Two consequences beyond the embarrassment:

1. **Every competitor row in those tables is untrustworthy** until re-derived, because the rename cannot be
   distinguished from a genuine mention by reading alone.
2. **They rate ReciMe as "🟢 Low threat", filed under "Tier 3 — Niche Competitors"** on the strength of one
   Android Police test. That assessment is the direct opposite of the current directive and is contradicted by
   the traction data in §2 below.

Those files should be marked superseded, not silently edited — the corruption is itself a lesson about
repo-wide renames touching prose.

---

## 1. What ReciMe actually is

**A capture tool, not a cooking platform.** Its entire product identity is _getting a recipe out of somewhere
it is trapped_ — principally a social video — and into a private, searchable, personal recipe box. Their App
Store subtitle is unusually literal about this:

> "#1 app to save recipes from Instagram, TikTok, Facebook, YouTube, Pinterest & more."
> — [App Store listing](https://apps.apple.com/us/app/recime-recipes-meal-planner/id1593779280), fetched 2026-08-21

Everything else they ship — cookbooks, weekly meal plan, aisle-sorted grocery list, cook mode, nutrition —
exists to give the captured recipe somewhere to live. This is the correct way to read them: **they won a
distribution wedge, then bolted a workflow onto it.** The workflow is, by consistent independent report, the
weaker half.

**They are explicitly NOT a social/discovery platform, and this is load-bearing.** From their own help centre:

> ReciMe "does not have a central library of recipes available"; all saved recipes are "automatically marked
> private and visible only to the individual user."
> — [Recipe Saving on ReciMe and Copyright](https://recime.app/help/en/articles/11596213-recipe-saving-on-recime-and-copyright)

That is not a product gap. It is their **copyright defence**. They argue they are Pocket/Evernote for recipes
— personal clipping, no redistribution — and they reinforce it with a second claim: ReciMe "does **not** use
bots or automated tools to scrape or collect recipes from other websites." Every import is a user-initiated
share. Hold on to this; §3 of the companion document shows we have taken the opposite position by default.

---

## 2. Traction — they are not a niche player

| Signal                  | Value                                                                            | Source                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| App Store rating        | **4.8★ / 278,000 ratings**                                                       | App Store listing, fetched 2026-08-21                                                                          |
| App Store category rank | **#21 in Food & Drink** (US)                                                     | same                                                                                                           |
| Play Store rating       | 4.65★ / ~94,868 ratings (74,131 written)                                         | Play listing structured data                                                                                   |
| Play installs           | 1M+                                                                              | Play listing                                                                                                   |
| Chrome extension        | v1.4.0, **30,000 users**, 4.8★                                                   | [Chrome Web Store](https://chromewebstore.google.com/detail/recime-extension/pfldidmekndhkehcoikjgaiajcfnmfga) |
| Self-reported users     | "10 million"                                                                     | ~20 consecutive App Store release notes                                                                        |
| Instagram / TikTok      | 274K / 164.2K followers                                                          | live counts, 2026-08-21                                                                                        |
| Release cadence         | **25 releases since March 2026** (v5.1.1 → v6.1.4)                               | App Store version history                                                                                      |
| Platforms               | iPhone, iPad, Mac (M1+), **visionOS**, Android, **web (beta)**, Chrome extension | App Store + help centre                                                                                        |
| Languages               | EN, FR, DE, PT, ES                                                               | App Store listing                                                                                              |

**~373,000 combined store ratings at 4.7–4.8★.** For calibration, that is more ratings than most Series-B
consumer apps ever accumulate. Any internal document filing them as "niche" is wrong.

⚠️ **The "10 million users" figure does not reconcile and should not be repeated as fact.** It sits against
1M+ Play installs, ~$60K ARR reported at end of 2023, and $2M total disclosed funding. It is almost certainly
**cumulative lifetime installs across all platforms**, not MAU. Treat as a marketing number. **UNVERIFIED.**

⚠️ **The version history is a cadence signal only, not a roadmap signal.** Nearly every release note since
March 2026 is the identical boilerplate string. The v5.1 → v6.0.0 arc was a **cosmetic rebrand** — their own
blog says "the app itself works exactly as you know it — what's changing is how it feels"
([ReciMe unveils bold new look](https://www.recime.app/blog/news/recime-unveils-bold-new-look)). High shipping
tempo, **low disclosed feature velocity**. We cannot infer what they are building from public sources, and we
should not pretend otherwise.

---

## 3. The company

|                        |                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity                 | **ReciMe Pty Ltd**                                                                                                                                                                                                                                                        |
| Founded                | App launched **November 2021**; company registered 2022                                                                                                                                                                                                                   |
| Founders               | **Christine Nguyen** (CEO), **Ivy Nguyen**, **Will Kent** — built it during Melbourne's 2020 lockdown                                                                                                                                                                     |
| Origin                 | **Melbourne, Australia** (registered address on their DMCA page: Suite 12/3 Albert Coates Ln, Melbourne VIC 3000)                                                                                                                                                         |
| Relocation             | Team partially moved to **New York, April 2024** — 75% of users and revenue were already US                                                                                                                                                                               |
| Team size              | ~31 (Tracxn, May 2026); RocketReach ~33. Their LinkedIn band says "2–10" and is stale                                                                                                                                                                                     |
| Funding                | **$2.0M total disclosed.** Pre-seed **$500K** (Oct 2022, LaunchVic Alice Anderson Fund + angels); Seed **$1.5M** (July 2024, led by **Even Capital**; angels include **Marissa Mayer**, **Deb Liu** (Ancestry CEO), **Karl von Randow** (Letterboxd), **Paul Greenberg**) |
| Series A               | **None on public record as of Aug 2026**                                                                                                                                                                                                                                  |
| Last disclosed revenue | **~$60K ARR at end of 2023**; founder claimed "20x subscribers and revenue" over the following ~6 months                                                                                                                                                                  |
| CTO                    | Nic Pacholski (joined early 2024; previously first engineer at Sweat)                                                                                                                                                                                                     |

**The arithmetic does not close, and that is itself a finding.** $2M raised, ~31 staff, NYC-based, no Series A
on record. Either the headcount figure includes contractors, or revenue is materially higher than anything
public, or **there is an undisclosed round**, or they are closer to a runway constraint than the growth
narrative implies. **UNVERIFIED — flagged as a genuine gap in the public record, not resolved.**

Strategically, the honest read: **they are a small, capital-light, distribution-led team.** They out-execute on
one thing. They are not resourced to defend a broad front simultaneously.

---

## 4. Pricing — resolved, and lower than most sources claim

Third-party reviews circulate **$59.99/year**. Two **first-party** ReciMe surfaces agree it is **$39.99**:

- [Gift Cards page](https://www.recime.app/gift-cards): "1 Year — **$39.99**"; "3 Months — **$19.99**"
- [Help centre pricing article](https://recime.app/help/en/articles/11630592-how-much-does-the-recime-subscription-cost): United States yearly plan "**$39.99 USD**"

Apple's IAP ladder for the app shows **$9.99 / $29.99 / $39.99 (×2) / $59.99 (×2)** — regional and term
variants, not one price. A monthly SKU exists (~$4.99–$5.95 across sources; exact figure **UNVERIFIED**) and
their help centre has a dedicated article on switching annual → monthly.

**Trial: 7 days, card required up front.** At least one reviewer calls the pattern a "bait and switch",
because the metered thing is the headline feature.

### The free / Plus split — authoritative, from their own help centre

Apple's marketing copy **overstates** the free tier. [What are the benefits of ReciMe
Plus?](https://recime.app/help/en/articles/11630603-what-are-the-benefits-of-recime-plus) is the authority:

| Free                                      | ReciMe Plus                                                     |
| ----------------------------------------- | --------------------------------------------------------------- |
| Manual recipe creation — **unlimited**    | **Unlimited** imports from Instagram / TikTok / Facebook / etc. |
| Grocery lists that **auto-sort by aisle** | Scan recipes from **cookbooks or handwritten notes** (OCR)      |
| **Weekly meal planning**                  | **Nutrition calculator** (one-click)                            |
| **Cookbooks** (organisation)              | **Paste** recipe content directly into the app                  |
| **5 imports per week**                    | **Cooking Mode** (hands-free guidance)                          |
|                                           | **Unit conversion** (metric ⇄ imperial)                         |
|                                           | **"Ask ReciMe"** AI cooking assistant                           |
|                                           | **Export to PDF / print**                                       |

**The shape of their monetisation, stated plainly: they charge for volume and convenience. They do not charge
for privacy — recipes are private at every tier, including free.** That is the single most important sentence
in this document for our purposes, and §3 of the companion explains why.

---

## 5. Import — the whole moat, and exactly where it breaks

This is their differentiator, so it deserves mechanical precision.

### 5.1 The documented pipeline is three tiers, and there is no fourth

ReciMe's own help articles for TikTok and Instagram describe an identical waterfall:

1. **Caption / description text** — "the easiest place for us to pull the details from"
2. **Audio transcription** — "if there's no caption, ReciMe will try to detect the recipe from the video's audio"
3. **Original-source lookup** — search for the creator's blog/site and import the recipe from there

— [Import from TikTok](https://recime.app/help/en/articles/11661452-import-from-tiktok),
[Import from Instagram](https://recime.app/help/en/articles/11596425-import-from-instagram)

**There is no visual tier.** No OCR of burned-in on-screen text. No frame or scene analysis. Their
documentation never claims one.

### 5.2 The failure modes, corroborated independently

| Failure                                                                                                  | Evidence                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Video with on-screen text but no caption and no narration → total failure**                            | Android Police's four-app head-to-head found ReciMe **failed to import an ASMR potato-soup video entirely** ([androidpolice.com](https://www.androidpolice.com/i-tried-viral-recipe-apps-clear-winner/)) |
| **Silently drops steps shown but not spoken**                                                            | Same test, vlog-style aloo bazi video: **wrong title**, and **missed the step of adding potatoes**                                                                                                       |
| **Recipes in comments are invisible**                                                                    | ReciMe's own [import-troubleshooting article](https://recime.app/help/en/articles/14773584-why-didn-t-my-recipe-import-correctly)                                                                        |
| **Multi-recipe posts extract only one**                                                                  | same                                                                                                                                                                                                     |
| **Paywalled / login-gated / private sources categorically unsupported**                                  | same — "ReciMe can only see what's public"; official workaround is _screenshot it_                                                                                                                       |
| **Handwritten OCR ~80%**, cursive and faded ink cause unit errors (**"tsp" read as "tbsp"**)             | recipeone.app review — _third-party, single source_                                                                                                                                                      |
| **Quantity parsing on messy phrasing** — parenthetical alt-units, "¼ cup + 2 tbsp" — **5 of 15 correct** | Deglaze comparison page — ⚠️ **competitor marketing, methodology undisclosed, directional only**                                                                                                         |

**Ranked in order of exploitability, their import blind spots are:**

1. **Visual-only content.** The fastest-growing format on TikTok — text-overlay recipes, silent ASMR cooking —
   is the format they structurally cannot read.
2. **Comment-thread recipes.** Extremely common creator behaviour ("full recipe in the comments!").
3. **Multi-recipe posts.** Meal-prep videos, the single highest-intent content type for a planning app.
4. **Anything gated.** Their answer is "take a screenshot", which degrades to screenshot-OCR quality.

### 5.3 The AI stack, and a disclosure gap we must not copy

Google's own [Gemini API Developer Competition project
page](https://ai.google.dev/competition/projects/recime) confirms ReciMe uses **Gemini** multimodal —
pantry-photo ingredient recognition, recipe text generation, recipe image generation, an interactive
"adapt this recipe" loop.

**Their [privacy policy](https://recime.app/privacy-policy) names zero AI processors.** No OpenAI, no
Anthropic, no Google AI, no ML service of any kind appears in its service-provider list, which enumerates only
payment processors, Google Analytics, "mail house operators", and customer-contact vendors.

A general-audience privacy policy disclosing no AI sub-processor, next to a vendor page confirming user photos
and free text reach Gemini, is a **material disclosure gap**. Note it as a compliance failure to avoid, not as
an attack line — our own `005` BYOK/provider surface has to get this right.

⚠️ Whether Gemini also backs the _import_ extraction path specifically is **INFERENCE, not confirmed** — the
competition page's language is scoped to the pantry/generation feature.

### 5.4 Nutrition — almost certainly LLM-estimated, and self-labelled beta

Their [nutrition help article](https://recime.app/help/en/articles/11626106-does-recime-provide-nutrition-information)
names **no data source at all** and calls the feature **"still in beta."** No USDA / Edamam / Nutritionix /
Spoonacular relationship is marketed anywhere — and a licensed database is exactly the kind of thing a company
markets if it has one. A third-party review characterises the output as "AI-generated nutritional
information"; users report calories reading systematically _lower_ than the source recipe states.

**Best-evidenced read: nutrition is an LLM estimate over the parsed ingredient list, not a database lookup.**
Labelled **INFERENCE**, moderate confidence — no source states the mechanism outright. This is the single
largest quality gap in their product and the one we are already built to beat (see companion §4).

---

## 6. The workflow half — consistently reported as thin

These come from third-party reviews, including **Plan to Eat, a competing meal-planning product** — weight
accordingly. They are listed because _independent sources converge on the same specific mechanical gaps_,
which is a stronger signal than any one of them alone.

- **Grocery list does not merge duplicate ingredients across recipes.** Two recipes needing onions produce two
  lines. This is the highest-frequency complaint about their list.
- **Editing the meal plan does not propagate to an already-generated list.**
- **Aisle categories cannot be customised or reordered.**
- **Meal plan is single-week view only.** No multi-week view, no templates, no plan reuse.
- **No pantry inventory tracking** as a shipped grocery feature.
- **Cookbook sharing exists and is BROKEN.** Their "What is ReciMe?" article mentions "collaborative cookbook
  features"; a user reports the invite delivers an **empty cookbook** to the recipient, and that thread drew no
  staff reply (§6B #12). So the honest statement is not "no sharing" — it is _"a sharing feature ships, does
  not work, and is not being fixed."_ There is still **no household/family account model.**
- **No confirmed data export** beyond Plus PDF/print. No CSV, no JSON, no Paprika-format export, no bulk backup.
- **No confirmed health-app sync**, no Apple Watch app, no widgets, no Siri Shortcuts. All absent from
  marketing that otherwise lists platform reach in detail — a strong negative signal, not a positive confirmation.
- **Grocery delivery exists** ("Turn your grocery list into a delivery! Order directly in-app") but **no partner
  is named anywhere** in first-party copy or help docs. **UNVERIFIED.**

### 6.1 The web app is a genuine open flank

Their own [web-app help article](https://recime.app/help/en/articles/11626084-can-i-access-recime-using-a-computer)
states it is **beta**, **desktop browsers only** (explicitly not mobile browsers), and can currently do only:
import/add recipes, view recipes and cookbooks, edit recipes.

**Meal planning and grocery lists are absent from the web app** — stated as "coming".

We have a production Next.js web app with real feature parity as a governing rule (`001-FR-044`,
`001-FR-044a`). This is the clearest place where our architecture already beats theirs.

---

## 6A. The interface

Reconstructed from App Store/Play screenshot captions, their help centre, onboarding analytics
(screensdesign.com), paywall data (Adapty), and independent reviews. **I could not install the app** — layout
details not sourced below are flagged as gaps rather than guessed.

### Navigation

- **Cookbooks is a primary tab** and doubles as the subscribe entry point ("Navigate to the Cookbooks tab and
  tap Subscribe" — [help](https://recime.app/help/en/articles/11629967-how-do-i-subscribe)).
- **There is no discovery or feed tab.** Deliberate — consistent with §1.
- **Import is not a tab.** It is the OS **share sheet**, in-app paste, camera scan, or the Chrome extension.
  This is the single most important IA decision in the product: _capture happens where the recipe already is_,
  not inside their app.
- ⚠️ Exact tab-bar order and count: **not sourced.**

### Onboarding — long, and monetisation-first

**~19 discrete steps** before the main interface. Order: demographic questions (age, "where did you hear about
us") → feature tutorial → **notification-permission prompt deliberately placed immediately before the
paywall** (a warm-up pattern) → **paywall** (7-day trial, card required, 4.8★ + testimonials as social proof)
→ **account creation happens _after_ the subscribe decision.**

Plan to Eat flags the demographic questions as needless friction. The analytics source calls the flow "quite
long… numerous questions and a tutorial before reaching main interface" and a likely drop-off risk.
⚠️ Nobody measured actual time-to-first-value.

**This is an opening.** Their first-run experience monetises before it delivers value. A capture-first
onboarding — _paste a link, watch it work, then decide_ — inverts it.

### Screens worth knowing

- **Recipe detail** carries the two genuinely charming details in the product: **blue tappable ingredient text**
  inline in instructions (tap to see the quantity without scrolling back up) and **orange tappable temperature
  text** (toggles °C/°F). Both are small, specific, and solve real in-kitchen friction. Worth stealing outright.
- **Import** — screenshots stack as thumbnails bottom-left; the user **manually verifies formatting before
  committing**, i.e. a review step, not a silent auto-commit. Good practice, and the same shape as our
  `004-FR-015` draft-with-confidence model.
- **Meal plan** — weekly only, drag-and-drop onto day/meal slots.
- **Grocery list** — aisle- or recipe-grouped, with in-app delivery ordering.
- **Cook mode** — card-based, one step per card, checkable steps, screen stays awake. Plus-gated.
- **Library** has a **pantry-match filter** ("find recipes based on ingredients you already have") — notable,
  since no pantry _inventory_ feature is documented. ⚠️ Mechanism unclear.
- ⚠️ **Search layout, settings screen, and paywall visual composition: not sourced.**

### Design language

- **February 2026 rebrand**: new logo ("a playful chef's hat"), ingredient-named palette — "Blueberry, Mango,
  Lime". No published hex values. Brand copy: "brighter… more fun, warm, human," inspired by "vintage
  cookbooks, handwritten recipes."
- **Confetti micro-animation** on successful import.
- **No dark mode.** Confirmed absent, requested by users, and actively marketed against them by rival Deglaze.
  For an app used in a kitchen at night, this is a real miss.
- App is **205.1 MB** on iOS.
- ⚠️ Characterisation is genuinely mixed across sources — "clean and modern" vs "a bit outdated and clunky."

### Accessibility — weakest area, for them and in our evidence

One low-authority aggregator claims VoiceOver, adjustable text size, and Siri support; it reads as boilerplate
and **could not be corroborated**. The only well-evidenced signal is negative: **no dark mode**. No source
discusses Dynamic Type, contrast, or TalkBack. **No accessibility audit exists in any source found.**

Our specs mandate `getByRole`/`getByLabel`-queryable accessible names and forbid colour as the sole conveyor
of state on **every** feature (`NFR-003`, `NFR-004`, repeated across 001/004/007/008/009/010). That is a real
differentiator we have not been marketing.

---

## 6B. What users actually say

Sources: App Store and Play reviews, Product Hunt, roundups, and — most valuably — **r/recime, a
company-run subreddit where founders and staff reply to nearly every post.** That last source is unusually
candid and is where the worst findings come from.

### Praise — narrow, and all about one thing

1. **Social import quality and speed.** The dominant positive, including from switchers: _"Recime! easy to
   import from different platforms. Switched from Paprika to Recime a few months ago."_ — u/forzapasta,
   [r/EatCheapAndHealthy](https://www.reddit.com/r/EatCheapAndHealthy/comments/1j7ji6r/)
2. **Cook mode keeps the screen awake.** Small, universally appreciated.
3. **Founder presence.** Staff personally answer bug reports in r/recime; it visibly buys goodwill even when
   bugs persist.

⚠️ The praise corpus is **thinner and less itemised** than the complaint corpus — partly a real signal, partly
because the research was weighted toward complaints. Do not read the asymmetry as a 1:1 sentiment ratio.

### Complaints — ranked

1. **Paywall / forced trial / "advertised as free"** (~40 mentions) — the largest single bucket, App
   Store-dominant. The metered thing is the marketed thing.
2. **Import failures and inconsistency** (~30) — including a **staff-acknowledged outage across all three major
   platforms**: _"There's a known issue with imports right now, especially videos shared directly from
   Instagram, TikTok, and Facebook Reels, and we're on it."_ — u/Reah-Recime (staff),
   [r/recime](https://www.reddit.com/r/recime/comments/1tme9th/). Non-English imports garble.
3. **The February 2026 rebrand, plus a concurrent performance regression** (~15+, near-unanimous negativity
   across three threads). This is invisible in App Store data and is the most damaging finding:
    - _"It looks like a gambling logo or something… went from opening the app daily to wanting to hide it."_
      — u/atticusashh, [r/recime](https://www.reddit.com/r/recime/comments/1qznfc0/)
    - _"What the f\*\*\* did you guys change during the logo-update? Literally everything since then has been a
      downgrade in performance, UI, and experience. **I've cancelled my subscription because of this update
      specifically.** I was recommending this app to everybody I knew because of how much I loved it."_
      — u/LogicalFalcon2568, [r/recime](https://www.reddit.com/r/recime/comments/1skslbq/)
4. **Price escalation and a documented discount dark pattern** (~15). Reported prices swing wildly by region
   and time — ~$49.99/yr (2024), ~$30/yr or $9.99/mo (2025), _"It's now $99/year 😳"_, "hiked to roughly
   $60/year" (2026). And: _"if you don't accept the free trial that turns into £49.99 just press the x and they
   eventually offer it to you for £24.99."_ — u/Starry_Director86,
   [r/Cooking](https://www.reddit.com/r/Cooking/comments/1e1k4g0/). A marketing-analysis thread confirms the
   paywall is deliberately multi-stage: close the 7-day trial and you are instantly offered 14 days.
5. **Billing disputes / refused refunds** (~12).
6. **Android treated as second-class** (~7) — **staff-confirmed** iOS-only or iOS-first features: smart
   grocery-item combining, recipe tags, offline grocery mode, app-icon customisation, and ingredient search
   (Android only caught up June 2026). _"Are android users ever going to be able to do anything?… We pay the
   same as iOS users, no?"_ — u/BabiiGoat, [r/recime](https://www.reddit.com/r/recime/comments/1r9bd5j/)
7. **A ~1-month search bug that made the app "borderline unusable"** (~12) — _"I've imported 144 recipes
   total, but only 38 of them show up when I click the search bar."_ — u/Helcra,
   [r/recime](https://www.reddit.com/r/recime/comments/1ty3tii/)
8. **Nutrition accuracy** (~10) — the concrete example: **86 kcal/serving calculated for a Nutella cheesecake
   against ~567 kcal actual.** A 6.6× understatement. Reportedly patched (iOS first) by August 2026.
9. **Support unresponsive** (~10).
10. **Data loss on update / device switch** (~7).
11. **Data lock-in — no bulk import and no export** (~4), **staff-confirmed**: _"Bulk importing isn't supported
    at the moment"_ in response to a user with a 2,000-recipe Paprika backup. And:
    _"Bulk export of my own recipes (JSON or CSV)… I've reached out through support and LinkedIn without a
    response."_ — u/sbarghaan, [r/recime](https://www.reddit.com/r/recime/comments/1t94vgn/)
12. **Cookbook sharing is broken** — _"I've tried using the 'invite' to a cookbook function but it doesn't seem
    to work — the cookbook goes into their app but is empty of recipes."_ — u/Siloquist,
    [r/recime](https://www.reddit.com/r/recime/comments/1om035p/). **This resolves the §6 contradiction: the
    collaborative-cookbook feature exists and does not work.**

### Churn — stated reasons, with destinations

- **Rebrand + performance regression** — quoted above, explicit cancellation.
- **Missing Walmart integration** — _"Commenting because I canceled my subscription when I realized I didn't
  have direct integration with Walmart."_ — u/Ok_Negotiation_4441
- **Subscription fatigue**, posted _inside ReciMe's own bug thread_: _"Have you tried the app Recipe Fox? It
  does the same thing and is just a one time $10 upgrade. I'm so sick of subscriptions."_ — u/queondaguero

**Where they go:** Paprika (most cited), Deglaze, Allspice, CookNest, Recipe Fox, Chowboy, Umami, Flavorish,
Samsung Food, Mela, RecipeSage, AnyList, Copy Me That. **The long tail is crowded and moving.**

### The honest counterweight

None of this shows up in the storefront numbers. **4.8★ / 278K on the App Store and 4.65★ / ~94.8K on Play are
verified first-hand and are excellent.** Reddit is a self-selecting, high-engagement minority. The correct read
is not "they are collapsing" — it is **"their most loyal, highest-intent users had a bad 2026, and the exit
doors are well-signposted."** That is a window, not a rout.

---

## 7. Legal posture — theirs is more conservative than ours

|                                      | ReciMe                                                                                                                                                                          | Commise (as specified)                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Imported recipes' default visibility | **Private, always, every tier**                                                                                                                                                 | **Public** for free-tier users (`001-FR-003`); `imported_public` is public by class (`004-FR-011`)           |
| Public library of imported content   | **None, by design** — "no central library"                                                                                                                                      | **Yes** — any authenticated user may view (`001-FR-004`) and clone (`001-FR-005`)                            |
| Scraping posture                     | Claims **no bots/automation**; user-initiated share only                                                                                                                        | Server-side fetch, with `robots.txt` handling (`004-FR-023`) and a paywalled-source blocklist (`004-FR-014`) |
| Content licence taken from users     | **Broad** — "irrevocable, nonexclusive, royalty-free… reproduce, distribute, publicly display… prepare derivative works" ([Terms](https://www.recime.app/terms-and-conditions)) | Not yet specified                                                                                            |
| DMCA process                         | Formal, named agent, Melbourne address                                                                                                                                          | Specified only for `012` creator profiles                                                                    |

**Upstream, our spec is materially more rigorous than theirs** — robots.txt evaluation, an admin-governed
paywalled-domain blocklist, source attestation with citation (`004-FR-014a`), SSRF defence (`NFR-007`),
sanitisation before persistence (`NFR-008`). We then **give that advantage back at the visibility layer** by
publishing the results. See companion §3; this needs an owner decision.

⚠️ **No food-blogger or publisher complaint naming ReciMe was found.** Targeted searching returned nothing.
Treat as **absence of evidence, not a clean record** — the search budget was exhausted before Reddit and
food-blogger forums could be swept directly.

---

## 8. Where they are strong, and where they are weak — the summary

**Strong**

1. **The capture wedge itself.** Best-in-category at pulling a recipe out of a captioned or narrated social video, and they own the positioning in the App Store.
2. **Distribution.** ~373K store ratings at 4.7–4.8★, TikTok-native growth with essentially no paid acquisition, 274K IG / 164K TikTok followers.
3. **Trust posture.** Private-by-default, no public library, formal DMCA, explicit no-scraping claim. Simple to explain and legally defensible.
4. **Surface coverage.** iOS, iPad, Mac, visionOS, Android, web, Chrome extension, 5 languages, near-weekly releases.
5. **Price.** $39.99/yr undercuts most of the paid field.

**Weak**

1. **No visual tier in import** — the fastest-growing content format is a structural blind spot.
2. **Nutrition is unsourced and self-labelled beta** — likely LLM-estimated, users report it reads low.
3. **Grocery list doesn't merge duplicates** and doesn't resync from the plan.
4. **Meal planning is one week, no templates, no reuse.**
5. **No pantry, no confirmed household sharing, no confirmed export, no health-app sync.**
6. **Web app can't plan or shop.**
7. **The metered thing is the headline thing** — 5 imports/week caps the exact behaviour their marketing promises, which is their most-cited source of paywall resentment.
8. **Capital-light and undiversified** — $2M raised, no Series A on record, one wedge, and both their growth channel and their core feature depend on continued access to the same handful of social platforms.
9. **Data lock-in, staff-confirmed** — no bulk import, no export of any kind beyond Plus PDF. A user with a 2,000-recipe Paprika library is told bulk import "isn't supported at the moment." **Nothing stops us taking those users; nothing helps them leave us either, unless we choose differently.**
10. **Android is visibly second-class**, by their own staff's admission — smart grocery combining, tags, offline mode, and (until June 2026) ingredient search were iOS-only, at identical price.
11. **A rough 2026** — February rebrand backlash from their most loyal users, a staff-acknowledged import outage across Instagram/TikTok/Facebook Reels, and a month-long search bug users called "borderline unusable."
12. **Monetisation-first onboarding** — ~19 steps, demographics and a tutorial before value, paywall before account creation, and a discount dark pattern that rewards users for trying to leave.
13. **No dark mode.**

---

## 9. Confidence register

| Claim                                                           | Confidence                     | Basis                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| $39.99/yr US annual price                                       | **High**                       | Two first-party surfaces agree                                                                                                                                                                                                                                                                                |
| Free/Plus split as tabulated                                    | **High**                       | First-party help centre                                                                                                                                                                                                                                                                                       |
| 4.8★/278K, #21 Food & Drink                                     | **High**                       | Fetched directly from App Store                                                                                                                                                                                                                                                                               |
| Three-tier import waterfall, no visual tier                     | **High**                       | First-party docs, twice, plus independent test corroboration                                                                                                                                                                                                                                                  |
| Import fails on caption-less/narration-less video               | **High**                       | Independent hands-on test + consistent with their own docs                                                                                                                                                                                                                                                    |
| Nutrition is LLM-estimated                                      | **Medium**                     | INFERENCE — no source states mechanism; strong circumstantial case. Corroborated by a reported 86 kcal vs ~567 kcal actual error                                                                                                                                                                              |
| **Recipes private by default at every tier, no public library** | **High — verified first-hand** | Direct fetch of their copyright article: "automatically marked as **Private**… only visible to the individual user… not shared publicly within the app or with other users." ⚠️ A third-party review site claims the opposite (free recipes public); that site also got the price wrong and is **unreliable** |
| Feb 2026 rebrand caused real churn                              | **Medium-High**                | Multiple r/recime threads, near-unanimous, with explicit cancellation quotes — but Reddit is a self-selecting minority                                                                                                                                                                                        |
| Android feature disparity                                       | **High**                       | Staff statements in their own subreddit                                                                                                                                                                                                                                                                       |
| No bulk import/export                                           | **High**                       | Staff statement in their own subreddit                                                                                                                                                                                                                                                                        |
| Cookbook sharing broken                                         | **Medium**                     | Single detailed user report, no staff rebuttal                                                                                                                                                                                                                                                                |
| Grocery/meal-plan mechanical gaps                               | **Medium**                     | Third-party, competitor-adjacent, but multiple sources converge                                                                                                                                                                                                                                               |
| "10 million users"                                              | **Low**                        | Self-reported, does not reconcile with other figures                                                                                                                                                                                                                                                          |
| Team size ~31                                                   | **Medium**                     | Tracxn + RocketReach agree; LinkedIn contradicts                                                                                                                                                                                                                                                              |
| No household **account** model                                  | **Medium**                     | Absent from all first-party docs; the cookbook-invite feature that exists is reported broken                                                                                                                                                                                                                  |
| Grocery delivery partner identity                               | **Unknown**                    | Named nowhere                                                                                                                                                                                                                                                                                                 |
| No publisher/blogger complaints                                 | **Low**                        | Absence of evidence; search budget exhausted                                                                                                                                                                                                                                                                  |
