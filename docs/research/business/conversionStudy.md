# Commise conversion study: what share of users will pay, and what share will be active?

Independent second pass. Prepared 2026-10-27. Read-only; no repo files changed.

Every rate below names its source, sample and year. Where a figure was not checked at its primary source, it is
marked **[secondary]**. Where something is my arithmetic on cited inputs, it is marked **[arithmetic]**. Where no
market figure exists, it says **GAP**. No number in this report is an unlabelled judgment.

---

## 0. Answer first

1. **The first pass was correct at source.** RevenueCat SOSA 2026 does say: median download-to-paid 2.0%, freemium
   2.1%, Health & Fitness 2.9% (top quartile above 6.2%), Health & Fitness trial-to-paid 37.7%. Adapty 2026 says
   Health & Fitness trial-to-paid 35.0%. But two corrections matter:
    - The famous "hard paywall 10.7% vs freemium 2.1%" is **download-to-paid at day 35**, not trial-to-paid. RevenueCat's own
      blog mislabels it; the report's chart title and section heading say download-to-paid.
    - **Recipe apps are not Health & Fitness.** Every recipe app checked (ReciMe, Samsung Food, Plan to Eat, Paprika,
      NYT Cooking, Crouton, Pestle, SideChef) lists **Food & Drink** as its primary App Store genre (iTunes Search API,
      checked 2026-10-27). RevenueCat has no Food & Drink bucket. Health & Fitness is the best-monetizing category in
      both reports, so using it as the base is the flattering cut. The neutral base is **freemium, all categories**.
2. **On the "% of registered users who pay" denominator, the evidence supports about 2%, not 5–10%.** Every
   registered- or download-denominator comparable found sits between 1% and 4.5%: RevenueCat freemium median 2.1%
   (top quartile 4.5%), Dropbox 2.2% (S-1), Evernote 1.75–2.2%, Headspace about 3.2% and Calm about 4% of
   downloads, Strava about 1.1–1.4% (estimate). The cost model's 5% sits near the top quartile and its 10% is above
   RevenueCat's 90th percentile (8.2%).
3. **On the "% of monthly active users who pay" denominator, 5% is normal for winners, not high.** Mature category
   leaders: Evernote 4.9% (2009), Strava about 4–5% (estimate), Flo about 7%, Duolingo 9%, Canva about 12%. Spotify
   (about 39%) is a music outlier. These are survivors late in life, so they are the top of the range, not the
   middle.
4. **Active share: 20–35% of registered being monthly active is seen only in sticky winners** (Evernote 35% at 18
   months, Strava about 28%, estimated). **45% is not supported by any disclosure found**, except as an arithmetic
   effect in the first three months, when most registered users are brand new. Install-cohort benchmarks for Food &
   Drink apps (day-30 retention 2.9–7.9%) point lower for a typical app.
5. **The owner's view, tested honestly.** Partly right: on a monthly-active base, 5% paying is in line with the
   comparables, and a recipe library gains value with tenure, as Evernote's data shows. Not supported: 5–10% of
   _registered_ users paying, or 45% of registered users being monthly active. A cost model that sets "30% active"
   and "5% of registered pay" implies 16.7% of monthly active users pay. Only Spotify beats that.
6. **Recommended base for financial projections:** paying subscribers ≈ **1.7% of cumulative registered users at 12
   months** (low 0.24% / high 3.6%) and **≈1.1–1.4% at 24 months** (low 0.2% / high 2.4–3.1%), built from
   RevenueCat's freemium distribution. See §6.
7. **Replace SC-006** with a cohort metric that has its denominator and its window. See §7.

Confidence: **Medium** on the cross-category rates (large primary samples). **Low** on anything recipe-specific;
the category has no public conversion benchmark.

---

## 1. Denominators: read these first

| Denominator                    | What it counts                                                | Who reports it this way                                              |
| ------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Downloads / installs**       | Every first install, signed up or not                         | RevenueCat, Adapty, Headspace, Calm                                  |
| **Registered users**           | Everyone who ever made an account (cumulative, never shrinks) | Dropbox S-1, Evernote, Strava claims, Yummly, the Commise cost model |
| **Monthly active users (MAU)** | Users active in the month                                     | Duolingo, Spotify, Canva, Flo, SC-006 ("active free-tier")           |

- Registered ≤ installs. Commise's front door is sign-in (FR-045a), so registration is a hard gate after install.
  **GAP:** I found no current consumer benchmark for install-to-registration. The only hard data is old: Liftoff
  Q4 2014, install-ad traffic: social 88.4%, e-commerce 70.6%, finance 52.1%
  ([Liftoff via search](https://liftoff.io/?p=2828)) **[secondary, 2014]**. So a per-download rate _understates_ a
  per-registered rate by an unknown factor, roughly 1.1× to 1.9× on that old data.
- MAU is always smaller than registered. So a "% of MAU paying" is always larger than a "% of registered paying"
  for the same business. Mixing these two is the main reason the 5% target looks either easy or impossible
  depending on who reads it.
- Identity: **% registered paying = (MAU ÷ registered) × (paying ÷ MAU).** §5 uses it.

---

## 2. The funnel, stage by stage (sourced)

Primary source unless marked: **RevenueCat, State of Subscription Apps 2026**
([report](https://www.revenuecat.com/state-of-subscription-apps/)), 115,000+ apps, $16B+ revenue, metric year 2025,
published March 2026. It covers apps on RevenueCat with active subscription revenue above a minimum threshold
(selection: subscription apps only, survivors only). Distributions are medians across apps; P10 and P90 are given
only in some charts; **P25 is not published in the text** for most metrics.

| Stage                           | Benchmark                                         | Figure                                                                       | Source / sample / year                                                                                                                               |
| ------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install → account               | Install-to-registration                           | **GAP** (old: 52–88%)                                                        | Liftoff 2014 **[secondary]**                                                                                                                         |
| Install → active day 1 / 7 / 30 | Food & Drink                                      | 22.9% / 18.9% / 7.9%                                                         | [OneSignal Mobile App Benchmarks 2024](https://onesignal.com/mobile-app-benchmarks-2024) (OneSignal SDK apps, 2023–24)                               |
| Install → active day 30         | Food & Drink iOS / Android                        | 3.6% / 2.9%                                                                  | AppsFlyer via Business of Apps 2026, as tabled by [Braze, Jul 2026](https://www.braze.com/resources/articles/mobile-app-retention) **[secondary]**   |
| Install → active day 30         | Health & Fitness iOS / Android                    | 3.9% / 3.4%                                                                  | same                                                                                                                                                 |
| Install → active day 1/7/14/30  | All apps                                          | 26% / 13% / 10% / 7%                                                         | Adjust, quoted by [Getpanto](https://www.getpanto.ai/blog/mobile-app-retention-statistics) **[secondary; adjust.com blocked the fetch]**             |
| Install → active day 1          | Food & Drink                                      | about 13%                                                                    | Adjust via Getpanto **[secondary]**                                                                                                                  |
| Active at 3 months              | Median / top 10%                                  | healthcare 2.1% / 10.6%; media 2.5% / 13.4%; financial services 4.6% / 19.5% | [Amplitude 2025 Product Benchmark Report](https://amplitude.com/blog/healthcare-product-benchmarks), 2,600+ companies                                |
| Active day 7                    | Top-quartile threshold                            | 7%                                                                           | [Amplitude, 7% rule](https://amplitude.com/blog/7-percent-retention-rule) (half of products lose >98% of new users by week 2)                        |
| DAU/MAU                         | Duolingo Q2 2026                                  | 58.7M / 140.6M = **41.7%**                                                   | [Duolingo Q2 2026 letter, SEC 8-K](https://www.sec.gov/Archives/edgar/data/0001562088/000162828026053299/q2fy26duolingo6-30x26share.htm)             |
| DAU/MAU                         | All industries (average)                          | 37% (2023)                                                                   | Mixpanel 2024 Benchmarks via [Plotline](https://www.plotline.so/blog/mobile-app-engagement-metrics) **[secondary]**                                  |
| Install → trial (D30)           | All / Health & Fitness / North America            | 5–6% typical / 6.9% / 7.1%                                                   | RevenueCat 2026                                                                                                                                      |
| Install → trial                 | AI vs non-AI                                      | 8.5% vs 5.6%                                                                 | RevenueCat 2026                                                                                                                                      |
| Install → trial                 | Above-average price                               | 8.9% (P75 16.5%)                                                             | RevenueCat 2026                                                                                                                                      |
| Install → trial                 | All (Adapty)                                      | 10.9% (median 11.2%); NA 14.5%                                               | [Adapty SOIS 2026](https://adapty.io/state-of-in-app-subscriptions/), 16,000+ apps, $3B                                                              |
| Trial → paid                    | Health & Fitness                                  | **37.7%** (P75 51.4%)                                                        | RevenueCat 2026                                                                                                                                      |
| Trial → paid                    | North America / all-store medians                 | 34.2% / 32.0–32.6%                                                           | RevenueCat 2026                                                                                                                                      |
| Trial → paid                    | By trial length: ≤4d / 5–9d / **10–16d** / 17–32d | 25.5% / 37.4% / **35.4%** (wide spread) / 42.5%                              | RevenueCat 2026                                                                                                                                      |
| Trial → paid                    | All / Health & Fitness (Adapty)                   | 25.6% / 35.0%                                                                | Adapty SOIS 2026                                                                                                                                     |
| Install → paid (D35)            | All apps                                          | **2.0%**; NA 2.8% (P75 6.0%)                                                 | RevenueCat 2026                                                                                                                                      |
| Install → paid (D35)            | **Freemium**                                      | **2.1%** (P75 4.5%; P10–P90 0.3–8.2%)                                        | RevenueCat 2026                                                                                                                                      |
| Install → paid (D35)            | Hard paywall                                      | 10.7% (P75 20.0%; P10 4.2%; P90 38.7%)                                       | RevenueCat 2026                                                                                                                                      |
| Install → paid (D35)            | Health & Fitness                                  | 2.9% (P75 6.2%)                                                              | RevenueCat 2026                                                                                                                                      |
| Install → paid (D35)            | Price: low / mid / high (vs. all measured apps)   | 1.4% / 2.0% / 2.8%                                                           | RevenueCat 2026                                                                                                                                      |
| Install → paid (D35)            | iOS / Google Play                                 | 2.6% / 0.9%                                                                  | RevenueCat 2026                                                                                                                                      |
| Install → paid (D35)            | AI / non-AI                                       | 2.4% / 2.0%                                                                  | RevenueCat 2026                                                                                                                                      |
| Conversion timing               | Freemium                                          | 1/3 on day 0; 60%+ in week 1; **23% after week 6**                           | RevenueCat 2026                                                                                                                                      |
| Paid churn, monthly plan        | 1st / 2nd / 3rd renewal                           | 53–61% / 65–77% / 73–82% (category medians)                                  | RevenueCat 2026                                                                                                                                      |
| Paid retention at 12 months     | Monthly plan: freemium / hard paywall             | 8% / 9%                                                                      | RevenueCat 2026                                                                                                                                      |
| Paid retention at 12 months     | Yearly plan: freemium / hard paywall              | 28% / 27%                                                                    | RevenueCat 2026                                                                                                                                      |
| Paid retention at 12 months     | Yearly: low / mid / high price                    | 36% / 26% / 23%                                                              | RevenueCat 2026                                                                                                                                      |
| Paid retention at 12 months     | AI vs non-AI: monthly / yearly                    | 6.1% vs 9.5% / 21.1% vs 30.7%                                                | RevenueCat 2026                                                                                                                                      |
| Annual cancellations            | Share in month 1                                  | 35%                                                                          | RevenueCat 2026                                                                                                                                      |
| Refunds                         | Median                                            | 2.9% freemium; 3.5% non-AI; 4.5% high price                                  | RevenueCat 2026                                                                                                                                      |
| Lenny/OpenView (SaaS)           | Freemium self-serve "good / great"                | 3–5% / 6–8% of new accounts                                                  | [Lenny's Newsletter, Aug 2023](https://www.lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion), 1,000+ products, mostly B2B/prosumer SaaS |
| Lenny/OpenView (SaaS)           | Free-trial products "good / great"                | 8–12% / 15–25%                                                               | same                                                                                                                                                 |

**Consistency check [arithmetic]:** Health & Fitness install-to-trial 6.9% × trial-to-paid 37.7% = 2.6%, against the
measured Health & Fitness D35 install-to-paid of 2.9%. The stages hang together.

**Card-required trials.** An App Store or Play trial always has a payment method on file, so RevenueCat and Adapty
trial-to-paid figures **are** the card-required consumer comparable. The B2B SaaS opt-out vs opt-in studies (First
Page Sage 48.8% vs 18.2%, 86 SaaS firms **[secondary]**) are not needed and are less comparable.

**Adapty caveats.** Adapty's rates are averages of per-app rates, not medians. Its pages contradict each other: the
Lifestyle report claims 18–38% "direct install-to-paid", which no other source comes near, and its paywall-library
pages give two different revenue numbers for the same app (§3). I gave Adapty less weight than RevenueCat.

**Things that do not transfer cleanly to Commise:**

- RevenueCat is mostly in-app-purchase data (it says "iOS, Android and web ecosystems", but it is an IAP platform).
  Commise bills on the web through Stripe and sends mobile users there. **GAP:** no public benchmark measures
  web-checkout conversion for a mobile-first consumer app. I made no adjustment.
- RevenueCat's "high price" tier is relative to all measured apps (above average). Commise Pro at $99.99/yr is
  far above RevenueCat's median yearly price ($34.80; North America $39.99). It is also far above every recipe
  competitor's annual price checked: ReciMe $29.99–59.99, Plan to Eat $54.99, Samsung Food $59.99, NYT Cooking
  $54.99–69.99 (App Store listings, 2026-10-27). Higher price lifted D35 conversion (2.8% vs 2.0%) but lowered yearly
  retention (23% vs 26%) in RevenueCat's data.
- Commise's 14-day trial falls in RevenueCat's 10–16 day bucket (median 35.4%, wide spread).
- Apply the AI retention penalty only to "Pro with AI". Commise is not an "AI app" in RevenueCat's sense (AI is not
  the primary value).

---

## 3. Recipe and meal-planning apps: what can be estimated

There is **no public paid-share benchmark for recipe apps**. Below is every usable data point. Method and confidence
are stated for each.

| App                      | Data found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Paying estimate and method                                                                                                                                                                                                                                                                                                                                                                                        | Confidence |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **ReciMe**               | Dec 2023: 400k users, premium launched that year, **$60k ARR** ([SmartCompany, 18 Dec 2023](https://www.smartcompany.com.au/?p=284926)). Jul 2024: 800k users ([Capital Brief](https://www.capitalbrief.com/briefing/cooking-app-recime-raises-15m-in-seed-round-led-by-even-capital-c46f07d0-5d14-4d13-b10c-817eae74cad6/); [Inside Small Business](https://insidesmallbusiness.com.au/finance/funding/cooking-app-recime-raises-1-5-million-in-investment-round)). 2025, Sensor Tower: **top-grossing US Food & Drink app** every quarter; weekly US gross revenue points from $52k to $543k; weekly download peaks 179k–254k; "active users" 0.49M–1.8M ([Q1](https://sensortower.com/blog/2025-q1-unified-top-5-food%20and%20drink-revenue-us-602e0a75241bc16eb808976d), [Q2](https://sensortower.com/blog/2025-q2-unified-top-5-food%20and%20drink-revenue-us-602e0a75241bc16eb808976d), [Q3](https://sensortower.com/blog/2025-q3-unified-top-5-food%20and%20drink-revenue-us-602e0a75241bc16eb808976d), [Q4](https://sensortower.com/blog/2025-q4-unified-top-5-food-and-drink-revenue-us-602e0a75241bc16eb808976d)). Price: ReciMe Plus $29.99–59.99 (App Store). | 2023: $60k ÷ ~$40 ≈ 1,500 annual-equivalent subscribers ≈ **0.4% of registered** in the paywall's first year [arithmetic]. 2025: cannot be pinned. The Sensor Tower posts are AI-written and give peaks and endpoints only; weekly revenue × 52 spans $2.7M–$28M; the "active users" series is not consistent between quarters; revenue is mostly annual purchases, so revenue ÷ price is not a subscriber count. | Low        |
| **NYT Cooking**          | 1M Cooking subscriptions ([Editor & Publisher](https://editorandpublisher.com/stories/the-new-york-times-both-cooking-and-games-reach-1-million-subscriptions,212023)); 2025 Sensor Tower app actives 1.3–1.9M, weekly revenue $57k–$382k (same posts). NYT does not break out Cooking now ([Digiday 2023](https://digiday.com/media/the-new-york-times-cooking-is-letting-readers-taste-test-recipes-over-text-to-drive-subscriptions/)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Not separable: bundles, web sales, and a news brand. Not a fair comparable for a new brand.                                                                                                                                                                                                                                                                                                                       | Low        |
| **Mealime**              | Pro $2.99/mo. Adapty page shows "<$5K" and "$60K" monthly revenue on the same page and marks the iOS listing "removed" ([Adapty](https://adapty.io/paywall-library/mealime-meal-plans-recipes/)). Latka: 2020 revenue $768K ([Latka](https://getlatka.com/companies/mealime)) **[secondary]**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | $768k ÷ $35.88/yr ≈ 21k paying-equivalent (2020) [arithmetic]. No reliable user denominator.                                                                                                                                                                                                                                                                                                                      | Very low   |
| **Crouton**              | Adapty: $10K–$20K/mo, <5K–10K downloads/mo; Discover $14.99/yr, Plus $24.99; acquired by Combustion ([Adapty](https://adapty.io/paywall-library/crouton/); [The Spoon](https://thespoon.tech/combustion-acquires-award-winning-recipe-app-crouton-appoints-crouton-developer-as/?nb=1)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | $120k–$240k/yr ÷ $15–25 ≈ 5k–16k payers (mix includes tips and one-time purchases) [arithmetic].                                                                                                                                                                                                                                                                                                                  | Very low   |
| **Pestle**               | Adapty: $9K–$10K/mo; Pro $19.99–24.99/yr, lifetime $39.99–49.99 ([Adapty](https://adapty.io/paywall-library/pestle/)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Same method: about 4k–6k payers [arithmetic].                                                                                                                                                                                                                                                                                                                                                                     | Very low   |
| **Samsung Food (Whisk)** | 6M+ users claimed; Food+ $6.99/mo or $59.99/yr (App Store) **[secondary for users]**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | No subscriber data found.                                                                                                                                                                                                                                                                                                                                                                                         | None       |
| **Plan to Eat**          | Paid membership $54.99/yr (App Store). No user or revenue disclosure found.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | None.                                                                                                                                                                                                                                                                                                                                                                                                             | None       |
| **Paprika**              | Paid up front ($4.99 iOS), 54k iOS ratings (iTunes API). No unit sales public.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Paid-upfront model: by definition every user paid. Not comparable to freemium.                                                                                                                                                                                                                                                                                                                                    | n/a        |
| **SideChef**             | 13.5M users and $1.5M revenue in 2021 ([Success](https://www.success.com/?p=70699)) **[secondary]**; now sells B2B to retailers and CPG brands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | $1.5M ÷ 13.5M users ≈ $0.11 per user per year [arithmetic]. Consumer subscriptions did not carry it.                                                                                                                                                                                                                                                                                                              | Low        |
| **Ollie**                | 50k+ families, $9.99/mo for new sign-ups ([Inquirer, Aug 2025](https://www.inquirer.com/food/ai-apps-meal-planning-shopping-20250828.html)); about 90k families mid-2026 **[secondary]**; $7.5M seed ([American Bazaar, Sep 2026](https://americanbazaaronline.com/2026/09/08/san-diego-ai-startup-ollie-secures-7-5-million-in-seed-funding-487752/)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | No paying split.                                                                                                                                                                                                                                                                                                                                                                                                  | None       |
| **Yummly**               | 20M+ registered at Whirlpool's 2017 purchase ([Whirlpool](https://whirlpool.mediaroom.com/2017-05-02-Whirlpool-Corporation-Announces-Planned-Acquisition-of-Yummly); [TechCrunch](https://techcrunch.com/2017/05/04/whirlpool-acquires-yummly-the-recipe-search-engine-last-valued-at-100m/)). Whole team laid off April 2024 ([The Spoon](https://thespoon.tech/whirlpool-lays-off-entire-team-for-cooking-and-recipe-app-yummly)); shut 20 Dec 2024; Whirlpool cited "adjusting its operating model" ([Plan to Eat blog](https://www.plantoeat.com/blog/2024/12/yummly-is-closing-discover-the-best-meal-planning-alternative)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | No paying data. Lesson from evidence only: 20M+ registered users did not make a self-funding business inside an appliance maker. Anything more about "why" is unsourced.                                                                                                                                                                                                                                          | Low        |
| **Tasty**                | No subscription product found.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | n/a                                                                                                                                                                                                                                                                                                                                                                                                               | —          |

**What the category evidence does show:** (1) a recipe app _can_ earn at scale on subscriptions (ReciMe topped US Food
& Drink grossing all of 2025, per Sensor Tower estimates); (2) category prices cluster at $30–$70 a year; (3)
large free audiences (Yummly 20M+, SideChef 13.5M) did not turn into subscription businesses on their own. It does
**not** give a paid share. The business plan's line "RevenueCat data: Food apps see 2–5% subscription conversion"
(`docs/business-plan.md` §5.3) has no source I could find. RevenueCat publishes no Food & Drink figure. Its
"5% / 8% / 10% subscription conversion" table (§5.2) is also unsourced.

---

## 4. Active users: the owner's question, tested

The cost model guessed **20% / 30% / 45%** of registered users are monthly active.

### 4.1 Direct disclosures of MAU ÷ registered

| Company            | MAU ÷ registered        | Source                                                                                                                                                                                                                                                                 | Notes                                                                                                                                 |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Evernote, Dec 2009 | 700k ÷ 2M = **35%**     | [TechCrunch, 30 Dec 2009](https://techcrunch.com/?p=132324)                                                                                                                                                                                                            | 18 months after launch, growing about 10%/month; a "library" product like a recipe box                                                |
| Strava, 2025       | ~50M ÷ 180M+ = **~28%** | Sensor Tower MAU estimate and company claim, via [Forge](https://forgeglobal.com/insights/strava-upcoming-ipo-news/) / [the5krunner](https://the5krunner.com/2026/01/09/strava-ipo-filing-3-billion-valuation-analysis/) **[secondary; both pages blocked the fetch]** | 16-year-old category leader                                                                                                           |
| Others             | —                       | —                                                                                                                                                                                                                                                                      | Duolingo, Spotify, Canva, Flo disclose MAU but not registered. Yummly, MyFitnessPal and Samsung Food disclose registered but not MAU. |

### 4.2 What the install-cohort benchmarks imply [arithmetic]

Day-N retention measures being active _on one day_, which is below being active _at some point in the month_. So it
gives a **floor** for MAU ÷ registered. With a month-0 cohort counted fully active (it just signed up), day 30
= Food & Drink benchmark, and day 90 onward = Amplitude 3-month medians:

| Months since launch | Flat sign-ups (OneSignal F&D / AppsFlyer F&D iOS) | Sign-ups growing 10%/month |
| ------------------- | ------------------------------------------------- | -------------------------- |
| 3                   | 36.8% / 35.2%                                     | 39.9% / 38.4%              |
| 12                  | 11.1% / 10.4%                                     | 16.2% / 15.3%              |
| 24                  | 6.8% / 6.2%                                       | 12.9% / 12.1%              |

What this shows:

- **Active share is not a constant.** It is high at launch because almost everyone is new, then it falls as the base
  ages, unless growth keeps feeding new users in. A flat 20/30/45% is the structural flaw in the cost model.
- The true value sits above these floors. **GAP:** no source gives the multiplier from "active on day 30" to "active
  in month 1" for food apps.
- The observed ceiling for winners is about **28–35%** (Evernote, Strava).

### 4.3 Verdict on 20 / 30 / 45%

- **20%**: inside the evidence (between the 12-month floor of 10–16% and the winners' 28–35%).
- **30%**: matches the winners. Reasonable as an upside case, optimistic as a base for a new brand.
- **45%**: no disclosure found supports it at 12–24 months. It appears only in months 1–3, from the arithmetic
  effect of new sign-ups.
- **The owner thinks these figures are far too low. The evidence does not support raising them.** It supports 20–30%
  for a successful app, and lower for an average one.

### 4.4 Share of monthly active users who pay (disclosed)

| Company            | Paid ÷ MAU                | Source                                                                                                                                                                                                                                                        | Notes                                                                                                                      |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Evernote, Dec 2009 | **4.9%** (35k premium)    | [TechCrunch 2009](https://techcrunch.com/?p=132324)                                                                                                                                                                                                           | Also 1.75% of registered; still-active 2-year users paid at 20% ([TechCrunch, May 2010](https://techcrunch.com/?p=185020)) |
| Strava, 2025       | **~4–5%** (2–2.5M ÷ ~50M) | Sensor Tower estimates via secondary press **[secondary]**                                                                                                                                                                                                    | ~1.1–1.4% of 180M registered                                                                                               |
| Flo, June 2024     | **~7%** (~5M ÷ ~70M)      | [Fierce Healthcare, Jul 2024](https://www.fiercehealthcare.com/digital-health/fertility-and-period-tracking-app-flo-health-bank-200m-reach-unicorn-status)                                                                                                    | Health app, 11 years old                                                                                                   |
| Duolingo, Q2 2026  | **9.0%** (12.7M ÷ 140.6M) | [Q2 2026 8-K](https://www.sec.gov/Archives/edgar/data/0001562088/000162828026053299/q2fy26duolingo6-30x26share.htm); the FY2025 10-K states "approximately 9%" ([10-K](https://www.sec.gov/Archives/edgar/data/1562088/000162828026012494/duol-20251231.htm)) | Excludes trials and non-paying family members                                                                              |
| Canva, 2025        | **~11.7%** (31M ÷ 265M)   | [TechCrunch, 18 Feb 2026](https://techcrunch.com/2026/02/18/canva-gets-to-4b-in-revenue-as-llm-referral-traffic-rises/)                                                                                                                                       | Includes business seats                                                                                                    |
| Spotify, Q3 2026   | **38.8%** (306M ÷ 788M)   | [Spotify Q3 2026, SEC 6-K](https://www.sec.gov/Archives/edgar/data/0001639920/000114036126040435/ef20084028_ex99-1.htm)                                                                                                                                       | Music, ad-limited free tier, family sub-accounts. A ceiling only, not a comparable                                         |

All of these are **winners measured late in life** (survivorship bias). They mark the top of the 24-month range, not
the middle. Their median, without Spotify, is about **7%**.

### 4.5 Registered-denominator disclosures (cross-check)

Dropbox 2.2% of 500M+ registered (S-1, 2018; [SEC](https://www.sec.gov/Archives/edgar/data/0001467623/000119312518055809/d451946ds1.htm)).
Evernote 1.75% (2009) and 2.2% (68k ÷ 3.1M, 2010). Headspace 2M+ paid ÷ 62M+ downloads ≈ 3.2% ([BusinessWire, Feb 2020](https://www.businesswire.com/news/home/20200212005206/en)).
Calm 4M+ ÷ 100M+ downloads ≈ 4% **[secondary]**. Strava ≈ 1.1–1.4% **[secondary]**.
Range: **1.1%–4%**. This agrees with RevenueCat's freemium median 2.1% and top quartile 4.5%.

---

## 5. Combining the two: % of registered who pay [arithmetic]

% registered paying = active share × paid share of active.

| Active share ↓ / Paid ÷ MAU → | 2%    | 4.9% (Evernote) | 7% (Flo) | 9% (Duolingo) | 11.7% (Canva) |
| ----------------------------- | ----- | --------------- | -------- | ------------- | ------------- |
| 7% (24-month floor, flat)     | 0.14% | 0.34%           | 0.49%    | 0.63%         | 0.82%         |
| 11% (12-month floor, flat)    | 0.22% | 0.54%           | 0.77%    | 0.99%         | 1.29%         |
| 20% (cost model low)          | 0.40% | 0.98%           | 1.40%    | 1.80%         | 2.34%         |
| 28% (Strava est.)             | 0.56% | 1.37%           | 1.96%    | 2.52%         | 3.28%         |
| 35% (Evernote)                | 0.70% | 1.72%           | 2.45%    | 3.15%         | 4.09%         |
| 45% (cost model high)         | 0.90% | 2.21%           | 3.15%    | 4.05%         | 5.26%         |

- Every registered-denominator comparable (§4.5) falls between 1.1% and 4%. That band sits in the middle-right of
  this grid.
- **The cost model's 5% of registered** needs 45% active _and_ Canva-level paid share. **Its 10%** is off the grid:
  at 30% active it implies 33% of MAU paying, and at 45% active it implies 22%. No comparable except Spotify
  reaches either.
- So the two inputs the owner wants raised cannot both be high at once and still match any real business found.

---

## 6. Commise range at 3, 12 and 24 months

**Method [arithmetic on cited inputs].** The end-to-end distribution is RevenueCat's freemium D35 install-to-paid
(P10 0.3% / median 2.1% / P75 4.5% / P90 8.2%). **P25 is not published**, so "low" uses P10. Stage percentiles are
not multiplied together (that assumes the stages are independent and overstates the spread), and segment uplifts
(Health & Fitness, North America, high price) are not stacked, because those cuts overlap. Model inputs, all from
RevenueCat 2026: the late 23% of freemium conversions are spread over months 2–11 (the spread is my assumption; the
23% is sourced); monthly-plan survival 57% → 40% → 31% → 20% at 6 months → 8% at 12 months; yearly survival 100%
to month 12, then 28%, then ×60% at the second renewal; plan mix 53% yearly / 47% monthly (RevenueCat's North
America mix of 40% yearly / 36% monthly, with weekly removed because Commise sells none). Sign-ups are flat or
growing 10%/month. The model script is kept privately and is not published.

**Paying subscribers ÷ cumulative registered users**

| Months after launch | Low (P10)  | Base (median) | Health & Fitness median (flattering) | High (P75) | Ceiling (P90) |
| ------------------- | ---------- | ------------- | ------------------------------------ | ---------- | ------------- |
| 3                   | 0.26%      | **1.8%**      | 2.5%                                 | 3.9%       | 7.1%          |
| 12                  | 0.24%      | **1.7%**      | 2.3%                                 | 3.6%       | 6.5%          |
| 24 (flat / growing) | 0.16–0.20% | **1.1–1.4%**  | 1.6–2.0%                             | 2.4–3.1%   | 4.4–5.6%      |

Sensitivities: Health & Fitness plan mix (68% yearly) moves base at 24 months to 1.3%; AI-app retention (yearly
21.1%) moves it to 1.1%. Counting per registered instead of per download could raise all rows by 1.1–1.9× (old
Liftoff data, §1). This model **does not** include Evernote-style conversion that keeps rising with tenure (0.5% in
month 1 → 2% at 12 months → 6% at 18 months of a whole cohort). A recipe library may behave that way, which is the
best evidence for the owner's view. But only one 2009–2010 source shows it.

**Share of monthly active users paying [arithmetic]:** base 12-month 1.7% ÷ active share 28–35% ≈ **4.9–6.1% of
MAU**. That lands right next to Evernote (4.9%) and Strava (about 4–5%). At 3 months, active share is at least 35–40%
(§4.2 floor), so base paid ÷ MAU is at most about **4.5–5%**, and the P75 case is at most about 10%.

**Drivers, with direction and source:**

- Category: Food & Drink has no benchmark. Lifestyle install value $0.70 is 7th of 8, against Health & Fitness $1.21
  (Adapty 2026). Leans down from Health & Fitness.
- Freemium vs hard paywall: 2.1% vs 10.7% D35 install-to-paid; yearly retention equal (28% vs 27%) (RevenueCat).
  Commise is freemium with a generous free tier. Leans down.
- Price: Commise $99.99/yr is about 2–3× category prices. Higher price lifts conversion in RevenueCat's
  cross-category data (2.8% vs 2.0%) but lowers yearly renewal (23% vs 26%). Net effect for a category priced at
  $30–$70: **GAP**.
- Card-required 14-day trial: 10–16 day bucket median 35.4% trial-to-paid (RevenueCat). Already inside the
  benchmarks.
- Web vs mobile: iOS converts at 2.9× Google Play (2.6% vs 0.9%). Web checkout from mobile: **GAP**.
- AI: AI apps convert slightly better (2.4% vs 2.0%) but keep yearly payers worse (21.1% vs 30.7%). Applies to Pro
  with AI.
- Geography: North America D35 2.8% vs global 2.0%. US-heavy acquisition leans up.

---

## 7. SC-006: recommended replacement wording

Problems with the current text ("Pro conversion rate of at least 5% of active free-tier users within the first 3
months"): "active" is not defined; "first 3 months" could mean months since launch or days since sign-up; trials
are not excluded; and 5% of MAU at 3 months is at or above the median case (§6).

**Proposed SC-006 (primary, cohort-based, matches RevenueCat's definition):**

> **SC-006**: For each monthly cohort of newly registered users, at least **2.0%** hold a paid (not trialing, not
> refunded) Pro or Pro with AI subscription **35 days after registration**, measured over the first three full
> cohorts after launch. Benchmark: RevenueCat SOSA 2026 freemium median D35 download-to-paid 2.1%; stretch target
> 4.5% (RevenueCat top quartile).

**Proposed SC-006a (secondary, comparable to public filings):**

> **SC-006a**: Paid subscribers ÷ monthly active users (users with at least one signed-in session in the calendar
> month, paid users included) reach **5% by month 12** and **7% by month 24** after launch. Benchmarks: Evernote
> 4.9% (2009), Flo about 7% (2024), Duolingo 9% (2026).

Report both every month, with the denominators named. Do not report one number called "conversion".

**Base rate for financial projections:** paying subscribers = **1.7% of cumulative registered users at month 12**
and **1.25% at month 24** (midpoint of 1.1–1.4%). Low case 0.25% / 0.2%. High case 3.6% / 2.8%. Model
active users as a curve that falls with base age (§4.2), not a fixed 20/30/45%. Replace the business plan's 5/8/10%
and its "RevenueCat food apps 2–5%" line; neither has a source.

---

## 8. Evidence vs judgment, and where evidence is thin

**Strong (primary, large samples):** RevenueCat 2026 conversion, trial and retention distributions; Duolingo,
Spotify and Dropbox filings.

**Medium:** Canva and Flo (company figures through press); Evernote (old, small, but CEO-reported); OneSignal and
AppsFlyer retention (vendor SDK samples; their definitions differ, hence 2.9% vs 7.9% for Food & Drink day 30).

**Weak:** all recipe-app paid estimates (AI-written Sensor Tower summaries, contradictory Adapty pages, Latka);
Strava MAU and subscriber figures (estimates via secondary press); Adjust figures (secondary).

**Judgment I could not avoid, labelled:** spreading the late 23% of conversions over months 2–11; using P10 as the
low case because P25 is not published; the plan-mix renormalization.

**Gaps no source closes:** install-to-registration today; a Food & Drink conversion benchmark; web-checkout
conversion for mobile-acquired users; the effect of a $99.99 price in a $30–$70 category; a day-N to monthly-active
multiplier. The fastest way to close all five is Commise's own first three cohorts. Re-baseline SC-006 after them.

**Bias notes:** Every company-level comparable is a survivor; failed recipe apps publish nothing. RevenueCat
includes only apps already earning subscription revenue above a threshold. Both biases push the comparables
**up**, so the true median for a new entrant is, if anything, below the figures here. Nothing here is causal: the
freemium-vs-hard-paywall and price gaps are correlations across apps that differ in many ways.
