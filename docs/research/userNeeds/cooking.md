# Cooking from a recipe: user needs

The problems people have while they cook from a recipe. It covers the steps, timing and prep. It covers the device or
paper in the kitchen, amounts and units, and swaps. It also covers unclear wording, skill, safety, cooking for others
and cleaning up. Problems with finding and choosing a recipe are in `findingRecipes.md`. Problems with planning are in
`mealPlanning.md`. The format and the evidence codes are in `README.md`.

Research date: 2026-10-20, with a second round on 2026-10-21. Desk research only. Nobody was interviewed or
observed for this file.

## Method and limits

**What I reached**

- **App-store reviews (`V`).** I pulled the 11,249 most recent public reviews of 23 app listings:
    - **6,449 App Store (US) reviews** of Paprika, Mealime, Plan to Eat, AnyList, Samsung Food, NYT Cooking, ReciMe,
      Crouton, Mela, Pestle, Tasty, Kitchen Stories, Cookidoo, Recipe Keeper and Just the Recipe. They came from Apple's
      public review feed.
    - **4,800 Google Play (US, English) reviews** of Paprika, Mealime, NYT Cooking, ReciMe, Tasty, Allrecipes, Cookidoo
      and Yummly. They came from the `google-play-scraper` library.
    - Most reviews are from 2024 to 2026. Some apps go back further (Kitchen Stories to 2016), and the record shows the
      date. I read the 1 to 3 star reviews most closely.
    - An App Store review has no link of its own. It is cited by app, stars, date and Apple review id, with the app page
      URL. A Google Play review is cited with its `reviewId` link. Every review quote was checked word for word against
      the downloaded text.
- **Studies (`S`).** I read the full text of:
    - Frummet et al. 2022 (TOIS): 45 home cooks, 2,376 turns.
    - Vtyurina and Fourney 2018 (CHI): 10 cooks.
    - Hwang et al. 2023 (DIS): 12 cooks.
    - Li et al. 2024 (ASSETS): 20 blind or low-vision cooks and 4 instructors.

    From abstracts or secondary reports I used:
    - the USDA FSIS kitchen observation study (2018, 383 cooks)
    - the FDA 2016 Food Safety Survey (more than 4,000 people)
    - Lavelle et al. 2016
    - Tuncer et al. 2020 (CHI)
    - Cherkaoui et al. 2015 (1,941 children)
    - Rizzo et al. 2026 (121 adults with vision loss)
    - the BLS American Time Use Survey 2024

- **Surveys (`M`):**
    - Instacart / SurveyMonkey 2025 (1,011 US adults, unweighted)
    - Impulse Research, as reported by Tufts in 2013 (1,087 people)
    - USDA SNAP barriers report, as reported by FRAC
    - a 2016 survey of more than 1,000 households reported by The Spoon. It names no owner, so treat it as weak.
- **Forums (`V`):**
    - Straight Dope Message Board (2026)
    - Hungry Onion (2022)
    - two Substack posts with their comments (2025)
    - CookingBites (2019, 2025)

**What was blocked**

- **Reddit.** Every route failed: `reddit.com` returned 403, old.reddit returned 403, the archive APIs timed out, and
  search never returned Reddit pages. **This is the biggest hole in the voice evidence.** The subreddits in the brief
  (r/Cooking, r/AskCulinary and the rest) are not represented at all.
- **eGullet** blocked bots. **MetaFilter** returned 403.
- **USDA and FNS pages** returned 403, so the FSIS and SNAP figures come from secondary reports (Safety+Health
  magazine, FRAC).
- **CookingBites** blocks raw downloads, and the fetch tool did not copy posts word for word. So CookingBites is used
  only as a pointer, in my own words, marked "paraphrase". It is never quoted.
- **Google Play** returned nothing for Samsung Food and Kitchen Stories.
- **Not attempted:** Plan to Eat, AnyList, OurGroceries, Bring!, Out of Milk, Eat This Much and Instacart reviews,
  beyond the App Store pulls above. Those apps belong to the grocery and planning files.

**How "validated" was applied**

A problem is validated if it has `S` or `M` evidence, or `V` evidence from three independent places. Different
websites count as different places. Different apps count as different places. Many reviews of the same app count as
one place.

**Gaps: who is missing from this evidence**

- **Older cooks.** The Spoon's 2016 survey found only about 10% of people aged 60 and over use a device in the kitchen
  weekly. Older cooks are likely to cook from paper and to be absent from app reviews. No study here looks at older
  cooks.
- **Non-English speakers and cooks outside the US.** All reviews are from US English stores. Their voice shows up only
  through complaints about metric and Celsius.
- **Disabled cooks other than blind and low-vision cooks**, for example people with arthritis, tremor, limited
  mobility, or cognitive or attention difficulties. There is one ADHD blog post and nothing else. This is a real gap:
  15% of SNAP participants named a physical disability or limitation as a barrier to healthy eating (USDA, as
  reported by FRAC, see CK-019).
- **Low-income households.** There is one USDA SNAP survey figure, and no voices.
- **Paper and cookbook users**, children and teens, and cooks with no smartphone.
- **People who do not write reviews or post on forums.** App reviews come mostly from people who are angry or
  delighted, and from people who already use apps.

Read every record with these gaps in mind.

## Round 2 method and limits (added 2026-10-21)

**Why a second round.** Round one could not reach Reddit at all. Round two went back to six questions, each treated
as a hypothesis to test, not a fact to prove: do ordinary cooks get overwhelmed while following a recipe; do they do all
the prep before they start, and why; what do studies say about attention, memory and errors while cooking; how do
uncertainty and fear of failure show up; how much do tedium and tiredness matter; and what makes cooking feel bad or
good.

**What I reached**

- **Reddit (`V`), through the Arctic Shift archive API.** This fills round one's biggest hole. I searched post titles in
  r/cookingforbeginners, r/Cooking, r/adhdwomen, r/Parenting, r/AskWomen and r/AskMen, for words such as overwhelmed,
  stress, anxiety, panic, mise en place, confidence, frustrated, tired, enjoy, proud, therapeutic and relaxing. I
  fetched 37 threads with up to 100 comments each, and read the post titles of many more. One fetched thread,
  "Anyone else get COMPLETELY overwhelmed by cooking?" (r/cookingforbeginners, 2022-09-18), had been removed by a bot
  and had no text. Each quote links to the original reddit.com address, at the comment where
  there is one, and carries the comment's own date. Every quote was copied from the archived text and checked word for
  word by a script.
- **App Store (US) reviews (`V`) of four meal-kit apps** that round one did not cover: HelloFresh, Home Chef, Blue
  Apron and SideChef. That is 1,538 recent reviews from Apple's public feed. These cooks follow a recipe card with the
  food already bought and measured, so they show what is left of the cooking problem when shopping and measuring are
  taken away.
- **Studies (`S`):**
    - Hwang et al. 2023 (DIS), re-read in full for overload.
    - Krueger and Schkade, CEPS Working Paper 138, read in full: 229 employed women in Travis County, Texas, who rated
      how they felt during each part of two days in 2005.
    - Widener et al. 2021 (SSM Population Health), Statistics Canada time-use survey, 11,254 adults. The text came
      through a tool that rewrites pages, so I give only its numbers.
    - Stern and Sharfi 2026 (OTJR), adults with and without ADHD. Abstract only.
    - Bowen, Elliott and Brenton 2014 (Contexts), through North Carolina State University's press release, read in full.
- **Surveys (`M`):** the Harris Poll 2010 (2,503 US adults, online, opt-in, weighted), through MediaPost, read in full;
  and Talker Research for Kevin's Natural Foods 2024 (2,000 US adults, online), through the poll firm's own page. The
  Talker page came through a tool that rewrites pages, so I give its numbers, not quotes.
- **Expert writing (`X`):** Sara Moulton's 2012 post against prepping everything first, read in full through the
  Internet Archive (the live page loads its text by script).

**Limits of this round**

- **Title search only.** Some searches failed with an error and are missing: "prep first", "too slow", "multitask" and
  "waste" in r/cookingforbeginners, "stressful" and "hate cooking" in r/Cooking, and every search of r/ADHD. r/ADHD is
  not represented. r/adhdwomen is, so the ADHD voices here are mostly women.
- **Beginners are over-represented by design.** Searching r/cookingforbeginners for "overwhelmed", "anxiety" or "stress"
  finds anxious beginners. Those threads show that a problem exists and what it looks like. They cannot show how common
  it is among ordinary cooks.
- **"Overwhelmed" is a loose word.** It also matched posts about too much zucchini, too many saved recipes and buying
  cookware. Those were not counted as overwhelm during cooking.
- **Scores are not agreement.** The archive stores a comment's score soon after it was posted, so almost every comment
  shows 1 or 2. No claim here rests on a comment's score. A post's points are given only as a rough sign of reach.
- **Large threads are samples.** Threads with more than 100 comments were read only to their first 100.
- **Left out because I could not open them:** a UK Food Standards Agency figure on how many people enjoy cooking (the
  report links returned 404), the six-month results of the Jamie's Ministry of Food evaluation (Flego et al. 2014), and
  a sentence attributed to Bowen et al.'s paper. They appeared only in search snippets.
- **Question 3 (attention, memory and errors) has no direct answer.** I found no study of attention, interruptions
  or errors among ordinary home cooks. What exists is about other groups or settings, and I did not use it as
  evidence: lab "breakfast task" studies of multitasking (Craik and Bialystok 2006 and later work, seen only in
  secondary reports), clinical kitchen tasks used to assess brain injury, and a thesis that timed 24 supervised cooking
  sessions of people with cognitive impairments in sheltered housing (Kosch 2020, arXiv 2010.07703). The evidence on
  this question in CK-020 and CK-021 is therefore first-hand voices plus Hwang et al.
- **Subreddits from the brief that were not searched:** r/AskCulinary, r/EatCheapAndHealthy, r/MealPrepSunday,
  r/Frugal, r/budgetfood, r/TwoXChromosomes and r/loseit.
- **Sent to another file, not recorded here:** meal-kit reviewers often praise not having to decide what to cook
  ("After a long workday, that decision fatigue is real", Blue Apron, App Store, 5★, 2025-05-14, id 12656652761,
  https://apps.apple.com/us/app/id976642810). That is a meal-planning problem and belongs in `mealPlanning.md`.
- **How "validated" was applied this round:** `S` or `M` evidence validates. For `V`, all of Reddit counts as **one**
  place, however many subreddits it comes from. Different apps still count as different places, as in round one. This
  is stricter than round one for forums.
- **Groups this round adds:** anxious beginners, cooks with ADHD (mostly women), parents of young children, and cooks
  using meal kits. **Still missing:** older cooks, non-English speakers, low-income households (apart from the Bowen
  study), people who never post online, and men who cook for a family (r/AskMen threads were mostly about who cooks,
  not how it feels).

---

## Records

### CK-001: I keep going back and forth between the ingredient list and the step to find how much to add

- **Status:** validated
- **Who:** Everyone who cooks from a written recipe, most of all people using phones and screen readers.
- **When:** Mid-step, often with messy hands, when the step says "add the flour" but the amount is somewhere else.
- **Need:** Know the exact amount and form of each ingredient at the moment the step uses it.
- **Evidence:**
    - `S` In a study of real home cooking (45 cooks, 2,376 turns), questions about **ingredients were 24.6%** of all
      needs and questions about **amounts were 17.8%**. Examples: "How much egg yolk is needed?" "How much of the couscous
      do I need for one person?" (Frummet et al., TOIS 2022, https://epub.uni-regensburg.de/51990/1/3498330.pdf)
    - `S` In a cooking study with a voice helper (10 cooks), 8.9% of requests asked for an ingredient quantity and 6.2%
      asked to list the ingredients again. (Vtyurina and Fourney, CHI 2018,
      https://cs.uwaterloo.ca/~avtyurin/papers/Vtyurina_ConversationalCues.pdf)
    - `S` A blind participant: "Whatever it is called for in the ingredient list, just call it by the same name all the
      way through, I'd say." Another: "If more ingredients were that way, six cloves of garlic divided and then you'd
      know". (Li et al., ASSETS 2024, P3 and P7, https://arxiv.org/abs/2407.19065)
    - `V` "We really need the option to toggle back & forth between ingredients and directions. Scrolling up and down is
      cumbersome, especially with more involved recipes." (Recipe Keeper, App Store, 3★, 2026-10-10, id 14651839402,
      https://apps.apple.com/us/app/id974683711)
    - `V` "the ingredients list is no longer in a separate column on the left, making it harder to make recipes without
      constantly scrolling up and down making cooking more difficult." (Kitchen Stories, App Store, 1★, 2023-09-12, id
      10361888976, https://apps.apple.com/us/app/id771068291)
    - `V` "when in cooking mode having to tap on the ingredients to see amounts is counterproductive. It should list the
      amounts below the step/instructions." (Pestle, App Store, 3★, 2023-03-27, id 9759576072,
      https://apps.apple.com/us/app/id1574776971)
    - `V` "it would be nice to be able to see the ingredients and the directions at the same time. Sometimes annoying to
      have to flip back and forth, especially with messy hands." (Paprika, Google Play, 4★, 2026-06-03,
      https://play.google.com/store/apps/details?id=com.hindsightlabs.paprika.android.v3&reviewId=96edfd69-d6ed-480b-80aa-f329f73becea)
    - `V` Where it is done, people notice: "The ingredient portions are listed alongside each step so you don't have to
      go back and forth. Never seen that before and super handy" (Mealime, Google Play, 3★, 2025-07-29,
      https://play.google.com/store/apps/details?id=com.mealime&reviewId=0b238576-db6f-4f7f-a1a4-03bdf33333e1)
    - `V` (added 2026-10-21) A reason amounts and prep should sit together: "Recipe writers that phrase the ingredients
      list like “1 onion, diced” are the GOAT" (Reddit r/cookingforbeginners, 2024-09-25,
      https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lovd6s5/)
- **How often / how bad:** This is the most common kind of question in both observation studies. Amount and
  ingredient questions together were about 42% of needs in Frummet. People call it frustrating, not ruinous. The real
  harm is a wrong amount, or a "divided" ingredient added all at once.
- **Workarounds people use:** Memorising several steps at once (Li et al., P7). Screenshotting the ingredients and
  the steps separately (ReciMe, Google Play, 2026-09-03). Measuring everything out first.
- **Where current products fail:**
    - Kitchen Stories' 2023 redesign removed the side-by-side ingredient column.
    - Pestle hides amounts behind a tap.
    - Mealime shows amounts in its own recipes, but not in recipes users add: "when uploading your own recipes they do
      not show the ingredients with each step" (Mealime, Google Play, 1★, 2026-04-25,
      https://play.google.com/store/apps/details?id=com.mealime&reviewId=f9e996f9-2f54-4ab3-bbf8-cae0c962fa07).
    - Mealime's printed version is patchy: "why put the ingredients needed under some but not all of the steps in the
      printed version" (Mealime, App Store, 3★, 2025-06-17, id 12786794044,
      https://apps.apple.com/us/app/id1079999103).
- **Open questions:** How often does this cause a real error, such as a wrong amount or a doubled "divided"
  ingredient, rather than just effort? Does it differ between people who measure everything first and people who
  prep as they go?

### CK-002: My hands are wet or dirty and I have to touch the screen, and the screen keeps locking

- **Status:** validated
- **Who:** Anyone cooking from a phone, tablet or laptop. Worse for screen-reader users, who must touch the screen more.
- **When:** Mid-step: hands in dough, raw meat or oil, and the screen dims, locks, or needs a swipe to move on.
- **Need:** Read and move through the recipe without touching the device with dirty hands, and without washing them
  each time.
- **Evidence:**
    - `S` Blind and low-vision cooks described "the heavy burden of hand-washing to interact with recipe readers". One
      said: "I only have one option to interact with my recipe reader which is through touch, I had to wash my hands
      multiple times". (Li et al., ASSETS 2024, P17, https://arxiv.org/abs/2407.19065)
    - `S` "it's really difficult to actually grab your phone and try to see. You know. Rinse your hands and then get
      back to other stuff." (Li et al., ASSETS 2024, P19)
    - `S` In the FDA's 2016 Food Safety Survey (more than 4,000 people by phone), "about half of survey respondents have
      used some sort of device while cooking", and "Only about a third of the respondents reported washing their hands
      after touching the device and before continuing cooking." (FDA, 2018 page,
      https://www.fda.gov/food/conversations-experts-food-topics/using-your-smartphone-or-tablet-kitchen-food-safety-hazard)
    - `S` In a USDA observation of 383 home cooks making turkey burgers, mobile devices were among the items contaminated
      during raw-meat handling: 6% of the cooks who did not watch the thermometer video. (USDA FSIS 2018, as reported by Safety+Health, 2018-09-19,
      https://www.safetyandhealthmagazine.com/articles/17472-home-cooks-spreading-lots-of-germs-usda-study-shows)
    - `M` About 7 in 10 of more than 1,000 households bring a device into the kitchen to help them cook. (Survey reported
      by The Spoon, 2016, owner not named,
      https://thespoon.tech/data-insight-do-you-use-a-mobile-device-when-you-are-cooking)
    - `V` "No screen locking on you mid hands messy in a recipe." (Paprika, App Store, 5★, 2025-04-01, id 12492904779,
      https://apps.apple.com/us/app/id1303222868)
    - `V` "this app keeps your phone on so you don't have to touch it as much with messy hands." (Just the Recipe, App
      Store, 5★, 2023-02-23, id 9647657149, https://apps.apple.com/us/app/id1598423213)
    - `V` "having to hit a reset button every 3-4 minutes while using my hands to cook or handle ingredients is
      inconvenient at best." (ReciMe, Google Play, 3★, 2026-09-03,
      https://play.google.com/store/apps/details?id=com.recime.app&reviewId=9261bd04-fc4f-42cd-8125-a1fe2649b036)
    - `V` "The cooking facial navigation is gimmicky and probably not usable for most unless you situate your device just
      right. We need spoken commands like next, back, ingredients, timer, etc." (Crouton, App Store, 3★, 2025-07-03, id
      12849764950, https://apps.apple.com/us/app/id1461650987)
    - Against: The FDA researcher said there is no evidence yet that devices cause foodborne illness ("No, and that's what
      we're planning to study next").
    - Against: Screen-lock complaints are rare in low-star reviews: 2 keyword hits in 3,031 reviews of 1 to 3 stars. Dedicated
      recipe apps mostly keep the screen on already, and users praise this in 5-star reviews. The lock problem is perhaps now
      mostly on recipe websites and in general apps, which this review set does not cover.
- **How often / how bad:** Device use while cooking is common (half to 70% of people). Touching the device with
  dirty hands is a hygiene risk that most people do not see as a problem. Only a third wash their hands after touching
  it.
- **Workarounds people use:**
    - a zip bag or plastic wrap over the device ("I would get like Saran Wrap or something", Li et al., P2)
    - a knuckle or elbow
    - placing the device far from the stove
    - smart speakers
    - turning off auto-lock
    - stylus spoons
- **Where current products fail:**
    - Hands-free controls exist but are fragile. Mealime: "the hands free option constantly crashes my phone" (Mealime,
      App Store, 3★, 2023-12-06, id 10664813170, https://apps.apple.com/us/app/id1079999103).
    - Crouton's wink control depends on where the device is placed.
    - ReciMe on Android resets during cooking.
- **Open questions:** How often do people touch the screen per recipe? Does touching it with dirty hands lead to
  illness? Do people want hands-free control, or just fewer reasons to touch the screen?

### CK-003: I'm juggling several things at once and the recipe doesn't tell me what to do while something else cooks

- **Status:** validated
- **Who:** Everyone making more than one component. Worst for new cooks, slow choppers, and anyone serving a main
  with sides.
- **When:** Mid-cook: pasta boiling while the sauce needs making, sides done before the main, onions burning while
  you cut potatoes.
- **Need:** Know what can be done in parallel, what must happen in order, and when to start each part so everything
  is ready together.
- **Evidence:**
    - `S` The most common need in real home cooking was the next step: "Preparation" questions were 28.7% of all needs
      ("What's next after bringing to the boil?"). (Frummet et al. 2022)
    - `S` The most common request to a voice helper was the next step or ingredient: 32.8%. (Vtyurina and Fourney 2018)
    - `S` "I need time, and things that keep time management going. So a recipe where will give you the instructions to
      cook pasta and tell you while you're cooking the pasta now you can do something, you can make the sauce." (Li et
      al., ASSETS 2024, P11)
    - `S` "Fragmentation": "All of the garnishing, [Alexa] told me them in three different steps . . . So I had to stand
      there, wait for it to say it". (Hwang et al., DIS 2023, 12 cooks, C9, https://arxiv.org/abs/2306.09992)
    - `V` "Steps are over described (we all know how to boil water), out of order (why am I making the green beans
      before baking the meat for 20 minutes?)" (Mealime, Google Play, 2★, 2025-01-23,
      https://play.google.com/store/apps/details?id=com.mealime&reviewId=b5de77c6-3676-4907-b0b5-06095859ca65)
    - `V` "the steps (order of operations) needs some review and revisions. It doesn't seem like someone actually tested
      the steps." (Mealime, Google Play, 3★, 2026-08-31,
      https://play.google.com/store/apps/details?id=com.mealime&reviewId=f66c4005-877a-404f-ac1e-37be2e07ed0b)
    - `V` "The cooking recipe feature that scrolls when you wave your hand over each step is nice, but it's not
      convenient when there are steps supposed to be in tandem with each other." (Mealime, App Store, 2★, 2024-02-25, id
      10980381051, https://apps.apple.com/us/app/id1079999103)
    - `V` "prep as you go requires multi-tasking" (Mealime, App Store, 2★, 2024-08-12, id 11603440228,
      https://apps.apple.com/us/app/id1079999103)
    - `V` Paraphrase (I was not able to check the raw page): CookingBites members named juggling several dishes so they
      finish together, timing when cooking for people outside the family, and family arriving at unpredictable times as
      their hardest problems (CookingBites, thread of 15 Nov 2025,
      https://www.cookingbites.com/threads/what-do-you-find-the-most-challenging-aspect-of-cooking.31611). In a 2019
      thread, a member said prepping as you go fails for slow cooks, because something burns while they chop
      (https://www.cookingbites.com/threads/writing-up-working-from-recipes-real-life-time-for-prepping-and-cooking.16997).
    - `X` A recipe tester says "TIME" is the number one cooking struggle people name to her (Life As A Strawberry,
      updated 2023-03-06, https://www.lifeasastrawberry.com/dinner-timing/).
    - Against: In the Vtyurina study, all 10 cooks finished their recipe, with low reported workload.
      That was a single dish chosen to be simple, so timing across dishes was not tested.
    - `V` (added 2026-10-21) "I always think I have more time to do something while other steps are happening than I
      actually do." (Reddit r/cookingforbeginners, 2025-11-21, https://www.reddit.com/r/cookingforbeginners/comments/1p3dw0s/_/nq3xonw/)
    - `V` (added 2026-10-21) "trying to make salmon and two sides come out at roughly the same time so it's all still hot
      with three different recipes on phone. I've turned around in circles six times." (Reddit r/adhdwomen, 2025-09-25,
      https://www.reddit.com/r/adhdwomen/comments/1nqjq2l/i_just_realized_why_i_hate_cooking/)
    - `V` (added 2026-10-21) Where a recipe does this, people notice: "I love how the entire meal is laid out in
      integrated
      steps so the whole thing is ready at the same time." (Home Chef, App Store, 5★, 2025-02-28, id 12366758842, https://apps.apple.com/us/app/id994918972)
    - `V` (added 2026-10-21) Timing is the named hard part of cooking for guests: "For me it’s the timing. You want
      everything to finish at the same time and still be hot/fresh" (Reddit r/cookingforbeginners, 2025-07-30,
      https://www.reddit.com/r/cookingforbeginners/comments/1mdii71/_/n61wc5h/). See CK-024.
    - Against (added 2026-10-21): experienced cooks say the problem fades with practice. "As you get more skilled you can
      start doing things on the fly." (Reddit r/Cooking, 2025-08-17, https://www.reddit.com/r/Cooking/comments/1msxfk8/_/n992spu/) But
      one beginner was told: "I know seasoned cooks that still struggle with timing." (Reddit r/cookingforbeginners,
      2025-11-21, https://www.reddit.com/r/cookingforbeginners/comments/1p3dw0s/_/nq3zsx0/)
- **How often / how bad:** The single largest kind of in-the-moment need in both observation studies. The common
  results are cold mains, burnt onions, or a late meal.
- **Workarounds people use:** Several timers, a timer app with one timer per burner, cooking only one new dish at a
  time, make-ahead dishes, and keeping things warm.
- **Where current products fail:**
    - Mealime's own recipes are criticised for step order.
    - Mealime's timer is lost when you go to the next step: "if you move to the next step, the timer is lost so I stick
      to my kitchen timer" (Mealime, Google Play, 3★, 2026-08-31, same review as above).
    - Pestle's timers misbehave: "The timers on this app have never worked." (Pestle, App Store, 2★, 2023-04-19, id
      9839357613, https://apps.apple.com/us/app/id1574776971)
    - Step-by-step modes that show one step at a time hide the parallel work.
- **Open questions:** Do people want one combined timeline, or just a warning before each long wait? How do skill and
  chopping speed change the right order? No study looked at timing across several dishes.

### CK-004: The recipe says "until golden", "to taste" or "medium-high", and I can't tell what that means or when it is done

- **Status:** validated
- **Who:** New cooks most of all. Also blind and low-vision cooks, for whom visual cues are useless. Also anyone on
  different equipment than the writer.
- **When:** At the judgement points: doneness, seasoning, heat level, texture.
- **Need:** Know what "done" or "enough" is in terms I can check: time, temperature, texture, sound, smell or amount.
- **Evidence:**
    - `S` Cooks asked for definitions: "What do you mean to taste? How much should I put?" and "How high is medium-high
      heat is?" (Vtyurina and Fourney 2018: 2.8% of requests)
    - `S` "It is really common to see 'cook this until golden brown' in recipes, but it is sometimes hard to standardize
      the conversion to a description in time or texture." (Li et al., ASSETS 2024, P7) Most participants said visual
      checks were an obstacle "they could not easily overcome".
    - `S` "just knowing the time of cooking didn't give you how well things cooked." (Li et al., ASSETS 2024, P19)
    - `S` "Missing Details": useful details are left out, for example "Cook until the juices run clear. If chicken is
      not consistent thickness, consider cutting into chunks." was added at a cook's request. (Hwang et al., DIS 2023,
      C11)
    - `S` "Cooking technique" questions about steps the recipe did not explain were 7.9% of needs, and "Time" questions
      were 6.8%. (Frummet et al. 2022)
    - `V` "I have never seen a recipe that does an adequate job of explaining the importance of seasoning in stages."
      (biondanonima, Hungry Onion, 2022-09-17,
      https://www.hungryonion.org/t/the-recipe-convention-that-dooms-home-cooks/31260)
    - `V` "some videos says "weigh in flour" but it doesn't specify how mush we should actually be weighing" (Kitchen
      Stories, App Store, 4★, 2018-10-30, id 3363435893, https://apps.apple.com/us/app/id771068291)
    - `S` More than 40% of 121 adults with vision loss reported trouble with measuring ingredients and with sanitising food.
      The source gives one shared figure for both. (Rizzo et al., J Nutr Educ
      Behav 2026, as reported by News-Medical, 2026-08-26,
      https://www.news-medical.net/news/20260826/Visual-impairment-may-limit-kitchen-independence-despite-skills.aspx)
    - Against: Experienced cooks do not want this spelled out. One CookingBites member said they find it hard to follow
      a recipe exactly as written at all (paraphrase, 2025). Li et al.'s P9 wanted detail "but not so much that you have a paragraph for each step." The need depends on skill.
    - `V` (added 2026-10-21) "Pots boiling over, something sizzling too quickly, me googling what simmer actually looks
      like... total chaos." (Reddit r/cookingforbeginners, 2025-11-21,
      https://www.reddit.com/r/cookingforbeginners/comments/1p3dw0s/why_does_every_simple_recipe_still_feel_stressful/)
    - `V` (added 2026-10-21) "there are apparently a million and one "intuitive" things that no one tells you and you're
      just supposed to know and recipes won't tell you them either." (Reddit r/cookingforbeginners, 2026-02-04,
      https://www.reddit.com/r/cookingforbeginners/comments/1qvlxt8/is_there_a_way_to_actually_enjoy_cooking/)
    - `V` (added 2026-10-21) Not knowing until the end: "the worst part is having to wait like 40 minutes to see if you've
      fucked up" (about baking; Reddit r/Cooking, 2018-10-23, https://www.reddit.com/r/Cooking/comments/9qhexy/_/e8b8zef/). See CK-029.
- **How often / how bad:** Common for beginners. The results range from bland or over-salted food to undercooked meat
  (see CK-009).
- **Workarounds people use:** Searching for another recipe that describes the cue differently (Li et al., P7). YouTube.
  A thermometer. Asking someone. Tasting as you go.
- **Where current products fail:** Recipe text is passed through unchanged. No app reviewed adds a missing cue, and
  voice helpers "did not surface crucial details" (Hwang et al.).
- **Open questions:** Which cues cause the most failures? Can one recipe serve beginners and experts, or does it need
  different levels of detail?

### CK-005: Ads, pop-ups, freezes and crashes cover the step I'm on

- **Status:** validated
- **Who:** People using free recipe sites and ad-supported or buggy apps.
- **When:** Mid-recipe, at a glance, often with food on their hands.
- **Need:** See the current step and amounts whenever I look, with nothing covering them.
- **Evidence:**
    - `V` "It's horribly frustrating when my hands are covered in food and I glance over to see the next step and there
      is an ad blocking it." (Samsung Food, App Store, 2★, 2023-09-04, id 10333811006,
      https://apps.apple.com/us/app/id1133637674)
    - `V` "Now I can barely follow any recipe because of the full page ads that take over every 10-15 seconds." and "I
      have ruined a few recipes because I lose my place" (Samsung Food, App Store, 1★, 2025-03-25, id 12464621865,
      https://apps.apple.com/us/app/id1133637674)
    - `V` "I'm paying for an annual subscription, yet have massive adds displayed in the app where inadvertent clicks
      while scrolling takes you out of the app" (NYT Cooking, App Store, 3★, 2026-08-04, id 14389186613,
      https://apps.apple.com/us/app/id911422904)
    - `V` "When I actually wanted to cook something I had imported, I couldn't. Each time I open a recipe and start
      scrolling to read the directions, the app would freeze" (ReciMe, App Store, 2★, 2026-10-13, id 14663652976,
      https://apps.apple.com/us/app/id1593779280)
    - `V` "It freezes and won't let me see the rest of the instructions that include oven temps and duration." (ReciMe,
      App Store, 3★, 2026-10-03, id 14624114534, https://apps.apple.com/us/app/id1593779280)
    - `V` "there are so many pop-up ads that it's hard to read the recepies." (Paprika, Google Play, 2★, 2026-06-21,
      https://play.google.com/store/apps/details?id=com.hindsightlabs.paprika.android.v3&reviewId=cd7345b8-7e81-4f45-a702-f1a55af0013b)
    - `V` "my iPad is old and it tends to temporarily freeze up at spots while scrolling through content-heavy pages."
      (solost, Straight Dope, 2026-06-11, https://boards.straightdope.com/t/recipes-on-line/1030826)
    - `V` "I wouldn't be able to rely on cooking something from it so it's a bit pointless." (ReciMe, Google Play, 2★,
      2026-10-14,
      https://play.google.com/store/apps/details?id=com.recime.app&reviewId=8b9bfcfc-5706-41ae-95cf-ac2a732893b0)
- **How often / how bad:** Frequent in reviews of ad-supported apps. Crashes and freezes are among the most common
  complaints across all apps, though not all of them happen during cooking. It is severe when it happens mid-step,
  because people lose their place and ruin dishes. Old devices make it worse.
- **Workarounds people use:** Paying for an app to escape ads. Printing. "Jump to recipe". Screenshots. Going back to
  paper ("I will get the recipes printed on cards", Mela, App Store, 1★, 2025-10-24, id 13308213862,
  https://apps.apple.com/us/app/id1548466041).
- **Where current products fail:**
    - Samsung Food (full-screen ads after the Whisk rebrand)
    - NYT Cooking (ads despite a subscription)
    - ReciMe (freezing in 2026)
    - Yummly on Google Play ("Gave 3 stars due to all the ads popping up over what im trying to see", 2024-01-27,
      https://play.google.com/store/apps/details?id=com.yummly.android&reviewId=cd2da831-5e62-4d12-881f-5ab93c59d369)
- **Open questions:** How much of this is web versus app? Does an offline copy of the recipe prevent it?

### CK-006: The recipe I saved or imported is quietly wrong, with missing steps, changed amounts or bad fractions

- **Status:** validated
- **Who:** People who save recipes from websites, social video or photos into an app.
- **When:** Mid-cook, when an amount looks odd or a step is missing, and they have to go back to the original.
- **Need:** Trust that the recipe in front of me says exactly what the source said.
- **Evidence:**
    - `V` "if the recipe says "1 and 1/2 cups" it will only pull 1/2 cup ... I have to double check them all for
      errors." (Crouton, App Store, 2★, 2023-10-27, id 10522444835, https://apps.apple.com/us/app/id1461650987)
    - `V` "Crouton reading my "2-1/4" that I do for readability as "a range from two to one-fourth"" (Crouton, App
      Store, 2★, 2025-11-04, id 13356894922, https://apps.apple.com/us/app/id1461650987)
    - `V` "I follow the instructions on the app and find something off just to look at the original instructions. Then
      to realize the steps had become distorted, with either extra/reapted steps added in or steps are taken out."
      (ReciMe, App Store, 1★, 2026-09-21, id 14578448843, https://apps.apple.com/us/app/id1593779280)
    - `V` "over half the recipes I've entered on here so far have something wrong or missing. I've had 2 meals now where
      I have to figure out what to substitute for an item missing on the list." (ReciMe, App Store, 3★, 2026-09-20, id
      14572534062, https://apps.apple.com/us/app/id1593779280)
    - `V` "the amounts of ingredients (esp. grams, ounces) do not match the amounts provided on the original recipe
      website." (Samsung Food, App Store, 2★, 2025-11-12, id 13390856591,
      https://apps.apple.com/us/app/id1133637674)
    - `V` "Recipe for homemade Graham Crackers. apparently they now contain paprika, who knew!" (ReciMe, Google Play,
      1★, 2026-10-17,
      https://play.google.com/store/apps/details?id=com.recime.app&reviewId=ae49cd6f-3205-401d-b031-e9efc4297b83)
    - `V` "the recipe in the app doesn't match the one in the browser." (Yummly, Google Play, 1★, 2024-09-25,
      https://play.google.com/store/apps/details?id=com.yummly.android&reviewId=8e781a04-269e-476d-a6fd-5aecadefd1f0)
- **How often / how bad:** Reported across at least four apps, with a cluster in 2026 tied to ReciMe's AI import. It
  is severe because the cook finds out mid-recipe, often too late, and loses trust in every saved recipe.
- **Workarounds people use:** Checking against the original every time. Keeping the link. Retyping by hand.
- **Where current products fail:** Crouton (fractions), ReciMe (AI rewrites steps), Samsung Food (amounts), Yummly
  (app versus web). The import itself belongs to `findingRecipes.md`. The harm lands here, at the stove.
- **Open questions:** How often are imports wrong when nobody complains? Do people check before cooking or only after
  something looks off?

### CK-007: I didn't see the whole job before I started: preheat, marinate, rest, or a step that takes an hour

- **Status:** validated
- **Who:** New cooks and busy cooks. Screen-reader users, who find reading the whole recipe slow.
- **When:** Partway through, when a step says to marinate overnight or to preheat the oven, and it is too late.
- **Need:** Know before starting what the recipe involves, what has to happen first, and how long the waits are.
- **Evidence:**
    - `S` "Missing the Big Picture": "Alexa maybe could give me the bigger picture in the introduction." And "Time
      Insensitivity": "like pre-heating the oven . . . If you're not preparing [preheating or thawing] that ahead of
      time, then either you're gonna be waiting 20 minutes or you'll just be going ahead with whatever, cold meat"
      (Hwang et al., DIS 2023, C10 and C1)
    - `S` Cooks usually read the whole recipe first to check ingredients, tools and time. Screen-reader users found this
      took too long, partly because of the stories on the page. They wanted "a short overview of how the recipe is going
      to turn out". (Li et al., ASSETS 2024, P9)
    - `V` "doesn't say upfront how ingredients are prepped, have to read through recipe" (Mealime, App Store, 2★,
      2024-08-12, id 11603440228, https://apps.apple.com/us/app/id1079999103)
    - `V` "Since the update I can no longer view the full recipe and the steps involved. This helped me to decide whether
      to cook it or not." (Cookidoo, Google Play, 2★, 2025-04-07,
      https://play.google.com/store/apps/details?id=com.vorwerk.cookidoo&reviewId=44529f3f-eb00-4ca8-90b8-5aac5435e961)
- **How often / how bad:** Unknown frequency. Its cost is a delayed meal or a skipped step, such as cold meat or a
  shorter marinade.
- **Workarounds people use:** Reading the recipe through first, which is expert advice that people often skip.
  Printing it.
- **Where current products fail:** Step-by-step modes and voice helpers give one step at a time, which hides the
  shape of the whole job (Hwang et al.). Cookidoo's 2025 update removed the full view.
- **Open questions:** How many people read the recipe through before starting? Which advance steps get missed most
  often?

### CK-008: I lose my place in the recipe, and voice helpers forget where I am

- **Status:** validated
- **Who:** Everyone, and most of all screen-reader and voice-assistant users.
- **When:** After looking away, after an interruption, or after an accidental swipe or a pop-up.
- **Need:** Get back to exactly where I was, and move to the next or previous bit, without starting over.
- **Evidence:**
    - `S` "It is very common that it does not recognize your wording clearly and loses the current stage of
      information" (Li et al., ASSETS 2024, P15, about Alexa)
    - `S` "you can accidentally go out of the file or you can accidentally lose your place." (Li et al., ASSETS 2024, P1)
    - `S` 7.8% of requests to a voice helper were to repeat something. 8 of 10 cooks repeated an instruction aloud to
      themselves. (Vtyurina and Fourney 2018)
    - `S` "Failure to Listen": "Alexa, what should I do with the sausage? [ 11 seconds pass while C8 chops onions]. . .
      She ignored me." "Discarded Context": asked how much vinegar the recipe needed, Alexa answered from a medical
      website. (Hwang et al., DIS 2023)
    - `V` "I'm constantly stopping to close out a full page ad over and over to the point that I have ruined a few
      recipes because I lose my place" (Samsung Food, App Store, 1★, 2025-03-25, id 12464621865,
      https://apps.apple.com/us/app/id1133637674)
    - `V` "I tried to scroll down to see the ingredients and it sent me to my recipe box." (NYT Cooking, App Store, 3★,
      2026-10-11, id 14655169674, https://apps.apple.com/us/app/id911422904)
- **How often / how bad:** Common in studies. It hurts most for a cook who cannot see the screen.
- **Workarounds people use:** Memorising steps. Ticking steps off on paper. Not using voice assistants for recipes
  (P15: "I typically do not use Alexa to guide me through the recipe").
- **Where current products fail:** Alexa (Hwang et al., Li et al.). NYT Cooking misreading scroll gestures. Ad
  interruptions (CK-005).
- **Open questions:** How do sighted cooks keep their place today? No study measured this for them.

### CK-009: I'm not sure the meat is cooked safely, and I spread raw-meat germs without noticing

- **Status:** validated
- **Who:** All home cooks. Few see it as their problem.
- **When:** Handling raw meat, then touching spice jars, taps or the phone. Deciding when meat is done.
- **Need:** Know the food is safe to eat, and avoid spreading germs from raw food while cooking.
- **Evidence:**
    - `S` USDA observation of 383 cooks: participants washed their hands "only about 30 percent of the time" when they
      needed to. "Almost half contaminated spice containers." Only 34% of the group without the video used a thermometer,
      versus 75% after a short video. (USDA FSIS 2018, as reported by Safety+Health, 2018-09-19,
      https://www.safetyandhealthmagazine.com/articles/17472-home-cooks-spreading-lots-of-germs-usda-study-shows)
    - `S` "Only about a third of the respondents reported washing their hands after touching the device and before
      continuing cooking." (FDA 2016 Food Safety Survey, 4,000+ people)
    - `S` "Sometimes if your water evaporates faster or if your heat is too low, it will be raw on the inside." (Li et
      al., ASSETS 2024, P19)
    - `S` More than 40% of 121 adults with vision loss reported trouble with measuring and sanitising food (one
      shared figure, see CK-004). (Rizzo et al. 2026)
    - `V` Paraphrase (I was not able to check the raw page): CookingBites members named undercooking meat, and frying
      chicken so the inside is done before the outside burns, as their hardest problems (CookingBites, 15 to 19 Nov 2025,
      https://www.cookingbites.com/threads/what-do-you-find-the-most-challenging-aspect-of-cooking.31611).
    - `V` "App and thermometer do not update in real time. ... Consistently over and under cool due to the readings on
      here." (Yummly, Google Play, 1★, 2024-04-23,
      https://play.google.com/store/apps/details?id=com.yummly.android&reviewId=4fe7da2b-4ee2-4dc7-853f-b953a50351c1)
    - `V` (added 2026-10-21) Fear leads to overcooking: "I’m terrified of making myself or someone else sick so I tend to
      overcook things." (Reddit r/cookingforbeginners, 2024-11-06,
      https://www.reddit.com/r/cookingforbeginners/comments/1gl2chx/severe_anxiety_with_cooking_its_embarrassing/) In the same title search, 10
      of the 40 r/cookingforbeginners posts with "anxiety" in the title mention chicken, raw food or food safety, for
      example "Extreme anxiety when cooking chicken." (2020-09-19).
- **How often / how bad:** The behaviour is very common: unsafe handwashing in about 70% of needed moments. Illness
  from it is real (USDA cites 48 million US cases a year from all causes) but not tied to recipes. Worry about
  doneness shows up in forum voices.
- **Workarounds people use:** Cutting into meat to check. Overcooking to be safe. Thermometers, used by a minority.
- **Where current products fail:** Recipes rarely state safe temperatures or handwashing points. The USDA video
  doubled thermometer use, which suggests a prompt at the right moment works. Here that is a finding, not a solution
  claim. Connected thermometers have their own reliability complaints (Yummly).
- **Open questions:** Do cooks want safety prompts, or find them nagging? This is a latent need: it rarely appears in
  complaints.

### CK-010: The recipe assumes skill I don't have, and I can't tell whether I'm doing it right

- **Status:** validated
- **Who:** New and occasional cooks, young adults, men (per Irish research), and people who have had a kitchen disaster.
  The opposite group, experienced cooks, find beginner detail tiring.
- **When:** At an unfamiliar technique, or right after doing a step, when unsure it was right.
- **Need:** Get the amount of explanation that fits my skill, and confirm I did a step correctly before moving on.
- **Evidence:**
    - `S` Cooks used "reassurances" a lot to check they had understood a step ("Meanwhile, I have to let it cook,
      right?"). 18 of 45 participants seldom or never cooked. (Frummet et al. 2022)
    - `S` Barriers to cooking from scratch included "effect of kitchen disasters". Greater self-efficacy helped. (Lavelle
      et al., Appetite 2016, 27 interviews, https://openaccess.city.ac.uk/id/eprint/15260/)
    - `S` "there are different modes of viewing a recipe ... when they're battle planning, they're preparing to cook,
      that information is annoying, it's too much." (Li et al., ASSETS 2024, P1). P9: "It has to be detailed, but not so
      much that you have a paragraph for each step."
    - `V` "far too many steps (seemingly directed at people who are cooking for the 1st time)" (Mealime, Google Play, 1★,
      2026-03-12,
      https://play.google.com/store/apps/details?id=com.mealime&reviewId=8ae72d75-4115-4f47-8710-de5e2a0f6078)
    - `V` "Sometimes I see a recipe with dismal reviews and it comes out ok and sometimes I try a well rated item and it
      is a flop. It would be so great to learn from experiences of other people." (Cookidoo, App Store, 3★, 2026-08-30,
      id 14492048299, https://apps.apple.com/us/app/id1470401164)
    - Against: `M` 62% of 1,011 US adults say they are very or extremely confident cooks, and only 7% name lack of skill as the
      biggest obstacle. Time (20%) and tiredness after work (19%) rank higher. More than half of Gen Z said they were
      only moderately confident or less. (Instacart / SurveyMonkey, 2025-09-11, unweighted,
      https://company.instacart.com/ideas/cooking-at-home-survey)
    - Against: `M` An older survey found 28% "don't know how to cook" (Impulse Research, 1,087 people, reported by Tufts
      2013-11-15, https://www.nutritionletter.tufts.edu/general-nutrition/28-of-americans-cant-cook). The two surveys
      disagree. Wording and sample likely explain it.
    - `V` (added 2026-10-21) Meal-kit cooks say a fully specified recipe built their skill and confidence: "Before Blue
      Apron, I barely knew my way around a kitchen. Now, thanks to their easy-to-follow recipes, I’ve actually learned how
      to cook—and I enjoy it!" (Blue Apron, App Store, 5★, 2025-05-14, id 12656652761, https://apps.apple.com/us/app/id976642810) And: "every time I tried a
      recipe, it was usually an epic fail…until Blue Apron came into my life." (Blue Apron, App Store, 5★, 2023-01-14,
      id 9507716299, https://apps.apple.com/us/app/id976642810)
    - Against (added 2026-10-21): the same kits may not teach skill that carries over. "The convenience of having
      pre-mixed spices makes it harder to learn what to use for a given kind of dish. These are essentially 1-and-done,
      not very transferable recipes" (Home Chef, App Store, 4★, 2026-09-27, id 14600918662, https://apps.apple.com/us/app/id994918972)
- **How often / how bad:** The validated part is the need for reassurance and for the right level of detail. The
  surveys against show how big it is. Skill is a smaller barrier than time for most adults, but it is large for young adults and
  rare cooks. Detail that is wrong for the reader irritates both beginners and experts.
- **Workarounds people use:** Cooking only known dishes. YouTube. Calling family. Reading recipe comments.
- **Where current products fail:** Recipes have one fixed level of detail. Mealime is seen as too wordy by an
  experienced cook. Cookidoo has no shared experience from other cooks.
- **Open questions:** Can people judge their own level? Which steps make people lose confidence most?

### CK-011: Units are in a system I don't use (cups or grams, °F or °C, gas mark)

- **Status:** validated
- **Who:** Cooks outside the US using US recipes, US cooks using metric recipes, and bakers who weigh.
- **When:** At the measuring step, with no matching tools.
- **Need:** Get each amount and temperature in units I can measure with the tools I have.
- **Evidence:**
    - `V` "I have to constantly flip in and out of the app to get the conversions since I do not own any metric measure
      cooking equipment." (Kitchen Stories, App Store, 1★, 2023-09-12, id 10361888976,
      https://apps.apple.com/us/app/id771068291)
    - `V` "now I can't change the recipe measurements to metric. this makes it unusable anyone not in the US." (Cookidoo,
      Google Play, 1★, 2025-07-07,
      https://play.google.com/store/apps/details?id=com.vorwerk.cookidoo&reviewId=ded7f16a-e087-4874-a1ff-bba779121cc7)
    - `V` "Very annoying to guess how much is needed for a recipe when it's in imperial." (Cookidoo, Google Play, 3★,
      2025-09-29,
      https://play.google.com/store/apps/details?id=com.vorwerk.cookidoo&reviewId=5ea16480-c872-44b5-b42f-eba6e2c4e674)
    - `V` "quite frustrating that it starts the entire planet off in US measurements" (Mealime, Google Play, 2★,
      2025-08-12,
      https://play.google.com/store/apps/details?id=com.mealime&reviewId=6f86e3c7-65d7-4725-b88f-1bed1f21c34c)
    - `V` "It would be so nice if I could change lbs (imperial system) to kg (metric) in the app." (Tasty, Google Play,
      3★, 2026-02-21,
      https://play.google.com/store/apps/details?id=com.buzzfeed.tasty&reviewId=5823a8c5-e03c-4a36-acaf-ba71f085be3c)
    - `V` "Why did you convert 2 tbsp of parsley in a recipe to 40mL? What even is 40 mL of parsley?" (Just the Recipe,
      App Store, 3★, 2022-12-17, id 9406447629, https://apps.apple.com/us/app/id1598423213)
    - `V` "It would be nice if there is a way to convert recipes from imperial to metric and to convert volumemetric to
      weight in grams." (Recipe Keeper, App Store, 3★, 2025-06-02, id 12726898309,
      https://apps.apple.com/us/app/id974683711)
- **How often / how bad:** Frequent in Cookidoo reviews, an international product. For someone without the matching
  tools it blocks cooking. A literal conversion that gives a nonsense unit (40 mL of parsley) is its own failure.
- **Workarounds people use:** Searching conversions mid-recipe. Separate converter apps. Guessing.
- **Where current products fail:**
    - Cookidoo removed metric for some users in 2025.
    - Kitchen Stories' app lacks the web toggle.
    - ReciMe puts conversion behind payment: "locks things like basic unit conversion behind a premium subscription"
      (ReciMe, Google Play, 1★, 2026-10-11,
      https://play.google.com/store/apps/details?id=com.recime.app&reviewId=d68451bf-2cd8-4039-899b-72f24fda9e9d).
    - Just the Recipe, likewise for subscribers who already paid.
    - Kitchen Stories (2017, old) converted the ingredient list but only some amounts in the steps.
    - Praise is rare: "The only positive thing about the app is the scale converter for cups vs. weights" (NYT Cooking,
      Google Play, 2★, 2026-06-10,
      https://play.google.com/store/apps/details?id=com.nytimes.cooking&reviewId=3a710c5f-d39c-4b4e-bd8b-aa942d91356b).
- **Open questions:** How do people want volume-to-weight handled for foods like chopped herbs, where it is not exact?
  This group is under-represented (see Gaps).

### CK-012: I need to cook for a different number of people and the recipe won't scale, or scales wrong

- **Status:** validated
- **Who:** Single cooks, couples, large families and hosts.
- **When:** Before or at the start of cooking, and again at every amount.
- **Need:** Get correct amounts for the number of people I'm feeding, including awkward ones like half an egg, and know
  what else changes, such as pan size and time.
- **Evidence:**
    - `S` "How much of the couscous do I need for one person?" (Frummet et al. 2022, an example Amount question)
    - `V` "why are 2, 4, and 6 servings the only options? At the very least, 1 serving should be an option." (Mealime,
      App Store, 3★, 2025-06-17, id 12786794044, https://apps.apple.com/us/app/id1079999103)
    - `V` "The fact you can't scale recipes beyond certain pre established numbers is mind boggling as it's just simple
      math." (Cookidoo, Google Play, 2★, 2026-09-12,
      https://play.google.com/store/apps/details?id=com.vorwerk.cookidoo&reviewId=c6b503f7-4725-4e06-a663-cafb748c80ab)
    - `V` "it needs to be able to double a recipe, or half a recipe." (Recipe Keeper, App Store, 3★, 2025-11-07, id
      13368600784, https://apps.apple.com/us/app/id974683711)
    - `V` "scaling a recipe struggles to recognize fractional measurements." (Crouton, App Store, 1★, 2024-08-03, id
      11568855753, https://apps.apple.com/us/app/id1461650987)
    - `V` "For recipes that have dual measurements (1 cup / 120g flour), scaling the recipe only modifies the first
      measurement." (Crouton, App Store, 5★, 2025-12-06, id 13483080365, https://apps.apple.com/us/app/id1461650987)
    - `V` "Don't love that I can't scale my recipes" (Yummly, Google Play, 3★, 2024-10-16,
      https://play.google.com/store/apps/details?id=com.yummly.android&reviewId=84519bad-1f90-418c-9df9-2028126878c8)
    - `X` Food writers warn that salt, spices, leavening and yeast do not scale in a straight line, and that pan size and
      baking time change (The Takeout, https://www.thetakeout.com/1920383/biggest-doubling-recipe-mistake/; KitchenAid,
      https://www.kitchenaid.com/countertop-appliances/pinch-of-help/doubling-a-recipe).
- **How often / how bad:** Common. Amounts scaled by hand risk mental-maths errors. Scaling that does not parse
  fractions silently gives wrong amounts.
- **Workarounds people use:** Doing the maths by hand. Making the full amount and freezing it. Halving by eye.
- **Where current products fail:** Mealime and Cookidoo use fixed serving steps. Crouton mis-parses fractions and dual
  units. Recipe Keeper and Yummly have no scaling.
- **Open questions:** How often does scaling cause a failed dish? Do people expect the time and pan to change too? No
  study found.

### CK-013: The stated prep and cook times are wrong; it takes me much longer

- **Status:** validated (updated 2026-10-21, was: reported. `V` now from four places: a Substack post, Mealime, Home Chef and Reddit.
  The counter-evidence is real too; see the evidence lines.)
- **Who:** New cooks, slow choppers, and people who cook after work.
- **When:** When dinner is late. When choosing a recipe for a weeknight.
- **Need:** Know how long the recipe will really take me, from getting things out to food on the plate.
- **Evidence:**
    - `V` "Twenty minutes. That's how long the recipe said it would take for prep." She timed it from taking ingredients
      out: "Fifty-five minutes." "Almost triple the time the recipe said!" "One suspicion I have is that recipe writers
      don't include the mise-en-place." (Jen Sherman, Substack, 2025-06-25,
      https://jensherman.substack.com/p/prep-times-on-recipes-are-almost)
    - `V` "the recipe time takes longer than listed (typical food blogger lie)" (Mealime, App Store, 2★, 2024-08-12, id
      11603440228, https://apps.apple.com/us/app/id1079999103)
    - `V` Paraphrase (I was not able to check the raw page): CookingBites members called 30-minute meal claims misleading,
      because the times leave out gathering, measuring and reading the recipe. One said picking fresh thyme alone can
      take 30 minutes (CookingBites, 2019-10-29,
      https://www.cookingbites.com/threads/writing-up-working-from-recipes-real-life-time-for-prepping-and-cooking.16997).
    - `V` "Even from a website the importer doesn't always get prep/cook/total times right." (Mela, App Store, 4★,
      2024-10-08, id 11812549869, https://apps.apple.com/us/app/id1548466041)
    - `S` Context: US adults spend 0.67 hours a day on food preparation and cleanup on average (men 0.46, women 0.86).
      54% of men and 72% of women do some on a given day. (BLS American Time Use Survey 2024,
      https://www.bls.gov/charts/american-time-use/activity-by-hldh.htm)
    - Against: Some cooks accept a small gap: "Sometimes takes a few minutes longer than the recipe says but that's to be
      expected." (Mealime, Google Play, 5★, 2025-02-05,
      https://play.google.com/store/apps/details?id=com.mealime&reviewId=e129fb73-ef80-4858-b495-536fd8c5193f)
    - `V` (added 2026-10-21) "Sometimes the “Express” or “Easy” are anything but in my opinion." (Home Chef, App Store,
      5★, 2025-07-26, id 12939849062, https://apps.apple.com/us/app/id994918972)
    - `V` (added 2026-10-21) The time label itself can be unclear: "saying “cook & prep time: 20-30” which to me means
      “cook and prep time takes 20 to 30 minutes” as opposed too “prep time is 20 minutes and cook time is 30 minutes”"
      (Home Chef, App Store, 4★, 2024-06-10, id 11365806429, https://apps.apple.com/us/app/id994918972)
    - `V` (added 2026-10-21) Advice given to a panicking beginner: "Throw cooking times in recipes out the window
      entirely, don't even consider them." (Reddit r/cookingforbeginners, 2025-11-22,
      https://www.reddit.com/r/cookingforbeginners/comments/1p3dw0s/_/nq4fzmc/)
    - `X` (added 2026-10-21) The time depends on whether the cook preps first. Sara Moulton, a food writer, says that for
      one of her recipes prepping everything first "would have taken double the time" (saramoulton.com, 2012-07-06,
      https://saramoulton.com/2012/07/saras-kitchen-revelations-mise-en-place-is-a-waste-of-time/). See CK-022.
    - Against (added 2026-10-21): "The estimated prep and cook times are fairly accurate for a novice chef." (Home Chef,
      App Store, 4★, 2026-09-27, id 14600918662, https://apps.apple.com/us/app/id994918972) Meal kits pre-measure the food, so this may not hold for
      ordinary recipes.
    - Against (added 2026-10-21): the felt time can be longer than the real time. "I just feel like it takes sooo much
      time (even when I force myself to check and it only took me 30 minutes to cook)" (Reddit r/adhdwomen, 2026-06-27,
      https://www.reddit.com/r/adhdwomen/comments/1uh7g0a/i_cant_figure_out_how_to_like_cooking_and_not/)
- **How often / how bad:** (Updated 2026-10-21: round two adds Home Chef and Reddit, so this now meets the validated
  rule. The rest of this paragraph is the round one reading.) Reported, not validated: the voice evidence comes from only
  two places I was able to check
  (one Substack post and Mealime reviews). The CookingBites thread is a third place, but I was not able to check its words.
  Frequency is unknown. It ties to the biggest barrier people name, time (Instacart 2025: 20%.
  USDA SNAP: 30% cite time to cook from scratch). A wrong time breaks evening plans and erodes trust.
- **Workarounds people use:** Doubling the stated time in their head. Prepping ahead. Sticking to known recipes.
- **Where current products fail:** Times are passed through from the source, sometimes wrongly (Mela). No reviewed
  product reflects the cook's own speed.
- **Open questions:** How large is the gap on average, and for whom? This needs a timed study.

### CK-014: I'm missing an ingredient, or need to swap one, and don't know what will work

- **Status:** validated
- **Who:** Everyone at some point. People on budgets and in rural areas, and people with dietary limits.
- **When:** Mid-recipe, on finding something missing. Or before starting, when adapting for a diet.
- **Need:** Know what I can use instead, and how it changes the amount, method or result.
- **Evidence:**
    - `V` "If I need to swap an ingredient, I'll just scroll through the comments." (NYT Cooking, App Store, 2★,
      2026-10-16, id 14676326127, https://apps.apple.com/us/app/id911422904)
    - `V` "I've had 2 meals now where I have to figure out what to substitute for an item missing on the list." (ReciMe,
      App Store, 3★, 2026-09-20, id 14572534062, https://apps.apple.com/us/app/id1593779280)
    - `V` "It shouldn't be so difficult to manually edit a recipe if you decided to make substitutions based on your
      preferences." (Samsung Food, App Store, 2★, 2024-08-07, id 11582254311,
      https://apps.apple.com/us/app/id1133637674)
    - `V` "Recipes should allow adding notes as I would like to possibly customize, suggest substitutions, keep track of
      results" (Cookidoo, App Store, 2★, 2024-03-30, id 11102803923, https://apps.apple.com/us/app/id1470401164)
    - `V` "unless your have decent size pockets, you're left with making your recipe of choice with a bunch of
      substitutions." (Mealime, App Store, 2★, 2024-05-14, id 11267377641, https://apps.apple.com/us/app/id1079999103)
    - `V` Where present, it is valued: "Ingredients in recipes will show substitutes if it's at all difficult to find."
      (Mealime, Google Play, 3★, 2025-04-08,
      https://play.google.com/store/apps/details?id=com.mealime&reviewId=82912d42-3181-4e44-8fae-5162146c372d)
    - Against: One NYT Cooking reviewer prefers human comments to an AI swap ("AI, like
      garlic, doesn't need to be in everything"). That is against one answer to the need, not against the need.
- **How often / how bad:** Common. It is worst mid-cook, with no time to shop.
- **Workarounds people use:** Reading comments. Web search. Asking family. Leaving the item out.
- **Where current products fail:** Samsung Food makes editing hard. Cookidoo has no notes for swaps. Swaps for allergy
  or diet reasons are covered under CK-018 and in `findingRecipes.md` (filters that let banned foods through).
- **Open questions:** Do people want swaps they can trust for safety reasons (allergy) or for flavour, and are those
  the same need?

### CK-015: Cleaning up afterwards is a reason not to cook, and cleaning as I go does not happen

- **Status:** validated
- **Who:** Busy people, people with ADHD, small kitchens, and people without a dishwasher.
- **When:** During cooking (piles build up) and after the meal.
- **Need:** Finish the meal without a mess that outweighs the cooking.
- **Evidence:**
    - `M` 25% of 1,087 people avoid cooking because they dislike cleaning the kitchen afterward. 21% say they lack time.
      (Impulse Research, reported by Tufts, 2013-11-15,
      https://www.nutritionletter.tufts.edu/general-nutrition/28-of-americans-cant-cook)
    - `V` "only to get overwhelmed, forget half the ingredients, or somehow set off the smoke alarm?" The same post
      lists "clean as you go" among the things that fail for her (Alice Gendron, Substack, 2025-02-25,
      https://thebravefire.substack.com/p/why-cooking-with-adhd-is-hell).
    - `V` Paraphrase (I was not able to check the raw page): two CookingBites members named washing up, and dishes that
      never end, as their hardest part of cooking (CookingBites, 19 Nov 2025,
      https://www.cookingbites.com/threads/what-do-you-find-the-most-challenging-aspect-of-cooking.31611).
    - `S` Context: the BLS counts food preparation and cleanup together. No current split is available here.
    - `V` (added 2026-10-21) "as a beginner cook im so overwhelmed by the cleanup after :(" (post title, Reddit
      r/cookingforbeginners, 2026-07-20, about 670 points and 331 comments when archived,
      https://www.reddit.com/r/cookingforbeginners/comments/1v1j3m2/as_a_beginner_cook_im_so_overwhelmed_by_the/)
    - `V` (added 2026-10-21) Why washing up feels worse than chopping: "With veggie prep, I can always just choose to get
      take-out if I'm not feeling it. I opt in to cooking. But with dishes, they _have_ to be done whether I want to do
      them or not." (Reddit r/Cooking, 2020-12-16, https://www.reddit.com/r/Cooking/comments/kdyudz/_/gg0011v/)
    - `V` (added 2026-10-21) Washing up is the main cost of prepping first: "I really like to have my mise-en-place
      together, but I refuse to wash a bunch of tiny bowls." (post title, Reddit r/cookingforbeginners, 2021-03-25,
      https://www.reddit.com/r/cookingforbeginners/comments/mclnru/) See CK-022.
    - `V` (added 2026-10-21) "It’s the only way I really bother to cook now as I hate any cooking that requires
      coordinating different steps, or waiting around and stirring pots etc, and it’s also less things to wash up after"
      (about one-pan recipes; Reddit r/adhdwomen, 2025-09-26, https://www.reddit.com/r/adhdwomen/comments/1nqjq2l/_/ng8ym2s/)
- **How often / how bad:** A quarter of people in a 2013 survey. The survey is old. Newer figures exist (a 2026 HelloFresh / Scrub Daddy
  survey) but the page was blocked, so they are not cited.
- **Workarounds people use:** One-pot meals. Cleaning while something bakes. Paper plates. Avoiding recipes that use
  many pots.
- **Where current products fail:** No reviewed app says how many pots or how much mess a recipe makes. No review
  complained about this either, so this is an unmet need people do not voice, not a stated product failure.
- **Open questions:** Is cleanup a reason to choose a recipe (finding), a pain during cooking, or both? Current data
  is needed.

### CK-016: The text is too small, or the app doesn't work with my screen reader or poor eyesight

- **Status:** validated
- **Who:** Low-vision and blind cooks, older cooks (likely, but not in this evidence), and people reading from across
  the counter.
- **When:** Reading at a distance, or with a screen reader, mid-cook.
- **Need:** Read every part of the recipe at a size and in a form I can use from where I stand.
- **Evidence:**
    - `V` "I am unable to use this app because the only font size I can change is the ingredient list." (NYT Cooking,
      App Store, 1★, 2026-08-10, id 14412222500, https://apps.apple.com/us/app/id911422904)
    - `V` "I wish the settings allowed me to change the font size." Title: "Not great for vision impaired" (Crouton, App
      Store, 3★, 2025-02-23, id 12347634520, https://apps.apple.com/us/app/id1461650987)
    - `V` "The recipes are great but the font is too small and I can't locate a settings option to change it." (Yummly,
      Google Play, 2★, 2024-02-10,
      https://play.google.com/store/apps/details?id=com.yummly.android&reviewId=4769d97a-75fc-419c-ba84-acd24e513ec9)
    - `V` "Ingredient lists in recipes are overly messy with small font and unnecessary individual images ... there needs
      to be an option to remove unnecessary images for those with disabilities." (Cookidoo, Google Play, 2★, 2025-04-06,
      https://play.google.com/store/apps/details?id=com.vorwerk.cookidoo&reviewId=825cf46e-e23d-48af-860b-31cbfceacf4b)
    - `V` "I am also blind using voice over. Navigation is quite difficult. Your Videos are next to meaningless for me."
      (Kitchen Stories, App Store, 2★, 2019-08-14, id 4616932804, https://apps.apple.com/us/app/id771068291)
    - `S` Screen readers repeat unneeded text, and recipes with long stories take too long to read. Visual cues are
      inaccessible. (Li et al., ASSETS 2024.) Most of 121 adults with vision loss had medium or high cooking skill, yet
      many still struggled to follow recipes. (Rizzo et al. 2026)
- **How often / how bad:** Few reviews mention it, but for the people affected it blocks use entirely ("I am unable to
  use this app").
- **Workarounds people use:** Zooming screenshots. Printing in large type. Using a different app. Asking someone.
- **Where current products fail:** NYT Cooking (only the ingredient font scales), Crouton, Yummly, Cookidoo, Kitchen
  Stories (video-first with no text).
- **Open questions:** What is the reading distance at the counter? What do older cooks need? No evidence here.

### CK-017: Video recipes are too fast to follow while cooking, and I keep pausing and rewinding

- **Status:** validated
- **Who:** People who learn from TikTok, Instagram, YouTube or app videos. Most young adults use video for cooking.
- **When:** Mid-cook, trying to match the video while their hands are busy.
- **Need:** Follow each action at my own pace, and find the exact amount or step again without scrubbing through.
- **Evidence:**
    - `S` People following instructional videos must pause them again and again. They pause to find things, to start the
      action, to keep up, and to fix problems. (Tuncer, Brown and Lindwall, "On pause", CHI 2020. Taken from the abstract as
      quoted in search results. I was not able to open the paper. https://emcawiki.net/Tuncer2020a)
    - `V` "If I want to cook something, I have to watch a video played at fast forward speed, to the same snappy tune
      and try to tap fast enough to pause at the next step in the process." (Kitchen Stories, App Store, 1★, 2017-01-07,
      id 1517279452, https://apps.apple.com/us/app/id771068291) (old)
    - `V` "Now it's mostly tik tok videos which are boring and not helpful." (Tasty, App Store, 2★, 2024-04-25, id
      11200718603, https://apps.apple.com/us/app/id1217456898)
    - `V` "when the language is other than English there is no way to change it to English. so I have to watch the video
      to make it." (ReciMe, Google Play, 2★, 2026-09-29,
      https://play.google.com/store/apps/details?id=com.recime.app&reviewId=418b32df-f4f2-4548-93cd-75d789a9eefa)
    - `M` 36% of US adults use YouTube for cooking ideas, and nearly 38% of 18 to 29 year olds use TikTok. (Instacart, 2025)
    - `S` Audio-only has the opposite gap: "It would also be nice to have a visual image of what the sauce is supposed to
      look like" (Hwang et al., DIS 2023, C4)
    - Against: Some people like video steps: "I loves the app at the beginning where it was full of
      practical videos of the step by step recipe" (Tasty, Google Play, 3★, 2026-06-27,
      https://play.google.com/store/apps/details?id=com.buzzfeed.tasty&reviewId=2b8f6138-3e0b-4cc9-af04-8b2b212cd3fd).
      People value seeing the action. The problem is pace and control, not video itself.
- **How often / how bad:** Growing, as video becomes the main source for young cooks. Severity is unknown.
- **Workarounds people use:** Watching first and writing it down. Screenshots. Saving videos into recipe apps.
- **Where current products fail:** Kitchen Stories (video without text, in 2017). Tasty (short-form social video).
  ReciMe (falls back to the video when import fails).
- **Open questions:** Which parts of a video do people return to? Amounts or technique?

### CK-018: I'm cooking for someone else, often with an allergy or diet, and I'm afraid of getting it wrong

- **Status:** reported
- **Who:** Hosts, parents, partners, and friends cooking for someone with an allergy, a diet or a strong preference.
- **When:** Planning and cooking a meal for guests or family with a different diet.
- **Need:** Be sure the dish is safe and right for the people eating it, and ready when they are.
- **Evidence:**
    - `S` Among 1,941 Canadian children with peanut allergy, 37% of accidental exposures happened at home and 14.3% at
      relatives' or friends' homes. Restaurants accounted for 9.3%. (Cherkaoui et al., Clin Transl Allergy 2015,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC4389801)
    - `V` "This app is gonna kill someone. STAY AWAY if you have severe food allergies!" (about suggestions that ignored a
      set nut allergy) (Yummly, Google Play, 1★, 2024-02-11,
      https://play.google.com/store/apps/details?id=com.yummly.android&reviewId=309d2ea8-4faf-474b-a6c9-b8b9d2ff31c9)
    - `V` "I have a shellfish allergy but I don't want to rule out all seafood ... when I have only shellfish marked on
      avoid I still get things like shrimp popping up." (Tasty, App Store, 2★, 2026-07-27, id 14356664937,
      https://apps.apple.com/us/app/id1217456898)
    - `V` Paraphrase (I was not able to check the raw page): CookingBites members named timing when cooking for people
      outside the immediate family, and guests arriving at unpredictable times, as hard parts (CookingBites, 15 Nov 2025).
- **How often / how bad:** Reported, not validated: studies show where allergy exposures happen, but not that
  cooking for others is the cause. Allergy errors can be life-threatening. Most of the app complaints are about recipe
  filters, which is finding, not cooking. Evidence about the in-kitchen side is thin: checking labels, cross-contact
  with shared tools, swapping safely.
- **Workarounds people use:** Cooking familiar dishes for guests. Asking guests. Make-ahead dishes. Avoiding recipes
  with the allergen entirely.
- **Where current products fail:** Allergy filters let banned foods through (Yummly, Tasty, Samsung Food: "I am gluten
  free ... every single day it gives me suggestions for recipes that have gluten", App Store, 1★, 2022-04-30, id
  8622981231, https://apps.apple.com/us/app/id1133637674). See `findingRecipes.md`.
- **Open questions:** How do cooks check a recipe for an allergen while cooking? How common is cross-contact from
  shared tools? Direct research is needed.

### CK-019: The recipe assumes equipment I don't have

- **Status:** validated
- **Who:** Low-income households, small or shared kitchens, students, and people new to cooking.
- **When:** Reading the recipe, or mid-recipe, for example at a step that needs a stand mixer.
- **Need:** Know whether I can make this with what I have, or how to do the step another way.
- **Evidence:**
    - `M` 11% of SNAP participants named lack of adequate kitchen equipment as a barrier to healthy eating, and 14% named
      storage. Cost (61%) and time to cook from scratch (30%) ranked higher. (USDA FNS, _Barriers That Constrain the
      Adequacy of SNAP Allotments_, as reported by FRAC. I did not check the sample because the USDA page was blocked.
      https://frac.org/blog/cost-tops-list-of-hurdles-to-eating-healthy-while-receiving-snap-a-new-usda-study)
    - `S` Wolfson and Bleich (NHANES 2007 to 2010, more than 9,000 adults) list lack of cooking equipment among the
      barriers to cooking. This is from the lead author's comments, not a measured result. (Johns Hopkins, 2014,
      https://clf.jhsph.edu/about-us/news/news-2014/study-suggests-home-cooking-main-ingredient-healthier-diet)
    - `S` A rehabilitation instructor said students "sometimes struggle with the tools they have at home". (Li et al.,
      ASSETS 2024)
    - Against: An Oklahoma survey of food stamp applicants found over 97% of homes had adequate cooking
      equipment (Journal of Extension, 2008, https://archives.joe.org/joe/2008february/rb4.php). It is old and regional.
- **How often / how bad:** A minority (about 1 in 9 SNAP participants), but it blocks the recipe for them.
- **Workarounds people use:** Improvising (a jar for a whisk, a pan for a wok). Skipping recipes.
- **Where current products fail:** No reviewed app lets the cook say what equipment they have. No review asked for
  it, so this is an unvoiced gap.
- **Open questions:** What equipment is most often missing? Do recipes state it up front?

### CK-020: I lose track of what I'm doing, forget a step or ingredient, or forget something is cooking

- **Status:** validated (updated 2026-10-21, was: reported. `V` now comes from three places: a Substack post, Reddit
  and Blue Apron. Stern and Sharfi 2026 adds `S` context, but it measures confidence in food preparation, not
  forgetting.)
- **Who:** People with ADHD or other attention difficulties, tired or distracted cooks, and parents being
  interrupted.
- **When:** Throughout, and most of all during waits or when switching tasks.
- **Need:** Keep track of what is done, what is left and what is cooking right now.
- **Evidence:**
    - `V` "How forgetting you're even cooking is very real (RIP, burnt toast)" and "only to get overwhelmed, forget half
      the ingredients, or somehow set off the smoke alarm?" (Alice Gendron, Substack, 2025-02-25,
      https://thebravefire.substack.com/p/why-cooking-with-adhd-is-hell)
    - `S` "looking back and forth to figure out what am I throwing in there and when and if my timing is right." (Li et
      al., ASSETS 2024, P7)
    - `S` 8 of 10 cooks repeated instructions aloud to themselves, which suggests they were holding things in working
      memory. (Vtyurina and Fourney 2018)
    - `S` (added 2026-10-21) Adults with ADHD reported lower food-preparation self-efficacy than adults without it
      (effect size d = −0.47, p < .001; 63 adults with ADHD, 101 without, self-report questionnaires). (Stern and Sharfi,
      OTJR 2026, abstract only,
      https://cris.haifa.ac.il/en/publications/food-preparation-skills-of-adults-with-adhd-and-the-mediating-eff/)
    - `V` (added 2026-10-21) "I usually end up overcooking chicken because I forgot about… unless I force myself to stand
      there and watch it this always happens." (Reddit r/adhdwomen, 2025-12-30,
      https://www.reddit.com/r/adhdwomen/comments/1pzrkk7/i_forget_im_cooking_all_the_time/)
    - `V` (added 2026-10-21) "Every time I bake I forget to add something." (Reddit r/adhdwomen, 2025-07-28,
      https://www.reddit.com/r/adhdwomen/comments/1mbrd7n/anyone_else_forget_to_add_ingredients_while/)
    - `V` (added 2026-10-21) Not only people with ADHD: "If I get interrupted, I may forget that I didn't grab a
      particular
      spice or add the salt yet. If I get everything out and put it away as I add it, everything actually ends up in the
      dish." (Reddit r/cookingforbeginners, 2024-09-25, https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lovggb9/) And: "I love
      to cook and I’m competent at it, but I would starve or I would have burned down the kitchen by now if I didn’t set
      alarms to check the food." (Reddit r/cookingforbeginners, 2020-07-19,
      https://www.reddit.com/r/cookingforbeginners/comments/hu61tr/_/fyld32h/)
    - `V` (added 2026-10-21) The kitchen itself adds load: "Cooking is also just a very overstimulating activity! It’s
      usually warm, can be loud, and comes with lots of smells and textures." (Reddit r/cookingforbeginners, 2024-12-18,
      https://www.reddit.com/r/cookingforbeginners/comments/1hgp02y/_/m2l2mal/)
    - `V` (added 2026-10-21) Interruptions from children: "I can NOT coordinate all of this stuff plus have kids asking me
      for stuff." (Reddit r/adhdwomen, 2025-09-25, https://www.reddit.com/r/adhdwomen/comments/1nqjq2l/i_just_realized_why_i_hate_cooking/)
    - `V` (added 2026-10-21) Losing a way of tracking progress is felt as a loss: "you removed the checklist. Why? ... The
      old app made cooking stress-free" (Blue Apron, App Store, 1★, 2025-08-13, id 13013227973, https://apps.apple.com/us/app/id976642810)
- **How often / how bad:** (Updated 2026-10-21: round two adds many first-hand voices from cooks with ADHD, and from
  cooks without it who forget when interrupted. Frequency is still unknown.) Unknown. There is only one first-hand
  source on attention difficulties. It can be
  dangerous (a smoke alarm, food left on the heat).
- **Workarounds people use:** Not leaving the kitchen. Timers for everything. Laying out all ingredients first. A
  partner passing ingredients.
- **Where current products fail:** No direct evidence.
- **Open questions:** Needs research with neurodivergent cooks and with people who are often interrupted, such as
  parents of young children.

### CK-021: Halfway through the recipe I panic: pots boil over, things cook too fast, and I can't keep up

- **Status:** validated (added 2026-10-21)
- **Who:** New and anxious cooks most of all, cooks with ADHD, and parents cooking while children need them. Some
  experienced cooks on new or fast recipes. How common it is among ordinary, experienced cooks is **not** established.
- **When:** The time-critical stretch of a recipe: oil is hot, something is sizzling, the next step needs an ingredient
  that is not ready, and the cook must also read the recipe.
- **Need:** Keep up with the steps that cannot wait, without losing control of what is already cooking.
- **Evidence:**
    - `S` Cooks following a recipe by voice often asked the helper to repeat a step, on average 4 times a session, and the
      authors read frequent repeats as a sign that "cooks were feeling overwhelmed by the amount of information they were
      receiving." Five of eleven cooks missed the last step. (Hwang et al., DIS 2023, 12 cooks,
      https://arxiv.org/abs/2306.09992) Two limits: the recipe was read aloud only, and cooks were asked not to read the
      recipe ahead of time. So this shows what happens without an overview, not how common overwhelm is.
    - `V` "every recipe claims to be super easy or foolproof, but I still end up panicking halfway through. Pots boiling
      over, something sizzling too quickly, me googling what simmer actually looks like... total chaos." (Reddit
      r/cookingforbeginners, 2025-11-21,
      https://www.reddit.com/r/cookingforbeginners/comments/1p3dw0s/why_does_every_simple_recipe_still_feel_stressful/)
    - `V` "So many times I throw something in a pan, and can't find my spatula/peeler/etc., and spend my time looking for
      it than doing the next step in the recipe. Then all the sudden it's chaos." (Reddit r/cookingforbeginners,
      2025-11-22, https://www.reddit.com/r/cookingforbeginners/comments/1p3dw0s/_/nq4fzmc/)
    - `V` "I've done it more than once heating oil in a pan, letting it go a little too long, then I add my garlic and it
      just burns immediately. Have to toss out the oil and chop new garlic." (Reddit r/cookingforbeginners, 2024-09-28,
      https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lpa3a51/)
    - `V` "But every time I am in the kitchen I am a stressed out, nervous wreck. I get angry. I get upset." (Reddit
      r/cookingforbeginners, 2024-01-03,
      https://www.reddit.com/r/cookingforbeginners/comments/18x9wlv/i_want_to_be_able_to_feed_myself_more_than_a/)
    - `V` "I prepped all the ingredients, watched loads of videos, found a recipe to follow online. During it I felt
      STRESSED. Nothing felt like it was going right." (Reddit r/cookingforbeginners, 2024-12-18,
      https://www.reddit.com/r/cookingforbeginners/comments/1hgp02y/immense_rage_stress_when_cooking/) This person had already prepped
      everything, so prepping first is not a full cure.
    - `V` Some cooks say the hard part was organising, not cooking: "I thought I was a terrible cook. Really what I was
      terrible at was the organizing part of cooking" (Blue Apron, App Store, 5★, 2024-01-29, id 10877736464, https://apps.apple.com/us/app/id976642810)
    - `V` Round one's ADHD source: "only to get overwhelmed, forget half the ingredients, or somehow set off the smoke
      alarm?" (Alice Gendron, Substack, 2025-02-25, https://thebravefire.substack.com/p/why-cooking-with-adhd-is-hell)
    - Against: In Vtyurina and Fourney's study (CHI 2018), all 10 cooks finished their recipe with low reported workload.
      It was one simple dish.
    - Against: `M` 62% of 1,011 US adults call themselves very or extremely confident cooks (Instacart / SurveyMonkey
      2025, see CK-010). The Reddit voices come from searches that pick out anxious beginners.
    - Against: experienced cooks describe the same moments calmly, as a matter of method: "Some things you'll learn you
      can start, leave it, and have time to prep the next part. Other things you have to prep all of it, and then the
      cooking is rapid fire until done" (Reddit r/cookingforbeginners, 2024-09-28,
      https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lpa3a51/).
- **How often / how bad:** It looks like panic, anger, crying, burnt garlic, a pot boiling over, a skipped step, and
  sometimes giving up on cooking (see CK-023). The evidence shows it is real and common **among beginners and anxious
  cooks**. For experienced cooks it seems to come back mainly with a new or fast recipe. No study measured how often it
  happens among ordinary cooks. The validated status rests on Hwang et al. and on voices from three places.
- **Workarounds people use:** Prepping everything first (CK-022). Reading the whole recipe once or several times
  before starting, even the night before. Cooking on medium heat. Never cooking when very hungry ("NEVER cook when you
  are super hungry. Because you will rush your processes and things will go crazy.", Reddit r/cookingforbeginners,
  2026-02-03, https://www.reddit.com/r/cookingforbeginners/comments/1p3dw0s/_/o3eh5ri/). Choosing slow, forgiving dishes. Meal kits.
- **Where current products fail:** A recipe shown one step at a time hides what is coming (Hwang et al.: "everything
  was a suprise", C8). A recipe shown all at once makes the cook find their place again in the middle of a fast step
  (CK-008). The recipe's own claim to be "easy" or "foolproof" makes the cook blame themselves.
- **Open questions:** How often does this happen to ordinary cooks, and on which kinds of recipe? Is it the recipe's
  pace, the cook's speed, the kitchen, or the reading that tips people over? This needs observation, not desk research.

### CK-022: If I prep while cooking, something burns; if I prep everything first, it takes longer and makes more dishes

- **Status:** validated (added 2026-10-21)
- **Who:** All cooks who follow a recipe. New cooks, forgetful or easily interrupted cooks, and anyone making a fast
  dish (stir fry, a pan sauce, risotto) lean to prepping everything first. Experienced cooks on familiar or slow dishes
  lean to prepping during the waits.
- **When:** Before the heat goes on, and in each gap while something cooks.
- **Need:** Have each ingredient ready at the moment the step calls for it, without leaving the pan and without wasting
  time or making needless work.
- **Evidence:**
    - `S` Cooks wanted to know about long preparations in advance: "If you’re not preparing [preheating or thawing] that
      ahead of time, then either you’re gonna be waiting 20 minutes or you’ll just be going ahead with whatever, cold meat
      or something which will cook slower." (Hwang et al., DIS 2023, C1) One cook's ideal overview included "a list of
      preparatory steps to be performed in advance of the recipe" (C9).
    - `V` **Why people prep first.** "Id rather have a few extra dishes to clean than panic chopping and measuring while
      cooking. My peace of mind (and fingers) are worth the extra dishes." (Reddit r/Cooking, 2025-08-17,
      https://www.reddit.com/r/Cooking/comments/1msxfk8/_/n99eyq4/)
    - `V` "Almost all of my cooking mistakes happen when I fail to prep everything beforehand." and "Trying to prep and
      cook at the same time just adds stress." (Reddit r/Cooking, 2012-02-27, https://www.reddit.com/r/Cooking/comments/q8djq/_/c3vlvjx/)
    - `V` "If you stop after cooking the chicken to cut an onion then the chicken will be overcooked by the time you're
      done" (Reddit r/cookingforbeginners, 2024-09-28, https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lpb1evu/)
    - `V` A cook with attention difficulties: "I suffer from attention issues to even now 4 years later I do everything
      methodically. I prep all my ingredients so I have them on the worktop in order I need them." (Reddit
      r/cookingforbeginners, 2024-11-07, https://www.reddit.com/r/cookingforbeginners/comments/1gl2chx/_/lvwlmm3/)
    - `V` "It often says dice onions and garlic, add to pan, dice mushrooms, add to pan, dice ... and so on. But I prep
      everything beforehand, way less stressful." (Reddit r/cookingforbeginners, 2021-05-26,
      https://www.reddit.com/r/cookingforbeginners/comments/nlc3k6/_/gzidok1/)
    - `V` It changes how cooking feels: "Disorganized cooking can be stressful. Organized cooking feels calm." (Reddit
      r/cookingforbeginners, 2024-09-28, https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lpbkum0/)
    - `V` For a cook with a spinal injury, prepping first saves time overall: "we cut 4 hours of work to 90 minutes"
      (Reddit r/Cooking, 2025-08-17, https://www.reddit.com/r/Cooking/comments/1msxfk8/_/n97s3l4/)
    - `V` Round one's App Store voice: "prep as you go requires multi-tasking" (Mealime, App Store, 2★, 2024-08-12, id
      11603440228, https://apps.apple.com/us/app/id1079999103)
    - `V` **It depends on skill and familiarity.** "If it’s a new recipe, I’ll mise en place. If I’m familiar with the
      steps and timing, I’ll multitask and prep while other things are cooking." (Reddit r/Cooking, 2025-08-18,
      https://www.reddit.com/r/Cooking/comments/1msxfk8/_/n9a6078/) And: "As a beginner you'll underestimate intermediate steps so more prep
      is necessary." (Reddit r/Cooking, 2025-08-17, https://www.reddit.com/r/Cooking/comments/1msxfk8/_/n992spu/)
    - Against: **Prepping everything first wastes time.** "any homecook with some experience will chop the things that
      need to be cooked first and then do the other tasks while those initial things are cooking for example, this saves
      time" (Reddit r/cookingforbeginners, 2024-09-26, https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/loy8e9k/) A former
      culinary student: "it will take 30 minutes for the potatoes to boil, just do that first THEN get the rest of the
      ingredients." (2024-09-26, https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lp2idbt/)
    - Against: `X` Sara Moulton, a food writer who had cooked dinner at home 5 or 6 nights a week for 25 years, calls
      prepping and measuring everything first "a waste of time, literally". For her burger recipe, prepping as she went
      took 15 to 20 minutes, and prepping first "would have taken double the time". She makes two exceptions: "any kind of
      Asian food that involves a lot of ingredients", and restaurant cooking. (saramoulton.com, 2012-07-06, read through
      the Internet Archive,
      https://saramoulton.com/2012/07/saras-kitchen-revelations-mise-en-place-is-a-waste-of-time/)
    - Against: **Space and washing up.** "Mise en place is impossible if you only have space to get one thing out at a
      time." (Reddit r/cookingforbeginners, 2024-09-27, https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lp5lnfq/) "I really
      like to have my mise-en-place together, but I refuse to wash a bunch of tiny bowls." (post title, Reddit
      r/cookingforbeginners, 2021-03-25, https://www.reddit.com/r/cookingforbeginners/comments/mclnru/)
    - Against: **Tiredness wins.** "half the time I don’t start cooking till I am already hangry (mostly after rushing
      home
      after work.)" (Reddit r/cookingforbeginners, 2024-09-25, https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/loxvcvi/) "So I
      just prep as I go, and spice as I go and take hip shots at measurements." (Reddit r/Cooking, 2012-02-27,
      https://www.reddit.com/r/Cooking/comments/q8djq/_/c3vmkuf/)
- **How often / how bad:** The hypothesis was that average cooks prep everything first because they do not trust
  themselves to prep while cooking. The evidence only partly supports it. Distrust of oneself is the stated reason
  mainly for beginners, forgetful cooks and fast dishes. Many cooks do a middle form: they get every ingredient out,
  check nothing is missing, and prep the rest during waits. Most say they prep first for new recipes and not for
  familiar ones. No survey says what share of cooks do which. Prepping first costs time (in Moulton's case, double),
  counter space and washing up. Prepping during costs burnt food when the gap is shorter than the cook thought. A
  recipe's stated time assumes one of the two without saying which (CK-013).
- **Workarounds people use:** Getting everything out first even when not measuring. Grouping ingredients that go in
  together in one bowl or one corner of the board. Putting each ingredient away once it is added, as a record of what
  is done (CK-020). Deli containers or plates instead of many small bowls. Prepping the next step during a long wait.
- **Where current products fail:** Recipes list prep inside the ingredient list ("1 onion, diced") or inside the steps,
  and rarely say which prep can wait for a gap and which must be done first. Round one found no reviewed app that shows
  this.
- **Open questions:** What share of home cooks prep everything first, and does it change with skill, age, kitchen size
  or the dish? How much time does each way really take for the same recipe? A timed study would answer both.

### CK-023: One failed dish shakes my confidence, and I'm afraid of wasting food and money

- **Status:** validated (added 2026-10-21)
- **Who:** New cooks and returning cooks, people on a budget, people cooking for one, and people who are hard on
  themselves. Also some experienced cooks after a run of failures.
- **When:** Right after a dish goes wrong, and before trying anything new.
- **Need:** Try a new recipe without risking a wasted meal, wasted money and a lasting loss of confidence.
- **Evidence:**
    - `S` Barriers to cooking from scratch included "effect of kitchen disasters". Greater self-efficacy helped. (Lavelle
      et al., Appetite 2016, 27 interviews, https://openaccess.city.ac.uk/id/eprint/15260/; already in CK-010)
    - `V` "Messing up something that simple made me feel terrible. I can’t stop thinking about how badly I got it wrong.
      Ever since then, my confidence has taken a hit. Even going into the kitchen makes me feel anxious and a bit sad."
      (Reddit r/cookingforbeginners, 2026-01-05,
      https://www.reddit.com/r/cookingforbeginners/comments/1q4t2fm/i_somehow_managed_to_mess_up_one_of_the_easiest/)
    - `V` "I feel so defeated whenever I spend a bunch of money on ingredients and time making a meal only for it to turn
      out horrible that all I can do is cry as I force myself to eat what I made." (Reddit r/cookingforbeginners,
      2026-02-04, https://www.reddit.com/r/cookingforbeginners/comments/1qvlxt8/is_there_a_way_to_actually_enjoy_cooking/)
    - `V` "now i have to package up all these leftovers of a mediocre meal i won't even really enjoy and keep beating
      myself up over not being able to cook meals as yummy as all of my friends." (Reddit r/cookingforbeginners,
      2023-09-12, https://www.reddit.com/r/cookingforbeginners/comments/16gdpv1/how_do_i_learn_to_enjoy_cooking_if_i_hate_failure/)
    - `V` "If a dish didn't come up "perfectly", it's a waste." (Reddit r/cookingforbeginners, 2024-01-03,
      https://www.reddit.com/r/cookingforbeginners/comments/18x9wlv/i_want_to_be_able_to_feed_myself_more_than_a/)
    - `V` It also happens to experienced cooks: "I’ve been cooking for about 10 years ... Now I dread it and always feel
      overwhelmed with so many recipe failures that turn into throwing your food out and wasting money!" (Reddit
      r/cookingforbeginners, 2024-12-18, https://www.reddit.com/r/cookingforbeginners/comments/1hgp02y/_/m2nlbd3/)
    - `V` Rescue attempts can make it worse: "the worst is when you think "I can salvage this" and just keep adding what
      you _think_ will fix it... Then all of a sudden you've doubled the volume and it's worse than before and it just
      feels super wasteful." (Reddit r/cookingforbeginners, 2026-01-05,
      https://www.reddit.com/r/cookingforbeginners/comments/1q4t2fm/_/nxv0o35/)
    - `V` Fear stops people trying: "whenever I flip through a cookbook or pinterest, I just assume that each recipe is
      too hard and I worry I won't like the result." (Reddit r/cookingforbeginners, 2022-05-08,
      https://www.reddit.com/r/cookingforbeginners/comments/uksv4o/my_lack_of_confidence_makes_it_hard_to_try_new/)
    - `V` A meal-kit cook links waste and confidence: "you don't end up with lots of extra food that goes to waste when
      you're like me and you don't have the kitchen-confidence and creativity to know what to do with it after you cook
      one recipe." (Blue Apron, App Store, 5★, 2024-01-29, id 10877736464, https://apps.apple.com/us/app/id976642810)
    - Against: Experienced cooks say failure is normal and most mistakes are still food: "You will however quickly reach
      the point r where 99% of kitchen mistakes are edible. It's a very forgiving skillset." (Reddit
      r/cookingforbeginners, 2026-01-05, https://www.reddit.com/r/cookingforbeginners/comments/1q4t2fm/_/nxv0kq7/) And from a daily cook:
      "I failed the bolognese I cooked 2 days ago. Sometimes, you fail. There's nothing wrong in it." (2023-09-12,
      https://www.reddit.com/r/cookingforbeginners/comments/16gdpv1/_/k08a84y/)
    - Against: `M` Only 7% of US adults name lack of skill as their biggest obstacle (Instacart / SurveyMonkey 2025, see
      CK-010).
- **How often / how bad:** Frequency is unknown. For the people who post, it is severe: crying, dread, avoiding the
  kitchen, eating takeout, and repeating the same few safe dishes. The cost is food, money and a person's belief that
  they can cook. It appears to hit hardest right after one visible failure on a dish that was called "easy".
- **Workarounds people use:** Cooking only known dishes. Small portions of a new dish. A backup meal or takeout fund
  ("Have a backup dinner or takeout fund at the ready for fuckups.", Reddit r/cookingforbeginners, 2021-04-26,
  https://www.reddit.com/r/cookingforbeginners/comments/mz7jnk/_/gvzc035/). Meal kits with pre-measured food. Tested recipe sources.
- **Where current products fail:** Recipes labelled "easy" or "foolproof" raise the stakes when they fail. Recipes
  rarely say which steps are risky, what a failure looks like, or how to rescue one.
- **Open questions:** What share of cooks avoid new recipes because of fear of waste? Does it differ by income, which
  this evidence barely reaches?

### CK-024: Cooking for guests or family is harder than cooking for myself, because I can't serve my mistakes

- **Status:** validated (added 2026-10-21)
- **Who:** Hosts, people cooking for a new partner, parents of picky children, and mothers who carry the family meal.
  Different from CK-018, which is about allergies and diets.
- **When:** Before and during a meal others will eat, and at the table when it is judged.
- **Need:** Serve others food that is ready on time and good enough, without the pressure taking over.
- **Evidence:**
    - `S` Interviews with 150 female caregivers of children aged 2 to 8, and 250 hours of observing 12 families: "mothers
      from all backgrounds reported difficulty in finding time to prepare meals that everyone in the family would be
      willing to eat." The authors name "the burden of pleasing others" as one of three things that make the home-cooked
      ideal hard. (Bowen, Elliott and Brenton, Contexts 2014, as reported by NC State University, 2014-09-03, https://news.ncsu.edu/2014/09/bowen-out-of-the-kitchen-2014/)
    - `V` "You can eat your mistakes / You can't serve your mistakes to others" (Reddit r/cookingforbeginners,
      2025-07-30, https://www.reddit.com/r/cookingforbeginners/comments/1mdii71/_/n61wqj3/)
    - `V` "If I forget to start on time, oh well, I’ll eat a bit later than I had planned. If I don’t get everything ready
      on time for guests I’m insulting them, saying their time and hunger don’t matter to me." (Reddit
      r/cookingforbeginners, 2025-07-30, https://www.reddit.com/r/cookingforbeginners/comments/1mdii71/_/n6284ma/)
    - `V` "I’ve been seeing a new man and he asked me to cook him dinner. I have no idea what to make because I’m bad at
      everything. I’m very embarrassed." (Reddit r/cookingforbeginners, 2024-11-06,
      https://www.reddit.com/r/cookingforbeginners/comments/1gl2chx/severe_anxiety_with_cooking_its_embarrassing/)
    - `V` "I want to be happy to eat my food and proud to present it to someone." (Reddit r/Cooking, 2026-06-14,
      https://www.reddit.com/r/Cooking/comments/1u5c9pi/why_cant_i_make_a_meal_that_isnt_burntovercooked/)
    - `V` Complaints at the table: "I didn't want to deal with the crying at dinner tonight and made the popular chicken
      nuggets, rice, broccoli plate. The first comment "ewwww this is gross"." (Reddit r/Parenting, 2021-02-21,
      https://www.reddit.com/r/Parenting/comments/lombhc/i_hate_cooking_dinner/) A father in the same thread: "My wife also hates cooking
      because of this, which is disheartening because it's something she used to really enjoy" (2021-02-21,
      https://www.reddit.com/r/Parenting/comments/lombhc/_/go6lzoc/)
    - `V` Criticism kills enjoyment, and its absence brings it back: "I hated cooking when I lived at home because there
      was ALWAYS criticism." (Reddit r/AskWomen, 2025-07-19, https://www.reddit.com/r/AskWomen/comments/1m2k9ds/_/n41xmx1/) "Not having to
      cook for other people. It's more relaxing when I'm not being nagged or judged" (2025-07-18,
      https://www.reddit.com/r/AskWomen/comments/1m2k9ds/_/n3v3njd/)
    - Against: Cooking for others is also a main source of pride and joy (CK-027). And one cook said: "I don't really find
      anything about it extra stressful besides having to make more food." (Reddit r/cookingforbeginners, 2025-07-30,
      https://www.reddit.com/r/cookingforbeginners/comments/1mdii71/_/n61u4ln/)
- **How often / how bad:** Bowen et al. found it in families of every income. For a host, the cost is a late or cold
  meal and embarrassment. For a parent, it is the daily effort of cooking food that is then refused. It overlaps with
  meal-planning burden (see `mealPlanning.md`, MP-002 and MP-015).
- **Workarounds people use:** Making a dish several times before serving it to a guest. Dishes made ahead and finished
  in the oven. Asking guests to bring a dish. A "safe" food on every child's plate. Stopping making separate meals.
- **Where current products fail:** Recipes are written for one cook and one dish, not for a meal served at a set time
  to people with opinions. No evidence here on products.
- **Open questions:** How much of the stress is timing, and how much is fear of judgement? Do men who cook for a family
  report the same? This evidence barely reaches them.

### CK-025: After work I'm too tired to start cooking, even when I know how

- **Status:** validated (added 2026-10-21)
- **Who:** Working adults, shift workers, parents, and people with ADHD or depression. It includes experienced cooks.
- **When:** The evening, between arriving home and being hungry.
- **Need:** Get a decent meal on the table on low-energy days, with little effort to start.
- **Evidence:**
    - `M` 19% of 1,011 US adults name tiredness after work as their biggest obstacle to cooking, close to time (20%).
      (Instacart / SurveyMonkey 2025, already in CK-010)
    - `M` 77% of 2,000 US adults say there are days when they are too exhausted to cook after work, and the poll firm
      reports that a fifth have fallen asleep while cooking. (Talker Research for Kevin's Natural Foods, online,
      2024-08-29, https://talkerresearch.com/nearly-80-of-americans-too-tired-to-cook-after-work/) Treat the second
      figure with care: it is a brand-commissioned online poll and the question wording is not given.
    - `V` "Some nights, i get home after a long day and just looking at the kitchen makes me exhausted, where the thought
      of
      chopping, stirring and timing everything feels impossible." (Reddit r/cookingforbeginners, 2025-12-19, 914
      comments, https://www.reddit.com/r/cookingforbeginners/comments/1pqm33y/when_youre_too_tired_to_cook_whats_your_goto_lazy/)
    - `V` An experienced cook: "I’m not new to cooking so I have experience. ... I’m a nurse that’s always working so
      between shifts I just head home, take a shower and sleep." (Reddit r/Cooking, 2026-09-16,
      https://www.reddit.com/r/Cooking/comments/1whkluf/ashamed_of_using_ubereats_but_too_tired_to_cook/)
    - `V` "it takes energy to start doing it, it takes focus" (Reddit r/adhdwomen, 2026-06-27,
      https://www.reddit.com/r/adhdwomen/comments/1uh7g0a/i_cant_figure_out_how_to_like_cooking_and_not/) And: "The mere thought of having
      to cook leaves me exhausted" (Reddit r/adhdwomen, 2026-08-12, https://www.reddit.com/r/adhdwomen/comments/1vmtco9/_/p3c7t5g/)
    - `V` "I’m tired after work and want something I just pop in the microwave or oven." (Home Chef, App Store, 5★,
      2025-07-26, id 12939849062, https://apps.apple.com/us/app/id994918972) "I work full time 9 hour days and was too tired when I got home to spend forever
      cooking" (HelloFresh, App Store, 2★, 2026-03-13, id 13844187297, https://apps.apple.com/us/app/id970107419)
    - `V` How often the question comes up: in r/Cooking alone, 36 posts from 2012 to 2026 have the exact phrase "too
      tired" in the title, many of them "What do you cook when you're too tired to cook?" threads with hundreds of
      replies.
    - Against: Some tired cooks find cooking restful: "No matter how tired I am, I always find it relaxing when cutting
      onions, ginger, and garlic." (post title, Reddit r/Cooking, 2020-12-16,
      https://www.reddit.com/r/Cooking/comments/kdyudz/no_matter_how_tired_i_am_i_always_find_it/) See CK-027.
- **How often / how bad:** Common: about one adult in five names it as the main obstacle, and the repeated forum
  threads suggest it is an everyday state, not a rare one. The usual result is takeout, a sandwich or frozen food, with
  cost and guilt ("Ashamed of using UberEats").
- **Workarounds people use:** A short list of "too tired" meals. Sheet-pan and slow-cooker meals. Air fryers.
  Leftovers and freezer meals. Meal kits with pre-cut food. Cooking on days off.
- **Where current products fail:** Meal kits labelled "Express" or "Easy" are "anything but" for some tired users
  (Home Chef review above). Recipe times leave out the energy it takes to start.
- **Open questions:** Is the barrier the first step (starting), the total effort, or the deciding (a meal-planning
  problem)? These need separating.

### CK-026: I'm embarrassed that I can't cook, so I avoid it and hide it

- **Status:** reported (added 2026-10-21): `V` from two places only (Reddit and the App Store).
- **Who:** Adults who were never taught, often in their 20s and 30s, and people who feel cooking is expected of them
  because of their gender or role.
- **When:** When asked to cook for someone, when comparing themselves with others, and when choosing not to cook.
- **Need:** Learn and practise cooking without feeling judged for not knowing.
- **Evidence:**
    - `V` "I was never taught or learned how to cook. I’m embarrassed to say I’m in my 30s. I have a deep sense of shame
      that I cannot make very basic things which has led me to avoid it altogether." (Reddit r/cookingforbeginners,
      2024-11-06, https://www.reddit.com/r/cookingforbeginners/comments/1gl2chx/severe_anxiety_with_cooking_its_embarrassing/)
    - `V` "Thanks to anyone, too embarrassed to ask people about this IRL. It seems like everyone just has it figured
      out."
      (Reddit r/cookingforbeginners, 2024-12-24, https://www.reddit.com/r/cookingforbeginners/comments/1hl12ka/embarrassed_and_overwhelmed/)
    - `V` "I spend a lot - the majority - of my time in the kitchen shouting at myself and crying. ... Now every crappy
      dish just makes me feel useless." (Reddit r/cookingforbeginners, 2020-07-19,
      https://www.reddit.com/r/cookingforbeginners/comments/hu61tr/how_to_rebuild_your_kitchen_confidence_after/)
    - `V` The reverse, when it goes well: "I feel better about myself as a person" (Blue Apron, App Store, 5★,
      2024-01-29, id 10877736464, https://apps.apple.com/us/app/id976642810)
    - Against: the replies in these threads are mostly kind, and several people say they learned late ("I didn’t start
      cooking proper food until I was 37.", Reddit r/cookingforbeginners, 2024-11-07,
      https://www.reddit.com/r/cookingforbeginners/comments/1gl2chx/_/lvwlmm3/). The shame is felt, but the community does not seem to judge.
- **How often / how bad:** Unknown. Where it appears it leads to avoiding cooking altogether. It overlaps with CK-023
  (failure) and CK-024 (cooking for others).
- **Workarounds people use:** Practising a dish alone before serving it. Asking strangers online instead of people they
  know. Meal kits.
- **Where current products fail:** No direct evidence.
- **Open questions:** How common is this? Does it differ by gender, age or culture? This needs interviews.

### CK-027: What makes cooking feel good: calm, control, a finished meal, and feeding people I care about

- **Status:** validated (added 2026-10-21)
- **Who:** Many home cooks, including some who also find it stressful. This is the positive side of CK-021 to CK-026.
- **When:** When the cook has time, knows the dish, and is not judged. Also when a first real meal works.
- **Need:** Feel calm, capable and proud while cooking, not only fed afterwards.
- **Evidence:**
    - `S` In a study of 229 employed women in Texas who rated how they felt during each part of their day, "preparing
      food" scored a net mood of 3.19 and 3.20 on two days two weeks apart. In the first session that put it 9th of 22
      activities: below playing, intimate relations, relaxing, walking, TV, exercise, eating and reading, and above
      talking, childcare, housework, commuting and working. It sits within about 0.2 of eating, TV, reading and praying,
      and the standard errors are about 0.16, so the rank is rough. (Krueger and Schkade, CEPS Working Paper 138, data from 2005, Table 6,
      https://swh.princeton.edu/~ceps/workingpapers/138krueger.pdf) So cooking is neither a joy nor a misery for this group. It sits in the middle.
    - `S` Across 11,254 Canadian adults, more time spent preparing meals went with slightly lower odds of high stress
      (odds ratio 0.985 per 10 minutes) and slightly better mental health (significant only at p < 0.1). It was a one-day
      survey, so it cannot show that cooking lowers stress. (Widener et al., SSM Population Health 2021,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC8170144/)
    - `M` 79% of 2,503 US adults said they enjoy cooking. Nearly half of them (49%) said they enjoy it only "when they
      have the time", and 30% said they "love" it. (Harris Poll, online, opt-in and weighted, as reported by MediaPost,
      2010-07-29,
      https://www.mediapost.com/publications/article/132813/harris-just-30-of-adults-love-cooking.html) The figure is
      old.
    - `V` Calm and presence: "Cooking for me is a form of mindful meditation, where I’m wholly present in the here and
      now."
      (Reddit r/Cooking, 2020-12-16, https://www.reddit.com/r/Cooking/comments/kdyudz/_/gfzwsz8/) A 2018 r/Cooking post, "Does anybody else
      find cooking therapeutic/stress relieving?", drew 421 comments (https://www.reddit.com/r/Cooking/comments/9qhexy/).
    - `V` Control and order: "Cooking is so relaxing to me because I’ve removed all stressors by approaching it this
      way." (about prepping first; Reddit r/cookingforbeginners, 2024-09-28,
      https://www.reddit.com/r/cookingforbeginners/comments/1foblo2/_/lpcml0k/)
    - `V` Pride in a small win: "Nothing fancy, but it felt good to make real meals for once. Kind of gave me a weird
      sense
      of control over my week." (Reddit r/cookingforbeginners, 2025-06-08,
      https://www.reddit.com/r/cookingforbeginners/comments/1l66go0/i_cooked_for_myself_three_days_in_a_row_and/) And a first full holiday
      meal: "I had so much fun making and preparing everything, I can’t remember the last time I was this excited or happy
      to be planning and cooking a meal." (Reddit r/Cooking, 2021-11-26,
      https://www.reddit.com/r/Cooking/comments/r2vmc0/i_cooked_thanksgiving_dinner_completely_myself/)
    - `V` Feeding others: "When I see satisfaction in others faces especially my son, ooh, am the happiest." (Reddit
      r/AskMen, 2026-01-28, https://www.reddit.com/r/AskMen/comments/1qpevgl/do_you_enjoy_cooking_for_your_fam_friends_or_your/)
    - `V` Flow on known dishes: "I've amassed a number of repertoire recipes that I essentially know by heart, where I can
      get in a flow state and knock out pretty quickly like a machine." (Reddit r/adhdwomen, 2025-09-26,
      https://www.reddit.com/r/adhdwomen/comments/1nqjq2l/_/ng8eb6n/)
    - `V` Meal-kit cooks often say the kit brought the enjoyment back: "Blue Apron is why I finally enjoy cooking!" (Blue
      Apron, App Store, 5★, 2024-11-30, id 12009263390, https://apps.apple.com/us/app/id976642810) "After working hard all day, I look forward to cooking an
      organized meal with healthy food." (Blue Apron, App Store, 5★, 2025-07-23, id 12926328272, https://apps.apple.com/us/app/id976642810)
    - Against: Some people do not enjoy it and do not expect to: "I'm indifferent to cooking; it's just a means to an end
      for me." (Reddit r/AskMen, 2026-01-28, https://www.reddit.com/r/AskMen/comments/1qpevgl/_/o28hpuw/) And: "I like to cook but I resent
      _having_ to cook." (Reddit r/adhdwomen, 2025-09-26, https://www.reddit.com/r/adhdwomen/comments/1nqjq2l/_/ng8eb6n/)
- **How often / how bad:** Most adults say they enjoy cooking at least sometimes, and "when they have the time" is the
  key condition. Across the voices, the same few things make it feel good: being organised, knowing the dish, not
  being rushed or judged, a visible finished meal, and someone enjoying it. These are the opposites of the problems in
  CK-021 to CK-026.
- **Workarounds people use:** Music or a podcast while prepping. Keeping a repertoire of known dishes. Cooking new
  things only on free days. Cooking with a partner or friend.
- **Where current products fail:** Blue Apron's 2025 update removed a step checklist that a user said "made cooking
  stress-free" (see CK-020). Otherwise no direct evidence.
- **Open questions:** Which of these conditions matters most, and can a weekday meal have them? The enjoyment
  figures are old (Harris 2010) or narrow (Texas women, 2005). A current survey with a stated sample is needed.

### CK-028: Cooking every day for years, for people who complain, wears the joy out of it

- **Status:** validated (added 2026-10-21)
- **Who:** The person who cooks for the household every day, most often a mother. Also cooks with ADHD, and people
  whose life changed (children, a new job, illness).
- **When:** Over months and years, more than in any one meal.
- **Need:** Keep cooking for a household over years without it becoming a dreaded chore.
- **Evidence:**
    - `S` Bowen, Elliott and Brenton (2014): time pressure, money and "the burden of pleasing others" made the
      home-cooked ideal hard for mothers of every income. "This idea of a home-cooked meal is appealing, but it’s
      unrealistic for a lot of families" (Bowen, quoted by NC State University, 2014-09-03, https://news.ncsu.edu/2014/09/bowen-out-of-the-kitchen-2014/)
    - `V` "After 30 years of cooking dinner, I had become overwhelmed with the thought of even making a bowl of cereal."
      (Home Chef, App Store, 5★, 2026-02-27, id 13795878304, https://apps.apple.com/us/app/id994918972)
    - `V` "Enter children -- right now age 4 and 2 but things really hit the fan when I was pregnant with my second.
      Cooking became an absolute nightmare scenario" (Reddit r/adhdwomen, 2025-09-25,
      https://www.reddit.com/r/adhdwomen/comments/1nqjq2l/i_just_realized_why_i_hate_cooking/)
    - `V` "I like to cook but I resent _having_ to cook. ... many days I literally just need food and I don't want to have
      to spend an hour or two in an active brain state in order to make something that takes 15 minutes to eat." (Reddit
      r/adhdwomen, 2025-09-26, https://www.reddit.com/r/adhdwomen/comments/1nqjq2l/_/ng8eb6n/)
    - `V` "My wife also hates cooking because of this, which is disheartening because it's something she used to really
      enjoy" (about picky children; Reddit r/Parenting, 2021-02-21, https://www.reddit.com/r/Parenting/comments/lombhc/_/go6lzoc/)
    - Against: the same cooks often recover the joy when the load changes: grief "took away something I used to love. But
      hello fresh helped me get back in the kitchen" (HelloFresh, App Store, 5★, 2026-04-14, id 13956156795, https://apps.apple.com/us/app/id970107419)
- **How often / how bad:** Unknown in numbers. Where it appears, cooking turns from something chosen into something
  dreaded, and the cook may stop. Much of it is about deciding and planning, which belongs to `mealPlanning.md`
  (MP-002, MP-003, MP-015). This record keeps only the cooking part: the daily effort and the reaction at the table.
- **Workarounds people use:** Meal kits. Cooking once for several days. Simple meals on most days and a "real" one or
  two a week. Not cooking separate meals for each person.
- **Where current products fail:** No direct evidence.
- **Open questions:** How much of this burnout is the cooking itself, and how much the deciding, the shopping and the
  complaints? Diary studies of the main household cook would show it.

### CK-029: Something went wrong and I don't know why, or whether it can be saved

- **Status:** reported (added 2026-10-21): `V` from Reddit only, with partial `S` support.
- **Who:** New cooks most of all. Bakers, who cannot check until the end.
- **When:** Mid-cook, when something looks wrong, and afterwards, when trying to learn from it.
- **Need:** Know during cooking whether it is going right, and after a failure, what caused it.
- **Evidence:**
    - `S` Cooks wanted visual information "to help them assess if they had achieved the intended outcome of a step, like
      the proper consistency of cake batter (C2) or the doneness of fried chicken (C4)." (Hwang et al., DIS 2023)
    - `V` "the worst part is having to wait like 40 minutes to see if you've fucked up" (Reddit r/Cooking, 2018-10-23,
      https://www.reddit.com/r/Cooking/comments/9qhexy/_/e8b8zef/)
    - `V` "I made banana bread a while back and the center sunk. I looked it up online and the answer was like "here are
      47
      things that could've gone wrong."" (Reddit r/Cooking, 2018-10-23, https://www.reddit.com/r/Cooking/comments/9qhexy/_/e8bd5ow/)
    - `V` "Tonight I somehow burnt packet rice, yesterday I burnt lovely goey brie bacon and cranberry grilled cheeses
      into
      a horrible charcoal gloop, and I served hash with horrifically under cooked potatoes." (Reddit
      r/cookingforbeginners, 2020-07-19,
      https://www.reddit.com/r/cookingforbeginners/comments/hu61tr/how_to_rebuild_your_kitchen_confidence_after/)
    - `V` "Every time I make a protein I end up burning it! I've tried lowering the heat or putting timers,, but I feel
      like
      it never comes out tasting good." (Reddit r/Cooking, 2026-06-14,
      https://www.reddit.com/r/Cooking/comments/1u5c9pi/why_cant_i_make_a_meal_that_isnt_burntovercooked/)
    - `V` "Most of the recipes I make that turn out badly are because I didn't do something I realized I should have done
      ahead of time. Which is a great lesson, but as a learner it's so frustrating that in every recipe there's always
      some minor unknown step that you have to keep in the back on your mind." (Reddit r/cookingforbeginners,
      2021-05-26, https://www.reddit.com/r/cookingforbeginners/comments/nlc3k6/anyone_else_frustrated_when_recipes_leave_out/)
    - Against: Several replies find the cause quickly from a short description (too-high heat, distraction), which
      suggests the knowledge exists and is reachable: "Based on the few things you mentioned, I can tell you that your
      heat is too high, which is a very common mistake for beginners." (Reddit r/cookingforbeginners, 2025-11-21,
      https://www.reddit.com/r/cookingforbeginners/comments/1p3dw0s/_/nq3yy1v/)
- **How often / how bad:** Unknown. It feeds CK-023: a failure the cook cannot explain feels like a personal failing,
  and is likely to happen again. Close to CK-004 (cues) and CK-009 (doneness).
- **Workarounds people use:** Asking online with a photo. YouTube. A thermometer. Repeating one dish until it works.
- **Where current products fail:** Recipes rarely say what can go wrong at each step, what it looks like, or how to fix
  it. No reviewed product evidence.
- **Open questions:** Which failures are most common, and which can be rescued? Observation of real cooks would show
  this.

---

## Top needs in this area

1. **See the amount where the step uses it.** This is the most common kind of question while cooking (CK-001), and it
   is made worse by ads and crashes covering the step (CK-005).
2. **Know what to do in parallel and when to start each part, and see the whole job before starting,** so everything
   is ready together and nothing like preheating or marinating is missed (CK-003, CK-007).
3. **Use the recipe without touching the device with dirty hands, and never lose your place** (CK-002, CK-008).
4. **Trust that the recipe on the screen matches its source,** because imports and AI rewrites quietly change amounts
   and steps (CK-006).
5. **Turn vague cues into things a cook can check, at a level of detail that fits their skill,** and confirm a step
   went right (CK-004, CK-010).
6. **Get amounts in your own units, for your own number of people, with real times** (CK-011, CK-012, CK-013).
7. **Cook safely without thinking about it:** doneness, handwashing, and allergies when cooking for others. It is a
   latent need: common in observation and rare in complaints (CK-009, CK-018).
8. **Make the recipe readable and usable for low-vision cooks and people with attention difficulties,** who are the
   groups least served and least represented in this evidence (CK-016, CK-020).

**Round 2 additions (2026-10-21).** The second round adds the feelings and the effort around following a recipe:

9. **Keep up with the steps that cannot wait,** and have each ingredient ready when the step needs it, without
   burning what is in the pan or doing needless prep (CK-021, CK-022). Prepping everything first helps beginners and
   fast
   dishes, but costs time, space and dishes, and experienced cooks often skip it.
10. **Try new dishes without the fear of wasting food, money and confidence,** and learn what went wrong when a dish
    fails (CK-023, CK-029).
11. **Cook for others, and on tired evenings, without the pressure taking over** (CK-024, CK-025, CK-028).
12. **Protect what makes cooking feel good:** calm, order, a known dish, a finished meal, and someone enjoying it
    (CK-027). Most adults enjoy cooking at least "when they have the time".
