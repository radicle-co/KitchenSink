# Competitor subscriptions: free plans, paywalls and AI

Fetched 2026-10-27. All fetch dates below are 2026-10-27 unless a source date is given.

Labels. [P] is a primary source: the company's own site, help center, newsroom or store listing. [S] is a secondary source. [Unconfirmed] means the fetch failed or no source says it.

Cell values. Y means free. Paid means behind the paywall. Limited(n) means free with a cap. "?" means no source settles it. N means a full primary feature list was read and the feature is not on it ("none on listing").

Store data method. App Store ratings, in-app purchase (IAP) lists and descriptions come from each app's own US page (apps.apple.com/us/app/id{N}) and the iTunes lookup API. Google Play figures come from each app's own US page header. The Play IAP range is the first "per item" range on the page. It matched the App Store figures for Samsung Food, AnyList and America's Test Kitchen, so it belongs to the app itself. Later ranges on the same page belong to "similar apps" and were ignored. Android prices can differ from iOS prices.

Prior work in `docs/competitive/01RecimeTeardown.md` was re-checked, not copied.

## Scale signal (store ratings, 2026-10-27)

| App                    | App Store rating (count) | Google Play rating (reviews, installs) | Play "Contains ads" label |
| ---------------------- | ------------------------ | -------------------------------------- | ------------------------- |
| ReciMe                 | 4.8 (322,101)            | 4.7 (113K, 1M+)                        | No                        |
| Samsung Food           | 4.8 (6,424)              | 4.4 (23.1K, 1M+)                       | No                        |
| Plan to Eat            | 4.8 (6,115)              | 4.7 (3.34K, 100K+)                     | No                        |
| NYT Cooking            | 4.9 (549,051)            | 4.9 (19.2K, 1M+)                       | Yes                       |
| AnyList                | 4.9 (81,167)             | 4.9 (30.9K, 1M+)                       | No                        |
| Copy Me That           | 4.6 (1,187)              | 3.9 (1.51K, 100K+)                     | No                        |
| Tasty                  | 4.9 (432,907)            | 4.7 (181K, 10M+)                       | No                        |
| America's Test Kitchen | 4.9 (18,361)             | 4.8 (4.1K, 100K+)                      | No                        |
| SideChef               | 4.7 (1,668)              | 4.4 (8.26K, 1M+)                       | No                        |
| Kitchen Stories        | 4.8 (22,778)             | 3.7 (34.3K, 1M+)                       | Yes                       |
| Cookidoo (US app)      | 4.9 (36,675)             | 4.7 (691, 10K+)                        | No                        |

Note. Samsung Food's low App Store count fits a renamed listing (ex-Whisk). Samsung's newsroom claimed "over six million users" as of July 2024 [P]. ReciMe's 2026-10-22 release notes claim "15 million users" [P, company claim, unaudited].

---

## 1. ReciMe (ReciMe Plus)

**Price**

- Yearly. "in the United States, the yearly plan is $39.99 USD." [P] [help: how much does it cost](https://recime.app/help/en/articles/11630592-how-much-does-the-recime-subscription-cost)
- Gift cards. "1 Year" "$39.99" and "3 Months" "$19.99". [P] [gift cards](https://www.recime.app/gift-cards)
- App Store IAPs, all named "ReciMe Plus" with no period shown: $29.99, $39.99 (x5), $59.99 (x4). [P] [App Store](https://apps.apple.com/us/app/recime-recipes-meal-planner/id1593779280)
- Google Play IAP range: $6.99 to $69.99 per item. [P] [Play](https://play.google.com/store/apps/details?id=com.recime.app)
- Monthly price. No primary page states it. [Unconfirmed]
- Trial. "You can start a 7-day free trial to access these premium features." [P] App Store and Play listings.

**Free plan** [P] [help: benefits of ReciMe Plus](https://recime.app/help/en/articles/11630603-what-are-the-benefits-of-recime-plus)

- "The free version includes up to 5 recipe imports per week"
- "Write up and save your own recipes manually."
- "Create grocery lists that sort themselves by aisle."
- "Build your weekly meal plan."
- "Organize recipes into cookbooks."

The cap is 5 imports per WEEK. It is stated only on the help center. The store listings state no number.

**Paywall (Plus)** [P] same help article

- "Import unlimited recipes from Instagram, TikTok, Facebook, and more."
- "Scan recipes from cookbooks or handwritten notes."
- "Calculate calories and nutrition in just one click with the Nutrition Calculator."
- "Copy and paste entire recipe blocks directly into ReciMe."
- Cooking Mode, "step-by-step guidance through any recipe."
- "Switch between metric and imperial in one tap with the Measurement Converter."
- "Ask ReciMe, your AI assistant, any question about a recipe as you cook."
- "Export any recipe to PDF or print it straight from the app."

Conflict. The App Store and Play listings list "Convert Measurements" and "Cook with Ease ... Follow recipes step-by-step" as plain features with no tier. The help center puts the converter and Cooking Mode under Plus. This file uses the help center. Scaling ("Adjust Ingredients") is in the store listing but in neither help-center list, so its tier is "?".

**AI**

- Base paid plan includes AI. "Ask ReciMe, your AI assistant, any question about a recipe as you cook." [P] help center, Plus list.
- No separate AI tier or credits were found.
- Nutrition is self-labelled beta. "This feature is still in beta". [P] [help: nutrition](https://recime.app/help/en/articles/11626106-does-recime-provide-nutrition-information)
- The App Store page shows an in-app event "Magic Meal Plan", described as "Get personalized recipes to fit your schedule and tastes each week." It does not say AI or name a tier. [P] App Store. The meal-plan help article describes manual planning only: "drop in any recipe from your Cookbooks for any day of the week". [P] [help: meal plan](https://recime.app/help/en/articles/14999930-how-to-use-your-meal-plan). So C14 is "?".

**Other facts**

- No public catalog. "we do not have a central library of recipes available". Saved recipes are "only visible to the individual user who saved it." "We do not offer any "sharing" functionality within ReciMe" [P] [help: copyright](https://recime.app/help/en/articles/11596213-recipe-saving-on-recime-and-copyright)
- Web app. Supports "Import and add new recipes", "View all your recipes and cookbooks", "Edit your recipes". Meal Plans and Grocery Lists are "Coming Soon". Import is "fastest with our Chrome extension." [P] [help: computer](https://recime.app/help/en/articles/11626084-can-i-access-recime-using-a-computer)
- Devices. "use your ReciMe account on as many devices as you like at the same time and at no extra cost." [P] [help: devices](https://recime.app/help/en/articles/11626072-can-you-share-your-recime-account-across-multiple-devices)
- Grocery delivery. "Order directly in-app and get ingredients to your door." Tier not stated. [P] Play listing.
- Migration. "Save your favorite recipes from your existing apps like Paprika, Notes app, Google Docs, Notion, Evernote, and more!" [P] Play listing. This is not described as a bulk file import.
- Platforms. iPhone, iPad, Mac (M1, "Not verified for macOS"), Apple Vision, Android, desktop web. [P] App Store, Play, help.

---

## 2. Samsung Food (ex-Whisk), Samsung Food+

samsungfood.com returned HTTP 403 to every fetch (home, Food+ page, support). Facts below come from the App Store, Google Play and the Samsung newsroom.

**Price**

- App Store IAPs. "Monthly" $6.99 and "Yearly" $59.99. [P] [App Store](https://apps.apple.com/us/app/samsung-food-meal-planner/id1133637674)
- Play IAP range $6.99 to $59.99 per item. [P] [Play](https://play.google.com/store/apps/details?id=com.foodient.whisk)
- Newsroom footnote, 2024-08-29. "$6.99 per month". [P] [Samsung newsroom US](https://news.samsung.com/us/upgraded-samsung-food-raises-bar-for-food-experiences-ifa-2024/)
- Trial. No primary page states it. A secondary review says "many Samsung devices come with an extended trial period for Food+." [S] [Unconfirmed]

**Free plan** [P] App Store description

- "Discover over 240,000 public recipes, including 124,000 fully guided ones."
- "Save any recipe from any website and make it your own."
- "Plan your weekly meals, turn them into smart shopping lists, and share them with friends or family."
- "Organize family shopping with shared grocery lists."
- "Get groceries delivered from one of our 23 integrated retailers across 4 regions."
- "Access detailed nutrition information and health scores on over 218,500 recipes."
- "All this, available for free on your iPhone, iPad, or web."
- Meal recommendations. "While Samsung Food users receive three days of recommendations per week, paid and subscribed Samsung Food+ users benefit from a full week of recommendations" [P] newsroom, 2024-08-29. This is the only primary numeric free cap found, and it is two years old.
- Photo or cookbook import on free: "up to 3 saved recipes", reported from the August 2025 release notes. [S] [samlover](https://samlover.com/2025/08/03/samsung-food-just-received-the-ability-to-snap-save-recipes-via-the-latest-update/amp/), also cited from an APKMirror changelog. Not seen on a Samsung page.
- No recipe-saving cap was found on any primary source.

**Paywall (Food+)** [P] App Store description

- "AI-personalized weekly meal plans tailored to your health goals."
- "Smart recipe customization", to "adjust servings, swap ingredients, or tweak nutrition."
- "Step-by-step Smart Cooking Mode for any recipe."
- "Automated pantry management with personalized cooking suggestions."
- "Nutrition tracking with adaptive meal plans to help you meet your goals."
- "Save and reuse unlimited meal plans anytime."
- Newsroom adds Vision AI, which "allows users to add items to their Food List by simply snapping a photo", and meal plans that prioritise ingredients "nearing use-by-date". [P] 2024-08-29.

**AI**

- AI is inside the base paid plan (Food+). There is one paid tier. No credits or add-on were found.
- Quote: "AI-personalized weekly meal plans tailored to your health goals." [P] App Store.
- Free users get a partial version of plan recommendations (3 days a week vs a full week, 2024 newsroom) [P].

**Other facts**

- Social video import. Local TV segments say TikTok and Instagram sharing works [S]. A competitor page says it does not [S]. No primary statement. "?"
- Ads on free. A competitor review says "Free tier with ads" [S]. The Play page shows no "Contains ads" label [P]. Marked "?".
- Platforms. iPhone, iPad, web, Android, Samsung appliances (Family Hub). [P]

---

## 3. Plan to Eat

**Price** [P] [pricing page](https://www.plantoeat.com/pricing)

- "$5.95/ month" and "$49/ year".
- 14-day trial, no credit card. App Store: "Try Plan to Eat FREE for 14 days, no payment information required at sign-up." [P]
- App Store IAP. "One-Year Membership" $54.99. [P] [App Store](https://apps.apple.com/us/app/plan-to-eat/id1215348056)
- Play IAP range $39.00 to $54.99 per item. [P]

**Free plan**

- None. The pricing page has an FAQ titled "Why isn't there a free plan?" [P]

**Paywall**

- Everything, after the trial.
- Import. "Save from any website, Instagram, TikTok, Pinterest and more with the Recipe Clipper." [P] pricing page.
- Photo scanning. "Snap a picture of a recipe card or cookbook page, and we'll turn it into a digital recipe for you." [P] [blog, 2025-11-19](https://www.plantoeat.com/blog/2025/11/the-meal-planning-updates-youve-been-asking-for/)
- Bulk import from Paprika, Recipe Keeper, Copy Me That (.html), RecipeSage (.json), MasterCook, Meal-Master, Living Cookbook. CSV is ".csv (requires a paid subscription)". [P] [help: import files](https://learn.plantoeat.com/help/import-recipe-files-from-other-programs)
- Nutrition. "Nutrition facts for your recipes and daily totals on your planner." [P] pricing page.
- Leftovers. "plan leftovers, and track frozen meals." [P] App Store.
- Platforms. "iPhone, Android and the web, always in sync." [P]

**AI**

- AI features ship in the one paid plan. No page says they cost extra. It is an inference that they are included, because there is only one plan.
- "AI Ingredient Suggestions" for "allergens, dietary needs, or whatever's missing from your pantry." [P] blog 2025-11-19.
- "AI Beginner Mode". "Rewrite recipe directions to make your recipes more beginner-friendly!" [P] blog.
- "AI Help Widget". "Our new chatbot can guide you right inside the program." [P] blog.
- Release notes [P] [release notes](https://learn.plantoeat.com/help/release-notes):
    - 2026-04-13. "We use AI vision to read the on-screen text and extract the recipe." (Instagram reels)
    - 2026-03-20. "our AI will estimate nutrition values directly"
    - 2025-10-24. "a beginner mode for recipes that uses AI to improve recipe directions for beginner cooks."

---

## 4. NYT Cooking

nytimes.com subscription prices render client-side, so the page text has no prices. Prices come from the App Store IAP list.

**Price**

- App Store IAPs [P] [App Store](https://apps.apple.com/us/app/nyt-cooking-quick-tasty-meals/id911422904): "Cooking - Monthly" at $4.99, $5.99 and $7.00. "Annual Cooking Subscription" $54.99. "Cooking - Annual" $69.99. "All Access - Monthly" $29.99.
- Billing period. "Most options offer the choice between billing every 4 weeks or billing annually." [P] [subscription FAQ](https://www.nytimes.com/subscription/cooking). So "Monthly" SKUs may bill every 4 weeks.
- Bundle. "All Access" digital and home delivery subscriptions include Cooking. "the "Basic" subscription option does not include Cooking." [P]
- Play IAP range $4.99 to $299.99 per item (includes All Access bundles). [P]
- Trial length. Not stated. [Unconfirmed]

**Free plan** [P] subscription FAQ, Q5

- "There will be a selection of editor-curated recipes, collections and guides available without a subscription."
- "Those who register for a free New York Times Cooking account will also be able to save recipes to their Recipe Box, write and view public notes on open recipes and sign up for Cooking newsletters."
- No number is given for the free recipe selection.
- Play shows "Contains ads". [P]

**Paywall** [P] subscription FAQ, Q3

- "unlimited access to all the content and tools Cooking has to offer, as well as to our subscriber-only mobile apps."
- "auto-organizing smart folders, create personalized folders to manage your saved recipes, search your Recipe Box, and import recipes from other sites into your Cooking Recipe Box."
- "write private notes on individual recipes".
- "Tools including your personal Recipe Box, Cook Mode, community notes and more." [P]
- Grocery. "Add the ingredients to our built-in grocery list, or skip the hassle and order grocery delivery via Instacart." [P] App Store.

**AI**

- None found. The App Store description, the Play description and the subscription FAQ name no AI feature. Two web searches found only a 2025 conference session title, "AI in the Kitchen: Scaling Human Expertise at NYT Cooking", with no product named [S]. C22 is N (none on listing).

---

## 5. AnyList (AnyList Complete)

**Price** [P] [features](https://www.anylist.com/features) and [complete](https://www.anylist.com/complete)

- "$9.99 / year for an individual" and "$14.99 / year for a household".
- App Store IAPs. "12 Month AnyList Complete Individual Subscription" $9.99. "1 Year Household Subscription" $14.99. [P]
- No monthly plan. Trial not stated on either page. [Unconfirmed]

**Free plan** [P] features comparison table

- "Import recipes directly from popular websites": Free "Limit 5", Complete "Unlimited". The page gives no period, so read it as 5 in total, not per week.
- Free: create and share lists, auto-categorise, customise grocery categories, Siri or Alexa, "Shop online at Walmart, Instacart, Kroger and more", widgets.
- Free recipes: "Collect and organize your recipes", "Automatic combining of similar ingredients into a single item in your list", "Group recipes with custom collections", "Add recipes via copy & paste", "View full recipe in cooking mode", "Share recipes with other household members".
- Free platforms: iOS and Android.

**Paywall (Complete)** [P] features table, Complete column only

- "Quickly scale recipes up or down"
- "Add photos to your recipes"
- Every meal-planning row, for example "Add recipes and notes to your meal planning calendar" and "Generate a grocery list from your meal plan".
- "Use AnyList on your PC with our web app" and "Quickly access AnyList on your Mac with our Mac app". Apple Watch.
- Item prices, stores and filters, folders, passcode lock, location reminders.

**AI**

- None. The features page and the Complete page do not mention AI [P]. A search found no photo-to-recipe import [S]. C22 is N.

---

## 6. Copy Me That (paid membership)

copymethat.com/faq/ returned 404 or 503. The home page loaded.

**Price**

- Home page. "The price is $1.00 per month, or choose the yearly or lifetime option." [P] [copymethat.com](https://www.copymethat.com/)
- App Store IAPs. "Membership" $0.99, "Membership" $12.00 (period not shown), "Premium membership" $0.99, "Lifetime membership" $65.00. [P] [App Store](https://apps.apple.com/us/app/copy-me-that-recipe-manager/id956800243)
- Play IAP range $0.99 to $34.99 per item. [P]
- Trial. Not applicable. The free plan has every feature.

**Free plan**

- "Copy Me That, with all of its features, is free up to 40 recipes." [P] home page.
- App Store. "The free version has a limit of 40 recipes. After that it's only $0.99 per month for unlimited recipes." [P]
- This is a TOTAL library cap of 40 recipes, not a rate.

**Paywall**

- Only the recipe count. Membership gives "unlimited recipes". [P]

**Features** [P] home page and App Store

- "Copy any recipe from any website with a click." "Add the button to your browser or use from the app."
- "Easily save recipes from any website, as well as from most apps, including social media apps."
- "Search, filter, print, scale, email, and share!"
- "Create multiple lists, merge items, and create a pantry list."
- "Create sets of recipes to re-use again and again."
- "Share with your family just by logging into the same account."
- "(Internet connection required.)"
- "Your recipes belong to you and you can export them at any time."
- Community. "see what others are sharing in the Copy Me That Community."

**AI**

- None. No AI on the home page or store listings. C22 is N.

---

## 7. Tasty (Tasty+)

tasty.co returned HTTP 406 to curl and 404 to WebFetch for /plus.

**Price**

- App Store IAPs. "Tasty+ Monthly" $3.99. "Tasty+ Yearly" $34.99. [P] [App Store](https://apps.apple.com/us/app/tasty-recipes-cooking-videos/id1217456898)
- Play IAP range $2.99 to $27.99 per item. [P]
- Trial. [Unconfirmed]

**Free plan** [P] App Store description

- "over 10,000 delicious recipes with video, step-by-step cooking mode, personalized recommendations, a thriving community of home chefs, and recipe shopping and seamless checkout."
- "Shop for affordable recipes and get your groceries delivered or picked up through Walmart".
- "Save your favorite recipes to your profile and organize them into custom cookbooks".
- "Ingredient Search" that "generates dish ideas from just 3 ingredients."
- "Easily adjust serving sizes per recipe, with metric values side-by-side with US measurements".

**Paywall (Tasty+)**

- What Tasty+ includes is [Unconfirmed]. No primary page was reachable. One blog lists "ad-free browsing", "exclusive recipes and cooking classes" and "advanced meal planning tools" [S, eatingmeals.com, low authority].

**AI**

- "AI Botatouille: Powered by ChatGPT API, our AI assistant helps you find recipes that match your preferences and tastes". [P] current App Store description, fetched 2026-10-27.
- Launched 2023-05-23, beta, iOS first. [P] [tasty.co article](https://tasty.co/article/victoriadroese/introducing-botatouille-tastys-new-AI). The article does not say whether it is free.
- Tier for AI: "?" [Unconfirmed].

---

## 8. America's Test Kitchen app

**Price** [P] [App Store](https://apps.apple.com/us/app/americas-test-kitchen/id1365223384)

- "ATK Essential - Monthly" $9.99. "ATK Essential - Annual" $49.99.
- "Classes Monthly" $9.99. "Classes Annual" $39.99.
- "Essential + Classes - Monthly" $19.99. "Essential + Classes - Annual" $89.99.
- Trial. "Try out the entire app with a free trial." Length not stated. [P]

**Free plan**

- None in the app. "Access to the ATK app requires a monthly or annual ATK Essential membership". [P] App Store.

**Paywall**

- "Cooking app with 14,000+ best-ever recipes". "Save favorite recipes, customize recipes with personal notes". "8,000+ rigorously researched product reviews". "Full Episodes, Ad-Free". "Shopping lists are created with ease". [P] App Store.
- Play listing adds "cook mode" and "Filter recipes by ingredient & dietary need". [P]
- ATK Classes is a paid add-on: "expert-led cooking classes", "Cook along with helpful step-by-step visuals". [P]

**AI**

- None. No AI on either store listing [P]. A search found no ATK AI feature [S]. C22 is N.

---

## 9. SideChef (SideChef Premium)

**Price**

- App Store description. "Monthly SideChef Premium subscription: $4.99 USD." "Annual SideChef Premium subscription: $49.99 USD." [P] App Store.
- Web. "7-Day Free Trial". "(Thereafter $4.99/month or $49.99/year cancel at anytime)". [P] [sidechef.com/premium](https://www.sidechef.com/premium/)

**Free plan** [P]

- "Over 11,000 recipes that are not under SideChef Premium" [P] sidechef.com.
- Free app: 18,000 step-by-step recipes total, filters, grocery list, meal planning tool, appliance control. [P] App Store.
- Grocery. "shop ingredients directly from Instacart, Walmart, Amazon Fresh, Target, and more online grocers." [P] App Store. Play says "Walmart and Amazon Fresh (U.S. only)". [P]
- Leftovers. "seeing the percentage of each ingredient used in a recipe" to "plan for leftovers and minimize food waste". [P]

**Paywall (Premium)**

- "an on-demand cooking class subscription called SideChef Premium which includes over 800 classes". [P] sidechef.com.
- "Unlock SideChef Premium Recipes in Your Personalized Meal Plan". [P] sidechef.com/premium.

**AI**

- RecipeGen AI, a 2024 beta. "allows cooking enthusiasts to snap a photo of any dish" and "SideChef will instantly generate a step-by-step shoppable recipe for that dish". [P] [press release, 2024-08-06](https://business.sidechef.com/press-releases/sidechef-announces-recipegen-ai-beta-feature). Tier not stated.
- The "SideChef AI" link on sidechef.com points to /business/sidechef-ai/, a B2B product. [P]
- The iOS app was last updated 2025-03-14 [P, iTunes lookup]. The consumer product looks low-activity.

---

## 10. Kitchen Stories (Kitchen Stories Plus)

kitchenstories.com/en pages return HTTP 410. The Plus page lives at pages.kitchenstories.com.

**Price**

- Web. "Then only 79,99€ yearly or 7,99€ monthly." Trial: "Try all Plus features for free for 7 days!" [P] [Plus page](https://pages.kitchenstories.com/en/plus)
- US App Store IAPs. "Plus Subscription" $6.99, $7.99 and $79.99. Offers at $39.99, $34.99 and $19.99 ("Black Friday Offer - Annual"). [P] [App Store](https://apps.apple.com/us/app/kitchen-stories-easy-recipes/id771068291)
- Play IAP range $7.99 to $79.99 per item. [P]

**Free plan** [P] Plus page comparison table (check and x icons parsed from HTML)

- Free has a check only on "More than 7,500 recipes".
- Free has an x on "Search recipes by ingredients", "Save your favourite ingredients", "Save recipes from the web".
- Free app also has cookbooks, serving-size scaling, timers and cooking mode. [P] Play listing.
- Play shows "Contains ads". [P]

**Paywall (Plus)**

- "Search recipes by ingredients", "Save your favourite ingredients", "Personalised feed with recipes based on your preferences", "Save recipes from the web". [P] Plus page.
- "With Kitchen Stories Plus, you can save and organize social media recipes from external platforms directly into your personal digital cookbook with just one click." [P] App Store.

**AI**

- None named. Neither the Plus page nor the App Store description uses the word AI. "Personalised feed" is a recommendation feature. C22 is N.

---

## 11. Cookidoo (Thermomix), US

US-relevant. Vorwerk LLC publishes a US app (com.vorwerk.cookidoo.us). It needs a Thermomix to be useful.

**Price**

- "The cost for a yearly membership is $65." [P] [Thermomix US support](https://service.thermomix.com/hc/en-us/articles/7925020790547-What-is-Cookidoo-How-much-does-it-cost)
- App Store IAP. "One Year Membership" $74.99. [P] [App Store](https://apps.apple.com/us/app/thermomix-cookidoo-app/id1470401164). This conflicts with $65. Apple pricing may include a markup.
- An older US support page says $55 [S, undated]. Treat as stale.
- Trial. "free 30-day trial membership". [P] support page.

**Free plan**

- Not stated. "With Cookidoo® Membership you get instant access to every recipe on Cookidoo®." [P] App Store. Free access without membership is "?".

**Paywall**

- "over 100,000 worldwide recipes". "keep favorite recipes, plan meals on a weekly planner, and even create your own recipes." [P] support page.
- "You can create, import and modify your favourite recipes" (Created Recipes). [P] App Store.

**AI**

- None named on the support page or store listing. C22 is N.

---

## AI summary across apps

| App                    | AI feature                                                                                   | How AI is priced                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ReciMe                 | "Ask ReciMe" assistant [P]                                                                   | Inside base Plus [P]                                                |
| Samsung Food           | AI-personalized meal plans, Vision AI pantry [P]                                             | Inside Food+ (one tier). Free gets 3-day recommendations (2024) [P] |
| Plan to Eat            | Ingredient suggestions, Beginner Mode, chatbot, AI vision import, AI nutrition estimates [P] | Inside the only paid plan (inferred, no page says so)               |
| NYT Cooking            | None found                                                                                   | None                                                                |
| AnyList                | None found                                                                                   | None                                                                |
| Copy Me That           | None found                                                                                   | None                                                                |
| Tasty                  | Botatouille chatbot on ChatGPT API [P]                                                       | Tier unknown [Unconfirmed]                                          |
| America's Test Kitchen | None found                                                                                   | None                                                                |
| SideChef               | RecipeGen AI photo-to-recipe beta (2024) [P]                                                 | Tier unknown                                                        |
| Kitchen Stories        | None named                                                                                   | None                                                                |
| Cookidoo               | None named                                                                                   | None                                                                |

No app sells AI as a separate tier, as credits or as bring-your-own-key. Every AI feature found sits inside the one paid plan or has an unknown tier.

---

## Combined matrix (C01 to C28)

Columns: RM ReciMe, SF Samsung Food, PtE Plan to Eat, NYT NYT Cooking, AL AnyList, CMT Copy Me That, TS Tasty, ATK America's Test Kitchen, SC SideChef, KS Kitchen Stories, CK Cookidoo.

For apps with no free plan (PtE, ATK, CK), "Paid" means the app has it for paying members.

| Row                                   | RM                              | SF                                       | PtE                         | NYT                                            | AL                             | CMT                         | TS                            | ATK                   | SC                                 | KS                                   | CK                           |
| ------------------------------------- | ------------------------------- | ---------------------------------------- | --------------------------- | ---------------------------------------------- | ------------------------------ | --------------------------- | ----------------------------- | --------------------- | ---------------------------------- | ------------------------------------ | ---------------------------- |
| C01 Web URL import                    | Limited(5/wk)                   | Y                                        | Paid                        | Paid                                           | Limited(5 total)               | Limited(40 recipes)         | N                             | ?                     | ?                                  | Paid                                 | Paid                         |
| C02 Social video import               | Limited(5/wk)                   | ?                                        | Paid                        | ?                                              | ?                              | Limited(40 recipes)         | N                             | N                     | ?                                  | Paid                                 | ?                            |
| C03 Photo or scan (OCR)               | Paid                            | Limited(3) [S]                           | Paid                        | ?                                              | ?                              | ?                           | N                             | N                     | ? (dish photo AI, not OCR)         | ?                                    | ?                            |
| C04 Extension or share sheet          | Y (Chrome ext)                  | ?                                        | Paid (clipper ext, share)   | ?                                              | Y (ext)                        | Y (browser button)          | ?                             | ?                     | ?                                  | Paid                                 | ?                            |
| C05 Bulk import, export               | Paid (PDF/print export), bulk ? | ?                                        | Paid (many formats, CSV)    | ?                                              | ?                              | Y (export)                  | N                             | ?                     | ?                                  | ?                                    | ?                            |
| C06 Free cap (number)                 | 5 imports/week                  | 3 photo imports [S], 3 days of plan recs | No free plan                | Editor "selection", no number                  | 5 web imports                  | 40 recipes total            | No cap found                  | No free plan          | 11,000 free recipes                | Web save not free                    | Not stated                   |
| C07 Private storage                   | Y (private only)                | ?                                        | Paid                        | Paid (private notes)                           | Y                              | Y                           | N                             | Limited (notes)       | ?                                  | Paid (web saves)                     | Paid (created recipes)       |
| C08 Public catalog or community       | N                               | Y (240K, communities)                    | N                           | Limited (paywalled)                            | N                              | Y (community)               | Y (10K+)                      | Paid (14K+)           | Y (18K)                            | Y (7,500+)                           | Paid (100K+)                 |
| C09 Collections, search own library   | Y                               | Y                                        | Paid                        | Limited (save free, folders and search paid)   | Y                              | Y                           | Y                             | Paid                  | Y                                  | Y                                    | Paid                         |
| C10 Manual entry and edit             | Y                               | Y                                        | Paid                        | ?                                              | Y (paste)                      | Y                           | N                             | Limited (notes)       | ?                                  | ?                                    | Paid                         |
| C11 Scaling and conversion            | ? scale, Paid convert           | Paid (adjust servings)                   | Paid (scale)                | ?                                              | Paid (scale)                   | Y (scale)                   | Y                             | ?                     | ?                                  | Y                                    | ?                            |
| C12 Cooking mode                      | Paid                            | Limited (Smart Cooking Mode paid)        | Paid                        | Paid                                           | Y                              | Limited (screen awake)      | Y                             | Paid                  | Y                                  | Y                                    | Paid                         |
| C13 Manual meal planner               | Y                               | Y                                        | Paid                        | ?                                              | Paid                           | Y                           | ?                             | ?                     | Y                                  | ?                                    | Paid                         |
| C14 Auto or AI meal plans             | ?                               | Limited (3 days free, full week paid)    | N                           | ?                                              | N                              | N                           | ?                             | N                     | Limited (curated, premium recipes) | ?                                    | ?                            |
| C15 Leftover or pantry-aware planning | ?                               | Paid (use-by priority)                   | Paid (leftovers)            | ?                                              | N                              | N                           | Limited (3-ingredient search) | ?                     | Y (leftover %)                     | Paid (cook with what you have)       | ?                            |
| C16 Pantry tracking                   | ?                               | Paid                                     | ?                           | ?                                              | N                              | Limited (pantry list)       | N                             | ?                     | ?                                  | Paid (fav ingredients)               | ?                            |
| C17 Grocery list (merge, aisle)       | Y                               | Y                                        | Paid                        | Y                                              | Y                              | Y                           | Y                             | Paid                  | Y                                  | Y                                    | ?                            |
| C18 Shared or household sync          | ?                               | Y                                        | Paid                        | ?                                              | Y (lists), Paid (meal plan)    | Limited (same login)        | ?                             | ?                     | ?                                  | ?                                    | ?                            |
| C19 Grocery ordering                  | Y (tier ?)                      | Y (23 retailers)                         | N                           | Y (Instacart)                                  | Y                              | N                           | Y (Walmart)                   | ?                     | Y                                  | ?                                    | ?                            |
| C20 Nutrition per recipe              | Paid (beta)                     | Y                                        | Paid                        | ?                                              | N                              | ?                           | ?                             | ?                     | ?                                  | ?                                    | ?                            |
| C21 Nutrition goals or macros         | N                               | Paid                                     | Limited (daily totals)      | ?                                              | N                              | N                           | ?                             | ?                     | ?                                  | ?                                    | ?                            |
| C22 AI assistant or generation        | Paid                            | Paid                                     | Paid                        | N                                              | N                              | N                           | Y (tier ?)                    | N                     | ? (beta, tier ?)                   | N                                    | N                            |
| C23 AI pricing model                  | Inside base paid                | Inside base paid                         | Inside base paid (inferred) | None                                           | None                           | None                        | ?                             | None                  | ?                                  | None                                 | None                         |
| C24 Offline                           | ?                               | ?                                        | ?                           | ?                                              | ?                              | N (internet required)       | ?                             | ?                     | ?                                  | ?                                    | ?                            |
| C25 Platforms                         | iOS, Android, web, Mac          | iOS, Android, web                        | iOS, Android, web           | iOS, Android, web                              | iOS, Android, web and Mac paid | iOS, Android, web           | iOS, Android, web             | iOS, Android          | iOS, Android, web                  | iOS, Android                         | iOS, Android, web            |
| C26 Creators, tipping, classes        | ?                               | Y (communities)                          | N                           | Limited (named cooks, videos)                  | N                              | Limited (public profile)    | Y (Tasty Creators)            | Paid (Classes add-on) | Paid (800 classes)                 | Y (community)                        | ?                            |
| C27 Ads on free                       | N                               | ?                                        | N (no free)                 | Y                                              | N                              | ?                           | N                             | N (no free)           | ?                                  | Y                                    | ?                            |
| C28 Price, trial                      | $39.99/yr, monthly ?, 7 days    | $6.99/mo, $59.99/yr, trial ?             | $5.95/mo, $49/yr, 14 days   | $4.99 to $7.00 per period, $54.99 to $69.99/yr | $9.99/yr, $14.99/yr household  | $1/mo, yearly, $65 lifetime | $3.99/mo, $34.99/yr           | $9.99/mo, $49.99/yr   | $4.99/mo, $49.99/yr, 7 days        | $6.99 to $7.99/mo, $79.99/yr, 7 days | $65/yr ($74.99 iOS), 30 days |

Notes on the matrix

- C27 "N" for RM, AL, TS means Google Play shows no "Contains ads" label on 2026-10-27. It does not prove the web versions carry no ads.
- C25 for ReciMe: the web app lacks meal plans and grocery lists. Mac is the iPad app on Apple silicon.
- C01 for Tasty and ATK: these are catalog apps. No import appears on their store listings.
- Gaps marked "?" were not filled from memory. The biggest gaps are offline use (C24) for every app, and nutrition (C20) for NYT, Tasty, ATK, SideChef, Kitchen Stories and Cookidoo.
