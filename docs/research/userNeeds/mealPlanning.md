# Meal planning: user needs

This file lists the problems people have with planning meals for a day or a week. Format, evidence codes and the "validated" rule are in
[`README.md`](README.md). ID prefix `MP`. This file describes the problem space, not Commise.

## Method and limits

Desk research, done on 2026-10-20. Nobody was interviewed or watched.

**How "validated" is counted here.** A problem is validated if it has `S` or `M` evidence, or `V` evidence from three
independent **venues**. One venue counts once, however many posts it has. The App Store is one venue, however many apps
or reviewers. Mumsnet, Hellobee, AARP Community, the Cathe forum and Hacker News are one venue each. This rule is
strict on purpose. Some records with many app reviews stay "reported" because every voice came from the App Store.

**Sources reached and read in full (text checked word for word):**

- App Store reviews, US store, pulled from Apple's public review feed: Mealime, eMeals, Plan to Eat, Samsung Food,
  Eat This Much, ReciMe, Ollie, Prepear, Paprika 3, AnyList. That is 4,329 reviews (867 with one or two stars), dated
  2017-10 to 2026-10. The feed returns about the 500 most recent reviews per app, so it leans to recent complaints.
  The feed gives no link per review. Each quote cites the app's store page plus the review ID and date.
- Mumsnet threads (UK): 3080756, 3610051 (2019), 4018955 (2020), 5158967 (2022–2024), 1148140 (2011).
- Hellobee (2015), AARP Community (2021), Cathe.com forum (2025), Hacker News comments (Algolia search).
- Studies: Wu et al. 2024 (CSCW), Ducrot et al. 2017, Beatty et al. 2014, WRAP Household Food Management Survey 2024.
- Surveys: Outset 2024 (vendor, n=120), Morning Consult 2022, Mott Poll 2024 (via HealthDay news coverage).
- Expert writing: British Dietetic Association page on adult ADHD.

**Sources named only through secondary coverage (search summaries, the original page was not opened):** Daminger 2019,
Taylor et al. 2015, Bowen, Brenton and Elliott 2019, Davis and You 2010, the Armour 2026 survey and the HelloFresh 2019
survey. These carry less weight, and no one's words are quoted from them.

**Blocked or not reached:** Reddit was fully blocked. WebFetch refused it. The old.reddit JSON, the Reddit API and the
pullpush mirror all returned 403. No browser was connected. That is a large gap, because the brief named Reddit as a main
source. Also blocked: Google Play reviews (no reachable feed), Trustpilot (403), ScienceDirect full text (403), the QVC and
Well-Trained Mind forums (403), and the BLS time-use release by sex (403). No NYT Cooking, Crouton, Mela, Pestle, Yummly,
Tasty, Kitchen Stories, Instacart, OurGroceries, Bring!, Out of Milk or Cookidoo reviews were pulled for this area.

**Order of records.** Records are ordered by strength of evidence, weighted by how severe the harm is. That is why
MP-006 (allergy safety) sits high although it is "reported", and why MP-008 sits above some validated records.

**Counts are keyword hits, not coded data.** Where a record says "about N reviews", that comes from a regular-expression
search over the review text. It is a rough signal, not a prevalence figure.

**Groups missing from this evidence:**

- Non-English speakers: none. All sources are in English and mostly from the US and UK.
- People with disabilities: only one app review (autistic user) and one dietitians' page on ADHD. No direct voices on
  vision, motor or cognitive impairment.
- Older cooks: thin. One AARP thread and one Cathe thread.
- Low-income households: mostly studies (Beatty, Bowen at second hand) plus one review. Few first-hand voices.
- People who cook for one: a handful of reviews.
- Men who plan: almost absent, apart from a few Hacker News comments.
- Non-nuclear households (flatmates, multi-generation, shared custody): absent.

## Round 2 method and limits (2026-10-21)

Desk research, done on 2026-10-21. Nobody was interviewed or watched. This round looked deeper at the fatigue,
uncertainty, tedium and monotony of planning, and at why many people do not plan far ahead. It added MP-022 to MP-029
and added lines, marked "(added 2026-10-21)", to MP-001, MP-002, MP-003, MP-007, MP-016, MP-017 and MP-021.

**New sources reached (every quote was checked word for word against the saved text):**

- **Reddit, reached this time** through the Arctic Shift archive API (`/api/posts/search`, `/api/comments/search`,
  `/api/comments/tree`, `/api/posts/ids`). Each quote links to the original reddit.com address. Subreddits used:
  r/Cooking, r/mealplanning, r/MealPrepSunday, r/EatCheapAndHealthy, r/Frugal, r/adhdwomen. The archive often timed
  out, so r/Parenting, r/ADHD, r/TwoXChromosomes, r/AskWomen, r/AskMen, r/loseit and r/budgetfood gave little or nothing
  usable. Round 1 said Reddit was blocked. That was true then, and it is no longer true.
- **Google Play, reached this time** for one app only: 1,500 Mealime reviews (2023-02 to 2026-10), pulled with the
  `google-play-scraper` Python package. The package did not find the Plan to Eat, eMeals or Samsung Food listings under
  the IDs tried. Google Play gives no link per review, so quotes cite the store page plus the review ID.
- **App Store**, a fresh pull of about 500 recent reviews each for Mealime, Plan to Eat, eMeals, Samsung Food, Paprika
  and Eat This Much.
- **Studies, full text opened and the relevant sections read:** Mauch et al. 2021 (JMIR mHealth, n=133), Fraser et
  al. 2025 (Health Promotion International, n=25), Devine et al. 2006 (Social Science & Medicine, n=69), and the
  tables of Ducrot et al. 2017. These were searched by keyword and read in part, not read end to end.
- **Studies, abstract only (PubMed):** Fraser et al. 2022, Agrawal et al. 2018, Jastran et al. 2009, Blake et al.
  2009, Mehta et al. 2020, Meiselman et al. 2000, Storfer-Isser and Musher-Eizenman 2013, Ncube et al. 2024.
- **Brand polls with a stated sample:** McCain/OnePoll (UK, n=2,000, November 2023) and Dolmio/OnePoll (UK, n=2,000,
  July 2023), read in regional newspaper copies.

**Read only at second hand or not opened, so not quoted:** Claassen, Mata and Hertwig 2025 (Appetite), read only through
a Max Planck press page. Second Measure's 2016 meal-kit retention post was opened, but it gives no method or sample, so it
counts as dated industry data, not `M`. These pages were not opened:

- the CNBC/Cardlytics meal-kit story (403)
- the AP story on "dinner fatigue" in the Washington Times (403)
- the Fernandez et al. 2020 review on Érudit (bot wall)
- Evans 2011 on food waste (paywall, seen only in search results)
- the BLS time-use release by sex (403)

**How venues are counted in this round.** The rule from round 1 stays. Reddit counts as **one** venue, however many
subreddits, just as Mumsnet and the App Store count once. Google Play is a new and separate venue. So a record with
voices from Reddit, the App Store and Google Play reaches three venues.

**The 2025–2026 Reddit evidence is contaminated. That is a finding in itself.** Many low-score r/Cooking and
r/mealplanning posts from 2025–2026 ask "does anyone else hate deciding what to cook?". They look like market research
for an app. In one such thread a commenter says the poster's account is "shilling an app"
(https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6u61vc/, 2026-02-22). Some replies read as machine-written.
In one thread the same comment appears three times. Several r/mealplanning posts are by app builders who say so
(dinnerSolved.ai, supperz, Plateful). So this round does these things:

- It counts a repeated comment once.
- It does not quote founder posts as user evidence.
- It does not use the claim that "most households eat roughly 10-15 meals on rotation". A search result showed an AP
  story (not opened) that credits the figure to Tim Masterson of Dinner Solved, an app company. An r/mealplanning
  moderator post repeats the same range. It is not independent data.

**Most Reddit quotes in this round still come from October 2026 threads with opening posts that scored 0 or 1.** Two of
them, 1x7odzg and 1x7offv, were posted the same day with the same title, which looks seeded. Many quotes also come from
1rbtvg8, whose poster was called out for promoting an app. The older, higher-score threads used are 18g9ohr (2023,
score 170), 1ms6qg1 (2025, score 157) and 1t2q8ru (2026, score 104). The replies quoted read as specific and personal,
and no record rests on Reddit alone. But the 2026 Reddit voices are weaker than their number suggests.

**Limits that still hold:** all sources are in English, and the new Reddit voices are mostly from the US. Low-income
households appear mainly through studies (Devine 2006, Agrawal 2018, Blake 2009). The one non-Western study is Ncube
2024 (South Africa). In this round, people who cook for one appear only on Reddit (round 1 had a few App Store voices
in MP-020). Older cooks appear only through a few Reddit comments.

---

## Records

### MP-001: "We had a plan, then the day changed and it fell apart"

- **Status:** validated
- **Who:** Working parents, shift workers and anyone whose evenings are not predictable.
- **When:** Late afternoon on the day: someone is late, an ingredient is missing, a club runs over, someone is too tired.
- **Need:** Keep the week's food on track when the day the meal was planned for does not happen as expected.
- **Evidence:**
    - `S` In 18 US families (61 people), plans "often go awry". Parents described last-minute substitutions, sending
      others shopping, and moving after-school schedules. Missed coordination led to "much delayed or even missed meals"
      (Wu, Miller, Chung and Kaziunas, PACM HCI CSCW 2024, n=18 families, https://arxiv.org/abs/2409.06627).
    - `S` One mother in the same study: "Sometimes I’ll find out we miss an ingredient for a dish, and I will ask my
      partner to get it on his way back since he drives by Kroger [a grocery store], but he often comes back so late that I
      had to make something else, or had to serve dinner late. I expect everything to be on time, but timing is tricky."
      (Joanne, F15, Wu et al. 2024, https://arxiv.org/abs/2409.06627)
    - `S` WRAP lists "Frequent ‘displaced meals’ - when planned meals aren’t eaten as intended" as a main driver of UK
      household food waste. In households with children, waste "is often linked to meal changes and overbuying" (WRAP
      Household Food Management Survey, fieldwork June–July 2024, n=4,740 UK adults,
      https://wrap.ngo/resources/report/understanding-household-food-waste-uk-household-food-management-survey).
    - `M` "Sometimes we put things on specific days, but that doesn't always work out. If we run out of time or didn't
      have all the ingredients, we switch around the days of the week, but we try to keep the same meals planned, just
      moving when we have them." Last-minute schedule changes were the most common reason for leaving the plan (Outset, June
      2024, n=120 US adults, AI-moderated interviews, vendor study,
      https://outset.ai/resources/blog/meal-planning-habits-us-households).
    - `V` "It should be made much easier … to reschedule a recipe to tomorrow or another night when my cooking plans
      change." (Paprika 3 review, 4 stars, 2026-06-08, review 14159864556, https://apps.apple.com/us/app/id1303222868)
    - `V` "Every weekend I write a meal plan … And then I get to this point mid week and I look at the plan and just think
      it's such a faff." (Mumsnet, 2020-09-09, https://www.mumsnet.com/talk/_chat/4018955-can-t-be-bothered-to-cook)
    - `V` "We don't plan it down to days and don't always stick to the plan." (Mumsnet, thread posts 2022–2024,
      https://www.mumsnet.com/talk/food_and_recipes/5158967-how-do-you-plan-your-weekly-meals)
    - `S` (added 2026-10-21) In 22 low-income employed mothers of 3–4-year-olds in rural New York, "Unexpected daily
      events, such as working overtime or waking up late, disrupted child feeding routines and required modifications".
      A predictable work schedule and other adults helped mothers keep their routines (Agrawal, Farrell, Wethington and
      Devine, Appetite 2018, qualitative 24-hour recalls, abstract only, https://doi.org/10.1016/j.appet.2017.08.010).
    - Against: In Outset, 70% of respondents said they kept to their plan, and people mostly moved
      meals rather than dropping them. So a plan "breaking" often means re-ordering, not failure.
- **How often / how bad:** Common in families (Wu: across many of the 18 families). WRAP ties it to measurable waste.
  It is a cause of both waste and stress.
- **Workarounds people use:** Plan meals but not days. Swap days. Keep freezer and cupboard fallbacks ("freezer
  surprise", a ready-meal night). Write the plan on a whiteboard "so it's not set in stone".
- **Where current products fail:** Paprika makes rescheduling slow (review above). Calendars that tie a recipe to a fixed
  date assume the day will happen.
- **Open questions:** How often does a planned meal move, and how often is it dropped altogether? What happens to the
  ingredients bought for a dropped meal?

### MP-002: "It's always me who has to think about dinner"

- **Status:** validated
- **Who:** Mostly women in couple households. Also the one adult who "does food" in any household.
- **When:** All week. The thinking happens before shopping, during the day and at the moment of cooking.
- **Need:** Share the thinking work of feeding a household (noticing, deciding, checking), not only the cooking.
- **Evidence:**
    - `S` The main meal preparer was a woman in 15 of 18 families, most of whom also worked full time. Women who did the
      planning and cooking "often described being both physically and emotionally exhausted" (Wu et al. 2024,
      https://arxiv.org/abs/2409.06627).
    - `S` Household work has a thinking part: anticipating needs, finding options, deciding and monitoring. Food was one
      of nine areas studied. Women did more of the anticipating and monitoring (Daminger, American Sociological Review
      2019, 70 interviews with 35 couples, read through secondary coverage, full text not opened,
      https://doi.org/10.1177/0003122419859007).
    - `V` "I have to put a list up for the week for my husband so he doesn't ask me three times a day!" (Mumsnet,
      2011-02-11, https://www.mumsnet.com/talk/food_and_recipes/1148140-Meal-planning-how-do-you-go-about-it)
    - `V` "I hear you all... it's beyond monotonous sometimes and I too wish that somebody would cook for us all rather
      than me doing it all the flipping time." (Mumsnet, 2020-09-09,
      https://www.mumsnet.com/talk/_chat/4018955-can-t-be-bothered-to-cook)
    - `V` "My husband doesn't cook at all, and since I'm a stay at home mom, all the cooking falls on me." (Hellobee,
      2015-07-08, https://boards.hellobee.com/topic/picky-husband-what-would-you-do)
    - `V` "I have been planning/preparing meals for 53 years!" (Cathe forum, 2025-04-11,
      https://cathe.com/forum/goto/post?id=2571545)
    - `V` "It works for us as I hate having to think of all the meals and either of us can get on and cook." (Mumsnet,
      2022–2024, https://www.mumsnet.com/talk/food_and_recipes/5158967-how-do-you-plan-your-weekly-meals)
    - `S` (added 2026-10-21) In 16 Australian families who use meal kits, "women, as the primary carers responsible for
      family meals, primarily reported the role that meal kits played in reducing their mental load through reduced
      food-related decision making" (Fraser, Love, Campbell, Ball and Opie, Appetite 2022, interviews, abstract only,
      https://doi.org/10.1016/j.appet.2021.105816).
    - `S` (added 2026-10-21) "Australian women shoulder the bulk of household duties including family food provisioning,
      despite increasing participation in the workforce." Time scarcity "was common and associated with stress in
      relation to family food provisioning" (Mehta, Booth, Coveney and Strazdins, Health Promotion International 2020,
      n=22 employed mothers, abstract only, https://doi.org/10.1093/heapro/daz061).
    - `S` (added 2026-10-21) In 69 low- and moderate-income employed US parents, mothers judged themselves on balancing
      work and family "while striving to provide healthy meals". Fathers judged themselves on schedule stability and
      taking part in family meals, "while meeting expectations to contribute to food preparation" (Blake et al.,
      Appetite 2009, abstract only, https://doi.org/10.1016/j.appet.2009.03.011).
    - `S` (added 2026-10-21) A working mother asked for a plan the whole family could reach, so "he wouldn’t be
      constantly asking me every day, ‘What’s for tea tonight?’" (Brianna, working 35+ hours a week, Mauch et al., JMIR
      mHealth and uHealth 2021, n=133 parents, 97.7% mothers, https://doi.org/10.2196/22990).
    - `V` (added 2026-10-21) "Everyday it’s such a chore! My husband calls around noon sometimes and, as part of the
      conversation, asks what I’m making for dinner. I don’t know, you think of something for once!😫" (r/Cooking,
      2026-02-23, https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6xh1y1/)
    - `V` (added 2026-10-21) Listing a household's chores: "The "invisible" ones (remembering, planning, noticing we're
      out of something) are the ones that surprised me most." (r/adhdwomen, 2026-10-13,
      https://www.reddit.com/r/adhdwomen/comments/1x51pie/comment/pgikplm/)
    - `V` (added 2026-10-21) Against the single-holder pattern: "My family all have a link to the account. … Then everyone
      knows what’s for dinner so whoever is available initiates and no last min decisions or shopping necessary." (Plan
      to Eat review, 5 stars, 2026-08-02, review 14379856135, https://apps.apple.com/us/app/id1215348056)
    - Against: Daminger (at second hand) found decision-making itself was split about evenly. The
      imbalance is in anticipating and monitoring. Some couples do share the planning (Mumsnet poster above).
- **How often / how bad:** Strong and consistent across study and forum evidence. Linked to exhaustion and guilt.
- **Workarounds people use:** A written plan on the fridge so others stop asking. Each family member picks one night.
  Partners each choose three or four meals for the week.
- **Where current products fail:** Mealime has no family sharing on its subscription: "paying 4+ subscriptions to do so is
  frankly silly" (Mealime review, 3 stars, 2024-08-31, review 11673663015, https://apps.apple.com/us/app/id1079999103).
  A single-account plan keeps the load on the account holder.
- **Open questions:** Does making the plan visible to others actually move any of the thinking work, or only stop the
  questions?

### MP-003: "I've gone blank. I don't know what to make."

- **Status:** validated
- **Who:** Anyone who cooks most nights, especially parents. Also beginners who know only a few dishes.
- **When:** Before the shop, standing in the shop, or at 5 pm.
- **Need:** Come up with a good-enough answer to "what's for dinner" without spending a lot of thought each time.
- **Evidence:**
    - `V` "I've completely gone blank on what to cook recently." (Mumsnet, thread 3080756, date not shown on the page,
      https://www.mumsnet.com/talk/am_i_being_unreasonable/3080756-To-not-have-a-clue-what-to-make-for-tea)
    - `V` "We are not picky I just cannot think of anything to cook even if I'm standing in the middle of a shop. Awful."
      (Mumsnet, 2019-06-11, https://www.mumsnet.com/talk/_chat/3610051-meal-planning)
    - `V` "What's For Dinner? Sometimes that phrase hits me with dread. UUgghh! Just too easy to get into a rut." (AARP
      Community, 2021-05-12, https://community.aarp.org/our-front-porch-35/what-s-for-dinner-249)
    - `V` "I like to cook. I totally hate deciding what's for dinner." (AARP Community, 2021-05,
      https://community.aarp.org/our-front-porch-35/what-s-for-dinner-249)
    - `V` "I didn’t know a lot of recipes, so every time I cooked I’d shuffle between like 3 things." (Mealime review, 5
      stars, 2024-09-18, review 11739773114, https://apps.apple.com/us/app/id1079999103)
    - `M` "I don't have to really think about it in the moment, and it frees up space in my brain for other things." Saving
      time and mental effort were the top reasons people planned (Outset 2024, n=120,
      https://outset.ai/resources/blog/meal-planning-habits-us-households).
    - `X` NPR (2016) reports a Food Genius estimate that up to 80% of Americans do not know what they will eat for dinner
      by 4 pm. No sample is given. Treat as context only (https://www.npr.org/sections/thesalt/2016/05/03/476488223/what-s-for-dinner-the-options-for-a-fast-answer-multiply).
    - `S` (added 2026-10-21) In NutriNet-Santé, 38.97% of non-planners agreed or strongly agreed that "Having to think
      about what to cook is a constraint", against 27.95% of planners. Most non-planners decided "During the day"
      (41.72%) or "Just before meal" (30.48%) (Ducrot et al. 2017, n=40,554, Table 2,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC5288891/). So about six in ten non-planners do not call it a constraint.
    - `M` (added 2026-10-21) "Almost half (47 per cent) of those aged 35 and under don’t usually know what they’re having
      for dinner until they look at what they’ve got in the cupboards or fridge after work" (McCain/OnePoll, UK, n=2,000,
      reported 2023-11-22, brand poll, https://www.thestar.co.uk/read-this/midweek-meals-have-turned-boring-and-repetitive-for-many-adults-4419239).
    - `V` (added 2026-10-21) "it really helps answer the dreaded question “what’s for dinner?” without the paralyzing
      number of choices you get just browsing a recipe site." (eMeals review, 3 stars, 2026-04-14, review 13958792809,
      https://apps.apple.com/us/app/id575756462)
    - `V` (added 2026-10-21) "I have recipe books, I have a digital recipe keeper, I have subscriptions to online sites.
      It's too much to look at sometimes." (r/Cooking, 2026-10-16,
      https://www.reddit.com/r/Cooking/comments/1x7offv/comment/ph6bzgx/)
    - `V` (added 2026-10-21) "If you're stuck trying to figure out what to make for dinner every night, give this app a
      try!" (Mealime, Google Play, 5 stars, 2025-06-05, review b9ced40c-07e1-4170-ae2b-64898b53a9c2,
      https://play.google.com/store/apps/details?id=com.mealime)
    - Against: "Blank" posts are self-selected: people post when stuck. The AARP poster enjoys cooking
      and dislikes only the deciding, so the pain is the decision, not the cooking.
- **How often / how bad:** Frequent in what was read. It opens several threads in each forum reached, but frequency was
  not measured.
- **Workarounds people use:** Theme nights (pasta, fish, rice). Picking by carbohydrate first. Lolly sticks drawn at
  random. A spreadsheet of 35 to 40 known meals. Meal kits, chosen once a month.
- **Where current products fail:** People use apps to pull ideas but still report blanking. Many low-star reviews are
  about the idea pool running dry (see MP-007).
- **Open questions:** Is the blank caused by too few known meals, too many options, or tiredness at the moment of
  choosing? The evidence does not separate these.

### MP-004: "Everyone at the table wants something different"

- **Status:** validated
- **Who:** Parents of young children, couples where one partner is picky, mixed diets (vegetarian and meat eaters).
- **When:** While choosing meals, and again at the table when food is refused.
- **Need:** Choose meals that the whole household will eat, without cooking a separate meal for each person.
- **Evidence:**
    - `S` "Three out of five parents say they’re willing to play personal chef and cobble up a separate meal for a child
      who balks at the family dinner". Parents' biggest mealtime challenge is getting a healthy diet into a picky eater
      (Mott Poll on Children's Health, reported by HealthDay 2024-04-22, preschool and elementary children, sample stated
      elsewhere as about 1,000 parents, not opened,
      https://www.healthday.com/health-news/child-health/many-parents-cook-special-meals-for-little-picky-eaters-poll).
    - `S` Picky eating in children is reported at roughly 6% to 50%, the wide range coming from inconsistent definitions
      (Taylor et al., Appetite 2015, read through secondary citation, https://doi.org/10.1016/j.appet.2015.07.026).
    - `V` "He says he doesn't like chicken, doesn't like pasta, doesn't like sweet things and doesn't like a lot of
      vegetables. … He also doesn't like leftovers, so he would prefer I make something new each night." (Hellobee,
      2015-07-08, https://boards.hellobee.com/topic/picky-husband-what-would-you-do)
    - `V` "I cook separate meals on a night as me and DS are veggie and DH and DD are meat eaters." (Mumsnet, 2019-06-11,
      https://www.mumsnet.com/talk/_chat/3610051-meal-planning)
    - `V` "Tonight though I am ashamed to say that I am making 3 different meals." (Mumsnet, thread 3080756,
      https://www.mumsnet.com/talk/am_i_being_unreasonable/3080756-To-not-have-a-clue-what-to-make-for-tea)
    - `V` "The problem with meal planning is I'm a terribly picky eater and there are few things she doesn't like." (Hacker
      News, 2015-01-09, https://news.ycombinator.com/item?id=8860357)
    - `V` "I was looking for something simple, easy and kid friendly without having to cook two different meals every
      night." (Mealime review, 3 stars, 2024-04-16, review 11166379934, https://apps.apple.com/us/app/id1079999103)
    - `M` A brand survey reports 45% of UK parents cook more than one meal a night for fussy eaters (HelloFresh 2019, n=2,000
      parents, commercial, read at second hand, https://blog.hellofresh.co.uk/cooking-for-fussy-eaters/).
    - Against: Some parents report one base meal with build-your-own toppings works well (tacos, jacket
      potatoes, rice bowls in the Mumsnet thread). One Mealime reviewer found the plan worked for a couple with different
      spice tastes by leaving items off one portion (review 12442859282, 2025-03-20).
- **How often / how bad:** Common and emotionally loaded. In Hellobee it pushes the cook to stop cooking ("I'm at the
  point where I don't feel like cooking at all").
- **Workarounds people use:** A shortlist of "safe" meals that everyone eats. One thing on each plate the child likes.
  Build-your-own meals. Hiding blended vegetables. Letting each person pick one night.
- **Where current products fail:** Planning apps hold one set of preferences per account. Samsung Food asks for
  preferences and then, per one user, "ignores all of them" (see MP-006).
- **Open questions:** How do people weigh one person's veto against everyone else's wishes? No source measured how many
  meals a week are cooked twice.

### MP-005: "I'm too tired by the evening to cook what I planned"

- **Status:** validated
- **Who:** Working adults, parents of young children, people with health problems.
- **When:** The end of the workday, when the planned meal needs effort.
- **Need:** Still eat reasonably well on the nights when energy is gone, without guilt.
- **Evidence:**
    - `S` "Generally, I’m okay with the role. It needs to get done. But there are times when I work all day and get home
      and I don’t want to cook. … It just makes me feel bad that we’re spending more on unhealthy food like burgers."
      (Allison, F17, Wu et al. 2024, https://arxiv.org/abs/2409.06627)
    - `V` "And in about 20 minutes the kids are going to start asking me what's for tea, and I just can't be arsed to cook
      anything." (Mumsnet, 2020-09-09, https://www.mumsnet.com/talk/_chat/4018955-can-t-be-bothered-to-cook)
    - `V` "Got a toddler and weaning baby so I’ve already done picnic and breakfast and all the shit tonne of mess they
      entail and I just don’t have the energy." (same thread, 2020-09-09)
    - `V` "There are days when a bag of chips and a soda seems like the perfect meal -ha!" (Cathe forum, 2025-04-11,
      https://cathe.com/forum/goto/post?id=2571545)
    - `V` "I ended up eating out way too much because I didn’t have the time and energy to cook." (Mealime review, 5 stars,
      2024-09-18, review 11739773114, https://apps.apple.com/us/app/id1079999103)
    - `V` An ICU nurse picks quick recipes on nights she gets home at 8 pm and saves longer ones for days off (Mealime
      review, 5 stars, 2025-02-21, review 12338332645, https://apps.apple.com/us/app/id1079999103).
    - `M` A brand survey reports 49% of US parents say dinner is their most stressful meal (Armour Mealtime Pressure Index,
      January 2026, n=2,000 parents, commercial, read at second hand,
      https://www.nationalhogfarmer.com/market-news/49-of-parents-say-dinner-is-most-stressful-meal).
    - Against: A planned week can include low-effort nights by design (scrambled eggs, a ready meal),
      which several posters say removes the problem.
- **How often / how bad:** Frequent. Leads to takeaway spending and guilt (Wu, Mumsnet, Mealime review).
- **Workarounds people use:** A "ready meal evening and a scrambled eggs on toast evening in the middle of the week"
  (Mumsnet). Batch cooking at weekends. Keeping frozen fallbacks. Matching the recipe to the day's energy.
- **Where current products fail:** "the recipe time takes longer than listed (typical food blogger lie)" (Mealime review,
  2 stars, 2024-08-12, review 11603440228). If a stated time is wrong, the user cannot match the meal to the evening.
- **Open questions:** How far ahead can people predict their own energy on a given night?

### MP-006: "I told it what I can't eat, and it still gave me those foods"

- **Status:** reported (all voices from one venue, the App Store, across four apps)
- **Who:** People with allergies, coeliac disease, eosinophilic oesophagitis (EoE), religious or recovery-related limits.
- **When:** Setting up a plan, and checking each suggested meal.
- **Need:** Trust that a planned meal is safe for everyone who will eat it, without re-checking every ingredient.
- **Evidence:**
    - `V` "It asks for all these preferences but ignores all of them. I am gluten free … and every single day it gives me
      suggestions for recipes that have gluten. I also preferences not to have alcohol and it constantly gives me drink
      recipes. That’s even more problematic because there is someone close to us who is alcoholic" (Samsung Food review, 1
      star, 2022-04-30, review 8622981231, https://apps.apple.com/us/app/id1133637674)
    - `V` "Clicked as such when prompted on the app, and went through to look at the recommended meals and at least four of
      them had my allergens." (Eat This Much review, 1 star, 2019-08-19, review 4642161935,
      https://apps.apple.com/us/app/id981637806)
    - `V` "I have a cilantro allergy and could not add that info." (Mealime review, 3 stars, 2025-05-01, review
      12607020463, https://apps.apple.com/us/app/id1079999103)
    - `V` "It literally gave me a pop up stating they aren't able to find recipes for me due to my eating preferences and to
      consider broadening my eating preferences. Ouch. I wish they were just preferences..." (Mealime review, 3 stars,
      2024-08-16, review 11618740284, https://apps.apple.com/us/app/id1079999103)
    - `V` "I’ve tried blocking foods, adding them to an exclusion list, adding the foods I do like to a favorites list to no
      avail." (Eat This Much review, 2 stars, 2024-04-12, review 11148926930, https://apps.apple.com/us/app/id981637806)
    - `V` A coeliac user found no gluten option at all despite the store listing promising gluten-free plans (Mealime review,
      1 star, 2024-10-15, review 11837488669).
    - Against: Other Mealime reviewers praise its allergy filters (review 12373705807, 2025-03-02).
- **How often / how bad:** About 37 reviews of three stars or fewer mention restrictions, allergies or exclusions. Severity is high: the
  EoE reviewer notes she "could have made and ate any of those".
- **Workarounds people use:** Checking every recipe by hand. Abandoning the app.
- **Where current products fail:** Samsung Food, Eat This Much and Mealime, with the evidence above. Two problems are
  mixed together: the filter is ignored, and the filter has no option for the person's actual restriction.
- **Open questions:** Forum voices on this were not found because Reddit was blocked. How do mixed households handle one
  member's allergy across a whole week?

### MP-007: "We keep eating the same few meals" (and "the suggestions all look the same")

- **Status:** validated
- **Who:** Long-term planners, people with a small set of known dishes, subscribers to a recipe catalogue.
- **When:** A few weeks into any routine.
- **Need:** Get enough variety that nobody is bored, while keeping the meals the household knows will work.
- **Evidence:**
    - `S` Planners had higher food variety scores than non-planners (OR 1.25, top vs bottom quartile) (Ducrot et al.,
      IJBNPA 2017, n=40,554 French adults, https://pmc.ncbi.nlm.nih.gov/articles/PMC5288891/). This is an association, not
      proof that planning causes variety.
    - `V` "I’m getting the same recipes 4-6 times a week, sometimes even the same exact thing for lunch and dinner on the
      same day" (Eat This Much review, 3 stars, 2024-06-10, review 11366174789, https://apps.apple.com/us/app/id981637806)
    - `V` "it feels like we’re eating only a slight variation of what we ate the night before, so we’re going to cancel."
      (Mealime review, 2 stars, 2024-08-12, review 11603440228, https://apps.apple.com/us/app/id1079999103)
    - `V` "I finally gave up and stopped paying for the pro version because what’s the point if they aren’t adding more
      recipes?" (Mealime review, 1 star, 2025-02-23, review 12346656918, https://apps.apple.com/us/app/id1079999103)
    - `V` "he gets bored of eating the same thing over and over, so he only wants me to make the same dish no more than
      twice a month." (Hellobee, 2015-07-08, https://boards.hellobee.com/topic/picky-husband-what-would-you-do)
    - `V` "I feel like I am eating the same meals over and over" (Cathe forum, 2025-04,
      https://cathe.com/forum/goto/post?id=2571545)
    - `V` "I must have a good 35-40 on there so none one gets bored (me cooking or them eating)." (Mumsnet, 2011-02-11,
      https://www.mumsnet.com/talk/food_and_recipes/1148140-Meal-planning-how-do-you-go-about-it)
    - `S` (added 2026-10-21) When the same midday meal was served for 5 days, "Acceptance and intake of the meal declined
      in the monotony week and did not decline in the variety week. Acceptance levels decreased but remained high". "The
      potato product was resistant to monotony", and "Green beans were sensitive to monotony" (Meiselman, deGraaf and
      Lesher, Physiology & Behavior 2000, sample size not in the abstract, https://doi.org/10.1016/s0031-9384(00)00268-7).
      So boredom can set in with food people like, and staples bore people more slowly.
    - `M` (added 2026-10-21) "A poll of 2,000 adults found 53 per cent are 'stuck in a rut' when it comes to cooking at
      mealtimes". "48 per cent revealed they're 'bored' of having the same dinners day after day". Barriers to more
      variety were "lack of inspiration (41 per cent), time (34 per cent), and skills (21 per cent)" (Dolmio/OnePoll, UK,
      reported 2023-07-04, brand poll for a pasta-sauce maker,
      https://www.scotsman.com/read-this/more-than-half-of-adults-admit-theyre-stuck-in-a-mealtime-rut-with-the-same-meals-on-loop-4202971).
    - `M` (added 2026-10-21) People eat the same meals because "it’s convenient (56 per cent), they’re quick to make (41
      per cent) and it has become habit (38 per cent)" (McCain/OnePoll, UK, n=2,000, reported 2023-11-22, brand poll,
      https://www.thestar.co.uk/read-this/midweek-meals-have-turned-boring-and-repetitive-for-many-adults-4419239).
    - `V` (added 2026-10-21) "Sometimes I start to believe that I've found the perfect combo of 6-8 dishes to shuffle
      through, but then I still get bored and need to bring in something new." (r/Cooking, 2025-08-16,
      https://www.reddit.com/r/Cooking/comments/1ms6qg1/comment/n92fl7o/)
    - `V` (added 2026-10-21) "When we got married 31+ years ago, we agreed that I would cook and he would do dishes … After
      the first year, I got pretty tired of making similar things over and over." (r/Cooking, 2025-08-16,
      https://www.reddit.com/r/Cooking/comments/1ms6qg1/comment/n92rlqn/)
    - `V` (added 2026-10-21) "Over the past 2 years I really lost my love of cooking. Always making the same recipes,
      struggling to find something new" (Mealime, Google Play, 5 stars, 2025-08-04, review
      b6340b87-3e85-402b-bd2c-1d89ece10a69, https://play.google.com/store/apps/details?id=com.mealime)
    - `V` (added 2026-10-21) "We have a hard time coming up with new ideas and often default back to our safe foods and get
      stuck in a rut." (Mealime, Google Play, 5 stars, 2024-06-20, review 23f3889b-b2a6-4afc-99ac-783f8fcb5f46, a
      neurodivergent household)
    - Against (added 2026-10-21): people differ widely in how much repetition they can stand. "I get bored INCREDIBLY
      easy. I don't like to do the same meal twice in a month!" (n92g0by) sits in the same thread as "No, I could cook my
      fav food at least 3 times a week!" (n92fe83), "I literally eat the same meals almost every day." (n92k22f) and
      "Various neurodivergences cause me to do the opposite. I lock in and eat the same thing for weeks." (n92gofw)
      (r/Cooking, 2025-08-16, https://www.reddit.com/r/Cooking/comments/1ms6qg1/). A cook who shops the offers says "I
      cook based on what is on sale, so that keeps the menu always different." (n92f8d6, same thread)
    - Against: Repetition is also a deliberate coping strategy. "We usually have like a set of recipes
      that I know my family will eat so I tend to kind of rotate through those." (Outset 2024, `M`). A Plan to Eat user on
      Mumsnet repeats a four-week menu and changes it only "after a few months when bored". So the need is the right amount
      of variety, not maximum novelty.
- **How often / how bad:** About 47 reviews of three stars or fewer mention repetition or lack of new recipes. Stale content is a direct
  reason people cancel (Mealime, Eat This Much).
- **Workarounds people use:** A master list of known meals. A four- or five-week rotation. "One new recipe a week".
- **Where current products fail:** Eat This Much repeats meals even with variety settings on. Mealime subscribers report
  months with no new recipes (several reviews, Feb–Apr 2025).
- **Open questions:** How many distinct meals does a household need to feel it has variety? No source measured it.

### MP-008: "The plan it gave me isn't how real people eat"

- **Status:** reported (App Store only)
- **Who:** People using generated plans for weight loss or macro targets, families.
- **When:** Reading a generated week for the first time.
- **Need:** Get a plan made of meals that look like real meals the person would choose to eat.
- **Evidence:**
    - `V` "one day suggested I eat three apples for breakfast and a bowl of refried beans for dinner. … These are clearly
      meals planned by robots without tastebuds." (Eat This Much review, 2 stars, 2019-01-20, review 3674142034,
      https://apps.apple.com/us/app/id981637806)
    - `V` "the recipes are not quite how real people eat." (Eat This Much review, 3 stars, 2019-07-31, review 4547018288)
    - `V` "the dinner options aren’t really dinner at all, and nothing I would feed my family." (Eat This Much review, 2
      stars, 2019-10-12, review 4933184417)
    - `V` "5 of 8 recipes in the 30 minute menu are drinks. 4 of 8 recipes in the kid friendly menu are dessert." (eMeals
      review, 2 stars, 2026-01-01, review 13582971779, https://apps.apple.com/us/app/id575756462)
    - `V` "they will throw in a side that doesn’t go with the main dish at all" (eMeals review, 2 stars, 2025-11-21, review 13426270787)
    - Against: Most Eat This Much quotes are from 2019. The product may have improved since.
- **How often / how bad:** Unknown frequency. When it happens, people stop trusting the whole plan.
- **Workarounds people use:** Swiping through and replacing items by hand, building each meal themselves.
- **Where current products fail:** Eat This Much and eMeals, as above.
- **Open questions:** Does this matter mainly to diet-goal planners, or to families as well?

### MP-009: "I bought it for a meal, then it went off before I used it"

- **Status:** validated
- **Who:** Everyone who shops for a plan, especially people cooking for one or two.
- **When:** Midweek, when a planned meal is skipped or an ingredient was bought for only one recipe.
- **Need:** Use up what was bought before it spoils, including half-used ingredients.
- **Evidence:**
    - `S` "Struggling to judge and buy the right amount" is a main driver of UK household food waste (WRAP 2024, n=4,740,
      https://wrap.ngo/resources/report/understanding-household-food-waste-uk-household-food-management-survey).
    - `V` "I have ALWAYS struggled to plan ahead for meals, compiling a list, and then remembering what ingredients I bought
      for each meal and using them before they went bad." (Mealime review, 5 stars, 2025-02-21, review 12338332645,
      https://apps.apple.com/us/app/id1079999103)
    - `V` "I’d have tons of leftover ingredients that would always end up going bad and thrown away." (Mealime review, 5
      stars, 2024-09-18, review 11739773114)
    - `V` "I no longer have bunches of parsley turning to green soup because I needed a few springs for some recipe" (AARP
      Community, 2021-05, https://community.aarp.org/our-front-porch-35/what-s-for-dinner-249)
    - `V` "I try to find ingredients that will be used across a few different meals." (Mumsnet, 2022–2024,
      https://www.mumsnet.com/talk/food_and_recipes/5158967-how-do-you-plan-your-weekly-meals)
    - `V` "I’ll serve with a green salad made with lettuce left from the tuna burgers on Monday." (Mumsnet, 2019-06-11,
      https://www.mumsnet.com/talk/_chat/3610051-meal-planning)
    - Against: One Norwegian student thesis found planning did not predict less waste (cited at second
      hand, low weight). WRAP shows waste comes from plan changes, not only from a lack of planning (see MP-001).
- **How often / how bad:** Measurable at national scale (WRAP). Overlaps with `groceryLists.md` (buying the right amount).
- **Workarounds people use:** Choosing recipes that share ingredients. Checking the fridge and freezer before planning.
  Meal kits for exact portions.
- **Where current products fail:** "whenever I search for recipes with my ingredient list, it doesn’t put the recipes
  first that actually use up your ingredients!!" (Samsung Food review, 3 stars, 2026-02-01, review 13703036602,
  https://apps.apple.com/us/app/id1133637674). eMeals' on-hand search "gave me recipes that didn’t even include the items
  that I had on hand!" (eMeals review, 1 star, 2026-02-12, review 13743136613). Mealime's "food waste rating" is
  praised (reviews 12306608632, 11915589795).
- **Open questions:** How much of the waste is whole unused items versus half-used ones?

### MP-010: "What's in the freezer, and how old are these leftovers?"

- **Status:** reported (App Store and Mumsnet only, two venues)
- **Who:** Batch cooks, families who cook double, people who take leftovers to work.
- **When:** Planning the week, and opening the freezer or fridge.
- **Need:** Know what cooked food is already on hand, how much, and how old it is, so it gets eaten in time.
- **Evidence:**
    - `V` "I’ve been searching for one to help me with meal prep and planning in a way that lets me know how many meals I
      have left out of the batch I froze." (Plan to Eat review, 5 stars, 2026-01-13, review 13629603488,
      https://apps.apple.com/us/app/id1215348056)
    - `V` "I struggle with dating leftovers and then can’t remember when I made a meal." (Mealime review, 4 stars,
      2025-02-13, review 12306608632, https://apps.apple.com/us/app/id1079999103)
    - `V` "Check the fridge and freezer first (I’m so sad I have a spreadsheet for the latter)." (Mumsnet, 2022–2024,
      https://www.mumsnet.com/talk/food_and_recipes/5158967-how-do-you-plan-your-weekly-meals)
    - `V` "Just found some forgotten sausage rolls at the bottom of the freezer." (Mumsnet, 2020-09-09,
      https://www.mumsnet.com/talk/_chat/4018955-can-t-be-bothered-to-cook)
    - Against: Not everyone wants leftovers: "He also doesn't like leftovers, so he would prefer I make something new
      each night." (Hellobee, 2015-07-08, https://boards.hellobee.com/topic/picky-husband-what-would-you-do). Some people cook two days of the same meal on
      purpose: "we have the same lunch and dinner for 2 consecutive days, so I cook Monday/Wednesday/Friday only" (Mumsnet).
- **How often / how bad:** Unknown frequency. Batch cooking is a very common strategy in the forums, so the tracking
  problem is likely widespread.
- **Workarounds people use:** Freezer spreadsheets. Labels. Planning "leftover" nights.
- **Where current products fail:** Most planners track recipes, not cooked food on hand. Plan to Eat is praised as an
  exception.
- **Open questions:** How long do people keep leftovers before they stop trusting them?

### MP-011: "We need meals that fit our food budget"

- **Status:** validated
- **Who:** Households on a budget, rural shoppers, couples with separate food spending.
- **When:** Choosing meals before the shop, at the till.
- **Need:** Plan a week of meals that stays within what the household can spend.
- **Evidence:**
    - `M` Many Outset respondents said planning helped them stick to a budget (Outset 2024, n=120).
    - `M` About 1 in 3 US adults plan most or all of the week's meals before shopping. Higher-income people, urban dwellers,
      millennials and households with children plan most (at least 40% of each group) (Morning Consult, weekly surveys in
      February 2022, sample size not shown on the page,
      https://intel.morningconsult.com/mc-content/analysis/meal-planners-an-attractive-audience-for-food-beverage-brands).
    - `V` "for someone who is on a tight budget and live in a rural or on the edge of a suburban area, this collection of
      recipes is not for you, or for me." (Mealime review, 2 stars, 2024-05-14, review 11267377641,
      https://apps.apple.com/us/app/id1079999103)
    - `V` "We used to have a roast dinner most Sundays but the cost has become prohibitive so maybe every 4-6 weeks now."
      (Mumsnet, 2022–2024, https://www.mumsnet.com/talk/food_and_recipes/5158967-how-do-you-plan-your-weekly-meals)
    - `V` "My meal planners are normally for a month as I get 15% off for food where I work but only once a month for pay
      day." (same Mumsnet thread)
    - `V` "My wife and I are terrible about planning meals and often end up going out to dinner which wrecks havoc on our
      checkbook." (Hacker News, 2015-01-09, https://news.ycombinator.com/item?id=8860357)
    - `V` "we would set a budget for our groceries … but we kept overspending. This would happen because we planned our own
      meals but followed the same budget without any coordination." (Hacker News, 2025-04-06, app builder, so biased toward
      the problem, https://news.ycombinator.com/item?id=43601074)
    - Against: Morning Consult suggests richer households plan more, not poorer ones. Budget may be a
      reason people say they plan rather than the main barrier for those who do not.
- **How often / how bad:** Common motive. Severity depends on income. The evidence from low-income households is thin.
- **Workarounds people use:** Planning around pay day and discounts. Buying what is on offer and planning from it.
  Cutting expensive meals.
- **Where current products fail:** Catalogues assume "healthy" fresh ingredients and nearby shops (Mealime review above).
  No app reviewed showed a plan's cost to the user (not verified across all apps).
- **Open questions:** What do low-income planners actually do week to week? Not reached in this research.

### MP-012: "Cooking cheaply takes time I don't have"

- **Status:** validated
- **Who:** Low-income households, single working parents, people on food assistance.
- **When:** Every week, the cheapest plans assume the most cooking from scratch.
- **Need:** Feed the household on little money without needing more hours than the person has.
- **Evidence:**
    - `S` Food insecurity and SNAP participation in single households were linked to 20% more time in meal preparation. In
      married households SNAP was linked to 32% less preparation time. The authors conclude food help "may need to consider
      the time constraints many low-income households face" (Beatty, Nanney and Tuttle, Public Health Nutrition 2014,
      n=10,247 US households, ATUS + CPS 2004–2010, https://doi.org/10.1017/S1368980012005599).
    - `S` Davis and You (J Nutr 2010) argue the USDA Thrifty Food Plan "is not thrifty when labor cost is considered"
      (title verified, abstract and figures not opened, PMID 20181790).
    - `S` Bowen, Brenton and Elliott (Pressure Cooker, OUP 2019) interviewed and observed mothers in North Carolina, many
      low-income, and argue that home-cooking advice ignores limited time, money and support (read through publisher and
      review summaries, sample size differs between summaries).
    - `S` "The responsibilities of meal planning and preparation are particularly heavy when families lack access to the
      resources and support they need to routinely put food on the table." (Wu et al. 2024,
      https://arxiv.org/abs/2409.06627)
    - Against: No first-hand low-income voices were reached for this record. It rests on studies.
- **How often / how bad:** Structural rather than occasional.
- **Workarounds people use:** Unknown from this research.
- **Where current products fail:** Not measured here.
- **Open questions:** What does a week of planning look like for a single parent on SNAP? This needs primary research.

### MP-013: "Planning around nutrition goals turns every meal into maths"

- **Status:** validated
- **Who:** People losing weight, tracking macros, managing a condition, or "eating clean", older adults managing sodium.
- **When:** Choosing meals for the week and checking them against targets.
- **Need:** Eat in a way that meets a health goal without the planning becoming a constant chore.
- **Evidence:**
    - `S` Meal planners had better adherence to French nutrition guidelines (OR 1.13) and, in women, lower odds of obesity
      (OR 0.79). Cross-sectional. No cause can be inferred (Ducrot et al. 2017, n=40,554,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC5288891/).
    - `S` Parents in the same family disagreed about what "healthy" means and how strict to be. "I make it a huge point to
      make sure we never have a meal without vegetables." (Jane, F2, Wu et al. 2024, https://arxiv.org/abs/2409.06627)
    - `V` "My husband and I eat really clean so I feel like I am endless doing math -- calculating grams of protein, fiber,
      sugar, salt, etc." (Cathe forum, 2025-04-11, https://cathe.com/forum/goto/post?id=2571545)
    - `V` "I’ve been counting calories, or points, or something, daily, for 50-years … I get sick of it, and tell myself
      I’m done with it, but then I see my clothes getting tighter" (Cathe forum, 2025)
    - `V` "I stepped away from calorie and micro/macro-nutrient tracking. I found I fall into self-judgment too easily
      doing that" (Cathe forum, 2025)
    - `V` "I love the idea of this app because meal planning within specific calorie constraints is HARD." (Eat This Much
      review, 2 stars, 2019-01-20, review 3674142034, https://apps.apple.com/us/app/id981637806)
    - `V` "I plan meals (loosely) and try and hit a target of 12-15 different fruit and veg a day or at least 10."
      (Mumsnet, 2020-09-09, https://www.mumsnet.com/talk/_chat/4018955-can-t-be-bothered-to-cook)
    - Against: Tracking can harm some people (Cathe: self-judgment, eating when not hungry). A need to
      meet goals is not the same as a need to count.
- **How often / how bad:** Common among diet-goal planners. The Cathe thread shows decades-long fatigue.
- **Workarounds people use:** Same breakfast and lunch every day, varying only dinner. Rules of thumb (vegetables at every
  meal). Stopping tracking.
- **Where current products fail:** "manually entering the nutrition information into the FitBit app is super tedious"
  (Mealime review, 3 stars, 2024-11-05, review 11915589795). Eat This Much ignores restrictions while hitting targets
  (MP-006, MP-008).
- **Open questions:** Where is the line between helpful nutrition information and harmful tracking? Not answered here.

### MP-014: "Who's home tonight, and does everyone know the plan?"

- **Status:** validated
- **Who:** Households with several adults, teenagers, after-school activities or shift work.
- **When:** Planning the week, the afternoon of each day.
- **Need:** Fit meals around who will be home and when, and keep everyone who cooks or shops aware of the plan.
- **Evidence:**
    - `S` "Time is 100% a priority for me. I need to make sure [Green family’s two young children] are done with dinner
      and drop them off for the soccer club at 6 p.m. So I have exactly one hour to get everything ready." (Alice, F3, Wu
      et al. 2024, https://arxiv.org/abs/2409.06627)
    - `V` "I check the calendar for others coming for dinner/tea etc, then I plan a week's meals … taking into account what
      days have after school activities and making make ahead stuff or quick pasta stuff on those days." (Mumsnet,
      2011-02-11, https://www.mumsnet.com/talk/food_and_recipes/1148140-Meal-planning-how-do-you-go-about-it)
    - `V` "I work shifts and we have different evening activities, so I also consider how much time there will be for
      cooking" (same Mumsnet thread)
    - `V` "Id like to write a note for each meal saying “going to a diner” “leftover spaghetti” “Todd brings dinner”"
      (Samsung Food review, 4 stars, 2024-04-09, review 11140581427, https://apps.apple.com/us/app/id1133637674)
    - `V` "If there was one thing I wish they would add, it would be a way to sync accounts so our meal plans are the same
      and we’d have the same shopping list." (Mealime review, 5 stars, 2024-09-18, review 11739773114)
    - `V` A Hacker News user runs a "shared calendar / meal plan / todo list info board" on the TV for the family
      (2026-10-09, https://news.ycombinator.com/item?id=50024206).
    - Against: Small or single-person households do not have this problem.
- **How often / how bad:** Common in families with children (Wu, Mumsnet).
- **Workarounds people use:** Fridge calendars, whiteboards, shared notes, wall displays.
- **Where current products fail:** Mealime has no shared account (reviews 11673663015, 11739773114). Samsung Food limits
  meal notes to 80 characters (review 11140581427). Shared-list sync bugs in AnyList and Samsung Food belong in
  `groceryLists.md`.
- **Open questions:** Who in the household updates the plan when it changes?

### MP-015: "Nobody helps decide, but everyone complains about the result"

- **Status:** validated
- **Who:** The main planner in a couple or family.
- **When:** Asking others what they want before the shop, serving the meal.
- **Need:** Get others' input at the time of planning, so the plan reflects what they will eat.
- **Evidence:**
    - `S` Men's involvement tended to come at the decision stage, after women had anticipated the need and researched
      options (Daminger 2019, read through secondary coverage, https://doi.org/10.1177/0003122419859007).
    - `V` "when I asked dh, on Saturday morning while making my list, what he would like for supper on Wednesday I rapidly
      realised I was onto a loser." (Mumsnet, 2011-02-11,
      https://www.mumsnet.com/talk/food_and_recipes/1148140-Meal-planning-how-do-you-go-about-it)
    - `V` "He won't eat it unless he's been in on the decision and properly consulted. Not only that, but he will
      complain, sulk and then spend money we haven't got on the most expensive takeaway he can think of" (same thread)
    - `V` "comments like "I don't care for this dish" make me feel like I wasted my time." (Hellobee, 2015-07-08,
      https://boards.hellobee.com/topic/picky-husband-what-would-you-do)
    - `V` "My husband and I pick out our meals … about once a month, together. And then I forget about it." (AARP
      Community, 2021-05, https://community.aarp.org/our-front-porch-35/what-s-for-dinner-249)
    - `V` "I gave him my login so he can add meals or tell me whether he likes the meals I’ve picked" (Mealime review, 5
      stars, 2025-03-20, review 12442859282, https://apps.apple.com/us/app/id1079999103)
    - Against: Several households report this works once input is asked for at a fixed time (Friday
      sit-down, each person picks a night).
- **How often / how bad:** Unknown frequency. Emotionally costly when it happens.
- **Workarounds people use:** A fixed weekly sit-down. Each person picks one night. Kids choose meals "so that I don't
  get the usual groans".
- **Where current products fail:** Single-user plans give others no way to weigh in (see MP-014).
- **Open questions:** Does asking for input early actually reduce complaints? No source tested it.

### MP-016: "I keep meaning to plan, and I keep stopping"

- **Status:** validated
- **Who:** Would-be planners, people whose routine was broken by a move, pregnancy, illness or a new baby.
- **When:** After a disruption, or a few weeks into a new attempt.
- **Need:** Get back into a planning routine, or keep one going, through busy or disrupted periods.
- **Evidence:**
    - `M` Only about 1 in 3 US adults plan most of the week's meals (Morning Consult 2022). `S` 57% of French adults plan
      at least occasionally, so 43% never do (Ducrot et al. 2017, n=40,554).
    - `V` "I'm a lapsed meal planner. Used to be fantastic at it and then the disruption of a move to a new town and three
      months inability to comtemplate food due to morning sickness got me out of the habit." (Mumsnet, 2011-02-11,
      https://www.mumsnet.com/talk/food_and_recipes/1148140-Meal-planning-how-do-you-go-about-it)
    - `V` "I NEED to do this but I never can muster any enthusiasm for it. So many unrealised ideas!" (Mumsnet, 2022–2024,
      https://www.mumsnet.com/talk/food_and_recipes/5158967-how-do-you-plan-your-weekly-meals)
    - `V` "Following and hoping someone can motivate me to do this! I still CBA after 43 years of living independently as an
      adult." (same thread)
    - `V` "as I try to get back to cooking more regularly after not being able to cook at all with morning sickness"
      (Samsung Food review, 3 stars, 2022-07-28, review 8922200910, https://apps.apple.com/us/app/id1133637674)
    - `V` "Stopped using before my subscription ended." (Eat This Much review, 2 stars, 2025-03-09, review 12400601123,
      https://apps.apple.com/us/app/id981637806)
    - `V` "I tried a 2 week subscription and was charged for a whole year for something I haven’t used and won’t use"
      (eMeals review, 1 star, 2026-01-22, review 13664547835, https://apps.apple.com/us/app/id575756462)
    - `X` Several writers describe quitting planning because rigid plans made them feel like failures (Substack posts found
      in search, not opened).
    - `S` (added 2026-10-21) Parents who trialled meal-planning and recipe apps for four weeks named habit as the limit:
      "...the app can be as brilliant as it is but if I’m not going to actually actively go out of my way to build that
      habit, (...) it’s only as good as I’m going to make it." (Sophie). A job change mid-trial: "I tried to settle back
      to just doing what was easy..." (Harper). Engagement was the lowest-rated app quality for all five apps (Mauch et
      al., JMIR mHealth and uHealth 2021, n=133 surveyed, 36 interviewed, https://doi.org/10.2196/22990).
    - `V` (added 2026-10-21) "I try to meal plan and shop from a list every week but time gets away and it’s hard to stay
      committed to the habit." (Mealime review, 5 stars, 2025-06-03, review 12733059891,
      https://apps.apple.com/us/app/id1079999103)
    - `V` (added 2026-10-21) "I’ve tried planning my meals in advance, but I usually stop following the plan after a couple
      of days." (r/mealplanning, 2026-07-14, https://www.reddit.com/r/mealplanning/comments/1uw1rg1/)
    - `V` (added 2026-10-21) "I stopped using the app several months ago to save money" (eMeals review, 1 star,
      2025-12-10, review 13498422327, https://apps.apple.com/us/app/id575756462)
    - (added 2026-10-21) Meal kits show the same drop-off. Second Measure reported that "28% of Blue Apron customers remain
      subscribed to the service 6 months after their first purchase", and that "Plated and HelloFresh’s 6-month customer
      retention are both 16%" (Second Measure, 2016-06-27, card-transaction data, method and sample not given on the page,
      https://secondmeasure.com/datapoints/blue-apron/). Old data, and not `M`.
    - `V` (added 2026-10-21) A tool going away also ends habits. In September and October 2026 Google Play reviewers
      reported that Mealime is shutting down: "I've been using it almost everyday for nearly 10 years. It's literally the perfect
      app for my anxious ADHD brain." (Mealime, Google Play, 5 stars, 2026-09-05, review
      2025a38a-c90a-4da0-9c92-5f178e9e0149, https://play.google.com/store/apps/details?id=com.mealime). The shutdown is
      known only from reviews and was not checked with the company.
    - Against: Not planning is the majority behaviour and is not always a problem (see MP-017).
      About 226 of 867 low-star reviews are about billing, but most are about two apps (ReciMe 104, eMeals 55), so this
      is mostly a fact about those companies. The useful signal is narrower: people pay ahead for a habit they then drop.
- **How often / how bad:** Lapsing is common in forums. No study measured how long a planning habit lasts.
- **Workarounds people use:** Starting small ("one week of dinners", Outset). Reusing an old plan. Themed nights so the
  plan almost writes itself.
- **Where current products fail:** Annual billing turns a lapse into a loss (eMeals, ReciMe reviews). Re-starting can also cost
  data or features: a Mealime subscriber found their saved recipes gone after the phone offloaded the app (review
  11242501529, 2024-05-07), and Prepear limited free users to three recipe views a week (review 6052273402, 2020-06-08).
- **Open questions:** What breaks the habit first: the time to plan, the plan going wrong, or life events?

### MP-017: "I don't plan. I decide from what's in the fridge, and that's fine"

- **Status:** validated
- **Who:** Confident cooks, people living alone, people who shop often and nearby, some retirees.
- **When:** Each evening.
- **Need:** Decide quickly from what is available, without being pushed to plan ahead.
- **Evidence:**
    - `S` 43% of French adults in NutriNet-Santé did not plan meals at all (Ducrot et al. 2017, n=40,554).
    - `M` About two in three US adults do not plan most of their week's meals (Morning Consult 2022).
    - `V` "My Dad ran a restaurant and taught me how to cook. So as DS says we won’t know what’s for dinner until Mum opens
      the fridge." (Mumsnet, 2022–2024, https://www.mumsnet.com/talk/food_and_recipes/5158967-how-do-you-plan-your-weekly-meals)
    - `V` "I'd like to do more of it, but honestly I also really enjoy the challenge of figuring something out based on what
      we have on hand." (Hacker News, 2014-09-23, https://news.ycombinator.com/item?id=8358184)
    - `V` "Since I'm "by myself," I can live a very unstructured lifestyle" (AARP Community, 2021-05,
      https://community.aarp.org/our-front-porch-35/what-s-for-dinner-249)
    - `V` "that give meal planning options from what you already have which, for me, tends to work better for me than
      thinking through possibly interesting meal plan ideas." (Mumsnet, 2019-06-11,
      https://www.mumsnet.com/talk/_chat/3610051-meal-planning)
    - `S` (added 2026-10-21) Among French meal planners, 56.32% drew their ideas from "Ingredients available during
      grocery shopping", 41.15% from their own repertoire and only 2.53% from "Internet, apps for meal planning". Even
      among planners, 26.27% chose the meal "During the day" and 11.87% "Just before meal" (Ducrot et al. 2017,
      n=40,554, Table 2, https://pmc.ncbi.nlm.nih.gov/articles/PMC5288891/).
    - `S` (added 2026-10-21) In 368 households in Tshwane, South Africa, 61% regarded meal planning as important, but only
      37% "reported that they planned their meals before cooking", and 64% "never used recipes" (Ncube, Manafe and
      Gordon, Health SA 2024, survey, abstract only, https://doi.org/10.4102/hsag.v29i0.2750). The authors read this as a
      gap to close. It is also evidence that most cooks there decide without a written plan.
    - `V` (added 2026-10-21) "I don't plan all that much — especially for typical weeknight dinners. I keep my house
      stocked with a variety of staples, and then I'll base a meal around whatever fresh produce/meat I have that I need
      to use, or whatever whim comes over me and just kind of freestyle." (r/Cooking, 2026-10-16,
      https://www.reddit.com/r/Cooking/comments/1x7offv/comment/ph5zzz1/)
    - `V` (added 2026-10-21) "I live a three minute walk from three different supermarkets in Brooklyn. I buy what I need
      per meal." (r/Cooking, 2026-02-23, https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6vklih/)
    - `V` (added 2026-10-21) "Others religiously meal plan and shop towards that plan. Each has benefits and detriments."
      (r/Cooking, 2026-10-16, https://www.reddit.com/r/Cooking/comments/1x7odzg/comment/ph5xyyf/)
    - Against (added 2026-10-21): where the shop is far, planning is not optional. "I live rurally, and feed 5 people most
      nights … because town is half an hour away, I need to plan what I need so we aren't blowing money on trips into town
      for just a few things." (r/Cooking, 2026-10-16, https://www.reddit.com/r/Cooking/comments/1x7offv/comment/ph5xyq1/)
    - Against: Improvising needs skill and stocked cupboards. Beginners say they cannot do it ("I’m
      also not someone who can just go to the kitchen and start cooking unless I’m following a recipe", Mealime review
      12338332645).
- **How often / how bad:** This is the majority behaviour, not a pain point. It matters because designs that assume a
  weekly plan do not fit these people.
- **Workarounds people use:** Stocked staples, shopping little and often, buying what is on offer.
- **Where current products fail:** Most planners start from an empty calendar, not from food on hand (see MP-009).
- **Open questions:** Do improvisers waste more or less food than planners? The evidence is mixed.

### MP-018: "I want help, not to have the whole thing taken away"

- **Status:** validated
- **Who:** Parents who value cooking with children, cooks who enjoy choosing.
- **When:** Considering any tool that would decide or do the work for them.
- **Need:** Keep control over the choices that matter to the household while losing the parts that are tedious.
- **Evidence:**
    - `S` Families did not want full automation of feeding, especially where it would take away a parent's control over
      nutrition, or an "invisible" system that removed shared cooking, which some parents valued for children's learning
      (Wu et al. 2024, https://arxiv.org/abs/2409.06627, paper title quotes a participant: "The struggle is a part of the
      experience").
    - `S` "I have to have interesting food. I’m not okay with eating peanut butter and jelly sandwiches every day of my
      life." (Sam, F6, Wu et al. 2024)
    - `V` "you appear to be looking to automate away the interesting bits while being left with the tedious ones. What I
      want is the opposite" (Hacker News, 2026-06-09, https://news.ycombinator.com/item?id=48460301)
    - `V` "I have adored it not only for partially solving what to make for dinner, but … I have learned about so many new
      ingredients and cooking techniques." (AARP Community, 2021-05,
      https://community.aarp.org/our-front-porch-35/what-s-for-dinner-249)
    - Against: Other people do want the decision made for them ("I just want someone else to cook!",
      Mumsnet 2020, "I love that I don’t have to think about what to eat…", Eat This Much review 4034292165, 2019).
      People differ, and the same person differs by day.
- **How often / how bad:** Unknown. It shapes whether help is accepted at all.
- **Workarounds people use:** Choosing some meals themselves and letting a tool or a kit fill the rest (Recipe Keeper
  user on Mumsnet: "I usually get it to suggest two or three recipes, then fill around that with standards").
- **Where current products fail:** Generated plans that must be accepted or rejected whole (Eat This Much: "make it to
  where I can pick specific foods and add them to a meal instead of relying on random generation", review 7128873032,
  2021-03-21).
- **Open questions:** Which parts of planning do people find tedious, and which meaningful? The evidence only hints.

### MP-019: "Not every night needs a recipe"

- **Status:** validated
- **Who:** All planners.
- **When:** Writing the week down.
- **Need:** See the whole week of eating in one place, including nights that are leftovers, takeaway, eating out or a
  dish cooked from memory.
- **Evidence:**
    - `V` "It also lacks an ability for me to just write in “leftovers” or a meal for which I don’t need a recipe. … (I
      really don’t need a recipe for taco night, spaghetti night, pancakes for dinner" (Paprika 3 review, 4 stars,
      2026-06-08, review 14159864556, https://apps.apple.com/us/app/id1303222868)
    - `V` "“going to a diner” “leftover spaghetti” “Todd brings dinner”" (Samsung Food review, 4 stars, 2024-04-09,
      review 11140581427)
    - `V` Mumsnet plans routinely include "Freezer surprise", "takeaway Tuesday", a "ready meal evening" and recipes "I
      know off the top of my head" (threads 3610051, 3080756, 4018955, 5158967).
    - `V` "rotate those 10, interspersed with some take out for him, and cereal/pb&j nights/nights when he fends for
      himself." (Hellobee, 2015-07-08, https://boards.hellobee.com/topic/picky-husband-what-would-you-do)
    - Against: None found.
- **How often / how bad:** Low severity, high frequency. A plan that shows only recipe nights looks emptier than the real
  week.
- **Workarounds people use:** Paper, whiteboards, notes apps.
- **Where current products fail:** Paprika and Samsung Food, as above.
- **Open questions:** None major.

### MP-020: "The portions don't fit my household"

- **Status:** reported (App Store only)
- **Who:** People cooking for one, large families, households with teenagers, batch cooks.
- **When:** Choosing servings for the plan and the shopping list.
- **Need:** Plan the right amount of food for the actual number and size of eaters, including planned leftovers.
- **Evidence:**
    - `V` "why are 2, 4, and 6 servings the only options? At the very least, 1 serving should be an option." (Mealime
      review, 3 stars, 2025-06-17, review 12786794044, https://apps.apple.com/us/app/id1079999103)
    - `V` "I grew up in a big family and couldn’t figure out how to cook for one." (Mealime review, 5 stars, 2025-03-20,
      review 12442859282)
    - `V` "when you’re feeding four teenage boys, you definitely need to scale up without having to sit and figure out what
      you need to double." (eMeals review, 3 stars, 2026-03-23, review 13878732982, https://apps.apple.com/us/app/id575756462)
    - `V` "I’d like to see a setting for more than 6 servings to help with freezing partially made meals." (Mealime review,
      5 stars, 2025-03-22, review 12452245766, https://apps.apple.com/us/app/id1079999103)
    - `V` "sometimes my teens eat a ton and sometimes they don’t." (Mealime review, 5 stars, 2024-08-26, review 11655844680)
    - `V` "As a single person, this cuts down a lot on my food waste." (Mealime review, 5 stars, 2024-05-19, review 11285949330)
    - Against: Several reviewers find fixed portions reduce waste. The complaint is about the range,
      not the idea.
- **How often / how bad:** Unknown. Single-person households are a large group but thin in this evidence.
- **Workarounds people use:** Doubling by hand. Choosing 6 servings and freezing the rest.
- **Where current products fail:** Mealime (2/4/6 only), eMeals (max 4 to 6).
- **Open questions:** How do people who live alone plan, if they plan at all? Not reached.

### MP-021: "Planning a week is too many steps for my brain"

- **Status:** validated (updated 2026-10-21: round 1 had one app review and one dietitians' page, so it was "reported".
  Round 2 adds voices from Reddit and Google Play, which makes three venues with the App Store.)
- **Who:** People with ADHD, autism or other executive-function differences, people with low energy from illness.
- **When:** Starting to plan, starting to cook.
- **Need:** Get from hunger to a meal with fewer separate decisions and steps.
- **Evidence:**
    - `X` "Executive function challenges can make it difficult to start cooking and to manage the mess afterwards. This may
      lead to avoidance of cooking and relying more on convenience food and takeaways." (British Dietetic Association,
      adult ADHD page, date not shown, https://www.bda.uk.com/resource/adult-adhd-not-just-a-trend.html)
    - `V` "Why do I have to spend five minutes entering information before I can even see what your app is about? … I am
      autistic … This is an accessibility issue for me." (ReciMe review, 1 star, 2026-10-15, review 14671326846,
      https://apps.apple.com/us/app/id1593779280)
    - `X` ADHD coaching blogs describe meal planning as "a marathon of executive functions" (getinflow.io, found through
      search, not opened).
    - `V` (added 2026-10-21) "I have AuDHD, so I think about every single micro-step involved and get overwhelmed. So I
      started trying to get into the meal prep game. I would save several recipes, get groceries for the week, and I would
      get through two or three recipes on my cooking day and then get too tired. Now I'm at a point where I'm even
      avoiding going grocery shopping. It's bad, and I feel ashamed that I can't help with cooking." (r/MealPrepSunday,
      2026-05-23, https://www.reddit.com/r/MealPrepSunday/comments/1tlq3t1/)
    - `V` (added 2026-10-21) "I suffer from Binge Eating along with ADHD and I absolutely hate meal planning/prepping but I
      do my breakfast because it's the easiest for me to do" (r/adhdwomen, 2026-10-19,
      https://www.reddit.com/r/adhdwomen/comments/1x9w55e/comment/php1jku/)
    - `V` (added 2026-10-21) "easy to use, makes my ADHD brain capable of more complex meals than ramen and Mac n' cheese."
      (Mealime, Google Play, 5 stars, 2024-05-14, review 10ffde97-26ed-49e0-98bf-72f84b44f3ca,
      https://play.google.com/store/apps/details?id=com.mealime)
    - `V` (added 2026-10-21) "I'm so so so sad Mealime is shutting down 😭 I've been using it almost everyday for nearly 10
      years. It's literally the perfect app for my anxious ADHD brain." (Mealime, Google Play, 5 stars, 2026-09-05, review
      2025a38a-c90a-4da0-9c92-5f178e9e0149). The Google Play venue for this record rests on these two reviews.
    - Against (added 2026-10-21): a plan can be what makes cooking possible for this group, not the barrier. "Opening the
      fridge on Wednesday and knowing exactly what I was making I could go into autopilot. I like cooking, but with a
      fridge full of groceries and no plan I will starve." (r/adhdwomen, 2026-10-13,
      https://www.reddit.com/r/adhdwomen/comments/1x4wqj4/comment/pghu19n/)
    - Against: Too little evidence to judge. Reddit (r/ADHD, r/autism) was blocked.
    - (added 2026-10-21) Round 2 reached Reddit, and the line above no longer holds for Reddit as a whole. r/ADHD itself
      still returned nothing usable (archive timeouts). The evidence is still thin: one long post, one comment and two
      reviews.
- **How often / how bad:** Unknown.
- **Workarounds people use:** Per the BDA: simpler recipes, fewer ingredients, pre-chopped and frozen vegetables.
- **Where current products fail:** Long onboarding before any value (ReciMe review above).
- **Open questions:** Almost everything. This group needs primary research.

### MP-022: "Deciding dinner every single day wears me down"

- **Status:** validated
- **Who:** The person who feeds the household most nights, for years. Mostly mothers in the studies. Also people who
  cook only for themselves.
- **When:** Every day, often at the end of the workday. It builds up over weeks, months and years, not in one moment.
- **Need:** Stop carrying the same daily food decision, again and again, for months and years.
- **Evidence:**
    - `S` In 25 Australian families with young children who use meal kits, "All participants reported that not having to
      think about ‘what’s for dinner’ was a major driver for using meal kits." The kits were seen to reduce "the
      cognitive (i.e. thinking, planning, and organizing) and emotional (i.e. caregiving, anticipating needs, worry) work"
      (Fraser, Love, Campbell and Spence, Health Promotion International 2025, interviews,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC12235520/).
    - `S` A mother in the same study: "I'm finding that just juggling motherhood and then work, it really uses up all of
      my brain space…I know that the priorities are to eat well and…that takes a lot of thought, so I kind of just been
      wanting to outsource it a little bit." (MK002, Fraser et al. 2025)
    - `S` Another: "So that's probably what keeps me coming back…Not having to worry about what I'm going to cook or
      stressing out because I forgot to take the meat out to thaw" (MK022, Fraser et al. 2025)
    - `S` In 69 low-wage employed US parents, work-family overload was "normative" and shaped food choices. Parents used
      food-choice coping strategies "to: (1) manage feelings of stress and fatigue" among others (Devine et al., Social
      Science & Medicine 2006, interviews, https://pmc.ncbi.nlm.nih.gov/articles/PMC1694441/).
    - `M` "A poll of 2,000 adults revealed 32 per cent frequently end up with a boring meal in the middle of the week,
      usually due to being tired (44 per cent) or a lack of planning (39 per cent)." (McCain/OnePoll, UK, reported
      2023-11-22, brand poll,
      https://www.thestar.co.uk/read-this/midweek-meals-have-turned-boring-and-repetitive-for-many-adults-4419239)
    - `V` "There are times I would rather be hungry than think about what I am going to eat." (r/Cooking, 2026-05-03,
      https://www.reddit.com/r/Cooking/comments/1t2q8ru/comment/ojpiz2u/)
    - `V` "I'd hire a personal chef, specifically for the meal planning. I have so many goals for how I WANT to eat, but I
      find the planning and execution to be exhausting. I would love to be able to pay a local professional to do that
      mental work for me." (r/Frugal, 2026-10-13, https://www.reddit.com/r/Frugal/comments/1x4vr5y/comment/pgikte4/)
    - `V` "What’s for dinner was putting me over the edge." (eMeals review, 5 stars, 2026-07-01, review 14250626602,
      https://apps.apple.com/us/app/id575756462)
    - `V` "it has saved my adult life and the eternal task of thinking what to cook and eat every day." (Mealime, Google
      Play, 5 stars, edited 2026-05-13, review 237f0d88-aa4a-49a1-9f83-46f8e1499e5e,
      https://play.google.com/store/apps/details?id=com.mealime)
    - `V` "If you're like me and can't produce enough head space to create a grocery list, find recipes and cook meals that
      taste good, every single day, and you dread it but have to eat, this app is for you." (Mealime, Google Play, 5
      stars, 2024-04-07, review f17f163c-1bc7-4608-b8be-016bfc0c8c6b)
    - Against: The popular claim that people make more than 200 food decisions a day does not hold up. A 2025 paper
      argues that the figure comes from a known bias in how people estimate (the "subadditivity effect"), and concludes
      that "the high number of "mindless" food decisions is not an empirically observed reality" (Claassen, Mata and
      Hertwig, Appetite 2025, read only through a Max Planck press page,
      https://www.mpg.de/25028482/the-myth-of-200-daily-food-decisions). So the load is real in people's words, but no
      study here measures "decision fatigue" from food choice directly.
    - Against: In NutriNet-Santé, about six in ten non-planners did not agree that "Having to think about what to cook is a
      constraint" (Ducrot et al. 2017, n=40,554, see MP-003). Some people enjoy the deciding: "I like planning dinner much
      better than actually cooking it." (r/Cooking, 2026-02-23,
      https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6w8nuy/)
    - Against: The sample in the Fraser studies is people who already pay for meal kits. They would name the mental load
      as a reason, because that is what kits sell.
- **How often / how bad:** Common in the voices and in two meal-kit studies. The voices describe it as daily and
  long-running ("eternal task", "every single day"). No study measured how the load changes over months.
- **Workarounds people use:** Meal kits on and off (Fraser). A fixed rotation or theme nights. Paying someone else,
  or wishing to. Handing a night to a partner or teenager ("Darwin Dinner", r/Cooking, 2023-12-12,
  https://www.reddit.com/r/Cooking/comments/18g9ohr/comment/kczmfwj/).
- **Where current products fail:** Most planners still ask the user to choose each week, so the decision moves to
  Sunday but does not go away (see MP-024).
- **Open questions:** Does the load come from the number of decisions, from being the only one who decides (MP-002), or
  from the decision coming at a tired time of day (MP-005)? The evidence mixes all three.

### MP-023: "I can't know on Monday what I'll feel like eating on Thursday"

- **Status:** validated (the schedule part rests on studies. The appetite and mood part rests on two venues, Reddit and
  Google Play, and is weaker.)
- **Who:** Couples and families where tastes change day to day, shift workers, people with unpredictable work, people
  who cook by craving.
- **When:** When making the plan, and again on the evening when the planned meal no longer appeals.
- **Need:** Eat something that fits how the person feels and what the day turned out to be, without wasting what was
  bought for the plan.
- **Evidence:**
    - `S` In interviews with low-wage parents, the authors report that "varied hours, overtime, multiple jobs, and shift
      work made it harder for them to use
      strategies aimed at reducing spillover or overload by planning ahead" (Devine et al. 2006, n=69,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC1694441/).
    - `S` "Work schedule predictability and other adults helped mothers maintain feeding routines. Unexpected daily
      events, such as working overtime or waking up late, disrupted child feeding routines and required modifications."
      (Agrawal et al., Appetite 2018, n=22, abstract only, https://doi.org/10.1016/j.appet.2017.08.010)
    - `S` Working adults kept eating routines but "modified routines as circumstances changed" (Jastran, Bisogni, Sobal,
      Blake and Devine, Appetite 2009, n=42, seven days of qualitative recalls, abstract only,
      https://doi.org/10.1016/j.appet.2008.09.003).
    - `V` "I could plan out the week in advance but I’m married and I get the, I’m not feeing like that for supper, 🙄 so
      now I ask and it bugs him lol, you don’t like my pre-planed meals fine you figure out what’s for supper." (r/Cooking,
      2026-02-23, https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6x2fyo/)
    - `V` "I'd completely understand if you're not feeling in the mood for one of the pre-planned meals, and that totally
      happens to us, so we just reschedule it." (r/Cooking, 2026-02-23,
      https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6wpq3z/)
    - `V` "The "What do you feel like having?" game. When neither one of us knows what we want, nor do we feel like
      putting much effort into it" (r/Cooking, 2026-10-16, https://www.reddit.com/r/Cooking/comments/1x7odzg/comment/ph5vv5n/)
    - `V` A post title: "Started cooking chicken parm, but the family deciding they wanted take out instead" (r/Cooking,
      2026-03-02, https://www.reddit.com/r/Cooking/comments/1rifp42/)
    - `V` "We chose 4 meals a week with leftovers and that worked great. Just get home and pick what you feel like eating,
      knowing all the ingredients are there." (Mealime, Google Play, 5 stars, 2024-02-21, review
      5dfedf3f-de6a-46ef-9365-ff1563724029, https://play.google.com/store/apps/details?id=com.mealime)
    - Against: Some cooks fix every day and are content: "I plan my menus on Sundays and never plan the same meal twice in a
      week." (r/Cooking, 2025-08-16, https://www.reddit.com/r/Cooking/comments/1ms6qg1/comment/n92fr2t/). In Outset 2024,
      70% said they kept to their plan, mostly by moving meals (MP-001).
    - Caution: four of the five Reddit voices on mood come from threads that may be seeded. 1rbtvg8's poster was called
      out for promoting an app. 1x7odzg and 1x7offv were posted the same day with the same title and score 0. The
      replies quoted read as genuine, but the threads were not started by ordinary users.
- **How often / how bad:** The schedule side is common in families and low-wage work (Devine, Agrawal, MP-001, MP-014).
  How often appetite alone breaks a plan is unknown. It turns a planned meal into waste or a second shop (WRAP,
  "displaced meals", MP-001).
- **Workarounds people use:** Plan meals but not days. "I typically set 2-3 meals on fixed days, usually based on
  freshness of ingredients and/or our schedules. The rest are planned and shopped for, but can be made whichever day we
  feel like it." (r/Cooking, 2026-02-22, https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6tqiou/). Keep
  fallbacks: "If we aren’t in the mood for what I have planned, then I find something in the freezer." (r/Cooking,
  2026-02-22, https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6uqml0/). Pick each evening from a short
  shopped-for list: "It can be one of teh 4 planned meals or one of our "pantry staple" meals." (r/Cooking, 2026-10-16,
  https://www.reddit.com/r/Cooking/comments/1x7odzg/comment/ph65pj6/)
- **Where current products fail:** Calendars that bind a recipe to a date (MP-001). Not measured further here.
- **Open questions:** How far ahead can a person predict their own appetite? Does a short list of "shopped-for, any
  night" meals waste less than a day-by-day plan? No study compared them.

### MP-024: "The planning session itself is a chore"

- **Status:** validated
- **Who:** Weekly planners, mostly the main food person in the household.
- **When:** The weekly sit-down: choosing recipes, checking the fridge and cupboards, building the list, fitting meals to
  the calendar.
- **Need:** Get through the weekly work of choosing, checking and listing with less time and effort.
- **Evidence:**
    - `S` Of 133 working parents, 80.5% (107) agreed they needed to "Have more time to plan, buy, and prepare healthy
      meals", and 65.4% (87) wanted "a better way of planning and recording meals and groceries for the coming week". The
      family-organiser app, "requiring a high level of user input, was rated the lowest for usability" (Mauch et al., JMIR
      mHealth and uHealth 2021, https://doi.org/10.2196/22990).
    - `S` In the same study: "I think, real or just perceived, I think, that’s a, um, a time issue, I feel, like, (...)
      there’s other things I should be doing..." (Cora, working 21 to <35 hours a week)
    - `V` "I compress the whole week of meal-planning pain into a single effort on a Saturday. I hate it, and it’s the
      hardest part of cooking." (r/Cooking, 2026-10-16, https://www.reddit.com/r/Cooking/comments/1x7offv/comment/ph5x0hb/)
    - `V` "The selecting of recipes is my least favorite part. The decision fatigue is real." (r/Cooking, 2026-10-16,
      https://www.reddit.com/r/Cooking/comments/1x7offv/comment/ph6bzgx/)
    - `V` "It makes me think hard for a couple hours but then it's done and keeps the guessing work out of the rest of the
      month." (r/Cooking, 2026-02-23, https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6y7b20/, posted three
      times in the thread, counted once)
    - `V` "As a mom my least favorite question is “what’s for dinner”. I would try to meal plan but it took so long."
      (eMeals review, 5 stars, 2024-08-23, review 11644790151, https://apps.apple.com/us/app/id575756462)
    - `V` "It’s made meal planning—something I dreaded—into a fun activity" (Plan to Eat review, 5 stars, 2026-01-14,
      review 13633726166, https://apps.apple.com/us/app/id1215348056)
    - `V` "I feel like I've been waiting for this app my whole life. I like cooking, hate planning, this app takes care of
      that." (Mealime, Google Play, 5 stars, 2024-04-05, review 11c58993-289a-429c-9b42-4036ef3c55c3,
      https://play.google.com/store/apps/details?id=com.mealime)
    - Against: For some people the session is the good part. "It condenses a week's worth of food thinking into one
      efficient hour." (r/Cooking, 2026-10-16, https://www.reddit.com/r/Cooking/comments/1x7odzg/comment/ph5zo3k/). "I
      love planning a themed menu with new recipes." (r/Cooking, 2026-10-20,
      https://www.reddit.com/r/Cooking/comments/1xa8mse/comment/pht39xe/)
    - Against: In Mauch, the meal-planning app scored well on usability (median System Usability Scale 78). The burden
      there came from apps that asked for a lot of input, not from planning as such.
- **How often / how bad:** Most working parents in Mauch wanted more time for it. In voices the session takes from one
  hour to "a couple hours". Round 1's Mumsnet "such a faff" (MP-001) fits here too.
- **Workarounds people use:** One fixed session a week. A master list of known meals. Copying ingredient lists into a
  notes app and deleting what is on hand. Meal kits or apps that choose for them.
- **Where current products fail:** Apps that need a lot of entering (Mauch, the family organiser). Recipe sources so
  large that choosing becomes the work ("It's too much to look at sometimes", MP-003).
- **Open questions:** Which step takes the most time: choosing, checking stock, or listing? No source timed them.

### MP-025: "I planned for the week I wish I had, and I keep feeling I failed"

- **Status:** reported (the link between ideal plans and guilt rests on Reddit voices. Studies show the guilt and the
  lowered expectations in general.)
- **Who:** New planners, people trying to eat more healthily, busy parents, people with low energy.
- **When:** Midweek, when bought food goes unused and takeaway replaces the plan.
- **Need:** Plan for the week the person will really have, so that a normal week does not feel like failure.
- **Evidence:**
    - `V` "Every time I go grocery shopping, I tell myself that this will be the week I actually cook properly. … By the
      end of the week, I’m looking at wilted vegetables in the fridge and feeling guilty for wasting both food and
      money." (r/mealplanning, 2026-07-14, https://www.reddit.com/r/mealplanning/comments/1uw1rg1/)
    - `V` A reply: "Honestly, I think it sounds like you might be meal planning in an aspirational way. … I think being
      realistic with what your needs are could help you reframe this so you buy more realistically, reduce your waste and
      stop seeing yourself as failing each week." (r/mealplanning, 2026-07-14,
      https://www.reddit.com/r/mealplanning/comments/1uw1rg1/comment/oxhpz7x/)
    - `V` "It's bad, and I feel ashamed that I can't help with cooking." (r/MealPrepSunday, 2026-05-23,
      https://www.reddit.com/r/MealPrepSunday/comments/1tlq3t1/)
    - `S` Parents' coping strategies included to "redefine meanings and reduce expectations for food and eating" (Devine et
      al. 2006, n=69, https://pmc.ncbi.nlm.nih.gov/articles/PMC1694441/).
    - `S` Employed mothers "saw the nutrition guidelines as unhelpful because of the time demands that were implied"
      (Mehta et al. 2020, n=22, abstract only, https://doi.org/10.1093/heapro/daz061).
    - `S` "It just makes me feel bad that we’re spending more on unhealthy food like burgers." (Allison, Wu et al. 2024,
      see MP-005)
    - `M` "21 per cent often feel guilty about the nutritional value of fast food after eating it." (McCain/OnePoll, UK,
      n=2,000, reported 2023-11-22)
    - `X` Several writers describe quitting planning because rigid plans made them feel like failures (round 1, MP-016,
      not opened).
    - Against: Some posters see the answer as more discipline, not a smaller plan: "I think that planning is the key,
      followed by sticking to the plan. It can take a while to get into the habit but once you're there, it gets easier."
      (r/mealplanning, 2026-07-14, https://www.reddit.com/r/mealplanning/comments/1uw1rg1/comment/oxfn2v4/)
- **How often / how bad:** Unknown frequency. When it happens it joins waste, money lost and guilt, and it may push
  people to stop planning (MP-016).
- **Workarounds people use:** Planning low-effort nights on purpose ("I plan low stress meals, plus a few ready to grab
  and put together things for when I can't even be bothered to do the low stress meal lol", r/EatCheapAndHealthy,
  2026-09-30, https://www.reddit.com/r/EatCheapAndHealthy/comments/1wtluur/comment/pd0wei1/). A freezer pizza or "911
  meals" in the plan.
- **Where current products fail:** Not measured here.
- **Open questions:** Do people who plan fewer, easier meals keep planning longer? No study tested it.

### MP-026: "I plan in some seasons and not in others"

- **Status:** validated
- **Who:** Most planners over time. Parents through life changes. Meal-kit users who buy on discount.
- **When:** Planning starts in a calm or motivated period, stops in a busy one, and comes back later.
- **Need:** Pick planning up again after a gap without starting from nothing, and get value from it even when it is only
  done some weeks.
- **Evidence:**
    - `S` In a four-week app trial, one parent used the meal planner like this: "...I would do another week every couple of
      months on it when I was looking for inspiration." (Lana, working 35+ hours a week, Mauch et al. 2021,
      https://doi.org/10.2196/22990)
    - `S` Meal-kit users planned around discounts, which "encouraged the regular use of meal kits (e.g. fortnightly, once
      per month, or 2–3 months)". One said: "I've been off [MKSS name] because they just stopped having any variety…then I
      went back to them…because they offered me 40% off. So I took it." (MK016, Fraser et al. 2025,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC12235520/). Many "ordering meal kits during times of uncertainty such as
      the birth of children and during Covid-19 lockdowns".
    - `S` Mauch et al. 2021: a parent who changed jobs mid-trial "tried to settle back to just doing what was easy" (see
      MP-016).
    - `V` "Weekly planning is something I've done, and it really makes life easier, but I'm too lazy to do it every week."
      (r/Cooking, 2026-02-23, https://www.reddit.com/r/Cooking/comments/1rbtvg8/comment/o6ysj8b/)
    - `V` "The planning definitely comes and goes though lol but when it hits my god it feels good." (r/adhdwomen,
      2026-10-13, https://www.reddit.com/r/adhdwomen/comments/1x4wqj4/comment/pghu19n/)
    - `V` "Meal plans stay until you clear them, which means if you miss a week or only cooked a part of what you planned
      to, You can pick up where you left off or start over." (Mealime, Google Play, 5 stars, 2026-06-11, review
      82494fb7-9a36-476e-999e-992dbeecf9b5, https://play.google.com/store/apps/details?id=com.mealime)
    - `V` "I try to meal plan and shop from a list every week but time gets away and it’s hard to stay committed to the
      habit." (Mealime review, App Store, 2025-06-03, review 12733059891)
    - Against: Some planners keep going for decades without a gap: "Customer for over 20 years! … Each week I pick out 3 to
      4 meals" (eMeals review, 5 stars, 2025-07-06, review 12859115834, https://apps.apple.com/us/app/id575756462). "I
      have used this app every week going on 5 years now" (Mealime, Google Play, 5 stars, 2025-01-25, review
      78cbfa0f-1b18-47c4-8bdf-7686d23f51e6).
- **How often / how bad:** Common in the voices and in both studies. It is not a failure for most people. It becomes a
  loss only when a tool charges for the gap or loses the person's data (MP-016).
- **Workarounds people use:** Reusing an old plan. A rotation that needs no fresh planning. Buying a kit only on
  discount.
- **Where current products fail:** Annual billing for a habit that comes and goes (MP-016). Plans that expire or reset
  after a missed week (the Google Play review above praises the opposite).
- **Open questions:** What restarts planning: a new life stage, money, health goals, or boredom? Not measured.

### MP-027: "How far ahead I plan depends on the week, and it's usually only a few days"

- **Status:** validated
- **Who:** All planners.
- **When:** Choosing how much of the week to fix before shopping.
- **Need:** Plan only as far ahead as the person can predict, which may be one evening, a few days, a week or a month.
- **Evidence:**
    - `S` Among 23,283 French meal planners, the plan covered "A few days" for 79.05%, "One week" for 19.77% and "Two
      weeks or more" for 1.18%. Of planners, 46.39% planned several times a week and 34.72% once a week. Only 7.69% of
      planners decided "One week before" (Ducrot et al. 2017, n=40,554, Table 2,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC5288891/). In this large sample, long-range planning is rare even among
      planners.
    - `S` "So I’ll probably sit down the night before and, you know, meal plan what we’re going to have for that week."
      (Kathryn, Mauch et al. 2021, who shops once a week)
    - `V` "Sometimes the plan only goes until Wednesday and then I fill in the rest Wednesday evening while watching tv
      before I go to bed." (r/EatCheapAndHealthy, 2026-09-30,
      https://www.reddit.com/r/EatCheapAndHealthy/comments/1wtluur/comment/pd1g5fh/)
    - `V` "At the start of the week I’ll try to get groceries for a Mon-Wed meals with specific (easy) meals in mind. Then
      by Thursday there is either left overs or something else and then Friday is ad hoc or we do something easy like take
      out." (r/EatCheapAndHealthy, 2026-09-30, https://www.reddit.com/r/EatCheapAndHealthy/comments/1wtluur/comment/pd217g5/)
    - `V` "I only do 3 days at a time because I get bored of it after than long and it gets wasted." (r/MealPrepSunday,
      2026-10-06, https://www.reddit.com/r/MealPrepSunday/comments/1wyvasp/comment/pe7cuwp/)
    - `V` "I’m insane and broke, so I plan meals two weeks out so I can shop in bulk for everything lol." (r/Cooking,
      2026-10-16, https://www.reddit.com/r/Cooking/comments/1x7odzg/comment/ph5vi8s/)
    - `V` Monthly planners exist where money or shops force it: payday planning (Mumsnet, MP-011), a monthly pick with a
      partner (AARP, MP-015), and "keeps the guessing work out of the rest of the month" (r/Cooking, MP-024).
    - Against: Ducrot's sample is French adults in a nutrition cohort, who may cook more than average. The Reddit voices
      lean to people who plan and post about it.
- **How often / how bad:** Not a harm in itself. It matters because a weekly or monthly calendar assumes a horizon most
  planners do not use.
- **Workarounds people use:** Half-week plans, a midweek top-up, plans fixed only for the busy days, leftovers and a
  takeaway night closing the week.
- **Where current products fail:** Not measured here.
- **Open questions:** Does the horizon depend on shop distance, household size or income? Ducrot reports these groups but
  this round did not open those tables.

### MP-028: "I only keep planning if I feel the payoff that same week"

- **Status:** validated
- **Who:** People who keep planning for months or years.
- **When:** The weekday evening the plan pays off, and the weekly shop.
- **Need:** See a payoff from planning (less stress, less takeaway, less waste, less money) that is bigger than the
  effort it costs.
- **Evidence:**
    - `S` "Like, it took away the decisions, decisions I had to make, I think, I had already made them, and then, I didn’t
      need to stress about it, basically." (Blair, Mauch et al. 2021, https://doi.org/10.2196/22990)
    - `S` "...having the plan there it, sort of, I mean, it almost makes you more accountable (...) it really cuts out the
      excuses of, oh, I’m tired, we’re running late, let’s get a pizza." (Cora, Mauch et al. 2021)
    - `S` Meal kits were also reported "to reduce food eaten away-from-home" (Fraser et al. 2022, abstract only,
      https://doi.org/10.1016/j.appet.2021.105816).
    - `M` Saving time and mental effort were the top reasons people planned, and many said it helped them keep to a budget
      (Outset 2024, n=120, see MP-003 and MP-011).
    - `V` "We were doing take out and DoorDash multiple times a week because we didn’t know what to make. Now I can’t even
      remember the last time we ordered out!" (r/EatCheapAndHealthy, 2026-09-30,
      https://www.reddit.com/r/EatCheapAndHealthy/comments/1wtluur/comment/pcxjfyc/)
    - `V` "I get take out, pay $75, and realize I need to get my as back in the kitchen." (r/Cooking, 2023-12-12, score
      296, https://www.reddit.com/r/Cooking/comments/18g9ohr/comment/kczhc63/)
    - `V` "Once I started meal planning and intentionally shopping for those plans it got wildly easier." (r/adhdwomen,
      2026-10-13, https://www.reddit.com/r/adhdwomen/comments/1x4wqj4/comment/pghu19n/)
    - `V` "The ease of planning, ordering and prep, relieves my mental load." (eMeals review, 5 stars, 2026-07-11, review
      14290418276, https://apps.apple.com/us/app/id575756462)
    - `V` "Reduced meal planning stress." (Mealime, Google Play, 5 stars, 2024-02-21, review
      5dfedf3f-de6a-46ef-9365-ff1563724029). "Fantastic free options for trying new things and having a mainly stress free
      meal schedule." (Mealime, Google Play, 5 stars, 2024-06-27, review f7ad24b0-17fa-49d2-b1c1-28724ea21dcf,
      https://play.google.com/store/apps/details?id=com.mealime)
    - Against: Planning costs time, and for confident cooks near a shop the payoff is small (MP-017). Ducrot found only very
      small differences in energy and nutrient intake between planners and non-planners. The variety and diet-quality
      links are associations, not proof that planning causes them.
    - Against: Five-star reviews of planning apps are a sample of people for whom it worked. They say nothing about the
      many who stopped (MP-016).
- **How often / how bad:** This is the other side of MP-016 and MP-024. People who keep planning describe a fast, felt
  payoff: the evening is already decided, and takeaway spending drops. When the payoff is slow or invisible, people
  stop (MP-016).
- **Workarounds people use:** What the people who keep going describe: a shared plan the family can see, an online
  order sent straight from the plan, a short list of known meals.
- **Where current products fail:** Not measured here.
- **Open questions:** How soon must the payoff show up for a new planner to keep going? No study tracked new planners.

### MP-029: "Cooking for one means eating the same dish for days"

- **Status:** reported (Reddit only, one venue)
- **Who:** People who live alone, students, people with chronic illness who batch cook to save energy.
- **When:** Day two to five of a batch.
- **Need:** Eat with some variety when cooking only one batch every few days for one person.
- **Evidence:**
    - `V` "Being single I eat the same dinner twice in a row because it’s cheaper and supermarkets tend not to cater to
      single people lol." (r/Cooking, 2025-08-16, score 119, https://www.reddit.com/r/Cooking/comments/1ms6qg1/comment/n92f4fl/)
    - `V` "since I live alone and don't want to waste things and am chronically ill so my energy has some constraints I
      cook a full sized dish and enjoy the leftovers for 3-5 days." (r/Cooking, 2025-08-16,
      https://www.reddit.com/r/Cooking/comments/1ms6qg1/comment/n92f4ds/)
    - `V` "I can eat the same thing three or four times, but not not 9 or 10." (r/Cooking, 2025-08-16,
      https://www.reddit.com/r/Cooking/comments/1ms6qg1/comment/n92ytte/)
    - `V` A 22-year-old student who cooks for herself: "I'm trying to make my grocery list right now and I'm just thinking
      "ughh. I'm so displeased by the food I'm having right now that I wish I could just not eat."" (r/Cooking,
      2026-05-03, https://www.reddit.com/r/Cooking/comments/1t2q8ru/). She adds: "I cook meals about twice a week
      (besides breakfast) and have the leftovers for lunch and dinner till it's time to make the next one" (comment
      ojpka9r, same thread).
    - `V` "Only because I live alone and have to do both the cooking and the cleaning up. It gets tiresome doing both."
      (r/Cooking, 2026-05-03, https://www.reddit.com/r/Cooking/comments/1t2q8ru/comment/ojpjlnw/)
    - `V` "no need to buy a family pack of hotdogs if it's just you, unless you want to torture yourself with the same thing
      for a week straight." (r/Frugal, 2026-10-12, https://www.reddit.com/r/Frugal/comments/1x49nwq/comment/pfi76lv/)
    - Against: Freezing half a batch solves it for some: "when I make lasagna (or a pot of soup or anything large) I
      immediately put half into the freezer." (n92ytte, same comment). Others do not mind repeats (MP-007, Against).
- **How often / how bad:** Unknown. Single-person households are a large group. MP-020 has App Store voices on portions
  for one. This record adds the monotony side. It links to portions (MP-020) and waste (MP-009).
- **Workarounds people use:** Freezing portions to rotate later. Prepping ingredients rather than whole meals and mixing
  them. Cooking twice a week.
- **Where current products fail:** Recipes and packs sized for families (MP-020).
- **Open questions:** Do people who live alone plan at all, and how? Still not reached directly.

---

## Top needs in this area

1. Keep the week's food on track when the planned day falls through (MP-001).
2. Share the thinking work of feeding the household, not only the cooking (MP-002, MP-015).
3. Reach a good-enough answer to "what's for dinner" with little thought, at the right amount of variety (MP-003, MP-007).
4. Feed people with different tastes and diets without cooking several meals (MP-004).
5. Eat reasonably on low-energy nights without guilt (MP-005).
6. Trust that planned meals are safe for everyone's restrictions (MP-006).
7. Use what is already bought or cooked before it spoils (MP-009, MP-010).
8. Respect that many people decide in the moment and do not want a weekly plan, and that people want help without losing
   control (MP-017, MP-018).
9. (added 2026-10-21) Stop carrying the same daily food decision for months and years, and make the weekly planning
   session less of a chore (MP-022, MP-024).
10. (added 2026-10-21) Plan only as far ahead as the person can predict, which is usually a few days, and leave room for
    appetite and the day to change (MP-023, MP-027).
11. (added 2026-10-21) Let planning come and go without loss, and plan for the real week, not the ideal one (MP-025,
    MP-026). People keep planning when the payoff shows up fast (MP-028).
