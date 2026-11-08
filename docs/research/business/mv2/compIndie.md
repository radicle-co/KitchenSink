# Indie and one-time recipe managers: features and free plans

Fetch date for every source below: 2026-10-27, unless a row says otherwise.
Labels: [P] primary (developer site, help page, store listing). [S] secondary (press, review, aggregator, competitor blog).
[Unconfirmed] means the fetch failed or no primary page states the number.
Prices are US storefront prices on the fetch date.
Row IDs follow `checklist.md` (not published) (C01 to C28).

## Headline findings

1. Paprika is moving to a subscription. The Paprika 4 open beta post says "premium features will require a subscription" after the beta. No price is published. [P]
2. Paprika 3 is still one-time and sold per platform. iPhone $4.99, Android $4.99, Mac $29.99, Windows $29.99. [P]
3. Most indie apps now use a freemium model with a small free cap. Pestle 15 [S], Crouton 5 or 20 [Unconfirmed], Recipe Keeper 20 [S], Deglaze 5 imports per week [P, developer blog], Paprika Android and Windows 50 [P].
4. AI is priced four ways. On-device and included (Mela, Pestle). Inside one paid plan (Honeydew Plus, Deglaze Pro). A separate subscription (Crouton Discover). Bring your own key (Mealie).
5. Two apps now connect to outside AI assistants. Honeydew has an MCP connector for Claude and ChatGPT. Deglaze Pro connects ChatGPT, Claude or Muse. [P]
6. Mealime is closed. Its page says it "will be discontinued as of October 21, 2026". [P]

## Fetch failures

- pestlechef.app (Pestle official site): HTTP 403. [Unconfirmed]
- paprikaapp.zendesk.com (Paprika help centre): HTTP 403. [Unconfirmed]
- crouton.app/help, mela.recipes/support, honeydewcook.com/pricing, paprikaapp.com/android/: HTTP 404.
- mealie.io open-ai doc page: HTTP 404. The live page is `ai-providers` (fetched).
- Recipe Keeper Windows Pro price: the Microsoft Store page was fetched, but no price for the Pro upgrade was in it. [Unconfirmed]
- pestle.app is an unrelated product ("Grind Practice Questions"). It is not the recipe app.

---

## 1. Paprika Recipe Manager 3 (Hindsight Labs)

**Price model.** One-time purchase, sold separately on each platform.

- Regular prices, from Paprika's own sale post. [P] https://www.paprikaapp.com/news/2025/11/17/2025-thanksgiving-and-black-friday-sale/ Quote: "iOS: $2.99 $4.99 Android: $2.99 $4.99 macOS: $14.99 $29.99 Windows: $14.99 $29.99" (sale price, then regular price).
- iOS listing: $4.99, no in-app purchases listed. [P] https://apps.apple.com/us/app/paprika-recipe-manager-3/id1303222868 Rating 4.9 from "54K" ratings. Version 3.8.5, Jul 16.
- Mac App Store listing: "$29.99". Quote: "Please note that each version is sold separately." [P] https://apps.apple.com/us/app/paprika-recipe-manager-3/id1303222628?mt=12 Not enough ratings to show.
- Windows: direct sale. Quote: "Buy Now $29.99". [P] https://www.paprikaapp.com/windows/
- Google Play: free download with in-app purchases. Play shows only a range: "$4.99 - $14.99 per item". [P] https://play.google.com/store/apps/details?id=com.hindsightlabs.paprika.android.v3 The $4.99 unlock price is taken from the sale post above. The $14.99 item is not explained on the page. Rating 4.9. The page holds two rating totals, 18,458 and 20,842. 500K+ downloads.

**Free version.** It depends on the platform.

- iOS and Mac: paid upfront. The store pages show no free tier and no trial.
- Android: Quote: "All features are available in the free version of Paprika, except: • You can only save up to 50 recipes. • Paprika Cloud Sync is not available." [P] (Play listing)
- Windows: Quote: "you can only save up to 50 recipes and 2) cloud syncing is not available." The trial has "no time limit". [P] https://www.paprikaapp.com/windows/
- Conflict: Deglaze's blog says of Paprika, "There is no free plan". [S] https://www.deglaze.app/blog/deglaze-vs-paprika This is true for iOS and Mac only.

**Behind the paywall.** Unlimited recipes and Paprika Cloud Sync (Android and Windows). On iOS and Mac, everything is behind the upfront price.

**Features (Paprika 3).** [P] iOS listing and https://www.paprikaapp.com/help/ios/

- Save from websites with a built-in browser, a Safari extension and a bookmarklet.
- Import from MacGourmet, YummySoup!, MasterCook and Living Cookbook. Export recipes.
- Grocery list that combines items and sorts by aisle. Export to Reminders.
- Pantry with quantities and expiry dates.
- Daily, weekly and monthly meal planner, plus reusable menus.
- "Scale & Convert" button for ingredients.
- Cook mode that keeps the screen on. Timers detected in directions.
- Nutrition is a manual field only. Help page: "notes , and nutrition".
- Offline. Quote: "No internet connection is required to view your recipes."
- No AI is mentioned on the listing or the help page.

**Cost to own, Paprika 3, regular prices.**

- iPhone + Mac + Android = 4.99 + 29.99 + 4.99 = **$39.97**.
- iPhone + Windows + Android = 4.99 + 29.99 + 4.99 = **$39.97**.
- All four = 4.99 + 4.99 + 29.99 + 29.99 = **$69.96**.
- During the Nov 2025 sale, all four = 2.99 + 2.99 + 14.99 + 14.99 = $35.96.

## 1b. Paprika 4 (open beta)

- Open beta since 2026-09-28 for "all current users". [P] https://www.paprikaapp.com/news/2026/09/28/paprika-4-is-now-in-open-beta/
- Pricing quote: "All new features are available for testing during the beta period. Afterwards, premium features will require a subscription." No price and no upgrade terms are published.
- The July post said the same: "Afterwards, these features will require a premium subscription." [P] https://www.paprikaapp.com/news/2026/07/06/paprika-4-beta-test-has-started/
- New in Paprika 4 (quotes from the September post):
    - "Choose a photo of a cookbook page or recipe card and let Paprika scan the recipe."
    - "Save recipes from TikTok, Instagram, Facebook and YouTube."
    - Clipboard import: "let Paprika extract the recipe."
    - "Calculate a recipe's nutritional information using USDA ingredient data and display a nutrition label."
    - Family sharing: "Each user gets their own login, and everyone shares the same recipes, grocery lists, meal plan, etc."
    - Cookbooks shared with other Paprika users. Direct messaging.
    - Extra pantry locations. Barcode scanning "(mobile versions only)".
    - Calendar feeds. Alexa. Siri, Shortcuts and Spotlight.
- The post does not use the word AI. It does not say how the scan or the social import works.
- Which features stay free in Paprika 4 is not stated.

---

## 2. Mela (Silvio Rizzi)

**Price model.** Free download. One-time unlock per platform (Mela+).

- iOS: "Mela+ for iOS/iPadOS" $6.99. Quote: "Mela is free to download but will require a one-time purchase to unlock all features." [P] https://apps.apple.com/us/app/mela-recipe-manager/id1548466041 Rating 4.6 from "883 Ratings".
- Mac: "Mela+ for macOS" $14.99. [P] https://apps.apple.com/us/app/mela-recipe-manager/id1568924476 Not enough ratings to show.
- Help FAQ: "Mela for macOS and iOS versions are offered as separate purchases". [P] https://mela.recipes/help/
- Platforms: "a simple, elegant and modern recipe manager for iOS and macOS that syncs with iCloud." [P] https://mela.recipes/ No Android, Windows or web.

**Free version.** The size of the free version is not stated by the developer. [Unconfirmed]

- No fetched page gave a recipe cap. A search snippet claimed "ten recipes", but the cited article (iphone-ticker.de, 2022-10-26) did not contain it when fetched. That number is not used here.

**Behind the paywall.** "all features" (iOS listing). The exact split is not published.

**Features.** [P] App Store listings and help page.

- In-app browser and share extension. Recipe feeds from blogs.
- Scanner: "Scan a recipe from a book." It uses text recognition.
- Version 2.6: "Mela's web recipe importer now supports extracting recipes from video descriptions on YouTube, TikTok and Instagram." It reads descriptions, not audio.
- Import: "Mela can import melarecipes and paprikarecipes files." Print and PDF export.
- Meal plan through Calendar.app. Groceries in Reminders.app.
- Cook mode in full screen, with timers.
- Shared iCloud recipe library: "All participants of a shared library can create, modify and delete recipes."
- AI: on-device only. Version 2.3: "Improved on-device machine learning powered importer (requires iOS 17)." The Mac listing also notes recipe translation in the editor (macOS 15).
- Privacy: "Mela does not collect any data."
- Last update: iOS 2.6.2 on 06/08/2025. Mac 2.6.1 on May 24, 2025. No update in over 16 months.

**Cost to own.** iPhone + Mac = 6.99 + 14.99 = **$21.98**. No Android or Windows version exists.

---

## 3. Pestle (Will Bishop, solo developer)

**Price model.** Free download. Subscription or lifetime ("Pestle Pro").

- In-app purchases as listed: "Pestle Pro (Monthly) $2.99", "Pestle Pro (Yearly) $24.99", "Pestle Pro Yearly $24.99", "Pestle Pro (Lifetime) $39.99", "Pestle Pro Lifetime $49.99". Two lifetime prices are listed. Which one is current is not stated. [P] https://apps.apple.com/us/app/pestle-recipe-manager/id1574776971
- Rating 4.7 from "1.8K Ratings". Version 4.1.1, about 2026-10-22.
- Platforms: iPhone, iPad, Apple Watch, Vision. The Mac app is "Designed for iPad. Not verified for macOS." No Android, Windows or web.

**Free version.** Limited to 15 recipes. [S]

- The App Store page shows a user review (07/26/2024): "the 'free' version only allows me to save 15 recipes!" The developer reply does not dispute the number.
- iMore (2024): "You'll also need Pestle Pro if you want to store more than 15 recipes." [S] https://www.imore.com/apps/how-to-meal-plan-with-pestle-and-make-2024-your-healthiest-year-yet
- Release notes confirm a cap exists: "Pestle will upload when you have Pestle Pro (if above the free limit)". [P]
- pestlechef.app returned 403. [Unconfirmed]

**Behind the paywall.** Recipes past the free limit [P]. Meal Plan and Discover tabs, per iMore 2024. [S]

**Features.** [P] App Store listing.

- Import from "Instagram, TikTok, Facebook, YouTube and more" through the Share sheet.
- Recipe scanner for physical recipes.
- Guided cooking, hands-free control, many timers.
- Households: "share all of your recipes with your family, and create Meal Plans together".
- Meal plan: "plan out your next 14-days".
- Shopping list from recipe ingredients.
- Import from "Paprika, Crouton, Mela and Pepperplate" (version 2.1).
- SharePlay supported.
- AI: on-device Apple Intelligence. Quote (3.0.5): "Pestle can now leverage on-device Apple Intelligence to parse recipes from more websites than ever." Also names untitled social recipes and timers. Version 4.0 adds Siri: "Ask Siri what to make for dinner".
- Nutrition is not mentioned.

**Cost to own.** One lifetime purchase of $39.99 or $49.99 (both listed). Apple platforms only.

---

## 4. Crouton (Crouton LLC)

**Price model.** Free download. One-time unlock (Crouton Plus) plus an optional subscription (Discover).

- In-app purchases as listed: "Discover Yearly $14.99", "Discover Monthly $1.99", "Crouton Plus $24.99", "Crouton+ Early Bird $17.99", tips $0.99 to $7.99. [P] https://apps.apple.com/us/app/crouton-recipe-manager/id1461650987
- Rating 4.8 from "2.9K Ratings". Version 2026.5.1, about 2026-10-26.
- Platforms: "Available on iOS, iPadOS, macOS, visionOS & watchOS" [P] https://crouton.app/ One listing covers iPhone, iPad and Mac. Whether one Plus purchase unlocks every device is not stated.

**Free version.** Recipe cap exists. The number is in conflict. [Unconfirmed]

- iphonesoft.fr (2026-05-24): "Crouton est gratuite avec un accès limité à cinq recettes." [S] https://iphonesoft.fr/2026/05/24/crouton-app-iphone-parfaite-gerer-recettes-cuisine
- A search snippet cited a 20-recipe default limit. Not verified on a fetched page.
- WhistleOut (updated 2026-10-19): "Crouton Plus removes the limit for $24.99 as a one-time purchase". [S] https://www.whistleout.com/CellPhones/Apps/crouton-app-review

**Behind the paywall.**

- Plus: removes the recipe limit [S].
- Discover: ingredient substitutions. Quote: "Requires Crouton Discover." [P] (2026.5 notes)
- iphonesoft says Discover includes family sharing, unlimited storage and "un import de recettes par IA via photos ou textes". [S]

**Features.** [P] App Store listing.

- Website import. Quote from site: "Automatically import recipe ingredients and steps from copied URLs".
- Scan: "scan recipes straight out of your recipe book using AI and OCR".
- AI import: "Import a recipe from a single photo with no manual entry required. Also supports plain text and images."
- Auto meal plan: "let Crouton automatically generate the meal plan from your organized dinner recipes."
- Step-by-step mode, hands-free gestures, timers. Grocery list into Reminders.
- iCloud family sharing. RSS recipe feeds. Bluetooth scale and Combustion probe support.
- Import schema.org JSON, ZIP. Export "as Crouton files, PDF, plain text, or Markdown".
- No social video import is mentioned. No Android, Windows or web.

**Cost to own.** Crouton Plus $24.99 one-time, plus Discover at $14.99 a year if you want AI substitutions. Apple only.

---

## 5. Recipe Keeper (Tudorspan Limited)

Do not confuse it with "Recipe Keeper: CookBook, AI Import & Grocery List", which is a different developer shown in related apps.

**Price model.** Free download. One-time Pro upgrade per platform.

- iOS: "Recipe Keeper Pro Upgrade $19.99". [P] https://apps.apple.com/us/app/id974683711 Rating 4.8 from "31K Ratings". Version 3.46.2, Apr 9.
- Mac: "Recipe Keeper Pro Upgrade $29.99". [P] https://apps.apple.com/us/app/id1315583175
- Android: "$19.99 per item". [P] https://play.google.com/store/apps/details?id=com.tudorspan.recipekeeper Rating 4.7 from 16,569 ratings. 1M+ downloads.
- Windows: free download, rating 4.7 from 3,287 ratings. Pro price not found. [P for rating, Unconfirmed for price] https://apps.microsoft.com/detail/9WZDNCRDKNKB
- Listing quote: "(separate purchase required for other platforms)". [P]

**Free version.** Limited to 20 recipes. [S] Only secondary and competitor sources state the number. No Tudorspan page states it. [Unconfirmed]

**Features.** [P] App Store and Play listings.

- Website import. Instagram and TikTok import (3.42.0).
- Scan: "OCR technology automatically converts images to text." Photos and PDFs.
- Transfer from Living Cookbook, MasterCook, MacGourmet, BigOven, Paprika, Pepperplate and more.
- Weekly and monthly planner. Quote: "Recipe Keeper can even create a random meal plan for you".
- Leftovers: "Got leftovers in the fridge? Search for a recipe to use them up."
- Shopping list grouped by aisle. Shared family recipe collection.
- Nutrition: "Add nutrition information and search for recipes by nutritional amounts" (manual).
- "Works offline". Alexa skill. PDF cookbooks.
- No AI claim on the listing.

**Cost to own.** iPhone + Mac + Android = 19.99 + 29.99 + 19.99 = **$69.97**. Windows Pro adds an unknown amount. [Unconfirmed]

---

## 6. Honeydew (Red Honey LLC)

**Price model.** Free tier plus subscription. No one-time option.

- Listing quote: "$6.99 per month or $39.99 per year (price may vary by region)". [P] https://apps.apple.com/us/app/honeydew-capture-recipes/id6714449541
- Other SKUs listed: Honeydew Plus $59.99, $19.99, $99.99. Honeydew Pro $59.99, $99.99. Premium Week $9.99. None is labelled lifetime.
- Support (updated 2026-02-06): "Honeydew does not currently offer a one-time purchase option." [P] https://honeydewcook.com/support/en/plans-and-payments/one-time-payment An aggregator's "$4.99 Lifetime Unlock" (AppShunter) is contradicted by this.
- Why a subscription: "from the AI that extracts recipes from photos, videos, and websites". [P] (same page)
- iOS rating 4.8 from "1.8K Ratings". Version 1.8.6, Sep 30.
- Play: 4.8 from 23,106 ratings, 100K+ downloads, "$0.99 - $199.99 per item". [P] https://play.google.com/store/apps/details?id=com.redhoney.eatlist
- Platforms: "Available for iPhone, iPad, and Android". Chrome extension. [P] https://honeydewcook.com/

**Free version.** Capped, number not published.

- Quote: "Save a limited number of recipes from websites, social media, or photos." [P] https://honeydewcook.com/support/en/discover-honeydew/free-vs-paid
- Also: "Use basic meal planning and grocery list features."

**Behind the paywall.** "unlimited recipe saves, advanced meal planning, enhanced grocery lists, priority support, and all future premium features". [P] https://honeydewcook.com/support/en/plans-and-payments/how-much-does-honeydew-cost Listing adds "Home sharing for easy meal planning".

**Contradictions on the developer's own pages.**

- Ads. Features list: "No ads ever". Plus perks: "Ad-free forever". It is unclear if the free tier shows ads.
- Photo and social import. Homepage FAQ: "With Honeydew Plus, you can capture recipes from photos, screenshots, or social media posts." The free-vs-paid page says free users can save from "social media, or photos". It is unclear if these are free.

**Features and AI.** [P] App Store listing and site.

- Import from "YouTube Cooking Videos" and "Facebook Reels & Instagram Reels", screenshots, notes and websites.
- "AI meal planner – weekly meal plans created in seconds". Diet plans for keto, vegan, paleo and more.
- "Talk to our AI assistant – plan meals with zero effort".
- "Copycat recipe generator", "Smart ingredient substitutions", "Cookbook translator".
- "Auto calorie and macro calculator – track nutrition with zero effort".
- "Works offline". Household sharing "with up to 6 family members".
- Import from "12 popular recipe apps" (1.8.6).
- MCP connector: "Connect Honeydew to Claude, ChatGPT, and other AI assistants." [P] https://honeydewcook.com/mcp
- "Creator Codes" from food creators (latest notes).

**AI pricing.** Inside the Plus subscription. No credits and no separate AI tier are stated.

---

## 7. Umami (Strange Quark LLC, solo developer)

**Price model.** 30-day free trial, then monthly, annual or lifetime.

- In-app purchases as listed: Monthly $0.99 and $3.99. Annual $9.99 and $19.99. Lifetime $19.99 and $59.99. Two prices per tier are listed. Which is current is not stated. [P] https://apps.apple.com/us/app/id1597523594
- iOS rating 4.8 from "481 Ratings". Version 3.36, about 2026-10-26.
- Play: 4.6 from 322 ratings, 10K+ downloads, "$0.99 - $59.99 per item". [P]
- Platforms: iOS, Android, and the web at umami.recipes. Chrome extension. [P] https://umami.recipes/

**Free version.** Time-limited, not capped by count.

- Quote: "Umami is free to use for the first 30 days. After 30 days, you'll need a monthly or annual subscription or a Lifetime purchase to keep importing recipes and adding new content." [P] https://umami.recipes/faq
- After expiry: "you will be able to view and export your existing content".
- No count limit: "There is no fixed recipe limit."
- Family: "share your subscription with up to five family members at no additional charge", across iOS and Android.

**Features.** [P] FAQ and listing.

- Import from websites and "Instagram, Facebook, and TikTok". Social limit: "the recipe ingredients and instructions must be included in the video's text or description."
- Scan: manual OCR. "drag the orange selection box around a section of text".
- Shared recipe books, shared grocery lists, shared meal plans.
- Cook mode with ingredient checklist. Scaling feeds the grocery list.
- Export: "PDF, Markdown, HTML, Plain Text, or Recipe JSON Schema".
- No AI and no nutrition are mentioned.

**Cost to own.** Lifetime $19.99 or $59.99 (both listed). It covers iOS, Android and web, and up to five family members.

---

## 8. Deglaze (Deglazed LLC)

**Price model.** Free tier plus subscription (Deglaze Pro).

- In-app purchase: "Deglaze Pro $49.99" (listed three times). [P] https://apps.apple.com/us/app/id6443578246
- Price period from the developer blog (2026-02-11): "Deglaze Pro is $49.99/year in the US." [P, developer blog] https://www.deglaze.app/blog/deglaze-vs-recime
- Trial: "There is a free trial offer for new users." Length not stated. [P]
- iOS rating 4.9 from "4K Ratings". Version 10.0.0, about 2026-10-22.
- Play: 4.7 from 170 ratings, 10K+ downloads. [P] https://play.google.com/store/apps/details?id=app.deglaze.prod
- Platforms: iPhone, iPad, Android, and a web app at web.deglaze.app. Blog: "It runs in any modern browser, so it works on Mac, Windows, Linux, and ChromeOS." [P, developer blog] https://www.deglaze.app/blog/deglaze-vs-paprika

**Free version.** 5 imports per week.

- Quote: "Both apps offer a free plan that includes a limited number of imports (currently 5 per week for both)". "Both" means Deglaze and ReciMe. [P, developer blog]
- Also: "Deglaze also lets you save unlimited recipes from its built-in search and social feed on the free plan."
- Household sharing is free: "Household sharing is free, and one Pro subscription covers your whole household". [P]

**Behind the paywall.** Listing quote: Pro "unlocks unlimited recipe imports & collections and several premium features". Items marked "(Pro)" on the listing:

- Meal planner.
- Aisle-sorted grocery list. Scaling before adding to the list.
- One-tap timers. Scaling and unit conversion.
- AI assistant connector: "Connect ChatGPT, Claude or Muse to your recipes, grocery list, meal plan and cooking history".

**Features and AI.** [P]

- Save from "Instagram, TikTok, Facebook, YouTube, websites". Cookbook and screenshot photo import.
- Blog: "Both use AI to extract structured recipes from whatever you share, pulling from captions and spoken audio."
- "Recipes are auto-categorized using AI".
- Built-in recipe search across top sites. Friends feed and a cooking log.
- Screen stays on. Audio cooking sessions.

**AI pricing.** AI import is used on the free plan within the 5-per-week cap. The assistant connector is inside Pro. No credits are stated.

---

## 9. Mealie (open source, self-hosted)

**Price model.** Free software. You host it yourself.

- License: AGPL-3.0. 13,705 GitHub stars. Last push 2026-10-27. [P] https://github.com/mealie-recipes/mealie (GitHub API)
- Site: "Self-hosted recipe management and meal planning". Funding through GitHub Sponsors. [P] https://mealie.io/

**Free version.** Everything is free. You pay for your own server, and for AI if you turn it on. No recipe cap.

**Features.** [P] https://mealie.io/documentation/getting-started/features/

- "Create recipes from hundreds of websites by simply providing a URL." Bulk URL import. Bookmarklet.
- Migrations from "Tandoor, Nextcloud Cookbooks, Paprika, Chowdown, Plan to Eat, Recipe Keeper, Copy Me That, My Recipe Box, DVO Cook'n X3". Full backups as zip.
- Meal planner with plan rules for random recipes. Per-meal serving sizes flow to the shopping list.
- Shopping lists. Groups and households: "Households maintain their own users and settings, while sharing their recipes with other households."
- Webhooks. Bring! shopping list link.

**AI.** Bring your own key. [P] https://mealie.io/documentation/getting-started/installation/ai-providers/

- "To enable AI features, you must have access to an AI provider (such as OpenAI). Mealie works with any OpenAI-compatible API."
- "a common self-hosted alternative to OpenAI is Ollama".
- Cost note: "If you deposit $5 into your OpenAI account, you will be permanently bumped up to Tier 1, which is sufficient for Mealie."
- Import with AI from a URL, photos or text. For video: "Give it a link to a video (e.g. YouTube or Instagram) and the video is transcribed instead, provided you've configured an audio provider."
- Optional translation into your own language.

---

## 10. Mealime (closed)

- Quote: "we regret to inform you that Mealime will be discontinued as of October 21, 2026." [P] https://www.mealime.com/closing
- Users are sent to Meals Hub inside Albertsons Companies grocery apps. Pro content became free before shutdown. Personal data is deleted at shutdown.
- It was already closed on the fetch date. It is not in the matrix.

---

## Combined matrix

Key: Y = yes. N = no or not offered. Paid = needs a paid plan. Limited(n) = capped or partial. ? = not stated on any fetched page. "beta" = Paprika 4 open beta, future paid status unknown.
P3 = Paprika 3. P4 = Paprika 4 beta. RK = Recipe Keeper.

| Row                           | P3                                                         | P4 (beta)                         | Mela                                     | Pestle                                         | Crouton                                              | RK                                                   | Honeydew                             | Umami                                                                               | Deglaze                                       | Mealie                               |
| ----------------------------- | ---------------------------------------------------------- | --------------------------------- | ---------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| C01 URL import                | Y                                                          | Y                                 | Y                                        | Y                                              | Y                                                    | Y                                                    | Y                                    | Y                                                                                   | Y                                             | Y                                    |
| C02 Social video              | N                                                          | Y beta                            | Limited (description only)               | Y                                              | ?                                                    | Y                                                    | Limited (?) gating unclear           | Limited (caption only)                                                              | Y (captions and audio)                        | Y (BYOK, audio)                      |
| C03 Photo or OCR              | N                                                          | Y beta                            | Y                                        | Y                                              | Y (AI import may be Paid [S])                        | Y                                                    | Limited (?) gating unclear           | Y (manual OCR)                                                                      | Y                                             | Y (BYOK)                             |
| C04 Capture surfaces          | Y (Safari ext, bookmarklet)                                | Y                                 | Y (share ext)                            | Y (share sheet)                                | Limited (copied URL)                                 | Y (share from Safari)                                | Y (share, Chrome ext)                | Y (share, Chrome ext)                                                               | Y (share, web app)                            | Y (bookmarklet)                      |
| C05 Bulk import, export       | Y                                                          | Y                                 | Y                                        | Y                                              | Y                                                    | Y                                                    | Limited (import Y, export ?)         | Y (export)                                                                          | ?                                             | Y                                    |
| C06 Free cap                  | iOS, Mac: N (paid upfront). Android, Win: Limited(50)      | ?                                 | ? (cap not published)                    | Limited(15) [S]                                | Limited(5 or 20) [Unconfirmed]                       | Limited(20) [S]                                      | Limited(n not published)             | 30-day trial, then read and export only                                             | Limited(5 imports per week)                   | N (no cap)                           |
| C07 Private storage           | Y                                                          | Y                                 | Y (iCloud)                               | Y                                              | Y (iCloud)                                           | Y                                                    | Y                                    | Y                                                                                   | Y                                             | Y (self-hosted)                      |
| C08 Catalog or feed           | N                                                          | N                                 | Limited (blog feeds)                     | Paid (Discover [S])                            | Paid (Discover)                                      | N                                                    | Y                                    | N                                                                                   | Y (search, friends feed)                      | N                                    |
| C09 Collections, tags, search | Y                                                          | Y                                 | Y                                        | Y                                              | Y                                                    | Y                                                    | Y                                    | Y                                                                                   | Y                                             | Y                                    |
| C10 Manual entry              | Y                                                          | Y                                 | Y                                        | Y                                              | Y                                                    | Y                                                    | Y                                    | Y                                                                                   | Y                                             | Y                                    |
| C11 Scaling, units            | Y                                                          | Y                                 | ?                                        | Y                                              | Y                                                    | Y                                                    | Y                                    | Y                                                                                   | Paid                                          | Y                                    |
| C12 Cooking mode              | Y                                                          | Y                                 | Y                                        | Y                                              | Y                                                    | Y                                                    | Y                                    | Y                                                                                   | Y (timers Paid)                               | ?                                    |
| C13 Meal planner              | Y                                                          | Y                                 | Y (Calendar.app)                         | Paid [S] (14 days)                             | Y                                                    | Y                                                    | Y (basic free)                       | Y                                                                                   | Paid                                          | Y                                    |
| C14 Auto or AI plans          | N                                                          | N                                 | N                                        | N                                              | Y (rule-based)                                       | Y (random)                                           | Y (AI)                               | N                                                                                   | Paid (via AI assistant connector)             | Y (random by rules)                  |
| C15 Leftover or pantry-aware  | N                                                          | N                                 | N                                        | N                                              | N                                                    | Limited (leftover search)                            | Limited (search by what you have)    | N                                                                                   | N                                             | N                                    |
| C16 Pantry                    | Y                                                          | Y (+ barcode)                     | N                                        | N                                              | N                                                    | N                                                    | N                                    | N                                                                                   | N                                             | N                                    |
| C17 Grocery list              | Y (merge, aisle)                                           | Y                                 | Limited (Reminders)                      | Y                                              | Limited (Reminders)                                  | Y (aisle)                                            | Y (store section)                    | Y (aisle)                                                                           | Y (aisle sort Paid)                           | Y                                    |
| C18 Household sync            | Limited (one shared account)                               | Y (family logins)                 | Y (shared iCloud library)                | Y (Households)                                 | Y (iCloud sharing)                                   | Y (family collection)                                | Paid (up to 6)                       | Y                                                                                   | Y (free)                                      | Y                                    |
| C19 Grocery ordering          | N                                                          | N                                 | N                                        | N                                              | N                                                    | N                                                    | N                                    | N                                                                                   | N                                             | N                                    |
| C20 Nutrition per recipe      | Limited (manual)                                           | Y beta (USDA)                     | ?                                        | ?                                              | ?                                                    | Limited (manual)                                     | Y (auto)                             | ?                                                                                   | ?                                             | ?                                    |
| C21 Goals or macros           | N                                                          | N                                 | N                                        | N                                              | N                                                    | N                                                    | Limited (diet plans, tracking claim) | N                                                                                   | N                                             | N                                    |
| C22 AI features               | N                                                          | ? (no AI stated)                  | Limited (on-device ML import, translate) | Limited (Apple Intelligence parse, Siri)       | Y (AI import, substitutions)                         | N                                                    | Y (assistant, generation, MCP)       | N                                                                                   | Y (AI import, auto-tags, assistant connector) | Y (BYOK)                             |
| C23 AI pricing                | none                                                       | none stated                       | included, on-device                      | included, on-device                            | separate sub (Discover)                              | none                                                 | inside Plus sub                      | none                                                                                | inside Pro sub (import within free cap)       | BYOK                                 |
| C24 Offline                   | Y                                                          | ?                                 | ?                                        | ?                                              | ?                                                    | Y                                                    | Y                                    | ?                                                                                   | ?                                             | ?                                    |
| C25 Platforms                 | iOS, Android, Mac, Win                                     | iOS, Android, Mac, Win            | iOS, Mac                                 | iOS, Watch, Vision (Mac as iPad app)           | iOS, Mac, Watch, Vision                              | iOS, Android, Mac, Win                               | iOS, Android, Chrome ext             | iOS, Android, web                                                                   | iOS, Android, web                             | web (self-hosted)                    |
| C26 Creators, tips, classes   | N                                                          | N                                 | N                                        | N                                              | N (tips go to the developer)                         | N                                                    | Limited (creator codes)              | N                                                                                   | N                                             | N                                    |
| C27 Ads on free               | N                                                          | N                                 | N                                        | ?                                              | ?                                                    | ?                                                    | ? (conflict)                         | ?                                                                                   | ?                                             | N                                    |
| C28 Price                     | $4.99 iOS, $4.99 Android, $29.99 Mac, $29.99 Win, one-time | subscription, price not published | $6.99 iOS, $14.99 Mac, one-time          | $2.99/mo, $24.99/yr, lifetime $39.99 or $49.99 | Plus $24.99 one-time, Discover $1.99/mo or $14.99/yr | Pro $19.99 iOS, $29.99 Mac, $19.99 Android, one-time | $6.99/mo, $39.99/yr, trial offered   | 30-day trial, then $0.99 to $3.99/mo, $9.99 to $19.99/yr, lifetime $19.99 or $59.99 | $49.99/yr, trial (length not stated)          | free (AGPL), own server and AI costs |

## Cost to own, one-time apps (regular US prices)

| App           | Platforms you can buy           | Arithmetic                                          | Total                                  |
| ------------- | ------------------------------- | --------------------------------------------------- | -------------------------------------- |
| Paprika 3     | iPhone + Mac + Android          | 4.99 + 29.99 + 4.99                                 | $39.97                                 |
| Paprika 3     | iPhone + Windows + Android      | 4.99 + 29.99 + 4.99                                 | $39.97                                 |
| Paprika 3     | all four                        | 4.99 + 4.99 + 29.99 + 29.99                         | $69.96                                 |
| Recipe Keeper | iPhone + Mac + Android          | 19.99 + 29.99 + 19.99                               | $69.97 (Windows Pro price unconfirmed) |
| Mela          | iPhone + Mac (no Android or PC) | 6.99 + 14.99                                        | $21.98                                 |
| Crouton       | iPhone + Mac (no Android or PC) | 24.99 (one listing, universal unlock not confirmed) | $24.99                                 |
| Pestle        | Apple only                      | one lifetime IAP                                    | $39.99 or $49.99                       |
| Umami         | iOS + Android + web             | one lifetime IAP, shareable with 5 family           | $19.99 or $59.99                       |

## App Store and Play rating counts seen

| App           | iOS                         | Google Play                                                |
| ------------- | --------------------------- | ---------------------------------------------------------- |
| Paprika 3     | 4.9, 54K                    | 4.9, 18,458 or 20,842 (two totals on page), 500K+ installs |
| Mela          | 4.6, 883 (iOS). Mac too few | none                                                       |
| Pestle        | 4.7, 1.8K                   | none                                                       |
| Crouton       | 4.8, 2.9K                   | none                                                       |
| Recipe Keeper | 4.8, 31K                    | 4.7, 16,569, 1M+ installs. Windows 4.7, 3,287              |
| Honeydew      | 4.8, 1.8K                   | 4.8, 23,106, 100K+ installs                                |
| Umami         | 4.8, 481                    | 4.6, 322, 10K+ installs                                    |
| Deglaze       | 4.9, 4K                     | 4.7, 170, 10K+ installs                                    |
