# Finding, choosing, saving and trusting recipes

Desk research, October 2026. ID prefix `FR`. Record format and evidence codes are defined in [README.md](README.md).

## Method and limits

**What this is.** Nobody was interviewed or watched. The evidence is what people wrote online, plus studies and surveys.
Read every `V` quote as one self-selected person, not as a share of users.

**Sources reached**

- **Reddit (`V`).** reddit.com itself blocked every fetch. All Reddit text comes from the Arctic Shift archive
  (`arctic-shift.photon-reddit.com`), which stores the raw post and comment text. Links point to the original reddit.com
  address. Some of these posts are possibly gone from Reddit now. Threads read in full or in part: r/Cooking
  (about 20 threads, 2019 to 2026), r/FoodAllergies, r/loseit, r/budgetfood, r/EatCheapAndHealthy, r/declutter,
  r/Old_Recipes. The scores shown in the archive are the scores at capture time, not today's.
- **App Store reviews (`V`).** Taken from Apple's public review feed (US store only). For each app this is the newest
  ~500 reviews, filtered to 3 stars or fewer. Apps covered: Paprika 3, ReciMe, Samsung Food, NYT Cooking, Crouton, Mela,
  Pestle, Tasty, Kitchen Stories, Mealime, Cookidoo, Plan to Eat, AnyList. Apple gives no link to a single review.
  So each link goes to the app's review page, and the record gives the reviewer name and date.
- **Studies (`S`).** Li et al., ASSETS 2024 (20 blind and low-vision cooks). Druck and Pang, ACL 2012 (recipe reviews
  on Allrecipes). Elsweiler, Trattner and Harvey, SIGIR 2017 (how people choose between recipes). Thompson et al.,
  _Critical Public Health_ 2016 (family meals). The quotes and numbers were checked against each paper's own text.
- **Surveys (`M`).** Allspice Labs 2026 (354 US and Canadian home cooks). This survey was run by a company that sells
  recipe-page software, and respondents were not told who ran it. Instacart/SurveyMonkey, September 2025 (1,011 US
  adults, unweighted). HUNTER Food Study Wave Two, December 2020 (1,032 US adults).

**Blocked or not used**

- **Google Play reviews.** Not reached, because the pages need JavaScript. There is no Android voice here.
- **Factor/Wakefield 2025 "deciding what to eat" survey.** The press release returned 403, so its figures are not used.
- **Numbers seen only in search summaries and never opened.** Adobe/Statista TikTok search, IFIC 2023 social media, the
  Instacart/Harris 2022 poll, the Sainsbury's "don't know what to cook" poll, and WRAP household-waste figures. None of
  these numbers are quoted.
- **CivicScience, December 2025.** The article states no sample size, so it is coded `X`, not `M`.
- **Yummly closure.** Comes from Wikipedia and trade press (`X`), not from users.
- **Mealime closure.** Reported only by app reviewers. No news report says the same.

**Evidence hygiene**

- Many 2026 r/Cooking posts that ask "how do you save/decide…" were written by people building an app. Their opening
  posts are **not** used as evidence. The replies to them are used, because those are ordinary cooks answering.
  Comments that plug a product are also excluded.
- Several comments in one thread count as **one** place for the "validated" rule. Places are counted by thread, by
  subreddit or by app.

**A bias to keep in mind.** The app reviews were filtered to low stars. The same apps rate very high overall: Paprika
4.9 (54k ratings), NYT Cooking 4.9 (549k), ReciMe 4.8 (317k), Tasty 4.9 (433k). The failures below are real, but most
users of these apps are satisfied.

**Groups missing from this evidence**

- Android users.
- Anyone outside the US App Store.
- Non-English speakers. The only trace is two Cookidoo reviews about language.
- Older cooks. There are only survey lines: Instacart says people 60+ lean on cookbooks, and CivicScience says people
  65+ use aggregator sites.
- People with disabilities other than blindness. There is one heat-intolerance post.
- People who cook from tradition, not recipes.
- Low-income households. There are some budget-subreddit posts, but no study.
- Anyone who does not post online.

---

### FR-001: "I just want the recipe" — stories, ads and pop-ups bury it

- **Status:** validated
- **Who:** Anyone using a free recipe website, most of all on a phone. It is worse for screen-reader users (see FR-020).
- **When:** Right after clicking a search result, and again on coming back to the page to cook.
- **Need:** Get to the ingredients and steps of a recipe I have already chosen, fast and without fighting the page.
- **Evidence:**
    - `M` 48.6% scroll straight to the ingredients, 24.3% click "jump to recipe", and only 11.3% read most of the
      article. 70.6% "often or sometimes" avoid recipe sites because they are frustrating to cook from. The top
      frustrations are finding the ingredients or steps (24.1%) and ads and pop-ups (19.8%). (Allspice Labs, 2026, n=354,
      https://www.allspicelabs.com/studies/home-cooks/)
    - `V` "every time i try to look up how to cook shakshuka or whatever, i get bombarded with pop-ups, timed ads, video
      ads, then the whole tab crashes mid-scroll." (r/Cooking, u/MichaelWForbes, 2026-01-21, 1,526 points,
      https://www.reddit.com/r/Cooking/comments/1qjdze0/)
    - `V` "navigating around all of the pops was miserable. Like my screen would jump and then I could t find what I was
      looking for." (r/Cooking, u/skuterkomputer, 2024-11-29, 4,629 points,
      https://www.reddit.com/r/Cooking/comments/1h2okew/)
    - `V` "I just want ingredients and steps, not a life story." (r/Cooking, u/days85, 2026-01-31,
      https://www.reddit.com/r/Cooking/comments/1qs1865/)
    - `V` "I’m exhausted every time I look it’s just another blog post." (r/Cooking, u/Dimmadome2701, 2024-07-01,
      https://www.reddit.com/r/Cooking/comments/1dsg770/)
    - `S` A blind participant: "The ads are really frustrating, but once you can get through those, I’ve had a lot of
      success." (Li et al., ASSETS 2024, P17, n=20, https://arxiv.org/abs/2407.19065)
    - `V` The same problem inside apps: "every recipe sends you to an external site that is full of pop-up ads and full
      screen ads that you can’t minimize or get away from." (Samsung Food, App Store, Jakkshthalnsgka, 2025-04-09,
      https://apps.apple.com/us/app/id1133637674?see-all=reviews)
    - **Against:** 11.3% do read most of the article (Allspice). Food bloggers say the long text and ads are what pay for
      free recipes (`X`, for example https://www.bowlofdelicious.com/why-are-food-blog-posts-so-long/, seen in search
      results only, not opened). Some readers value the writing: "I rarely read the blog section of a recipe, but I often
      do read hers." (r/Cooking, u/inkling435, 2024-10-28, https://www.reddit.com/r/Cooking/comments/1gdotx4/_/lu5ru8h/)
- **How often / how bad:** Very common. Two of the largest r/Cooking threads found are about this (8,011 and 4,629
  points). It is mostly annoyance, but tab crashes and layout jumps can stop a person entirely.
- **Workarounds people use:** The "print" button. Saving the page as a PDF. Screenshots. Copying into Word, Notes or a
  binder. Prefix sites such as cooked.wiki. Recipe-keeper apps. Buying cookbooks: "I’m tired of using Pinterest or my
  phone when cooking." (r/Cooking, u/Tall-Arugula1522, 2026-01-15, https://www.reddit.com/r/Cooking/comments/1qdpr17/)
- **Where current products fail:**
    - Most ad-funded blogs.
    - Samsung Food sends users out to ad-heavy sites, and the company told one reviewer it has "no control over the ads"
      (App Store, pool-nut, 2025-09-22).
    - NYT Cooking shows ads even to paying subscribers: "the ads are there whether or not you are subscribed." (App
      Store, Clint Eastwood’s Left Sideburn, 2026-10-11, https://apps.apple.com/us/app/id911422904?see-all=reviews)
    - Tasty: "The app is bloated with ads" (App Store, Pharagill, 2025-12-26).
- **Open questions:** Does the clutter change which recipe people pick, or only how they feel? Is there a share of
  readers, perhaps older ones, who want the story?

### FR-002: I can not tell if a recipe will work until I cook it

- **Status:** validated
- **Who:** Everyone, but most of all new cooks, and cooks trying a cuisine they do not know.
- **When:** Choosing between several versions of the same dish. The cost shows up later, at the table.
- **Need:** Judge before cooking whether a recipe is tested, balanced and likely to turn out the way it looks.
- **Evidence:**
    - `V` "I have a hard time trusting websites and their ratings for their recipes." (r/Cooking, u/snowboardingtoad,
      2024-10-27, https://www.reddit.com/r/Cooking/comments/1gdotx4/)
    - `V` "1. Look for recipe to make <thing> 2. Get excited 3. Make it 4. It sucks 5. Lose the will to find new recipes"
      (same thread, u/n00bdragon, 2024-10-28, https://www.reddit.com/r/Cooking/comments/1gdotx4/_/lu619qy/)
    - `V` "It never turns out that good, and it's always the recipe's fault." This is about a skilled cook who keeps
      choosing blog recipes. (r/Cooking, u/asdeasde96, 2023-10-15, 598 points,
      https://www.reddit.com/r/Cooking/comments/178qt4i/)
    - `V` "They make enticing videos for youtube but the end result in real life is pathetic." (Tasty, App Store,
      Pharagill, 2025-12-26, https://apps.apple.com/us/app/id1217456898?see-all=reviews)
    - `S` In a random sample of 550 Allrecipes reviews, 57.8% contained a "refinement". The paper defines a refinement
      as text that clarifies, corrects, improves or gives an alternative to the recipe. The paper did not study star
      ratings. Our reading, not the paper's: a rating often comes from someone who cooked a changed version. (Druck and
      Pang, ACL 2012,
      https://aclanthology.org/P12-1057/)
    - `V` The joke that sums it up: "I didn’t follow the recipe and left out onion, garlic, pepper, paprika, and all
      herbs. Doubled the salt because my husband likes that. Came out bland and salty. One star." (r/Cooking,
      u/hersheyMcSquirts, 2024-12-03, https://www.reddit.com/r/Cooking/comments/1h2okew/_/m07v5y3/)
    - `S` Blind cooks compare candidates: "I’ll look to see how many people have rated it. I’ll look through three or four
      recipes about the same thing" (Li et al., ASSETS 2024, P7, https://arxiv.org/abs/2407.19065)
    - **Against:**
        - Some "bad recipe" complaints are taste, not failure: "Recipe writers will generally specify a base level of
          seasoning" (u/Delicious-Income-991, 2024-10-28, https://www.reddit.com/r/Cooking/comments/1gdotx4/_/lu5q1kq/).
        - Some readers find the comments reliable: "when you see a number of comments which all say the same thing , it’s a
          pretty sure bet that they’re right." (u/Lessarocks, BBC recipes, same thread,
          https://www.reddit.com/r/Cooking/comments/1gdotx4/_/lu57c9t/)
        - Trusted names do earn trust: "I've never had a bad result baking one of her recipes." (u/towerofcheeeeza, same
          thread, https://www.reddit.com/r/Cooking/comments/1gdotx4/_/lu41zq9/)
- **How often / how bad:** Common. It wastes money, an evening and confidence, and the n00bdragon quote shows it can
  stop people trying new recipes at all.
- **Workarounds people use:**
    - A short list of trusted authors, often one per cuisine (Maangchi, Hot Thai Kitchen, Serious Eats, RecipeTin Eats,
      Sally's Baking Addiction, ATK, NYT).
    - Comparing 3 or 4 recipes.
    - Reading comments for repeated fixes.
    - Asking Reddit which sources natives trust.
- **Where current products fail:** Star ratings mix "I changed it" with "it worked" (Druck and Pang). Cookidoo shows
  no shared reviews: "you can’t leave reviews for other users to see." (App Store, Funkybeat85, 2026-09-18,
  https://apps.apple.com/us/app/id1470401164?see-all=reviews)
- **Open questions:** What signal do people actually use to trust a source they have never heard of? How far does trust
  in an author carry over to that author's other cuisines?

### FR-003: Search gives me junk — SEO copies, Pinterest loops, nothing good

- **Status:** validated
- **Who:** People searching the open web for a dish.
- **When:** At the very first step, typing a dish name into a search engine.
- **Need:** Find a few good, distinct versions of a dish without wading through near-copies.
- **Evidence:**
    - `V` "I'm so tired of these shitty ass blog type recipe websites filling up Google search results." (r/Cooking,
      u/basickarl, 2022-06-20, 8,011 points, 1,252 comments, https://www.reddit.com/r/Cooking/comments/vgrw3g/)
    - `V` "I will google something, i'll click the pintrest link, and then i just get 100 similar things but on pintrest."
      (r/Cooking, u/Rulebookboy1234567, 2024-12-02, https://www.reddit.com/r/Cooking/comments/1h2okew/_/m033uvy/)
    - `V` "I’ve switched to cooking almost exclusively from cookbooks this year, because it’s so difficult to find good
      recipes using Google now." (r/Cooking, u/Satchya1, 2025-03-07,
      https://www.reddit.com/r/Cooking/comments/1j5dqc9/_/mghhbo3/)
    - `V` "Everything all these websites suggest has like 15 ingredients and takes like 8 hours to cook" (r/Cooking,
      u/EclipseOnTheBrink, 2022-07-18, 647 points, https://www.reddit.com/r/Cooking/comments/w21wjy/)
    - `V` "Anyone else feel that Pinterest is the worst place for recipes?" (r/Cooking, u/rilyalune, 2019-03-02, 4,250
      points, https://www.reddit.com/r/Cooking/comments/awcrkf/)
    - `M` 87.6% use search engines to find recipes. Search is the main front door. (Allspice Labs, 2026, n=354)
    - `S` Choice between recipes is "often visually driven". People could not reliably tell which of two recipes had more
      fat, and on average chose the fattier one. (Elsweiler, Trattner and Harvey, SIGIR 2017, user studies n=107 and
      n=111, https://researchportal.northumbria.ac.uk/en/publications/exploiting-food-choice-biases-for-healthier-recipe-recommendation/)
    - **Against:** "Anyone else grateful for how easy it is to find amazing recipes nowadays?" is a counter-view, but it
      was posted by someone building an app, so it is not counted. A real counter-voice: "Very unpopular opinion: I enjoy
      Pinterest" (r/Cooking, u/cser34, 2019-03-03, 713 points, https://www.reddit.com/r/Cooking/comments/awp5m8/)
- **How often / how bad:** Common and long-running (2019 to 2026). It pushes some people off the open web completely.
- **Workarounds people use:** Going straight to a few trusted sites. Adding "reddit" to searches. Cookbooks. Asking
  forums.
- **Where current products fail:** Pinterest result loops. In-app search can fail too: "I looked up chocolate chip
  cookies and it said “0 results”" (NYT Cooking, App Store, App reviewer3345, 2026-10-11,
  https://apps.apple.com/us/app/id911422904?see-all=reviews)
- **Open questions:** How much has this changed since search engines added AI answers? No 2026 data was found.

### FR-004: My recipes are scattered everywhere and I can not find the one I want again

- **Status:** validated
- **Who:** Anyone who saves recipes from more than one place. That is nearly everyone who saves.
- **When:** Weeks after saving, at the moment they want to cook that dish.
- **Need:** Find a recipe I saved before, whatever the source and however long ago.
- **Evidence:**
    - `M` 80.5% "sometimes or always" rebuild a recipe off the page. 56.7% take screenshots, 22.6% copy to notes and 16.6%
      print. (Allspice Labs, 2026, n=354)
    - `V` "I have dozens of saved recipes in (Apple) Photos, Notes, and Files." (r/Cooking, u/Final_Room_7695,
      2026-10-05, https://www.reddit.com/r/Cooking/comments/1wym53a/)
    - `V` "I have a bunch of recipes from all sorts of sources like cook books, websites, TikTok, sticky notes, Grandma's
      stories and my own creations." (r/Cooking, u/Legitimate-Cinephile, 2025-08-01,
      https://www.reddit.com/r/Cooking/comments/1meu4cf/)
    - `V` "Remembering what title I saved them under. I just did a sweep of recipes I have saved... So many for the same
      thing" (r/Cooking, u/Owie100, 2026-05-29, https://www.reddit.com/r/Cooking/comments/1tqvzar/_/oojak79/)
    - `V` "I have a whatsapp group chat with just me in it for saving recipes" (r/Cooking, u/mi-sus, 2026-05-29,
      https://www.reddit.com/r/Cooking/comments/1tqvzar/_/oojbem8/)
    - `V` "I had my Pinterest as good as I could get it and it was still a mess." (r/Cooking, u/Vulf_momma, 2025-08-01,
      https://www.reddit.com/r/Cooking/comments/1meu4cf/_/n6ekau7/)
    - **Against:** Many people are content with simple systems, for example "A box with recipe cards in it. A binder…
      Very simple." (r/Cooking, u/EyeStache, 2025-11-10, https://www.reddit.com/r/Cooking/comments/1otkwdc/_/no59uzz/)
- **How often / how bad:** Very common. It is low-stakes each time, but it adds up, and a lost recipe is often lost for
  good.
- **Workarounds people use:** Screenshots in Photos. Notes apps. Email to self. Word or PDF folders on a PC. Google
  Docs or Sheets. OneNote. Binders. Index cards. Paprika, Recipe Keeper, Copy Me That.
- **Where current products fail:** Each platform (Instagram, TikTok, Pinterest, browser bookmarks) keeps its own saved
  list, so nothing spans all of them. See FR-005 and FR-011 for the capture failures.
- **Open questions:** How many saved recipes ever get cooked? No figure was found. Is the need to find a recipe again,
  or to decide which saved recipe to cook?

### FR-005: Saving a recipe from Instagram, TikTok or Facebook does not work

- **Status:** validated
- **Who:** People who find recipes in social video. They skew younger.
- **When:** Right after seeing a recipe in a feed, and later at the point of cooking it.
- **Need:** Keep a complete, usable copy of a recipe I found in a social post.
- **Evidence:**
    - `M` YouTube is a source of cooking ideas for 36% of US adults, and the top source for ages 18 to 44. Nearly 38% of
      ages 18 to 29 use TikTok. (Instacart/SurveyMonkey, 2025-09, n=1,011,
      https://company.instacart.com/ideas/cooking-at-home-survey). 51.1% get recipes from social media (Allspice, 2026).
    - `V` "Won’t download from Facebook or Instagram." (Paprika, App Store, Bella mane, 2026-10-15,
      https://apps.apple.com/us/app/id1303222868?see-all=reviews)
    - `V` "Instagram missed over half of the ingredients and instructions. Facebook was almost the same." (ReciMe, App
      Store, Ohh boy ohh, 2026-10-18, https://apps.apple.com/us/app/id1593779280?see-all=reviews)
    - `V` "Please figure out a way to pull the recipes from the IG reel captions." (Mela, App Store, afg2001, 2026-05-31,
      https://apps.apple.com/us/app/id1548466041?see-all=reviews)
    - `V` "For the life of me - I can’t import a recipe from TikTok to this app." (Pestle, App Store, dan09510,
      2025-10-02, https://apps.apple.com/us/app/id1574776971?see-all=reviews)
    - `V` "It seemed easily capable to import recipes easily from Instagram. But lately it stopped working" (Mela, App
      Store, AZKriegs, 2025-09-23). Also "Last two weeks it's not working for instagram. Just blank." (ReciMe, Still
      available, 2026-10-17)
- **How often / how bad:** Frequent in reviews of four different apps. When saving fails, the person either retypes the
  recipe or loses it.
- **Workarounds people use:** Screenshots of the caption. Copying the caption text. Typing it out by hand. Following the
  creator's link to a blog.
- **Where current products fail:** Paprika (no social import), ReciMe (partial imports, outages), Mela (no captions,
  stopped working), Pestle (TikTok fails, no carousels). It works one month and breaks the next as platforms change.
- **Open questions:** Whether it can work reliably depends on the platforms, not only on the app. Do people keep the
  link for the video itself, not just the text?

### FR-006: I can not decide what to cook — my mind goes blank and I fall back on the same few meals

- **Status:** validated
- **Who:** The person in a household who decides dinner, often alone. Also tired workers and new parents.
- **When:** Late in the day, or the night before, with no plan.
- **Need:** Arrive quickly at a dinner choice I am happy with, starting from no idea at all.
- **Evidence:**
    - `V` "Sometimes I wish there was human kibble I can eat when I don’t know what to eat, nothing sounds good and I’m
      craving nothing." (r/Cooking, u/pryshl, 2026-06-28, https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou8xbnh/)
    - `V` "All of it because I’m the only one that does it." (r/Cooking, u/barks87, 2026-06-28,
      https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou9tinb/)
    - `V` "The "What do you feel like having?" game. When neither one of us knows what we want" (r/Cooking, u/MOS95B,
      2026-10-16, https://www.reddit.com/r/Cooking/comments/1x7odzg/_/ph5vv5n/)
    - `V` "i hate deciding what to eat so i need something that i can eat everyday for dinner" (r/EatCheapAndHealthy,
      u/lainawesom, 2026-09-07, https://www.reddit.com/r/EatCheapAndHealthy/comments/1wa0y5n/)
    - `V` "I eat the same 3 meals every day without fail." This poster's options are limited by many allergies. (r/FoodAllergies,
      u/Routine_Window_7794, 2026-06-22, https://www.reddit.com/r/FoodAllergies/comments/1ucdrbj/)
    - **Against:**
        - "None of it. It's the easiest and most pleasant part of my day." (r/Cooking, u/gretelhansel2, 2026-06-28,
          https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou8zd5q/)
        - Weekly planners say the problem mostly goes away: deciding is "a small challenge once a week"
          (u/CatteNappe, same thread, https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou919fm/).
        - `M` 81% of respondents said they find enjoyment in cooking (HUNTER Wave Two, 2020-12, n=1,032,
          https://www.foodnavigator-usa.com/Article/2021/01/15/Survey-Americans-committed-to-maintaining-cooking-habits-in-post-pandemic-world/).
        - A widely cited vendor figure on this (Factor/Wakefield 2025) did not open, so it is not used.
- **How often / how bad:** Common in posts. The cost is takeout, boredom and the mental load landing on one person.
  Strength unknown: no neutral survey was reached.
- **Workarounds people use:** Weekly or two-weekly menu planning. Theme nights ("Taco Tuesday"). A short list of known
  meals. A spinning wheel. Keeping frozen backups.
- **Where current products fail:** Recipe sites answer "what can I make?" with endless choice. The person here has no
  starting point at all (see FR-003).
- **Open questions:** How much of this is decision fatigue, and how much is the invisible labour of being the only
  planner? Does a rotation of meals feel like a problem, or like a solution?

### FR-007: The recipe does not fit the time and energy I really have

- **Status:** validated
- **Who:** Working adults, parents of young children, tired or unwell people.
- **When:** Choosing a recipe for a weeknight.
- **Need:** Know honestly how much hands-on effort, total time and cleanup a recipe takes before I commit to it.
- **Evidence:**
    - `M` The top obstacles to cooking at home are lack of time (20%) and after-work exhaustion (19%). (Instacart, 2025,
      n=1,011)
    - `V` "the cooking is more active than passive (see: me standing at the stovetop “stirring frequently” while trying to
      keep baby from having a meltdown)." (r/Cooking, u/Adventurous-Baby-840, 2026-10-04,
      https://www.reddit.com/r/Cooking/comments/1wxlq3m/)
    - `V` "Sometimes menu-planning me thinks a diced onion and searing meat are no big deal, and then day-of me hates
      myself because I'm exhausted." (r/Cooking, u/PrizeFennel7995, 2026-06-28,
      https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou8y75g/)
    - `V` "i want a quick recipe, the app shows me recipes thatll take an incredibly long time" (ReciMe, App Store,
      Bunnyskie, 2026-10-19, https://apps.apple.com/us/app/id1593779280?see-all=reviews)
    - `V` "hard to cook while working and taking care of the kids" (r/budgetfood, u/Ok_Process_5538, 2026-08-31,
      https://www.reddit.com/r/budgetfood/comments/1w2za7p/)
    - `V` A disabled cook needs meals with "NO heat", for medical reasons. (r/budgetfood, u/TheSideAccount0, 2026-05-17,
      https://www.reddit.com/r/budgetfood/comments/1tfcmmm/)
- **How often / how bad:** Time and fatigue are the most-cited barriers in the surveys found. A bad estimate leads to
  takeout or a late, stressful dinner.
- **Workarounds people use:** Shortcuts (rotisserie chicken, bagged salad). Batch cooking. Slow cookers. Prepping the
  night before.
- **Where current products fail:** "Total time" leaves out how much is hands-on, and leaves out cleanup. App filters
  for "quick" are unreliable (ReciMe).
- **Open questions:** Which matters more to people, total time, hands-on time, or the number of dishes to wash?

### FR-008: Finding something everyone in the house will eat

- **Status:** validated
- **Who:** Parents, couples with different tastes, households with mixed diets or allergies.
- **When:** Choosing a dish for more than one person.
- **Need:** Choose meals that work for everyone at the table, without cooking several dinners.
- **Evidence:**
    - `M` Picky eaters in the household are the third-biggest obstacle for ages 30 to 44 (15%). (Instacart, 2025,
      n=1,011)
    - `S` Families handle children's tastes in one of two ways. Some keep "repeatedly consulting and negotiating with
      children over what to cook for each meal", often making several modified meals. Others keep a fixed "repertoire of
      meals that ‘work’ for the family". (Thompson et al., _Critical Public Health_ 2016, 9 families, UK,
      https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4784502/)
    - `V` "The "what will everyone actually eat" part wrecks me every time." (r/Cooking, u/MicahFoster0524, 2026-06-28,
      https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou9048s/)
    - `V` "It is always in the back of my mind (or the front of my mind) that someone can't eat tomatoes or won't eat any
      seafood." (r/Cooking, u/CatteNappe, 2026-06-28, https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou919fm/)
    - `V` "I use chat gpt for recipe ideas to navigate various allergies between my family and in-laws." (r/FoodAllergies,
      u/twoplustwoequal, 2026-06-22, https://www.reddit.com/r/FoodAllergies/comments/1ucdrbj/_/ot6foka/)
- **How often / how bad:** Common for families. It drives the "same few meals" pattern in FR-006.
- **Workarounds people use:** A fixed set of meals that "work". Theme nights. Base-plus-toppings meals (tacos, bowls).
  Asking ChatGPT.
- **Where current products fail:** Recipe search assumes one eater with one set of preferences.
- **Open questions:** How many different constraints does a typical household hold at once? No data was found.

### FR-009: Diet and allergy filters let the wrong food through

- **Status:** validated
- **Who:** People with allergies, coeliac disease, medical diets (MCAS, diabetes), vegetarians and vegans.
- **When:** Browsing or searching inside a recipe app.
- **Need:** See only recipes I can safely eat, and trust that what is shown really excludes what I must avoid.
- **Evidence:**
    - `V` "I’m gf and it’s literally only suggesting recipes with gluten" (Tasty, App Store, Nocjakne, 2026-03-05,
      https://apps.apple.com/us/app/id1217456898?see-all=reviews)
    - `V` "when I have only shellfish marked on avoid I still get things like shrimp popping up." (Tasty, lovinglifeLiz,
      2026-07-27)
    - `V` "after filtering for “meatless” dishes, I was greeted with shrimp alfredo" (Kitchen Stories, App Store,
      kalisutra, 2020-12-30, https://apps.apple.com/us/app/id771068291?see-all=reviews)
    - `V` "there should be a way to manually add ingredients that I’m allergic to." (Mealime, App Store, aria.na_blonde,
      2026-01-16, https://apps.apple.com/us/app/id1079999103?see-all=reviews)
    - `V` "Your profile should be able to mark your dietary needs so that only those recipes come up" (Cookidoo, App
      Store, AcaciaRenee, 2026-03-12, https://apps.apple.com/us/app/id1470401164?see-all=reviews)
    - `V` "There was no option to filter out those recipes." The reviewer is allergic to all peppers. (Tasty, M4NDI2000,
      2025-12-03)
- **How often / how bad:** Found in five apps. Severity is high for allergies: a filter that leaks is worse than no
  filter, because it invites trust.
- **Workarounds people use:** Reading every ingredient list. Allergy forums. ChatGPT. Eating the same safe meals.
- **Where current products fail:** Tasty, Kitchen Stories, Mealime, Cookidoo and ReciMe. They offer fixed diet lists
  only, have no way to name your own ingredients to avoid, and leak excluded foods.
- **Open questions:** How do people with rare or multiple allergies judge whether a recipe is safe? Do they trust any
  automated label?

### FR-010: I lose my collection when the service closes, changes or breaks

- **Status:** validated
- **Who:** Long-time users of any recipe app or site.
- **When:** Without warning, after a shutdown, a takeover, a forced update or a sync.
- **Need:** Keep my recipe collection safe, readable and portable for as long as I cook.
- **Evidence:**
    - `X` Yummly's app and website "were taken offline in December 2024" (Wikipedia, https://en.wikipedia.org/wiki/Yummly).
    - `V` "the decision of the stakeholders to close the app and move all recipes to Albertsons." (Mealime, App Store,
      Mealime4life, 2026-09-24, https://apps.apple.com/us/app/id1079999103?see-all=reviews). This closure is not
      confirmed by press.
    - `V` "What’s going to happen to meals that I added and saved to the app?" (Mealime, Lady Wynter, 2026-09-17)
    - `V` "Tried to log in and it says I never existed." (Samsung Food, App Store, Phailbot, 2026-02-24,
      https://apps.apple.com/us/app/id1133637674?see-all=reviews)
    - `V` "One day turned on iCloud sync and without warning it deleted all my data. Years of data gone." (Mela, App
      Store, Markw0, 2025-12-11, https://apps.apple.com/us/app/id1548466041?see-all=reviews)
    - `V` "I couldn’t access any of my recipes because my iPad can’t be upgraded to iOS 18." (NYT Cooking, App Store,
      Arbor Sue, 2026-10-14, https://apps.apple.com/us/app/id911422904?see-all=reviews)
    - `V` "I'm a bit anxious about investing hours in collecting things into an app - then having the app disappear or not
      be maintained." (r/Cooking, u/DrLilithCat, 2025-11-10, https://www.reddit.com/r/Cooking/comments/1otkwdc/)
    - `V` "I've seen app after app come and go and the friendliest thing I've used for recipes is a spreadsheet." (r/Cooking,
      u/oingapogo, 2025-08-01, https://www.reddit.com/r/Cooking/comments/1meu4cf/_/n6df0y0/)
- **How often / how bad:** Rare per person, but very severe: years of curated work can vanish. The fear alone stops
  some people from using any app.
- **Workarounds people use:** Paper binders. PDFs in Google Drive. Spreadsheets. Regular exports, for example "This
  export option is also a good insurance policy" (u/ShakingTowers, 2025-11-10,
  https://www.reddit.com/r/Cooking/comments/1otkwdc/_/no5gv7l/). Never trusting the cloud: "I don't ever save anything
  online or in the cloud. Ever." (u/Numerous-Bet-4847, 2026-05-29,
  https://www.reddit.com/r/Cooking/comments/1tqvzar/_/oojglk7/)
- **Where current products fail:** Yummly (closed). Mealime (reported closing). Samsung Food (lost account). Mela
  (sync wiped data, no support reply). NYT Cooking (dropped older iPads).
- **Open questions:** How much does a visible export, or a format you can open elsewhere, change people's willingness
  to invest in a collection?

### FR-011: When I do save a recipe, it comes out wrong

- **Status:** validated
- **Who:** Users of any recipe-saving tool.
- **When:** Right after saving. Or worse, mid-cook, on finding a missing step or a wrong amount.
- **Need:** Have the saved copy match the original exactly, with nothing missing, added or changed.
- **Evidence:**
    - `V` "The recipes it does download from other websites are full of all sorts of jibberish that I have to cut out."
      (Paprika, App Store, Bella mane, 2026-10-15)
    - `V` "Other times it downloads it in double or leaves out information." (Paprika, ktlibs, 2026-07-13)
    - `V` "It imports recipes, however, it doesn’t import the directions." (ReciMe, App Store, guinibgyyvctfctfuvhb,
      2026-10-18)
    - `V` "the amounts of ingredients (esp. grams, ounces) do not match the amounts provided on the original recipe
      website." (Samsung Food, EdwardoSanchez, 2025-11-12)
    - `V` "Crouton reading my “2-1/4” that I do for readability as “a range from two to one-fourth" (Crouton, App Store,
      Cosmic Jester, 2025-11-04, https://apps.apple.com/us/app/id1461650987?see-all=reviews)
    - `V` "I just spent roughly 45 minutes trying to put in one recipe from the Notes app." (Mela, Mewood40, 2025-12-08)
    - `V` "I have all my recipes in Google Docs. They are well formatted, but this application will not bring it in without
      me cutting and pasting each individual component." (Paprika, wpfeiffe, 2026-09-11)
- **How often / how bad:** Found in five apps. A wrong amount can ruin a dish, and it is only found while cooking.
- **Workarounds people use:** Checking every import by hand. Keeping the original link. Typing recipes in themselves.
- **Where current products fail:** Paprika, ReciMe, Samsung Food, Crouton and Mela, as quoted.
- **Open questions:** Do people check imports at all, or only find errors while cooking?

### FR-012: Getting paper recipes — family cards, handwriting, cookbooks — into a form I can use

- **Status:** validated
- **Who:** People with family recipe cards, inherited notebooks or cookbooks. Often the people keeping a family's food
  memory.
- **When:** Decluttering, after a death in the family, making a family cookbook, or wanting the recipe on their
  phone.
- **Need:** Keep paper recipes legible, searchable and shareable without losing the original.
- **Evidence:**
    - `V` "I have a lot of family recipes written that I thought I could just take a picture of and store in this app.
      Apparently you cannot" (Paprika, App Store, getting real annoyed, 2026-09-29)
    - `V` "Importing from camera just directs me to a page prompting me to purchase plus (which I already have)" (Crouton,
      GVW reviews, 2026-08-22)
    - `V` "Help decrypt my Wife’s Great Grandmother’s handwriting?" (r/Old_Recipes, u/GoldNPotato, 2025-01-22, 1,675
      points, https://www.reddit.com/r/Old_Recipes/comments/1i6z8uj/). An archive title search found several more
      handwriting-decoding posts on that subreddit between 2020 and 2026.
    - `V` "I’m about to type up all these, I’m having a little trouble on the handwriting on some." (r/Old_Recipes,
      u/Jess_the_bestt, 2020-05-31, 90 recipes, https://www.reddit.com/r/Old_Recipes/comments/gu0n66/)
    - `V` "we have about 10-15 books from which we only want to keep a few recipes." (r/declutter, u/StrongArgument,
      2023-06-30, https://www.reddit.com/r/declutter/comments/14n2u67/)
    - `V` "I scanned all my moms old 3x5 recipe cards and used OCR to convert most of them to searchable text." (r/Cooking,
      u/lostalaska, 2025-11-10, https://www.reddit.com/r/Cooking/comments/1otkwdc/_/no5eblg/)
    - **Against:** Many people want the paper itself, not a digital copy: "I wish I had it in her handwriting." (r/Old_Recipes,
      u/Intothemysticsky, 2022-02-05, https://www.reddit.com/r/Old_Recipes/comments/skzs5u/)
- **How often / how bad:** Moderate in frequency, high in emotion. The value is partly the handwriting itself.
- **Workarounds people use:** Phone photos in an album. Google Lens. Library scanners. Tearing out pages. Retyping.
  Making a printed family book.
- **Where current products fail:** Paprika (no photo-to-recipe). Crouton (camera import paywalled). Mela ("Import scan
  could be better", Pics4 life, 2025-09-25).
- **Open questions:** Do people want the text extracted, the image kept, or both side by side?

### FR-013: AI-made photos and recipes — I can not tell what is real anymore

- **Status:** validated
- **Who:** People browsing Pinterest, Facebook, Amazon cookbooks and, increasingly, recipe apps.
- **When:** Choosing a recipe from an unfamiliar source.
- **Need:** Know whether a recipe was written and tested by a person who actually cooked it.
- **Evidence:**
    - `V` "Honestly, it’s hard to trust any recipe from an unknown source if it was published in 2019 or later."
      (r/Cooking, u/veganbell, 2025-03-07, 613 points, https://www.reddit.com/r/Cooking/comments/1j5dqc9/)
    - `V` "I don’t even know what to trust anymore. How do you even check to see if a recipe is legit?" (r/Cooking,
      u/Boom_Kitty_22, 2024-06-20, https://www.reddit.com/r/Cooking/comments/1dkitbj/)
    - `V` "I love the recipes that are clearly omitting half the ingredients in the photo" (r/Cooking, u/treycook,
      2025-03-07, https://www.reddit.com/r/Cooking/comments/1j5dqc9/_/mgibtcj/)
    - `V` A paying NYT Cooking user objects to new AI "adjust" and "substitute" buttons: "AI slop destroyed Pinterest
      recipe searching" (NYT Cooking, App Store, Kat in the midwest, 2026-10-13)
    - **Against:** `M` 57% say they are willing to use an AI assistant built into a recipe page, and 15.0% already ask AI when they leave the
      page (Allspice, 2026). People with complex allergies find AI helpful (FR-008). The objection is to AI-made recipes
      passed off as human, not to AI help as such.
- **How often / how bad:** Rising since 2023. It makes FR-002 worse.
- **Workarounds people use:** Cookbooks by known authors. Checking who published a recipe. Trusting only named
  sources.
- **Where current products fail:** Pinterest, Facebook and Amazon (named by users). NYT Cooking's AI features drew a
  backlash from one subscriber.
- **Open questions:** What counts, for a user, as proof that a person tested the recipe?

### FR-014: Recipes that fit a tight budget

- **Status:** validated
- **Who:** Low-income families, students, people hit by bills, people on restricted diets that cost more.
- **When:** Planning the week's food, or choosing tonight's dish.
- **Need:** Find dishes I can make within a fixed amount of money, from food I can actually buy.
- **Evidence:**
    - `M` Saving money is the top reason people cook at home (35%). (Instacart, 2025, n=1,011)
    - `V` "The maximum I can spend on dinners (two adults and a toddler) is $150 over the course of 15 days."
      (r/budgetfood, u/Ok_Process_5538, 2026-08-31, https://www.reddit.com/r/budgetfood/comments/1w2za7p/)
    - `V` "I actually have about $60 to spend for groceries this week and we are down to the bare cupboards in the house."
      The household is 7 people. (r/budgetfood, u/TacoTuesdaySucks, 2025-12-08,
      https://www.reddit.com/r/budgetfood/comments/1phh0ec/)
    - `V` "I'd walk through the store grabbing one thing for this recipe, something else for another one" and "the bill is
      lower" after stopping. (r/loseit, u/Quiet-Jackfruit-977, 2026-07-07, 330 points,
      https://www.reddit.com/r/loseit/comments/1uqa79r/)
    - `V` "It is also becoming a little to expensive to continue eating this way." This is the allergy poster from FR-006.
      (r/FoodAllergies, u/Routine_Window_7794, 2026-06-22)
    - `V` "the only issue is if it's pretty expensive ingredients!" (r/Cooking, u/CherriBombSunday, age 17, 2026-07-24,
      https://www.reddit.com/r/Cooking/comments/1v50oeo/)
- **How often / how bad:** Common on budget subreddits. For some posters the stakes are not having enough food.
- **Workarounds people use:** Shopping sales first and then planning. A fixed list of basic ingredients. "Free soup"
  from scraps. Ground turkey instead of beef. Asking forums for "tried and true" cheap dishes.
- **Where current products fail:** One-off recipes each need their own special items, so cost piles up (loseit
  thread). No product evidence was gathered on cost display.
- **Open questions:** Do people want a price per serving, or a recipe built from what is already on sale? No study was
  found, and this is a gap.

### FR-015: Using up what I already have before it goes bad

- **Status:** validated
- **Who:** Anyone with leftovers or odd ingredients. Budget and waste-conscious cooks.
- **When:** Looking in the fridge, often mid-week.
- **Need:** Turn the specific ingredients I have on hand into a meal I want to eat.
- **Evidence:**
    - `V` "Trying to figure out what I need to use before it goes bad and how to combine it." (r/Cooking, u/WorthPlease,
      2026-06-28, https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou8x56o/)
    - `V` "The mental gymnastics of "okay I've got half an onion, some wilting spinach, and a single chicken thigh, what
      the hell can I make" takes way more energy than it should" (same thread, u/GrapefruitMore3386,
      https://www.reddit.com/r/Cooking/comments/1uhm2lv/_/ou91le8/)
    - `V` "whenever I search for recipes with my ingredient list, it doesn’t put the recipes first that actually use up
      your ingredients!!" (Samsung Food, App Store, Indecho, 2026-02-01, paid for this feature)
    - `V` "no concepts like pantry management and find recipes I can cook" (Cookidoo, App Store, Berlinguyinca,
      2026-06-06)
    - `V` "by Thursday I'd have half a cucumber going soft, a bag of spinach that was already questionable" (r/loseit,
      u/Quiet-Jackfruit-977, 2026-07-07)
    - An archive title search for "What can I make with" on r/Cooking returned many 2026 threads about one ingredient the
      poster had too much of (wonton wrappers, 15 lbs of mushrooms, 50 pounds of guavas). How common this question is
      compared with others was not measured.
- **How often / how bad:** Common. It links to food waste and money (FR-014). The WRAP and Sainsbury's waste figures
  were not opened (see Method).
- **Workarounds people use:** Soups, stir-fries, "free soup". The Allrecipes ingredient search. Asking Reddit. Buying
  only for planned meals.
- **Where current products fail:** Samsung Food (ranking ignores the ingredients you listed). Cookidoo (feature
  missing). Paprika's pantry needs manual entry (C’Ami, 2026-09-14).
- **Open questions:** Do people want to keep an inventory up to date at all? Most posts describe looking, not tracking.

### FR-016: My system works at 50 recipes and breaks at 500

- **Status:** validated
- **Who:** Keen cooks with large collections.
- **When:** Browsing or searching a collection that has grown over years.
- **Need:** Find and group recipes in more than one way, however large my collection gets.
- **Evidence:**
    - `V` "I have over 2000 recipes and imagine how many scrolls I need to get to search." (Mela, App Store,
      maxxipotamus, 2026-04-06)
    - `V` "There is no way to edit or delete categories, despite the user guide saying there is." (Paprika, Zebrasha,
      2026-07-10)
    - `V` "I have over 700 recipes and suddenly it stopped sorting them" (NYT Cooking, Ryan South Slope, 2026-10-09)
    - `V` "still no way to bulk delete recipes. When importing from another app, categories / folders do not sync."
      (Crouton, in2insight, 2026-03-15)
    - `V` "Sometimes I want the meal with mashed potatoes or rice or grits, and I don't want to inadvertantly make it seem
      like a main is stuck with one type of side." The poster is unsure whether to sort by dish type, protein or carb.
      (r/Cooking, u/redradish3, 2025-09-05, https://www.reddit.com/r/Cooking/comments/1w8b3u0/)
    - `V` "I especially like that you can tag recipes in multiple categories." (r/Cooking, u/GingerIsTheBestSpice,
      2024-10-17, https://www.reddit.com/r/Cooking/comments/1g6040u/_/lsf81i2/). This is a positive case showing that
      multiple tags meet the need.
- **How often / how bad:** Affects the most invested users, who are the ones most likely to recommend an app or leave
  it.
- **Workarounds people use:** Multiple tags. File-name schemes ("Main - Stew - Beef and ale"). Separate spreadsheets
  per category.
- **Where current products fail:** Mela, Paprika, NYT Cooking and Crouton, as quoted. Mealime cannot search your own
  recipes by name (MorriganNicole, 2026-03-15).
- **Open questions:** Which grouping axes matter most: meal, protein, cuisine, occasion, or "tried / want to try"?

### FR-017: Keeping my changes so next time turns out better

- **Status:** validated
- **Who:** Anyone who tweaks recipes, which is most experienced cooks.
- **When:** Right after cooking, and the next time they make the dish.
- **Need:** Keep what I changed and what I learned next to the recipe, so I can repeat or fix it.
- **Evidence:**
    - `V` "I made some dry AF chicken enchiladas recipe last night and I’d love to try again but in a couple weeks from
      now, I’ll forget the recipe I used, therefore forgetting how to not make them so dry." (r/Cooking,
      u/UniformFox_trotOscar, 2020-07-19, https://www.reddit.com/r/Cooking/comments/hu01qg/)
    - `V` "Then she'll talk about x, y, or z that she could do differently next time, and there is never a next time."
      (r/Cooking, u/asdeasde96, 2023-10-15)
    - `V` "I also make notes in the margins when I make changes to the recipes." (r/Cooking, u/SloeHazel, 2026-05-29,
      https://www.reddit.com/r/Cooking/comments/1tqvzar/_/oojbkit/)
    - `S` 13 of 20 blind and low-vision participants edited ingredients and steps and added personal notes. (Li et al.,
      ASSETS 2024)
    - `V` "recipe view needs tabs for Notes!" (Paprika, App Store, dtoyd, 2026-08-19)
    - `S` 57.8% of sampled Allrecipes reviews contain a refinement, such as a change, fix or clarification (Druck and Pang,
      2012). So cooks do write their changes down, even if only in public reviews.
- **How often / how bad:** Common among regular cooks. The cost is repeating the same mistake.
- **Workarounds people use:** Margin notes. A handwritten "final version" notebook, written only after making a recipe
  several times. Google Docs with a link back to the original.
- **Where current products fail:** Paprika has no separate notes view. Mela locks the text: "I cannot select the text
  from my own recipe." (Mela, cuj0du, 2025-10-24)
- **Open questions:** Do people want their version to replace the original, or sit beside it?

### FR-018: Sharing recipes with my partner, family or friends is clumsy

- **Status:** validated
- **Who:** Couples, families across generations, friend groups, mixed Apple and Android households.
- **When:** A relative asks for a recipe, a family builds a shared collection, or a couple plans together.
- **Need:** Share a recipe or a whole collection with the people I cook for or with, whatever device or skill they
  have.
- **Evidence:**
    - `V` "I am collecting recipes from Boomers and Gen Z - so trying to make it tech easy for the mature chefs. And we are
      a mixed Apple - Android family" (r/Cooking, u/DrLilithCat, 2025-11-10,
      https://www.reddit.com/r/Cooking/comments/1otkwdc/)
    - `V` "I was hoping to share a single recipe collection with my wife, but unfortunately the functionality to share
      across iCloud accounts doesn’t work." (Mela, MRobbinsDesign, 2025-11-10)
    - `V` "I’m not able to she crouton with anybody that doesn’t have an Apple device." (Crouton, Sscott8363, 2026-01-21)
    - `V` "it would be so nice to be able to see or follow each others folders" (NYT Cooking, Wishful Sharing,
      2026-10-04)
    - `V` "I want to start sharing with my daughter everything I learned" (r/Cooking, u/xyph5, 2026-04-21,
      https://www.reddit.com/r/Cooking/comments/1srxwsw/)
- **How often / how bad:** Common, moderate. Families end up on the lowest common tool: email, a OneNote, paper.
- **Workarounds people use:** Shared OneNote or Google Drive. Copy Me That accounts that follow each other. Emailing
  PDFs. Printed binders as gifts.
- **Where current products fail:** Mela and Crouton (Apple-only sharing). NYT Cooking (no shared folders). Kitchen
  Stories (family were unable to see a recipe held "in review", Sky-April, 2020-04-05).
- **Open questions:** Do people want one shared copy that everyone edits, or a copy each person owns?

### FR-019: I paid, and then the features moved behind a subscription

- **Status:** validated
- **Who:** Paying users of recipe apps, and people who download an app that looks free.
- **When:** After an update, at the end of a trial, or at the first save.
- **Need:** Know up front what keeping and using my recipes will cost, and have that stay true.
- **Evidence:**
    - `V` "I paid for this app to get the ability to have unlimited recipes and to be able to import PDFs and take pictures
      of recipes to import them… now those features are behind a monthly fee." (Crouton, Babs Spooner, 2026-06-28)
    - `V` "I joined on 3/2022 a lifetime account for $25. Clearly this was a lie." (Pestle, F/up100, 2025-03-09)
    - `V` "you have to pay for this when you want to save a recipe" (ReciMe, 098589, 2026-10-18). Also "I can’t even use
      the app without it forcing me to sign up for a “free trial”" (ReciMe, Meadowlife, 2026-10-19).
    - `V` "Ads now and I have to pay for the same information I once had access to for free?" (Tasty, Kai Sai Zai,
      2026-09-16)
    - `V` "A 37% price increase?" (NYT Cooking, (G)N@, 2026-10-17)
    - **Against:** Many happily pay a one-off fee: "Paprika is a one time fee… Totally worth it" (r/Cooking,
      u/perpetualmotionmachi, 2025-08-01, https://www.reddit.com/r/Cooking/comments/1meu4cf/_/n6cx8ko/)
- **How often / how bad:** Frequent in low-star reviews of ReciMe, Crouton, Pestle, Mealime and Tasty. It erodes trust
  and links to FR-010.
- **Workarounds people use:** One-time-purchase apps. Free tools (Docs, Sheets). Leaving.
- **Where current products fail:** Crouton, Pestle, ReciMe, Mealime ("Every single breakfast option is locked behind a
  paywall", Bjorn Momas, 2025-07-18), Tasty and NYT Cooking.
- **Open questions:** Is the objection to paying, or to the terms changing after purchase? The evidence leans towards
  the change.

### FR-020: Recipe sites fight my screen reader

- **Status:** validated (one study plus one forum voice)
- **Who:** Blind and low-vision cooks. Probably others using assistive tech, but there is no evidence for them.
- **When:** Finding and reading a recipe online.
- **Need:** Reach and read a recipe's text in order, without visual-only clutter getting in the way.
- **Evidence:**
    - `S` "If there was a video in the recipe, it would automatically start playing with sound." Nine of 20 participants
      copied recipes into Word or text files, P1 "so that I don’t have to deal with ads and web formatting when I’m
      trying to cook". (Li et al., ASSETS 2024, n=20, https://arxiv.org/abs/2407.19065)
    - `S` "I’ll search for the word ‘cup’ because I know that’s going to be in there somewhere." (same study, P1)
    - `V` "It's even worse for people who need screen readers. The ads completely fuck them over" (r/Cooking,
      u/TonyHawksAltAccount, 2024-12-01, https://www.reddit.com/r/Cooking/comments/1h2okew/_/lzwta2i/)
- **How often / how bad:** Severe for this group. It doubles the work in FR-001.
- **Workarounds people use:** Plain-text copies. Find-in-page for units. Specialist sites (visionaware.org, acb.org).
  Facebook groups.
- **Where current products fail:** Ad-heavy recipe sites with autoplay video (named by participants in general terms).
- **Open questions:** No evidence was found for motor, cognitive or older-age needs in finding recipes.

### FR-021: The recipe only exists inside a video, or the creator sends me elsewhere

- **Status:** validated (one study plus voices from two places)
- **Who:** People who find recipes on YouTube, TikTok and Reels. Blind cooks above all.
- **When:** Trying to get the ingredient list and amounts out of a video.
- **Need:** Get the full written ingredients and steps for a dish I saw cooked on video.
- **Evidence:**
    - `V` "the worst is when they publish a video without the ingredients in it or in the description. When you ask, they
      will tell you to go to their website." (r/Cooking, u/karsheff, 2025-03-08,
      https://www.reddit.com/r/Cooking/comments/1h2okew/_/mgpk9ow/)
    - `S` Twelve of 20 participants said they had used YouTube recipes but do not rely on them, because the videos lack
      audio description. One participant (P16) types recipes up by pausing and replaying: "It’s not convenient, but it’s
      nicer than if I miss an ingredient." (Li et al., ASSETS 2024)
    - `V` "not being able to upload videos, pdfs, or carousels from social media like insta is such a bummer." (Pestle,
      JaelenT, 2026-02-02)
- **How often / how bad:** Unknown frequency. It costs time, and the reader often lands on an ad-heavy blog anyway
  (FR-001).
- **Workarounds people use:** Pausing and transcribing. Reading the comments. Following the creator's link.
- **Where current products fail:** The platforms (no ingredient field). Recipe apps cannot read the video itself
  (Pestle, Mela).
- **Open questions:** How often do sighted cooks hit this? The strong evidence is from blind cooks.

### FR-022: Units and servings do not fit me

- **Status:** validated
- **Who:** Cooks outside the US, people who weigh, people cooking for one, US cooks given metric.
- **When:** Judging whether a recipe they found is usable.
- **Need:** Read a recipe in the units and portion size I cook with.
- **Evidence:**
    - `V` "No matter where I go online for recipes, everything is in US system and I'm very tired of having to convert
      different fractions of cups to grams." (r/Cooking, u/Traditional_Wheel_43, 2024-08-06,
      https://www.reddit.com/r/Cooking/comments/1elbst4/)
    - `V` "I wish there was a feature to convert units from metric to standard. Idk how to measure in grams lol" (Kitchen
      Stories, dg_$!, 2021-06-26)
    - `V` "why does it not translate into language of choice? Why does it not convert Celsius for Fahrenheit or oz to
      Grams?" (Cookidoo, Don't waste your $, 2026-08-30)
    - `V` "Asking my fellow Americans to get on board with…" (weighing ingredients) (r/Cooking, u/italiana626, 2020-07-08,
      10,489 points, https://www.reddit.com/r/Cooking/comments/hn824o/)
- **How often / how bad:** Moderate. It mostly hits non-US cooks, who are under-represented here.
- **Workarounds people use:** Converters. Choosing sites that give weights. Asking AI.
- **Where current products fail:** Kitchen Stories (forced units). Cookidoo (no conversion, language locked to billing
  country).
- **Open questions:** How big is this outside English-speaking markets? There is no evidence.

### FR-023: Recipes that assume skills or kit I do not have

- **Status:** reported (only two places, and the surveys point the other way)
- **Who:** New cooks, easily discouraged cooks.
- **When:** Choosing a recipe they can realistically pull off.
- **Need:** Judge before starting whether a recipe is within my skill and equipment.
- **Evidence:**
    - `V` "I'm not very good at cooking so they will have to be easy to follow while also not doing anything too
      complicated… I very easily get frustrated in the kitchen" (r/Cooking, u/Fortree_Lover, 2026-07-26,
      https://www.reddit.com/r/Cooking/comments/1v7awxs/)
    - `V` "None of these recipes will actually TEACH you how to cook unfortunately." (Tasty, Dylyo38, 2025-09-16)
    - **Against:** `M` Only 7% name lack of skill as an obstacle, against 20% for time (Instacart, 2025, n=1,011).
- **How often / how bad:** Probably less common than time or trust, by the survey.
- **Workarounds people use:** Following teaching channels. Starting with simple dishes.
- **Where current products fail:** Tasty (relies on premade items, does not teach).
- **Open questions:** Do people under-report skill as a barrier, and describe it as "time" instead?

### FR-024: I can not search the cookbooks I own

- **Status:** reported (two places)
- **Who:** Cookbook owners and collectors.
- **When:** Trying to remember which book had a recipe, or what they can make from their own shelf.
- **Need:** Find a recipe across the physical cookbooks I already own.
- **Evidence:**
    - `V` "All I need for my ultimate recipe organization dreams to come true is for someone to combine Paprika with Eat
      Your Books." (r/Cooking, u/aravisea, 2025-08-01, https://www.reddit.com/r/Cooking/comments/1meu4cf/_/n6czbwq/)
    - `V` "My husband and I had probably eight linear feet of cookbooks that we rarely opened (thanks to the internet)."
      (r/declutter, u/StrongArgument, 2023-06-30)
    - `M` 34.7% get recipes from cookbooks (Allspice, 2026). Ages 60+ lean on classic cookbooks (Instacart, 2025).
- **How often / how bad:** Unknown. Probably matters most to older cooks and collectors, the groups this evidence
  covers least.
- **Workarounds people use:** Eat Your Books (a paid index). Sticky notes. Copying favourites into a binder.
- **Where current products fail:** General recipe apps keep only what you enter yourself, and cannot see inside your
  books.
- **Open questions:** Is the want to search the books, or to cook more from books already bought?

---

## Top needs in this area

1. **Reach a chosen recipe without fighting the page** (FR-001, FR-020). This has the widest evidence, and it is worst
   for screen-reader users.
2. **Judge before cooking whether a recipe will work, and whether a person really made it** (FR-002, FR-013, FR-003).
   Ratings mix "I changed it" with "it worked", and AI-made content is making trust worse.
3. **Keep a complete, correct copy of any recipe from any source, social video and paper included** (FR-005, FR-011,
   FR-012, FR-021).
4. **Find a saved recipe again, as the collection grows** (FR-004, FR-016).
5. **Keep a collection safe and portable for years, at a cost that does not change** (FR-010, FR-019). It is rare per
   person but severe, and the fear alone stops people investing in any tool.
6. **Choose a dish that fits tonight's real limits:** the time and energy I have, everyone at the table, safe diets, the
   budget and the food on hand (FR-006, FR-007, FR-008, FR-009, FR-014, FR-015).
7. **Keep my own changes and share recipes with the people I cook with** (FR-017, FR-018).
