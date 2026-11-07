# AI tiers and the recipe-app market

Fetch date for every source below: 2026-10-27, unless a line says otherwise.

Labels:

- [P] primary. The company's own page, its App Store listing, or its SEC filing.
- [S] secondary. Press, analyst or aggregator.
- [Unconfirmed] seen only in a search summary or a weak source.

How the App Store data was read. I pulled each US App Store page (`https://apps.apple.com/us/app/id<ID>`) and read the "In-App Purchases" list from the page's JSON. Apple shows at most 10 IAP rows per app. So a tier missing from that list is not proof that it does not exist.

## Verdict on the owner's claim

The claim is "Pro with AI is an offering other apps don't have."

- **The tier SHAPE is rare. I found no recipe or meal-planning app that sells a non-AI paid plan with a separate, pricier AI plan above it.** That shape is Commise's Pro at $9.99 with Pro with AI at $19.99.
- **One app is unresolved.** Honeydew lists three paid names on the App Store: Plus, Pro and Premium. Its site ties AI photo import to Plus. Nothing I found says what Pro adds. If Pro is an AI tier above Plus, the claim fails. Status: [Unconfirmed].
- **The FEATURES are not rare.** AI meal plans, AI leftovers or food-waste help, and AI assistants are already sold, most often inside a single plan that costs less than $19.99 a month.
    - Samsung Food+ ($6.99/mo) advertises AI meal plans.
    - Kitchen Stories Plus advertises making dishes from leftovers to cut food waste.
    - ReciMe Plus includes an AI assistant.
    - Honeydew advertises an AI meal planner.
- **AI-native apps already sell usage tiers.** Some go above $19.99. Ollie charges $25 and $100 a month. DishGen charges $72 and $159 a year.
- **The nearest shapes I found:**
    - MyFitnessPal sells Premium+ above Premium. The extra is a meal planner. Its AI Coach is in both tiers.
    - Crouton sells a one-time $24.99 Plus unlock. AI import needs a separate Discover subscription, which costs less, not more.
- **Fair wording for the owner:** "Few if any recipe apps split AI into its own higher tier." Not: "No other app offers AI meal plans or food-waste help."

## Part 1. How recipe and meal apps sell AI

| App             | How AI is sold                                                              | Price points seen                                                       | Label                                 |
| --------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| Ollie           | AI-native. Message-credit tiers plus top-ups                                | Free, Everyday $25/mo, Always-On $100/mo                                | [P]                                   |
| DishGen         | AI-native. Credit tiers                                                     | Free, Premium $72/yr, Pro $159/yr (web). App Store: $7.99/mo, $79.99/yr | [P]                                   |
| ChefGPT         | AI-native. One paid "PRO" plan, many price points                           | $2.99 to $89.99                                                         | [P]                                   |
| Sage            | AI-native. Free AI-action bundle, then unlimited in Plus                    | $4.99, $39.99                                                           | [P]                                   |
| Samsung Food    | AI inside the single paid plan (Food+)                                      | $6.99/mo, $59.99/yr                                                     | [P]                                   |
| ReciMe          | AI assistant inside the single paid plan (Plus)                             | Plus $29.99 to $59.99                                                   | [P]                                   |
| Honeydew        | AI-heavy app. Three paid names. Split not documented                        | Plus, Pro, Premium ($6.99/mo, $39.99/yr)                                | [P] for list, [Unconfirmed] for split |
| Kitchen Stories | Leftovers feature in the app text. Single Plus plan                         | $6.99 to $79.99                                                         | [P]                                   |
| Flavorish       | AI import and generator inside the single Premium plan                      | $4.99/mo, $49.99/yr                                                     | [P]                                   |
| Crouton         | AI import needs the Discover subscription. Plus is a one-time non-AI unlock | Discover $1.99/mo, $14.99/yr. Plus $24.99                               | [P] list, [S] split                   |
| Deglaze         | Bring-your-own-AI. Pro links ChatGPT, Claude or Muse to your recipes        | Pro $49.99                                                              | [P]                                   |
| SideChef        | RecipeGen AI promoted. Single Premium plan                                  | $4.99/mo, $49.99/yr                                                     | [P]                                   |
| Cookidoo        | AI assistant launched 21 Sep 2026. Pricing link to it not stated            | One Year Membership $74.99                                              | [P]                                   |
| MyFitnessPal    | AI Coach in Premium AND Premium+. Premium+ adds meal planning               | Premium $19.99/mo, $79.99/yr. Premium+ $24.99/mo, $99.99/yr             | [P] Premium, [S] Premium+ price       |
| Lose It!        | AI photo and voice logging inside Premium                                   | $9.99 to $79.99                                                         | [P]                                   |
| Noom            | AI food logging inside the program                                          | $44.99 to $199.99                                                       | [P]                                   |
| Cal AI          | AI-native. One "Unlimited" plan                                             | $2.99 to $29.99                                                         | [P]                                   |
| Eat This Much   | Auto meal planner inside Premium. Not marketed as AI                        | $8.99 to $84.99                                                         | [P]                                   |
| Plan to Eat     | No AI found. One membership                                                 | $54.99/yr                                                               | [P]                                   |
| MealPractice    | AI-native. Credit packs                                                     | from $8                                                                 | [Unconfirmed]                         |
| Yummly          | Search returned no matching app on the US store                             | none                                                                    | GAP                                   |

### Quotes behind the table

**Ollie** [P] https://ollie.ai/pricing

- Everyday: "$25/month". "150 messages from Ollie per month". Top-ups "$0.30 per message".
- Always-On: "$100/month". "1,000 messages from Ollie per month". Top-ups "$0.25 per message".
- Free: "50 messages from Ollie per month".
- So the owner's figures ($25 and $100) are confirmed. Both tiers are AI. They differ by volume.

**DishGen** [P] https://www.dishgen.com/premium

- Basic: "15 usage credits per week". "1 credit = 1 recipe or meal plan".
- Premium: "$72/year". "75 usage credits per day".
- Pro: "$159/year". "150 usage credits per day". Adds "Commercial rights" and "AI recipe images".
- App Store [P] https://apps.apple.com/us/app/id6473455744 lists "DishGen Premium - Monthly = $7.99" and "DishGen Premium - Annual = $79.99". The app text says "Basic (Free): Includes 15 recipe credits/month" and "Premium: Unlimited recipe credits". The two DishGen sources disagree on Basic credits.
- This is a higher AI tier above a paid AI tier. It is not an AI tier above a non-AI paid tier.

**Samsung Food** [P] https://apps.apple.com/us/app/id1133637674

- IAP: "Monthly = $6.99", "Yearly = $59.99".
- App text: "AI-personalized weekly meal plans tailored to your health goals." and "Try Samsung Food+ for even more ways to eat well".

**ReciMe** [P] https://recime.app/help/en/articles/11630603-what-are-the-benefits-of-recime-plus

- Plus benefits include "Ask ReciMe", described as "your AI assistant" for "any question about a recipe as you cook".
- The page names only the free plan and ReciMe Plus.
- App Store [P] https://apps.apple.com/us/app/id1593779280 lists only "ReciMe Plus" rows, from $29.99 to $59.99.

**Honeydew** [P] https://apps.apple.com/us/app/id6714449541

- IAP rows: "Honeydew Plus = $19.99", "$59.99", "$99.99". "Honeydew Pro = $59.99", "$99.99". "Premium Month = $6.99". "Premium Year = $39.99". "Premium Week = $9.99".
- App text: "AI meal planner – weekly meal plans created in seconds". "Talk to our AI assistant".
- Site FAQ [P] https://www.honeydewcook.com/ : "With Honeydew Plus, you can capture recipes from photos, screenshots, or social media posts. Our AI recognizes text from images".
- What Pro adds: not found on the App Store, Google Play or the site. [Unconfirmed]

**Kitchen Stories** [P] https://apps.apple.com/us/app/id771068291

- App text: "Generate perfect dishes from leftovers to reduce food waste". "With Kitchen Stories Plus, you can save and organize social media recipes".
- IAP: "Plus Subscription = $6.99", "$7.99", "$79.99", plus sale rows.
- The text does not say if the leftovers feature is AI or Plus-only.

**Crouton**

- [P] https://apps.apple.com/us/app/id1461650987 IAP: "Discover Yearly = $14.99", "Discover Monthly = $1.99", "Crouton Plus = $24.99". App text: "AI IMPORTING. Quickly import recipes using AI."
- [S] https://www.tapsmart.com/apps/review-crouton/ (updated 30 Sep 2026): "A Discover subscription is also needed for the AI import feature."

**Deglaze** [P] https://apps.apple.com/us/app/id6443578246

- "Bring Your Recipes to Your Favorite AI Assistant (Pro). Connect ChatGPT, Claude or Muse to your recipes, grocery list, meal plan and cooking history".
- IAP: "Deglaze Pro = $49.99".
- This is the closest match to Commise's bring-your-own-key idea. The user brings their own AI account.

**MyFitnessPal**

- [P] https://apps.apple.com/us/app/id341232718 text: "PREMIUM PLUS. All Premium features, plus full nutrition-focused meal planning". IAP top rows: "Monthly Premium = $19.99", "Yearly Premium = $79.99".
- [P] https://www.myfitnesspal.com/premium : Premium "$79.99/ year" and "$19.99/ month". The page does not mention Premium+.
- [S] https://9to5mac.com/2026/06/16/myfitnesspal-adds-ai-powered-coach-for-personalized-nutrition-guidance/ (16 Jun 2026): AI Coach is "available to Premium and Premium+ subscribers".
- [S] Premium+ at $24.99/mo or $99.99/yr is from https://recurdash.com/subscription-pricing/myfitnesspal . I did not see it on an MFP page.

**SideChef** [P] https://apps.apple.com/us/app/id905229928 : "Monthly SideChef Premium subscription: $4.99 USD." and "Annual SideChef Premium subscription: $49.99 USD."

**Cookidoo** [P] https://www.presseportal.de/en/pm/52621/6356041 (21 Sep 2026): the assistant "will begin rolling out to customers from 21 September". It "helps users find recipes, compare options and organise cooking ideas". Price link not stated. App Store IAP: "One Year Membership = $74.99".

**Lose It!** [P] https://apps.apple.com/us/app/id297368629 : "PREMIUM PLAN FEATURES. Photo Meal Logging ... AI Voice".

**Noom** [P] https://apps.apple.com/us/app/id634598719 : "AI food logging with 1M+ food items".

**Eat This Much** [P] https://apps.apple.com/us/app/id981637806 IAP: "Eat This Much Subscription" at $8.99, $14.99, $47.99, $53.99, $59.99, $84.99.

**Plan to Eat** [P] https://apps.apple.com/us/app/id1215348056 IAP: "One-Year Membership = $54.99". No AI in the app text.

**Sage** [P] https://apps.apple.com/us/app/id6474780726 : "Sage is free to use, and comes with a starter bundle of AI actions". "Sage Plus includes unlimited AI actions."

**Flavorish** [P] https://apps.apple.com/us/app/id6478546136 : "we offer a $4.99/month Premium plan that supports our small team and covers the cost of advanced tools."

**MealPractice** [Unconfirmed]. Only aggregator sites (for example https://www.toolworthy.ai/en/tool/mealpractice) describe credit packs "from $8".

## Part 2. Top US Food & Drink grossers (Sensor Tower)

**2026 data: GAP.**

- I tried the URL pattern for 2026 Q1, Q2 and Q3 (unified, iOS, Android, with both spellings). Every one returned 404.
- I then downloaded all 1,509 Sensor Tower blog sitemaps (https://sensortower.com/sitemap.xml, last modified 2026-10-27). That is 1,511,102 URLs.
- Food and drink US posts exist up to 2025 Q4.
- The sitemap lists only 100 posts for 2026. All are game categories (97 "2d-anime-games", plus celebrity, truck and ultracasual games).
- So Sensor Tower has not published a 2026 food and drink top-5 post as of this date.

**Latest available: 2025 Q1 to Q4, unified (iOS plus Google Play), US.** All [S]. Sensor Tower is a third-party estimate.

The posts give peaks and end points, not full weekly series.

### 2025 Q4. https://sensortower.com/blog/2025-q4-unified-top-5-food-and-drink-revenue-us-602e0a75241bc16eb808976d (Jan 2026)

1. ReciMe. Weekly revenue about $543K at the start, $159K at the end. Downloads 203K, then 188K. "Active users peaked at over 537K mid-December before slightly dropping to 494K."
2. NYT Cooking. Revenue high of $382K in late December. Downloads peaked at 35K. "Active users consistently grew, starting from 1.3M and ending the quarter at 1.9M."
3. America's Test Kitchen. Revenue $30K to $40K weekly. Downloads spiked to 11K. "Active users remained steady, hovering around 52K to 60K throughout the quarter."
4. Vivino (wine, not recipes). Revenue $23K to $32K weekly. "Downloads saw a significant increase towards the end of the quarter, reaching 12.7K."
5. Gronda: Recipes for Chefs. Revenue peaked at $31K, then about $15K.

iOS-only Q4 2025 (https://sensortower.com/blog/2025-q4-ios-top-5-food-and-drink-revenue-us-602e0a75241bc16eb808976d): ReciMe "from approximately $475K to $38K by early November", then "nearly $176K". NYT Cooking "reaching $327K".

### 2025 Q3. https://sensortower.com/blog/2025-q3-unified-top-5-food%20and%20drink-revenue-us-602e0a75241bc16eb808976d (Oct 2025)

1. ReciMe. "peaking at approximately $525K by the end of September". Weekly downloads high about 254K. Active users 1.1M to about 1.8M.
2. NYT Cooking. "a notable peak in late July at $107K". Downloads about 18K to 20K a week.
3. Vivino (wine). "a peak of $33.5K in early September".
4. America's Test Kitchen. "averaging around $30K". Downloads peaked at 9.8K.
5. Seed Oil Scout (restaurant finder, not recipes). "starting at $30K and dropping to $16.5K".

### 2025 Q2. https://sensortower.com/blog/2025-q2-unified-top-5-food%20and%20drink-revenue-us-602e0a75241bc16eb808976d (Jul 2025)

1. ReciMe. "peaking at around $176.6K in late April before stabilizing to approximately $52K by the end of June". "downloads surged to 191K in early June". Active users "over 1.1M".
2. NYT Cooking. "a slight peak at $57.2K in late June". Downloads "starting at 19.5K in March and ending at 20.9K".
3. Seed Oil Scout. "a high of $34.8K in late June".
4. Vivino. "peaking at $32.5K in late June".
5. America's Test Kitchen. "reaching $29.9K by late June".

### 2025 Q1. https://sensortower.com/blog/2025-q1-unified-top-5-food%20and%20drink-revenue-us-602e0a75241bc16eb808976d (Apr 2025)

1. ReciMe. "hitting approximately $292.6K in mid-January". "Downloads surged to 178.8K in the week of January 13". Active users "around 638.9K by the end of March".
2. NYT Cooking. "culminating at $69K in late March". Active users "over 1.3M".
3. Seed Oil Scout. "peaking at $38.6K in late January".
4. America's Test Kitchen. "peak revenue of $37.2K in January".
5. Vivino. "peaking at $32.6K in late January".

### Recipe apps in the top 5

- ReciMe is #1 in all four 2025 quarters.
- NYT Cooking is #2 in all four.
- America's Test Kitchen is in all four.
- Gronda (a chef recipe app) appears in Q4.
- Vivino and Seed Oil Scout are not recipe apps.
- None of the top recipe grossers sells a separate AI tier. ReciMe sells one Plus plan. NYT Cooking and ATK are content subscriptions.

## Part 3. Market crowding

**Number of apps**

- Google Play, Food & Drink category: 130,973 free plus 312 paid, so **131,285 apps**. [S] 42matters, page data "update_time":"2026-10-27". https://42matters.com/google-play-statistics-and-trends . The page JSON says: `"category_name":"Food & Drink","free_apps_count":130973,"paid_apps_count":312`.
- This counts the whole category. It includes delivery, restaurant and wine apps, not only recipe apps.
- Apple App Store, Food & Drink: **GAP.** 42matters lists only its top 7 iOS categories. The smallest of those, Productivity, has 185,833 apps. Food & Drink is not in the list, so it has fewer. https://42matters.com/ios-apple-app-store-statistics-and-trends
- Recipe or meal-planning apps only: **GAP.** No Appfigures, AppMagic or Sensor Tower count was found.
- Not a category size: AppPricingLab says "3,775 food & drink apps tracked". That is only what that site tracks. https://www.apppricinglab.com/reports/food-and-drink

**Revenue concentration**

- Share of category revenue held by the top 1 to 5 apps: **GAP.** No source found.
- Proxy (my own arithmetic from the Sensor Tower posts above):
    - Q4 2025. ReciMe's start-of-quarter week ($543K) is about 17 times the #5 app's peak ($31K). It is about 36 times #5's later level ($15K).
    - Q3 2025. ReciMe's peak ($525K) is about 17 times the #5 app's start ($30K). It is about 32 times #5's end ($16.5K).
    - Q4 2025. ReciMe plus NYT Cooking peaks ($543K plus $382K) are about 4 to 5 times the combined ranges of #3 to #5.
- Reading: two apps take most top-5 revenue. A recipe app in the #5 slot earns roughly $15K to $40K a week by Sensor Tower's estimate.

**Context on churn and revenue in the wider subscription market**

- [S] RevenueCat 2026, cited by TechCrunch (10 Mar 2026) https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows : "AI-powered apps account for 27.1% of apps across all categories".

## Part 4. Will people pay for an AI tier above a base paid plan?

### The strongest signal: big companies are folding AI into the base plan

**Duolingo** [P], SEC filings, verbatim.

- Q4 FY25 shareholder letter (26 Feb 2026) https://www.sec.gov/Archives/edgar/data/1562088/000162828026012246/q4fy25duolingo12-31x25shar.htm : "we will move Video Call to be part of the Super Duolingo tier and experiment with changes to our top subscription tier, Duolingo Max."
- Q1 FY26 letter https://www.sec.gov/Archives/edgar/data/0001562088/000162828026029790/q1fy26duolingo3-31x26share.htm : "we're starting to expand access to Video Call to Super subscribers."
- Q2 FY26 letter https://www.sec.gov/Archives/edgar/data/0001562088/000162828026053299/q2fy26duolingo6-30x26share.htm : "most new Super Duolingo subscribers now have access to Video Call, and we expect to extend that access to existing Super subscribers later this year."
- 10-K FY2025 https://www.sec.gov/Archives/edgar/data/1562088/000162828026012494/duol-20251231.htm : "Duolingo Max is a premium subscription tier launched in 2023 and offered to a portion of our user base and priced higher than Super Duolingo."
- Paid subscribers (same letters): 12.2M at end of 2025, 12.5M in Q1 2026, 12.7M in Q2 2026.
- Max share of subscribers: **no primary figure.** I searched every shareholder letter and 10-Q/10-K from Q3 FY24 to Q2 FY26. None states a Max share. The missing figure is itself a finding.
    - [S] Earnings-call summaries put Max at about 5% (Q4 2024), 7% (Q1 2025), about 8% (Q2 2025) and about 9% (Q3 2025). Source: https://fintool.com/app/research/companies/DUOL/earnings/Q3%202025 . The Q3 2025 summary quotes management saying Max is "now 9% of our subscribers", below its own expectations.
    - [P] Q3 FY25 letter https://www.sec.gov/Archives/edgar/data/1562088/000162828025049514/q3fy25duolingo9-30x25share.htm : "a mix shift toward our higher-priced subscription tiers, including Max and our family plan, which drove a 7% year-over-year increase in subscription revenue per average paid subscriber".
    - [P] Q3 2025 10-Q: gross margin fell "due to ... an increase in generative AI costs associated with expansion of our Duolingo Max subscription tier".
- Reading: after about two and a half years, the AI tier held under 10% of subscribers (secondary figure). Its AI cost hurt margins. The company is now moving its main AI feature down into the base paid tier.

**Notion** [S]. It bundled AI into its plans and retired the standalone AI add-on for new buyers on 13 May 2025. Seen only in search summaries. [Unconfirmed]

**Microsoft 365** [P] https://www.microsoft.com/en-us/microsoft-365/blog/2025/01/16/copilot-is-now-included-in-microsoft-365-personal-and-family/ (16 Jan 2025)

- Microsoft is "increasing the prices of Microsoft 365 Personal and Family in the US". The rise is $3 a month.
- Subscribers get "a monthly allotment of AI credits".
- Users could keep the old price with "Personal Classic or Family Classic plans". Those have no Copilot.
- So Microsoft put AI into the base plan and kept a no-AI escape hatch. That is the reverse of an AI upsell.
- How many moved to Classic: GAP.
- [S] Later, Microsoft 365 Premium at $19.99/mo replaced Copilot Pro in Oct 2025. This is a higher AI tier above Family. https://www.techrepublic.com/article/news-microsoft-365-premium/ . Subscriber count: GAP.
- [Unconfirmed] 89 million consumer subscribers in July 2025, per https://office-watch.com/2026/microsoft-365-subscribers-2026/ . The figure is not on a Microsoft page I fetched.

### AI tiers that sit above a cheaper paid plan

**Google One** [S] Reuters via MarketScreener, 15 May 2025 https://ca.marketscreener.com/quote/stock/ALPHABET-INC-24203373/news/Google-hits-150-million-users-for-subscription-service-with-help-of-AI-49971744/

- Google One "recently crossed 150 million subscribers", up 50% from 100 million in Feb 2024.
- The AI plan is "$19.99 a month".
- The AI tier has "millions" of subscriptions. No exact count was given.
- Reading: "millions" out of 150 million is a low single-digit percentage at most. It is not a precise attach rate.

**ChatGPT** [S] TechCrunch, 27 Feb 2026 https://techcrunch.com/2026/02/27/chatgpt-reaches-900m-weekly-active-users

- "ChatGPT has reached 900 million weekly active users".
- "OpenAI also shared that it now has 50 million paying subscribers."
- About 5.6% of weekly users pay. **That is my own arithmetic.** The 50M may include business seats.

**Grammarly**: no attach figure found. GAP.

**Recipe-app AI attach data**: none found. GAP.

### AI apps in general: RevenueCat State of Subscription Apps 2026

Source: [S] TechCrunch, 10 Mar 2026 https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows . It cites the RevenueCat report https://www.revenuecat.com/state-of-subscription-apps .

- Revenue per payer, annual: "$30.16 vs. $21.37, also at the median" (AI vs non-AI). That is 41% higher.
- Revenue per payer, monthly: "$18.92 per month, compared with $13.59 for non-AI apps."
- Churn: annual plans cancel "30% faster than non-AI apps, at the median."
- Annual retention: "21.1% for AI apps, compared with a higher 30.7% for non-AI apps."
- Monthly retention: "6.1% retention rates versus 9.5% for non-AIs".
- Refunds: "4.2% vs. 3.5% at the median".
- Trial to paid: "8.5% vs. 5.6% at the median".
- [P] The RevenueCat page quotes Olivia Moore: "AI apps monetize at 2x pre-AI ARPU" and "Pre-AI, most consumer subscriptions topped out around $60 a year."
- [P] Health & Fitness benchmarks on the same page (nearest category to food): median download-to-paid 2.9%. Median trial-to-paid 37.7%. RLTV per payer $35.64 after year 1. Typical prices "$9.99 monthly" and "about $39.94 yearly".

### What this means for Pro with AI

- People do pay more for AI. Revenue per payer is about 41% higher.
- They also leave faster. Annual retention is 21% vs 31%.
- The best public data on an AI tier above a paid base is Duolingo Max. It stayed under about 10% of subscribers (secondary figure). Duolingo is now moving its main AI feature into the base tier.
- Microsoft and Notion also moved AI into base plans.
- A separate $19.99 AI tier is an untested bet in recipes. Treat its uptake as a small share of payers, not most of them, until Commise has its own data.
