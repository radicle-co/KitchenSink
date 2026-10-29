## Acquisition ideas beyond the current plan

This brainstorm adds 41 acquisition ideas that the business plan does not yet use, and ranks the best 12. The lane is downloads, sign-ups and reach. Conversion and retention belong to a separate brief.

The owner asked, verbatim: "brainstorm on what we can do beyond our current plan to maximize success in obtaining downloads and subscriptions." The mindset is "assume that we can do this and figure out how." So each idea says how it could work, then what would prove or kill it.

Only 9 of the 41 ideas have an effect figure measured outside Commise. The other 32 are a target plus a test. No uplift number here is invented.

### How to read this

Each idea gives six things: what it is, why it works, effort and cash, the expected effect and its test, the risks, and the spec it touches.

Tags: [P] is a primary source, [S] secondary, [D] derived arithmetic, [R] an owner ruling, [M] a method choice, and GAP means no data. "Plan target" means a number we choose to aim at, not a forecast.

**Effort bands [M].** S is up to 8 founder-hours. M is 8 to 40 hours. L is over 40 hours. Hours count the founder's own time, with AI agents doing drafts and builds under the repo's rules.

**Dates.** Today is 28 October 2026. The pre-launch blocks come from the business plan (not published). Block 1 runs 28 Oct to 26 Nov 2026, block 2 runs 27 Nov to 26 Dec, and block 3 runs 27 Dec 2026 to 25 Jan 2027. Launch has no date yet (D2), so any test that needs a live app is dated "launch + N days".

**How the sources were read.** Research helpers opened each page with a fetch tool that extracts the text. So a quote can be lightly trimmed. A fact that came only from a search snippet was dropped.

### What the plan already covers, so it does not count here

The current plan already holds these levers, and no idea below just repeats one of them:

- Store search, product page tests, custom product pages and a small Apple Ads test.
- Short video that shows capture, and creators paid in free Pro time through offer codes.
- Two-sided referral with 30 days of Pro each (spec `023-referrals-and-growth-measurement`).
- Public pages for cook-written recipes and creator pages, with search markup and share links (spec `021-public-discovery-and-sharing`).
- The marketing site, pricing page and waitlist (spec `022-marketing-site-and-waitlist`).
- Paprika and Mealime switcher pages, the "apps keep closing" press story, Product Hunt and a wire release.
- An Apple featuring nomination, a trainer pilot, share-sheet capture and the browser extension (spec `017-recime-parity`).
- The creator embed widget (spec `012-creator-profiles`) and household sharing inside Pro.

### Rules every idea was screened against

Seven rulings shape or block ideas. Each idea's risk line names the one it meets.

- **Signed-out use is reading only.** 001-FR-045 and spec `021-public-discovery-and-sharing` open one page at a time to readers. Any signed-out tool or write needs a new ruling.
- **Imported recipes never go public.** 021-FR-003 keeps `imported_public` off the open web. Nothing may seed search pages from imported blogs.
- **Capture is user-directed only.** Spec `017-recime-parity` allows no crawl and no batch, and the extension gets `activeTab` only.
- **No AI as bait.** The ADR-0024 ceiling stands until launch (ADR-0024 §6), and 023-FR-024 bars AI uses as a reward. No idea spends AI on free or signed-out users to attract them.
- **US only at v1.** 016-FR-048 serves one market, and an unserved market fails closed. Store work inside the US storefront is fine. A new country needs counsel.
- **English only today.** The web app's i18n config lists `locales: ['en']`.
- **People first.** The age floor is 16 (022-FR-047). No fingerprinting and no ad SDK (023-FR-031, FR-048). No reward tied to a review (023-FR-034). Deceptive patterns are refused, not weighed.

## The ideas

The 41 ideas sit in six groups: store and platform surfaces, search and content, loops inside the product, partners, founder-led channels, and markets and moments.

### A. Store and platform surfaces

#### A1. Turn the waitlist into App Store pre-orders and Google Play pre-registration

- **What.** List the app for pre-order on iOS and pre-registration on Android before launch. Send every confirmed waitlist member the store link.
- **Why it works.** Apple says: "On release day, your app automatically downloads onto the devices of people who have pre-ordered" [P, [Apple pre-orders](https://developer.apple.com/app-store/pre-orders/)]. A new app can sit on pre-order for "2 to 180 days". Google says "Play can deliver your app to users' devices automatically on launch day (if they've opted in)" [P, [Google Play](https://support.google.com/googleplay/android-developer/answer/9859047?hl=en)]. Pre-registration "can only last 90 days".
- **Effort and cash.** S. $0.
- **Expected effect and test.** No source gives a pre-order-to-install rate. Plan target [M]: 30% of emailed, confirmed waitlist members pre-order within 14 days. Test in block 3, once D2 sets a date. Kill rule: under 10% after 14 days means the message or the product page is wrong, so fix both before launch day.
- **Risks.** Needs a firm launch date (D2). Read Apple's rules on moving a pre-order date before publishing one. The email uses the waitlist's "beta and launch news" purpose only (022-FR-040). A Play pre-registration reward must be a one-time product, so no subscription time.
- **Spec.** 022-FR-050 already allows the pre-order badge. Add a pre-order step to `022-marketing-site-and-waitlist` section I.

#### A2. Run App Store in-app events around food moments

- **What.** Publish an in-app event for each moment, such as "Plan your Ramadan iftars" or "New Year, three easy dinners a week". Each event opens a ready collection inside the app.
- **Why it works.** Apple says events appear "on your product page", "in search results" and in curated picks on the Today and Apps tabs [P, [Apple in-app events](https://developer.apple.com/app-store/in-app-events/)]. People without the app "can download it directly from your In-App Event card". An app can have "up to 10 events published" at once. Each lasts up to 31 days and can be promoted 14 days ahead.
- **Effort and cash.** S per event, once deep links into a collection exist. $0.
- **Expected effect and test.** No opened study measures the effect. A publisher's case study was found only as a snippet, so it is not used. Test from launch: one event per moment, each with its own store campaign token. Kill rule: three events in a row with no installs on their token means stop.
- **Risks.** Apple reviews each event, and it must be a real, timely thing inside the app. No fake urgency (022-FR-036).
- **Spec.** New small spec, or an FR in `012-creator-profiles` for dated collections.

#### A3. Use Google Play promotional content for the same moments

- **What.** Publish the same seasonal events as Play promotional content.
- **Why it works.** Google says the content shows on the store listing and "may also be shown on other Google Play surfaces, like the homepage, search, and more" [P, [Google Play](https://google.play/business/programs/promotionalcontent/)]. Google also says apps that submit it and request featuring "can see over twice as many explore acquisitions during a featuring window". Its footnote counts only events with a significant uplift, about half of 6,000, with a median uplift of 106% [S, vendor's own analysis, Nov 2023 to Jan 2024].
- **Effort and cash.** S per event. $0.
- **Expected effect and test.** The 106% is Google's median over its best-performing half, so it is not a forecast for Commise. Test: check eligibility at launch, then run one event. Kill rule: as A2.
- **Risks.** Access needs "eligibility criteria for premium growth tools", which the page does not list. Eligibility is GAP. Play converts to paid at 0.9% against 2.6% on iOS (business plan 8.6).
- **Spec.** Same as A2.

#### A4. Add a second keyword set through the US storefront's extra languages

- **What.** Apple's US storefront supports more listing languages than English. Add an honest Spanish (Mexico) listing to reach more searches.
- **Why it works.** Apple's table lists, for the United States: "English (US)" plus "Arabic, Chinese (Simplified), Chinese (Traditional), French, Korean, Portuguese (Brazil), Russian, Spanish (Mexico), Vietnamese" [P, [Apple localizations](https://developer.apple.com/help/app-store-connect/reference/app-store-localizations)].
- **Effort and cash.** S. $0, or the price of an ASO tool (business plan GAP).
- **Expected effect and test.** The page does not say these listings are indexed for US search. That is a hypothesis. Test at launch + 14 days: add the listing, then check whether the new keywords rank on a US device. Kill rule: no movement in 30 days means revert.
- **Risks.** The app is English only. A Spanish listing must say so plainly. Stuffing keywords breaks App Review's accurate-metadata rule and would mislead Spanish readers, so it is refused.
- **Spec.** None. Store listing work.

#### A5. Translate the app into Spanish for US Spanish speakers

- **What.** Ship a full Spanish interface, store listing and site, still inside the US market.
- **Why it works.** Spanish is the top non-English home language in the US, at 61.1% of people age 5+ who speak another language at home [P, [US Census, Dec 2023](https://www.census.gov/newsroom/press-releases/2023/language-at-home-acs-5-year.html)]. Apple lists "Localization" among its featuring factors [P, [Apple](https://developer.apple.com/app-store/getting-featured/)]. The user-needs synthesis says non-English speakers are a group the evidence "barely reaches".
- **Effort and cash.** L. Translation and native review cost GAP. Every string already goes through the localisation path, by repo rule.
- **Expected effect and test.** Headcount and effect are GAP. Test first with A4 and a Spanish waitlist page in block 2. Kill rule: if Spanish visitors sign up at under half the English rate after 500 visits, wait.
- **Risks.** Parsing Spanish ingredient lines is a new engine problem (ADR-0026). Ship nothing that reads amounts wrong in Spanish.
- **Spec.** New spec needed.

#### A6. Build for iOS and Android system surfaces

- **What.** A "tonight's dinner" widget, a grocery-list widget, cooking timers as Live Activities, Siri and Shortcuts actions such as "add milk to my list", and timers on the watch.
- **Why it works.** Apple's featuring team weighs "New technologies that solve a unique problem and provide an enhanced user experience" [P, [Apple](https://developer.apple.com/app-store/getting-featured/)]. The page names no specific technology. These surfaces also serve the hands-free need (synthesis rank 6).
- **Effort and cash.** L. Native extension code outside React Native. $0 cash.
- **Expected effect and test.** No evidence ties a widget to installs. Target: name the widgets and Live Activities in the featuring nomination. Test at the nomination: Apple asks for two weeks' notice and suggests up to three months. Kill rule: if not featured within two nominations, keep the surfaces for retention only.
- **Risks.** Cross-platform rule: Android widgets ship in the same release (CLAUDE.md, §14).
- **Spec.** New FRs in `008-cooking-mode`, `006-meal-planning` and `007-grocery-lists`.

#### A7. Open shared recipe links in an App Clip on iPhone

- **What.** A shared link opens a light App Clip with the recipe and a "save" button, then offers the full app.
- **Why it works.** Apple's App Clip example is a shop's clip that is "instantly available ... without the need to install the full app" [P, [Apple App Clip docs](https://developer.apple.com/tutorials/data/documentation/appclip.json)]. Size limits are 15 MB, or 100 MB for links only on iOS 17 and later [P, same docs].
- **Effort and cash.** L. React Native and App Clip size limits make this hard. $0 cash.
- **Expected effect and test.** No evidence. Test only after 021 share links show their install rate. Kill rule: build it only if share-link visits per install are poor on iPhone compared with Android.
- **Risks.** Android Instant Apps ended: "Starting December 2025, Instant Apps cannot be published through Google Play" [P, [Android](https://developer.android.com/topic/google-play-instant/release-notes)]. So this is iPhone only, which strains the cross-platform rule. It needs an owner exception.
- **Spec.** `021-public-discovery-and-sharing`, FR-016 area.

#### A8. List Commise in the AI assistant app directories

- **What.** A Commise app in ChatGPT and a Commise connector in Claude's directory. A person says "add this recipe to my Commise list" in the assistant.
- **Why it works.** Instacart "launched a new shopping app inside ChatGPT" in December 2025 [S, [Digital Commerce 360](https://www.digitalcommerce360.com/2025/12/12/instacart-debuts-its-new-chatgpt-app/)]. Claude's directory says "Organizations can submit their MCP servers for review and inclusion" [P, [Claude docs](https://www.claude.com/docs/connectors/directory)]. The assistant runs the model, so Commise pays for no AI call.
- **Effort and cash.** M to L. A small tool server over the existing APIs. $0 cash.
- **Expected effect and test.** No evidence for installs. Test: submit to Claude's directory first, which takes submissions today. OpenAI's submission status could not be confirmed. Kill rule: under 50 connected accounts within 60 days of listing means stop.
- **Risks.** Recipe and list data flow to an outside AI company. That needs a privacy notice entry and a counsel check (016). Public recipes only for unauthenticated tools (021-FR-102).
- **Spec.** New spec needed. `staff-architect` review, because it adds a public surface.

#### A9. Treat browser extension stores as a channel, with a free "just the recipe" view

- **What.** The extension (017 D3) gets a free mode that shows only the recipe on a cluttered page, with a "Save to Commise" button.
- **Why it works.** It answers need rank 1, "the page fights back". But the evidence cuts against store demand. Three recipe-only extensions showed 20, 157 and 30 users [P, Chrome Web Store listings: [one](https://chromewebstore.google.com/detail/just-show-me-the-recipe/celmkpbnnpomiaidojlhopcmhoajhlkl), [two](https://chromewebstore.google.com/detail/recipe-extractor/ggdghegjkamfemkilhclapejcpljehia), [three](https://chromewebstore.google.com/detail/jenhlponehmdlalhflpoiehbekembmhl)].
- **Effort and cash.** M. $5 Chrome developer fee [Unconfirmed].
- **Expected effect and test.** Low reach on the evidence. Test with a good listing at launch. Kill rule: under 500 extension users at launch + 90 days means stop promoting it as a channel.
- **Risks.** `activeTab` only, user-triggered only (017). Publishers may object to a view that hides their page. Show the source link and the author (004-FR-010).
- **Spec.** `017-recime-parity` D3.

### B. Search and content

#### B1. Write an "export from X" guide for every place cooks keep recipes

- **What.** A guide for each source: Evernote, Apple Notes, Google Keep, Notion, Pinterest boards, NYT Cooking, Plan to Eat, BigOven, Samsung Food, and every closed app. Add importers for the biggest ones.
- **Why it works.** Switching moments keep coming. Evernote cut free accounts to "a single notebook and just fifty notes at a time" [S, [PCWorld, Nov 2023](https://www.pcworld.com/article/2159405/evernote-drastically-cuts-back-on-its-free-plan.html)]. Paprika says "premium features will require a subscription" [P, [Paprika news](https://www.paprikaapp.com/news/)]. The plan covers only Paprika, AnyList, Copy Me That and ReciMe.
- **Effort and cash.** M for 10 guides. L for new importers. $0 cash.
- **Expected effect and test.** Only 1.74% to 6.11% of new pages reach Google's top 10 within a year (business plan 8.4.6, Ahrefs). Test: publish 5 guides in block 2, each with a waitlist form. Kill rule: a guide with under 100 search impressions after 120 days gets no more work.
- **Risks.** An importer reads only a file the cook hands over. A Pinterest board import must not turn into a batch fetch (017). Use other apps' names as plain facts, never as ad keywords that imply a tie.
- **Spec.** `022-marketing-site-and-waitlist` pages. New importer FRs in `017-recime-parity` FR-016a.

#### B2. Offer free cooking tools on the marketing site

- **What.** A recipe scaler, a cups-to-grams converter by ingredient, and a turkey thaw-time calculator. They work with no account and no AI.
- **Why it works.** HubSpot's free Website Grader "was used to grade more than 4 million websites" between 2006 and 2011 [S, [GrowthHackers](https://growthhackers.com/growth-studies/hubspot/)]. Free tools earn links and search visits that a product page cannot.
- **Effort and cash.** M. $0 cash.
- **Expected effect and test.** Target [M]: each tool earns its own search visits within 6 months. Test with one tool, the converter, in block 2. Kill rule: under 300 visits a month at month 6 means stop adding tools.
- **Risks.** 022-FR-002 says the site "is not the app". A tool on it needs an owner ruling. Gram conversions must use the USDA data and show when data is missing (001-FR-007). No AI call, so no ADR-0024 draw.
- **Spec.** Amend `022-marketing-site-and-waitlist`, or new spec.

#### B3. Give food creators a free nutrition label maker

- **What.** A creator pastes their own recipe and gets a USDA-based nutrition panel to embed, with a "Nutrition by Commise" link.
- **Why it works.** Bloggers already pay for this. Food Blogger Pro says "we're no longer offering Nutrifox for free alongside an annual Food Blogger Pro membership" [P, [Food Blogger Pro](https://support.foodbloggerpro.com/en/articles/836340-how-can-i-get-access-to-nutrifox)]. Nutrifox's price page would not open, so its price is GAP. Every embed is a link from a recipe site.
- **Effort and cash.** M. $0 cash. It reuses the food catalog and the nutrition summary.
- **Expected effect and test.** No evidence for installs. Test: offer it to 20 creators from the plan's creator list in block 3. Kill rule: under 5 creators embed it within 30 days means stop.
- **Risks.** Label it as an estimate, never as a regulatory label for packaged food. Show the "incomplete" flag. The embedded link must be clear and creators may remove it.
- **Spec.** New spec needed, on `003-usda-food-data` and 001-FR-007.

#### B4. Partner with WP Recipe Maker for a "Save to Commise" button

- **What.** Ask the WP Recipe Maker team to add Commise as a save target, as they did for other partners. A reader on any recipe blog taps the button to save the recipe.
- **Why it works.** WP Recipe Maker has "50,000+" active installations [P, [WordPress.org](https://wordpress.org/plugins/wp-recipe-maker/)]. It already lists partner features such as "Shoppable ingredients with Instacart, Walmart, Chicory" and a "Hubbub Pro Save This block". One deal could reach every site that runs it.
- **Effort and cash.** M if the plugin team builds the button. L to write our own plugin. Partner terms GAP.
- **Expected effect and test.** No evidence for installs. Test: email the plugin team in block 1. Kill rule: no reply in 30 days means fall back to our own plugin only if creator demand shows up in B3.
- **Risks.** A saved recipe is `imported_public` and stays private (021-FR-003). The reader triggers each save, which fits 017. The publisher chooses the button, which eases the content licence gap in 016.
- **Spec.** Amend `004-recipe-importing` and `017-recime-parity` capture surfaces.

#### B5. Pin public recipes to Pinterest

- **What.** A Commise Pinterest account pins cook-written public recipes and capture videos. Public pages carry recipe markup that Pinterest reads.
- **Why it works.** The evidence is weak and falling. Pinterest sent 3.99% of Pinch of Yum's traffic in March 2026, down from 6.33% in March 2024 [S, [Food Blogger Pro, Apr 2026](https://www.foodbloggerpro.com/blog/pinch-of-yums-traffic-trends-2024-vs-2026/)]. Search sent 57.23%.
- **Effort and cash.** S to M. $0 cash.
- **Expected effect and test.** Low on the evidence. Test with 30 pins after 021 ships. Kill rule: under 1 install per 1,000 pin views after 60 days means stop.
- **Risks.** Pin only recipes that are open to the web under 021-FR-002.
- **Spec.** `021-public-discovery-and-sharing` FR-033 (preview tags).

#### B6. Be the app that AI answers recommend

- **What.** Write clear comparison and FAQ pages that answer "best recipe app that imports from TikTok" and similar questions. Keep them current and true.
- **Why it works.** Adobe saw traffic to US retail sites from generative AI sources jump "1,200 percent" between July 2024 and February 2025 [S, [Adobe, Mar 2025](https://blog.adobe.com/en/publish/2025/03/17/adobe-analytics-traffic-to-us-retail-websites-from-generative-ai-sources-jumps-1200-percent)]. That is retail, and old. The owner already allows answer crawlers in robots rules [R].
- **Effort and cash.** S to M. $0 cash.
- **Expected effect and test.** No evidence for a recipe app. Test: in block 2, ask 5 assistants 10 fixed questions and record whether Commise appears. Repeat monthly. Kill rule: no mention after 4 months means fold the effort into B7.
- **Risks.** Every claim must be in the claims register (022-FR-070). No claim that a rival is worse unless it is proven (see B9).
- **Spec.** `022-marketing-site-and-waitlist`.

#### B7. Get into the "best recipe app" roundups

- **What.** Pitch the writers of evergreen roundups at review sites and tech outlets. Send a review account and the export proof.
- **Why it works.** No evidence: target plus test. The plan's PR pitch is a one-off news story. A roundup is updated every year and ranks for the search itself.
- **Effort and cash.** S to M. $0 cash.
- **Expected effect and test.** Target [M]: 2 inclusions from 15 pitches. Test at launch + 30 days. Kill rule: zero inclusions by launch + 90 days means stop pitching roundups.
- **Risks.** Never pay for a placement that is not disclosed as an ad.
- **Spec.** None.

#### B8. List Commise on alternative-app directories

- **What.** List on AlternativeTo and similar sites as an alternative to Mealime, Paprika, Yummly and ReciMe.
- **Why it works.** These pages exist and are crowded. AlternativeTo shows "82 Mealime alternatives" and "149 Paprika Recipe Manager alternatives" [P, [Mealime page](https://alternativeto.net/software/mealime/), [Paprika page](https://alternativeto.net/software/paprika-recipe-manager/)]. A cook leaving a closed app lands there.
- **Effort and cash.** S. $0.
- **Expected effect and test.** No evidence for volume. Test: list in block 1, pointing at the waitlist. Kill rule: under 20 visits a month from these sites by launch + 60 days means stop updating them.
- **Risks.** Never post fake likes or reviews.
- **Spec.** None.

#### B9. Publish a recipe import accuracy benchmark

- **What.** Import the same 100 recipes into six apps by hand. Publish every result, the method and the data. Repeat each year.
- **Why it works.** Original data earns links. Backlinko says "over 79K people have linked to that study" of its own [S, [Backlinko, Mar 2025](https://backlinko.com/hub/seo/original-research)]. Fractl reports nine data stories for Adobe that "earned 390 new referring domains" [S, [Fractl, May 2026](https://www.frac.tl/?p=18389), vendor's own claim]. It proves need rank 2 in public.
- **Effort and cash.** M. Paid plans for rival apps, GAP.
- **Expected effect and test.** No evidence for installs. Test: publish in block 3 and pitch it with the PR list. Kill rule: under 10 linking sites at 90 days means do not repeat it.
- **Risks.** Comparative claims must be true and reproducible. `clo` checks it before release. Test by hand only, inside each app's terms. Report where Commise loses too.
- **Spec.** Claims register (022-FR-070).

#### B10. Plan a year of food moments

- **What.** One calendar drives videos, collections, A2 events and pitches. Dates: Thanksgiving 26 Nov 2026 [P, [OPM](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/)], Lunar New Year 6 Feb 2027, Ramadan about 8 Feb to 8 Mar 2027, and Diwali 29 Oct 2027 [S, Wikipedia tables, moon sighting may move Ramadan].
- **Why it works.** Meal-planning apps peak in January. Sensor Tower saw Yummly's weekly US revenue peak at "$21.7K in late January" and eMeals' "in mid-January" in 2023 [S, [Sensor Tower, Apr 2023](https://sensortower.com/blog/2023-q1-unified-top-5-food%20and%20drink-revenue-us-602e0a75241bc16eb808976d)]. That is revenue, not installs.
- **Effort and cash.** M across the year. $0 cash.
- **Expected effect and test.** Target: each moment beats the weekly install baseline on its tracked links. Test with Thanksgiving 2026 on the waitlist, block 1. Kill rule: a moment with no lift over the prior two weeks drops off next year's calendar.
- **Risks.** Cultural moments need cooks from that culture to review the content.
- **Spec.** Collections in `012-creator-profiles`. Events need A2.

#### B11. Time the public launch for January planning

- **What.** Put the public launch (plan month 4) in early January, when people start planning meals.
- **Why it works.** Same January peak as B10, revenue only.
- **Effort and cash.** S. $0.
- **Expected effect and test.** No install data for the effect. The decision belongs to D2. Kill rule: if January is missed, aim for the next planning moment rather than launching in a dead week.
- **Risks.** App Store review slows over late December holidays [Inference, check Apple's notice].
- **Spec.** `v1-launch-plan.md`, D2.

#### B12. Make YouTube how-to videos that answer searches

- **What.** Long-form videos such as "how to save a TikTok recipe" and "how to export your Paprika recipes". The plan has short video only.
- **Why it works.** No evidence: target plus test.
- **Effort and cash.** M. $0 cash.
- **Expected effect and test.** Test: 5 videos in block 2, each with a tracked link. Kill rule: under 1,000 views across all 5 after 60 days means stop long-form.
- **Risks.** Show only features that ship (022-FR-011).
- **Spec.** None.

#### B13. Send an owned weekly email of three easy dinners

- **What.** A short weekly email of three dinners from public recipes. It builds a list that Commise owns.
- **Why it works.** No evidence: target plus test. It targets the daily decision burden (synthesis theme 13).
- **Effort and cash.** M ongoing. List service cost per 022-FR-049a.
- **Expected effect and test.** Test: 8 issues from block 2. Kill rule: under 20% of readers click any recipe by issue 8 means stop.
- **Risks.** It needs a new consent purpose, because the waitlist allows launch news and interviews only (022-FR-040). No open tracking without consent (022-FR-049).
- **Spec.** Amend `022-marketing-site-and-waitlist`.

### C. Loops inside the product

#### C1. Let Free cooks form a household

- **What.** Answer 017-FR-034k "yes". Two Free cooks can share plans and lists. A paid plan adds coverage of paid features.
- **Why it works.** The spec itself says "each invite is a free growth loop". Splitwise "has long grown organically" and wants a free tier good enough that "users are willing to invite their friends" [S, [TechCrunch, Apr 2021](https://techcrunch.com/2021/04/28/splitwise-raises-20m-series-a-to-help-everyone-in-the-world-divvy-expenses)]. Shared lists answer need rank 7.
- **Effort and cash.** S to decide. The household is already specified, so the extra build is small. $0 cash.
- **Expected effect and test.** No evidence for size. Decide in block 1. After launch, count accepted household invites per active cook. Kill rule: under 0.05 accepted invites per active Free cook at launch + 60 days means the loop is weak.
- **Risks.** It can weaken household sharing as a Pro reason, so the conversion brief must weigh it. 023-FR-030 already blocks referral rewards inside a household.
- **Spec.** `017-recime-parity` FR-034k, `010-subscriptions`.

#### C2. Share a grocery list with a helper who has no account

- **What.** A link lets a partner or helper see and tick off the list in a browser. The page offers the app.
- **Why it works.** Helpers buy the wrong thing and shared lists drop items (GL-002, GL-018). Dropbox credited "20% from shared folders, other viral features" (business plan 3.1) [P].
- **Effort and cash.** M to L. $0 cash.
- **Expected effect and test.** No evidence for this app. Test with beta households in block 3, read-only first. Kill rule: under 1 install per 20 shared lists at launch + 60 days means keep it for helpers only.
- **Risks.** Ticking an item is a signed-out write, which 001-FR-045 forbids. It needs a ruling and a `staff-architect` review. The link must be revocable and unguessable. List contents can be personal.
- **Spec.** `007-grocery-lists`, `021-public-discovery-and-sharing`, new ruling.

#### C3. Plan a potluck or holiday meal with guests

- **What.** A host builds a menu, guests claim dishes by link, and each guest gets their recipe and list.
- **Why it works.** Partiful lets anyone "invite their friends from a link" and guests "don't need the app to respond" [S, [TechCrunch, Nov 2024](https://techcrunch.com/2024/11/18/partiful-is-googles-best-app-of-2024/)]. It "has been named Google's app of the year" and its weekly downloads "grew by 4x" that year. Cooking for others is a known fear (CK-024).
- **Effort and cash.** L. $0 cash.
- **Expected effect and test.** No evidence for food. Test a manual version for Thanksgiving 2026: a shared collection plus a sign-up form. Kill rule: under 3 guests per event on average means do not build it.
- **Risks.** Guests' names and emails are personal data. A guest's answer is a signed-out write (001-FR-045).
- **Spec.** New spec needed.

#### C4. Share a recipe as a good-looking image card

- **What.** Share makes an image of the recipe or "what I cooked", sized for Stories and chats, with a small Commise mark and the link.
- **Why it works.** Spotify Wrapped shares rose "41% YoY ... to around 500 million" in 2025 [S, [Music Business Worldwide, Dec 2025](https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase)]. Sensor Tower saw Spotify's daily users spike "14%" on Wrapped's launch day [S, [Sensor Tower, Dec 2023](https://sensortower.com/blog/mmm-spotify-wrapped-drives-app-usage-ski-resort-apps-propelled-by-winter)].
- **Effort and cash.** M. $0 cash.
- **Expected effect and test.** Spotify is a giant, so this is direction only. Test at launch + 60 days: image shares against link shares. Kill rule: if image shares bring fewer visits per share than link shares, keep links only.
- **Risks.** Strip all photo metadata (021-FR-071). Image cards only for recipes the cook may share. The mark is small and the cook can turn it off.
- **Spec.** `021-public-discovery-and-sharing` section D.

#### C5. Put a plain credit line on printed and PDF exports

- **What.** Printed recipes, PDF exports and emailed lists end with "Made with Commise, commise.app".
- **Why it works.** Hotmail's footer is the classic case. It reached "750,000 users" by Labor Day 1996 and "2 million" weeks later [S, [TechCrunch, Oct 2009, book excerpt](https://techcrunch.com/2009/10/18/ps-i-love-you-get-your-free-email-at-hotmail/)].
- **Effort and cash.** S. $0.
- **Expected effect and test.** Hotmail is a 1996 case, so this is direction only. Test at launch + 60 days with a campaign source on the link. Kill rule: under 1 visit per 100 exports means drop the link and keep a plain credit.
- **Risks.** Never inside the JSON export, which must stay lossless (017-FR-018). The cook can turn the line off. The link carries a source only, no user id (023-FR-031).
- **Spec.** `017-recime-parity` FR-018 to FR-020.

#### C6. Run a family cookbook project

- **What.** A cook starts a family circle, invites relatives to add the old recipe cards by scan, and can order a printed book as a gift.
- **Why it works.** No evidence: target plus test. Circles invite people by link (011, C-001). Family cards are a known source (FR-021, FR-024).
- **Effort and cash.** L. A print partner, GAP.
- **Expected effect and test.** Test a manual version before Mother's Day 2027 (date to confirm). Kill rule: under 3 relatives per circle means stop.
- **Risks.** Scans of other people's cards can hold personal notes. Circle members need accounts (011).
- **Spec.** `011-recipe-digitization`, new print spec.

#### C7. Invite friends to cook together live

- **What.** "Cook with me" lets two to six people cook one recipe at the same time. Each invite reaches new people.
- **Why it works.** No evidence: target plus test. The draft spec rates its own premise as an assumption.
- **Effort and cash.** L. $0 cash at small scale.
- **Expected effect and test.** The draft spec puts the voice guide first. Test the riskiest assumption it names before any build. Kill rule: set by that test.
- **Risks.** Live sessions need moderation and an age floor (016).
- **Spec.** `021-cook-with-me` (draft in the main checkout, numbered 021 by mistake beside `021-public-discovery-and-sharing`).

### D. Partners

#### D1. Give dietitians and health coaches a client tool

- **What.** Extend the trainer pilot to registered dietitians. A dietitian sets a client's nutrition plan, and the client installs Commise.
- **Why it works.** Dietitians and nutritionists "held about 86,300 jobs in 2025" [P, [BLS](https://www.bls.gov/ooh/healthcare/dietitians-and-nutritionists.htm)]. Each one advises many clients [Inference].
- **Effort and cash.** M for outreach. The feature is 009-FR-038.
- **Expected effect and test.** No evidence for volume. Test with 10 dietitians in beta, as the trainer pilot does. Kill rule: under 3 active clients each in 60 days means stop.
- **Risks.** A dietitian who is a HIPAA covered entity may need a business associate agreement. `clo` checks first. No health or allergy claims (022-FR-071).
- **Spec.** `009-nutrition-planning`.

#### D2. Work with CSA farms and farmers' markets

- **What.** A farm posts a weekly "what to cook with this box" collection. A QR card at the stall opens it.
- **Why it works.** No evidence: target plus test. The CSA farm count could not be opened (USDA site down), so it is GAP. It serves need rank 9, using what is at home.
- **Effort and cash.** M. Printing cost small, GAP.
- **Expected effect and test.** Test with 3 local farms in spring 2027. Kill rule: under 10 installs per farm per month means stop.
- **Risks.** The farm's recipes must be its own to go public (021-FR-002).
- **Spec.** `012-creator-profiles`.

#### D3. Reach people leaving meal kits

- **What.** A campaign for people who cancel a meal kit: "keep cooking your favourite cards". The cook scans the cards into Commise.
- **Why it works.** Meal-kit firms saw "just 12 percent of their U.S. subscribers return after one year" [S, [Second Measure, Jan 2019](https://secondmeasure.com/datapoints/ugly-produce-boxes-retain-customers-better-than-meal-kits/)]. That is old data, but it shows a large leaving group.
- **Effort and cash.** M. $0 cash unless ads are used.
- **Expected effect and test.** No evidence for this pitch. Test with a landing page and two videos in block 2. Kill rule: under half the sign-up rate of the general page after 500 visits means stop.
- **Risks.** Scanned cards are `imported_physical` and stay private (C-004). Use brand names only as plain facts.
- **Spec.** `011-recipe-digitization`, `004-recipe-importing`.

#### D4. Put offer cards in cookware boxes

- **What.** A small cookware brand puts a card with a Pro offer code in each box.
- **Why it works.** No evidence: target plus test. Apple offer codes allow up to 1 million redemptions a quarter (business plan 8.4.5) [P].
- **Effort and cash.** M. Card printing, GAP.
- **Expected effect and test.** Test with one brand. Kill rule: under 2% code redemption after 90 days means stop.
- **Risks.** Google Play codes give trials, not free time (business plan 8.4.5). No grocery or affiliate deal, which the owner has not ruled [R].
- **Spec.** `023-referrals-and-growth-measurement` reward ledger.

#### D5. Work with adult cooking classes

- **What.** Class teachers share their recipes as a collection. Students get the app to cook at home.
- **Why it works.** No evidence: target plus test.
- **Effort and cash.** M. $0 cash.
- **Expected effect and test.** Test with 3 teachers in spring 2027. Kill rule: under 30% of students install means stop.
- **Risks.** Adults only. The age floor is 16 (016).
- **Spec.** `012-creator-profiles`, `013-cooking-school`.

#### D6. Serve blind and low-vision cooks well, then tell them

- **What.** Make the app excellent with VoiceOver and TalkBack and the voice guide. Then share it in accessibility communities.
- **Why it works.** AppleVis "has an app directory where users can submit app descriptions and tell others whether the app is accessible" [S, [Equal Entry, 2018](https://equalentry.com/apples-applevis-a-users-experience)]. Apple lists "Accessibility" among featuring factors [P, Apple]. The synthesis says blind cooks are barely reached.
- **Effort and cash.** M after a `staff-ux-engineer` audit. $0 cash.
- **Expected effect and test.** No evidence for volume. Test after the WCAG audit. Kill rule: none needed, since the work is owed anyway (WCAG 2.2 AA).
- **Risks.** Claim only what an audit proves.
- **Spec.** `008-cooking-mode` voice guide.

### E. Founder-led channels

#### E1. Post a technical story on Hacker News

- **What.** A post on how two engines read every ingredient amount, with the 1919 cookbook data. Or a Show HN once people can try the app.
- **Why it works.** One launch reported "Hacker News: 6.3k" visits inside a launch that brought "1,432 Signups" across channels [S, [Typefully](https://typefully.com/frankdilo/launching-typefully-0Q4DG4p)]. Another front page brought "roughly 50 concurrent users" [S, [dev.to, 2017](https://dev.to/garysieling/what-the-hacker-news-front-page-did-for-my-app)].
- **Effort and cash.** S to M. $0.
- **Expected effect and test.** The audience is engineers, not cooks [Inference]. Test once in the soft launch. Kill rule: one-off by design.
- **Risks.** Hacker News bans vote requests. Show HN needs something people can try.
- **Spec.** None.

#### E2. Open-source the ingredient test corpus and scorer

- **What.** Publish the ingredient-line test set and the scoring tool, so others can test any parser.
- **Why it works.** No evidence: target plus test. It earns links from developers and backs the trust story.
- **Effort and cash.** M. $0.
- **Expected effect and test.** Test: release in block 3. Kill rule: under 100 repo stars in 90 days means no further releases.
- **Risks.** Release only public-domain text (ADR-0023). No user data.
- **Spec.** None.

#### E3. Build in public

- **What.** A weekly post of real numbers and lessons on one or two social sites.
- **Why it works.** No evidence: target plus test.
- **Effort and cash.** S a week. $0.
- **Expected effect and test.** Test for 8 weeks from block 1 with a tracked waitlist link. Kill rule: under 50 waitlist sign-ups from it in 8 weeks means stop.
- **Risks.** Never share user data or small counts that point to a person (023-FR-011).
- **Spec.** None.

#### E4. Take part in recipe communities, by their rules

- **What.** The founder answers questions in cooking and meal-prep communities as himself, and links only when asked.
- **Why it works.** No evidence for installs. Reddit's own guidance says "reddit is a community, not a platform for self-promotion" [S, [mirror of Reddit's wiki](https://redlib.groet-infra.nl/wiki/selfpromotion)]. It keeps own links to about a tenth of posts.
- **Effort and cash.** S a week. $0.
- **Expected effect and test.** Test for 8 weeks with a source tag. Kill rule: any moderator warning means stop in that community.
- **Risks.** Never pay anyone to post. Always say "I make this".
- **Spec.** None.

### F. Markets and moments

#### F1. Open English-speaking second markets

- **What.** Turn on Canada, the UK, Ireland, Australia and New Zealand through the market switch, with no translation.
- **Why it works.** No evidence: target plus test. RevenueCat reports a "$0.38 median RPI at D14" for North America, with no country split opened [S, [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps/)].
- **Effort and cash.** M per market, mostly counsel. Cost GAP.
- **Expected effect and test.** Test with Canada first after launch + 90 days. Kill rule: under 5% of US installs per month after 60 days means pause the next market.
- **Risks.** 016 says Australia is the sharpest legal market. Each market needs counsel before the switch (016-FR-048a).
- **Spec.** `016-legal-compliance-framework` FR-048.

#### F2. Enter awards

- **What.** Enter app and design awards that take entries.
- **Why it works.** No evidence: target plus test. Partiful's Google award made the news (C3).
- **Effort and cash.** S per entry. Entry fees GAP.
- **Expected effect and test.** Test 2 entries in year 1. Kill rule: no shortlist in 2 entries means stop paying fees.
- **Risks.** None beyond cost.
- **Spec.** None.

### Checked and not recommended

These were checked and fail on platform facts or rulings. They do not count toward the 41.

| Idea                                                                                       | Why not                                                                                                                                                                               | Source                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Google Assistant voice app on smart displays                                               | Conversational Actions ended: "the turndown is occurring on June 13, 2023"                                                                                                            | [P, Google](https://developers.google.com/assistant/ca-sunset)                                                           |
| Android Instant App for share links                                                        | Ended from December 2025                                                                                                                                                              | [P, Android](https://developer.android.com/topic/google-play-instant/release-notes)                                      |
| CarPlay grocery list                                                                       | The CarPlay page lists audio, video, messaging, navigation, EV charging, fueling, parking, public safety, quick food ordering, voice and driving task apps. No list category is named | [P, Apple CarPlay](https://developer.apple.com/carplay/)                                                                 |
| Alexa skill                                                                                | Possible ("individuals can publish skills"), but Paprika already tests one and it is a voice surface with no store reach shown                                                        | [P, Amazon](https://developer.amazon.com/en-US/alexa/alexa-skills-kit), [Paprika news](https://www.paprikaapp.com/news/) |
| Android-first markets such as India and Brazil                                             | US only at v1, and Play converts at 0.9%                                                                                                                                              | 016-FR-048, business plan 8.6                                                                                            |
| Grocery store or Instacart partnership                                                     | Grocery ordering is on no plan [R]                                                                                                                                                    | business plan 8.4.8                                                                                                      |
| Rewards for reviews, contact-list invite spam, fake countdowns, fingerprinting attribution | Deceptive or forbidden. Refused, not weighed                                                                                                                                          | 023-FR-034, 022-FR-036, 023-FR-031                                                                                       |

## The top 12, ranked by expected downloads per founder-hour

The ranking is an order, not a number. No source gives downloads per hour for any of these, so a figure would be invented.

**Method [M].** Each idea is placed on two columns. The first is reach, from a cited proxy or a labelled plan target. The second is founder-hours, from the effort band. Ties break toward ideas with a platform fact behind them, then toward ideas that need no new ruling.

| Rank | Idea                               | Reach proxy                                                         | Founder-hours | Why here                                                                                                   | First test                                  |
| ---- | ---------------------------------- | ------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1    | A1. Pre-order and pre-registration | The confirmed waitlist. Plan target 1,500 sign-ups by day 90        | S             | Both stores install the app on launch day by themselves. It turns sign-ups into installs at almost no cost | Block 3, once D2 sets a date                |
| 2    | C1. Free households                | Every household invite. Need rank 7                                 | S to decide   | The build is already specified. Each invite brings a person who must install                               | Ruling in block 1. Read at launch + 60 days |
| 3    | A2. App Store in-app events        | App Store search and the Today tab. Non-users install from the card | S per event   | Free placement in search, up to 10 events at once                                                          | First moment after launch                   |
| 4    | C5. Credit line on exports         | Every print, PDF and emailed list                                   | S             | A one-line change that rides on every export                                                               | Launch + 60 days                            |
| 5    | B8. Alternative-app directories    | 82 Mealime and 149 Paprika alternatives listed                      | S             | Catches cooks at the moment they leave an app                                                              | Block 1                                     |
| 6    | A4. US storefront extra languages  | A second keyword set on the US store                                | S             | Cheap and reversible. Indexing is a hypothesis                                                             | Launch + 14 days                            |
| 7    | B1. "Export from X" guides         | Evernote free-plan cut, Paprika subscription                        | M             | Many switching pools, not one. Search is 57% of a top recipe blog's traffic                                | 5 guides in block 2                         |
| 8    | B4. WP Recipe Maker button         | 50,000+ sites                                                       | M             | One partner deal reaches every site that runs the plugin                                                   | Email in block 1                            |
| 9    | B7. Roundup outreach               | Readers of evergreen "best app" pages                               | S to M        | Pages that keep ranking, unlike a news story                                                               | Launch + 30 days                            |
| 10   | E1. Hacker News story              | One reported launch: 6.3k visits                                    | S to M        | Cheap reach, but engineers, not cooks                                                                      | Soft launch                                 |
| 11   | B9. Import accuracy benchmark      | Links and press. Proves need rank 2                                 | M             | Feeds B7, E1 and the PR list in one piece of work                                                          | Block 3                                     |
| 12   | A3. Play promotional content       | Play homepage and search                                            | S per event   | Google's own figure is strong but eligibility is unknown                                                   | At launch, check eligibility                |

Next in line are C4 (image cards), A8 (AI assistant directories) and B10 (the food-moment calendar). C2 and C3 may bring the most people per user, but each needs a ruling on signed-out writes first.

```chart-spec
type: scatter plot with labelled points
title: Top 12 acquisition ideas, founder-hours against reach evidence (ordinal)
x-axis: founder-hours band, ordinal: S, S to M, M
y-axis: reach evidence, ordinal: 1 = target only, 2 = proxy audience, 3 = platform fact or cited count
points:
  - A1 Pre-order: x S, y 3
  - C1 Free households: x S, y 2
  - A2 In-app events: x S, y 3
  - C5 Export credit: x S, y 2
  - B8 Directories: x S, y 3
  - A4 Extra languages: x S, y 2
  - B1 Export guides: x M, y 2
  - B4 WP Recipe Maker: x M, y 3
  - B7 Roundups: x S to M, y 1
  - E1 Hacker News: x S to M, y 2
  - B9 Benchmark: x M, y 2
  - A3 Play promo: x S, y 3
note: Both axes are ordinal. The chart shows placement only, not downloads.
```

### Owner decisions these ideas need

Six rulings unlock the ranked list and the next tier.

| Decision                          | Unlocks                  | Spec                                           |
| --------------------------------- | ------------------------ | ---------------------------------------------- |
| Launch date (D2)                  | A1 pre-order, B11 timing | `v1-launch-plan.md`                            |
| Free households, 017-FR-034k      | C1                       | `017-recime-parity`                            |
| Tools on the marketing site       | B2, B3                   | `022-marketing-site-and-waitlist`              |
| A signed-out write for guests     | C2, C3                   | 001-FR-045, `021-public-discovery-and-sharing` |
| An iPhone-only App Clip exception | A7                       | CLAUDE.md cross-platform rule                  |
| A weekly email consent purpose    | B13                      | 022-FR-040                                     |

### Next steps

- Founder: in block 1, list on AlternativeTo (B8), email the WP Recipe Maker team (B4), and rule on 017-FR-034k (C1).
- `ts-1`: add store campaign tokens per in-app event and per export link to 023's closed source list (FR-004).
- `pm-1`: scope a small in-app events spec (A2) and the export credit line (C5).
- `clo`: review B9's comparison method, A8's data flow and D1's HIPAA question.
- `staff-architect`: review A8 and C2 before any build.
- `staff-ux-engineer`: design the export credit line, image cards and event landing collections.

Confidence: Medium. Platform facts are strong. Volume for every idea is GAP until the soft launch measures it.

### Sources

Pages opened for this brainstorm:

- [Apple, pre-orders](https://developer.apple.com/app-store/pre-orders/)
- [Apple, in-app events](https://developer.apple.com/app-store/in-app-events/)
- [Apple, getting featured](https://developer.apple.com/app-store/getting-featured/)
- [Apple, App Store localizations](https://developer.apple.com/help/app-store-connect/reference/app-store-localizations)
- [Apple, App Clip documentation (data)](https://developer.apple.com/tutorials/data/documentation/appclip.json)
- [Apple, App Clip size limits (data)](https://developer.apple.com/tutorials/data/documentation/appclip/choosing-the-right-functionality-for-your-app-clip.json)
- [Apple, CarPlay](https://developer.apple.com/carplay/)
- [Google Play, promotional content](https://google.play/business/programs/promotionalcontent/)
- [Google Play, pre-registration](https://support.google.com/googleplay/android-developer/answer/9859047?hl=en)
- [Google Play, featuring nomination form](https://support.google.com/googleplay/contact/featuring_review?hl=en)
- [Google, Conversational Actions sunset](https://developers.google.com/assistant/ca-sunset)
- [Android, Google Play Instant release notes](https://developer.android.com/topic/google-play-instant/release-notes)
- [TechCrunch, apps inside ChatGPT, Oct 2025](https://techcrunch.com/2025/10/06/openai-launches-apps-inside-of-chatgpt/)
- [Digital Commerce 360, Instacart app in ChatGPT, Dec 2025](https://www.digitalcommerce360.com/2025/12/12/instacart-debuts-its-new-chatgpt-app/)
- [Claude, connectors directory](https://www.claude.com/docs/connectors/directory)
- [Amazon, Alexa Skills Kit](https://developer.amazon.com/en-US/alexa/alexa-skills-kit)
- [Adobe, generative AI traffic, Mar 2025](https://blog.adobe.com/en/publish/2025/03/17/adobe-analytics-traffic-to-us-retail-websites-from-generative-ai-sources-jumps-1200-percent)
- [TechCrunch, Hotmail, Oct 2009](https://techcrunch.com/2009/10/18/ps-i-love-you-get-your-free-email-at-hotmail/)
- [TechCrunch, Partiful, Nov 2024](https://techcrunch.com/2024/11/18/partiful-is-googles-best-app-of-2024/)
- [GrowthHackers, HubSpot](https://growthhackers.com/growth-studies/hubspot/)
- [Typefully launch](https://typefully.com/frankdilo/launching-typefully-0Q4DG4p)
- [dev.to, Hacker News front page, 2017](https://dev.to/garysieling/what-the-hacker-news-front-page-did-for-my-app)
- [TechCrunch, Splitwise, Apr 2021](https://techcrunch.com/2021/04/28/splitwise-raises-20m-series-a-to-help-everyone-in-the-world-divvy-expenses)
- [Music Business Worldwide, Spotify Wrapped, Dec 2025](https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase)
- [Sensor Tower, Spotify Wrapped, Dec 2023](https://sensortower.com/blog/mmm-spotify-wrapped-drives-app-usage-ski-resort-apps-propelled-by-winter)
- [Backlinko, original research, Mar 2025](https://backlinko.com/hub/seo/original-research)
- [Fractl, Adobe campaigns, May 2026](https://www.frac.tl/?p=18389)
- [WordPress.org, WP Recipe Maker](https://wordpress.org/plugins/wp-recipe-maker/)
- [Food Blogger Pro, Nutrifox access](https://support.foodbloggerpro.com/en/articles/836340-how-can-i-get-access-to-nutrifox)
- [Chrome Web Store, Just Show Me the Recipe](https://chromewebstore.google.com/detail/just-show-me-the-recipe/celmkpbnnpomiaidojlhopcmhoajhlkl)
- [Chrome Web Store, Recipe Extractor](https://chromewebstore.google.com/detail/recipe-extractor/ggdghegjkamfemkilhclapejcpljehia)
- [Chrome Web Store, AllSimpleRecipes](https://chromewebstore.google.com/detail/jenhlponehmdlalhflpoiehbekembmhl)
- [Food Blogger Pro, Pinch of Yum traffic, Apr 2026](https://www.foodbloggerpro.com/blog/pinch-of-yums-traffic-trends-2024-vs-2026/)
- [AlternativeTo, Mealime](https://alternativeto.net/software/mealime/)
- [AlternativeTo, Paprika Recipe Manager](https://alternativeto.net/software/paprika-recipe-manager/)
- [PCWorld, Evernote free plan, Nov 2023](https://www.pcworld.com/article/2159405/evernote-drastically-cuts-back-on-its-free-plan.html)
- [Second Measure, meal kits, Jan 2019](https://secondmeasure.com/datapoints/ugly-produce-boxes-retain-customers-better-than-meal-kits/)
- [Paprika news](https://www.paprikaapp.com/news/)
- [US Census, language at home, Dec 2023](https://www.census.gov/newsroom/press-releases/2023/language-at-home-acs-5-year.html)
- [BLS, dietitians and nutritionists](https://www.bls.gov/ooh/healthcare/dietitians-and-nutritionists.htm)
- [Equal Entry, AppleVis, 2018](https://equalentry.com/apples-applevis-a-users-experience)
- [Sensor Tower, Q1 2023 food and drink revenue](https://sensortower.com/blog/2023-q1-unified-top-5-food%20and%20drink-revenue-us-602e0a75241bc16eb808976d)
- [OPM, federal holidays](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/)
- [Wikipedia, Ramadan](https://en.wikipedia.org/wiki/Ramadan), [Chinese New Year](https://en.wikipedia.org/wiki/Chinese_New_Year), [Diwali](https://en.wikipedia.org/wiki/Diwali)
- [Reddit self-promotion wiki, mirror](https://redlib.groet-infra.nl/wiki/selfpromotion)
- [RevenueCat, State of Subscription Apps](https://www.revenuecat.com/state-of-subscription-apps/)

Repository and plan inputs read: the owner's rulings and the business plan (not published), specs `021-public-discovery-and-sharing`, `022-marketing-site-and-waitlist`, `023-referrals-and-growth-measurement`, `017-recime-parity`, `012-creator-profiles`, `013-cooking-school`, `009-nutrition-planning`, `011-recipe-digitization`, `016-legal-compliance-framework`, the draft `021-cook-with-me`, and `docs/research/userNeeds/synthesis.md`.
