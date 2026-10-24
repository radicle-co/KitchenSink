# Grocery lists and shopping: user needs

Problems people have making and using a grocery list, and doing the shop. Record format, evidence codes and the
"validated" rule are in [README.md](README.md). ID prefix: `GL`.

## Method and limits

Desk research, done 2026-10-20. Nobody was interviewed or watched.

**How "validated" was counted.** A problem with `S` or `M` evidence is validated. A problem with `V` evidence from three
or more independent places is also validated. Each app, each Reddit thread and each other site counts as one place. Many reviews of the same
app count as one place. App Store and Google Play reviews of the same app count as one place. A survey that does not state its sample is still
shown as `M`, but it cannot validate a problem by itself.

**Sources reached**

- **App Store reviews (V).** About 14,500 unique US reviews of 20 apps came from Apple's public review feed. The feed
  gave up to 500 reviews per sort order (newest, and most helpful). The apps: AnyList, Paprika, Mealime, OurGroceries,
  Bring!, Out of Milk, Plan to Eat, Instacart, Samsung Food (formerly Whisk), ReciMe, NYT Cooking, Crouton, Mela, Pestle,
  Tasty, Kitchen Stories, Eat This Much, Cookidoo, Listonic and eMeals. These reviews have no permalink of their own. Each one is cited as the app's
  store page plus the review id and date, for example `apps.apple.com/us/app/id522167641`, review 14347592409.
- **Google Play reviews (V).** The newest 600 English reviews (US store) for each of 10 apps. Plan to Eat returned none.
  These have their own links.
- **Reddit (V), partly.** reddit.com blocked direct access (HTTP 403). Three r/Cooking threads were read in full
  through the Arctic Shift archive. A wider search across about 25 subreddits did not finish before this file was
  written. The Reddit evidence is thin. Comments that advertise an app were left out. One group of near-identical replies
  in one thread was also left out (the `oiow…` comment ids in post 1sxd7z5). They were posted within minutes of each
  other and read like marketing. Opening posts that are app-builder surveys were not used as evidence. Their replies were.
- **Hacker News (V).** Comments found through the public Algolia search.
- **Studies (S) read in full:** Newcomb, Pashley and Stasko (CHI 2003). Janssens et al. (Foods 2019). Gravert and
  Mormann (Scientific Reports 2025). Pew Research on ATUS data (2019).
- **Studies (S) read as abstracts only:** Taylor and Swan, "List Making in the Home" (ACM 2004). Hyland et al. (CSCW
  journal 2018). Yuan et al. (UAIS 2019).
- **Surveys (M) read on the page:** Tesco/YouGov (2022). Sainsbury's Nectar (2022). Empathy Research, Ireland (2016).
  IFIC/AARP (2018). 84.51° for Kroger (2024). FMI/Hartman (2024). WRAP (2024 and 2025). GS1 UK (2025/2026, through a
  trade-press report only). eMeals (2020).
- **Expert and vendor writing (X):** Plan to Eat and MemberKitchens help pages on merging list items. An HBR/NYU Stern
  piece on online substitutions.

**Sources that were blocked or did not open.** These were not quoted and not counted.

- Progressive Grocer (Hartman 2012, "only 35% of list makers stick to the list", "44% normally prepare a list"),
  Drug Store News and Meat+Poultry (NPD "94% of households write a list"), the GS1 UK press page, and Resource Media all
  returned 403. Figures from these appear only in search-engine summaries, so they are not used as evidence here.
- The Cornwall Council page that cites a "30% cut in food waste" shopping-list trial returned 404. The trial itself was
  not found.
- Instacart's own "95% of substitutions satisfy customers" figure and the "30–45% dissatisfied with substitutes" figure
  from academic work were seen only in search summaries. Not used.
- van Lin et al. 2023 (Journal of Consumer Research), which found promotions do not raise waste, was seen only as an
  abstract listing. It is noted as a secondary report in GL-009.

**Gaps in who is represented**

- **Low-income households:** almost nothing in their own words. The only data is a secondary report of USDA FoodAPS on
  transport (in GL-012, not counted) and a few Instacart reviews. People on SNAP or WIC are not heard directly.
- **Non-English speakers:** one German-language Bring! review. Every survey is from the US, UK or Ireland.
- **People with disabilities:** one abstract (visually impaired shoppers) and one commissioned survey with no stated
  sample. A few Instacart reviewers mention disability or surgery.
- **Older cooks:** one 2018 survey on online ordering. App reviewers rarely state their age.
- **Neurodivergent people (for example ADHD):** one positive AnyList review. The planned ADHD subreddit search did not
  finish.
- **Men vs women, and who carries the list:** only Pew's 80/20 split and indirect review evidence.
- **Store-brand and discounter shoppers (Aldi, Lidl), rural shoppers, and people who shop daily on foot:** barely
  heard.
- **Time:** many app reviews are from 2017 to 2020. Some named failures are possibly fixed now. Every quote is dated.
- **Self-selection:** low-star reviews are written by unhappy people. They show that a problem exists and what it feels
  like. They do not show how common it is.

---

## Records

### GL-001: "I don't know what I already have at home, so I buy it twice or skip it and run out"

- **Status:** validated
- **Who:** most shoppers, worst in shared households and for long-life items (spices, rice, condiments)
- **When:** writing the list at home, and standing in the aisle unsure
- **Need:** Know, at the moment of deciding to buy, whether the household already has enough of an item.
- **Evidence:**
    - `M` 92% of UK shoppers "don't always know what they already have in their kitchens" before shopping. 68% have bought
      an item without realising they already had it. 62% have missed an item because they wrongly thought they had it,
      and 53% then had to change their meal plans (Tesco via YouGov, 2022-11-09, sample size not stated,
      https://www.circularonline.co.uk/news/new-survey-shows-92-of-shoppers-dont-always-know-whats-in-their-kitchen/)
    - `M` The most common thing UK adults said would help them waste less: "Checking the fridge, freezer, and cupboards to
      see what you have before the next shop" (45%) (WRAP Household Food Management Survey, June 2024, 4,740 interviews,
      reported 2025-03-19, https://letsrecycle.com/news/household-food-waste-on-rise-since-2020)
    - `V` "Every few weeks I find three jars of the same spice or two half-used bags of rice shoved at the back of the
      cupboard. Clearly my “check the pantry before I shop” routine isn’t working." (r/Cooking post, 2026-10-09,
      https://www.reddit.com/r/Cooking/comments/1x1i5uy/)
    - `V` "Trying to take an accurate inventory of what I have/what I need!" (r/Cooking reply, 2025-06-24,
      https://www.reddit.com/r/Cooking/comments/1ljp0pi/comment/mzlgljf/)
    - `V` "If my husband is preparing to cook a meal, he’ll assume he needs every ingredient when he gives to the store."
      (r/Cooking reply, 2026-10-09, https://www.reddit.com/r/Cooking/comments/1x1i5uy/comment/petvkpc/)
    - `V` "This results in duplicate purchases and wasted money: Purchased items are crossed off the list on one phone but
      still appear as unpurchased on the other." (AnyList, App Store 2★, 2026-07-25,
      https://apps.apple.com/us/app/id522167641, review 14347592409)
    - `V` "family had a tendency of all shopping on the way home from work, and we'd all bring home milk so often that my
      mom actually learned how to make cheese." (r/Cooking reply, 2026-04-27,
      https://www.reddit.com/r/Cooking/comments/1sxd7z5/comment/oimk7sp/)
- **Evidence against:**
    - `S` In a Dutch survey, checking stock before shopping and making a list were **not** linked to less self-reported
      waste (β = −0.089, p = 0.168). Buying more than needed **was** linked to more waste (β = 0.31, p < 0.001) (Janssens et
      al., Foods, 2019, 211 adults, convenience sample, https://pmc.ncbi.nlm.nih.gov/articles/PMC6836184/)
    - `V` "i only buy things right before they run out so i never really had this." (r/Cooking reply, 2026-10-09,
      https://www.reddit.com/r/Cooking/comments/1x1i5uy/comment/petxzss/). Several replies in the same thread say the
      person who does all the cooking knows what is there.
- **How often / how bad:** Common. Two thirds of UK adults report buying a duplicate (Tesco). Cost is money and space for
  duplicates, and a broken meal plan for a missed item. It seems worse in homes where more than one person shops or cooks.
- **Workarounds people use:** a photo of the cupboard before leaving, a whiteboard on the fridge, "one container" rules,
  clear jars, a spreadsheet inventory, "add it the moment it runs out".
- **Where current products fail:** Apps keep the pantry and the shopping list apart, or match them only on exact words
  (see GL-008). Tesco's own answer was a behaviour campaign ("Use Up Day"), not a tool.
- **Open questions:** Is the main cause not looking, not remembering, or another person's purchases? Which item types
  cause most duplicates?

### GL-002: "Our shared list doesn't sync, so we lose items or both buy the same thing"

- **Status:** validated
- **Who:** couples, families, adult children shopping for parents
- **When:** one person adds, another shops
- **Need:** Everyone in the household sees the same current list, with nothing lost, at the moment they shop.
- **Evidence:**
    - `S` "If a shopper is purchasing groceries for a household, the list may be a collaborative effort where
      communication is important." (Newcomb et al., CHI 2003)
    - `S` Paper lists organise "the complex interrelations between a household's people, activities and tasks" but are
      "poor at handling the separation, or classification, of these things" (Taylor and Swan, "List Making in the Home",
      ACM 2004, ethnography of mothers' work, abstract only, https://www.microsoft.com/en-us/research/?p=151844)
    - `V` "Just back from a large grocery shop and am missing at least one item that I KNOW I entered. And one that my
      husband said he entered." (AnyList, App Store 2★, 2026-04-03, review 13919236516)
    - `V` "Never have the app open on two devices at the same time. Seriously—ask your family members before opening the
      app. … Emailing each other or texting is more reliable." (Out of Milk, App Store 2★, 2020-01-04, review 5362715784)
    - `V` "When my wife or I add items, some go missing and every shopping trip we end up missing something we needed."
      (Bring!, Google Play 2★, 2024-01-27,
      https://play.google.com/store/apps/details?id=ch.publisheria.bring&reviewId=ea90b12e-ea66-4f8e-90e1-aa51ebfad3e8)
    - `V` "app is not syncing between family members again." (Out of Milk, Google Play 1★, 2026-10-12,
      https://play.google.com/store/apps/details?id=com.capigami.outofmilk&reviewId=d6ce8cd0-ad5b-4d75-824f-89d802c5129c)
    - `V` "the shopping list often doesn’t update for the other user it’s shared with in your family." (Samsung Food, App
      Store 3★, 2022-09-05, review 9056306550)
    - `V` "the quantities of items in grocery lists stopped sharing correctly." (Samsung Food, App Store 2★, 2023-12-16,
      review 10703236017)
    - `V` "We get random items added that say someone in the house add this. But only my wife and I have access and did not
      add it." (OurGroceries, Google Play 1★, 2026-04-28,
      https://play.google.com/store/apps/details?id=com.headcode.ourgroceries&reviewId=4aa67519-ac5f-49d4-83e0-c837445e083b)
    - `V` "One member wants me to sync to some online list and that means I have to type it out EVERY TIME." (r/Cooking
      post, 2026-04-27, https://www.reddit.com/r/Cooking/comments/1sxd7z5/)
- **How often / how bad:** The single most repeated complaint in shared-list app reviews (AnyList, Out of Milk,
  OurGroceries, Bring!, Samsung Food, on both stores). Severe because it breaks trust: people go back to texting or
  paper. Self-selected, so frequency is unknown.
- **Workarounds people use:** text the list, whiteboard plus photo, Apple Reminders or Google Keep, "close the app when
  done".
- **Where current products fail:** all five apps named above, 2018–2026. Some shared lists also do not show who added an
  item (Samsung Food 2021, review 7490777779), and some charge each household member separately (OurGroceries 2020,
  review 6807763158).
- **Open questions:** How often do sync failures actually happen vs. how often are they noticed? Does a household need to
  see who added what, and why?

### GL-003: "I forget things: the item, or the list itself"

- **Status:** validated
- **Who:** list makers and non-list makers alike
- **When:** in the store, and back home when the missing item is needed
- **Need:** Leave the store with everything the household needed, without a second trip.
- **Evidence:**
    - `M` Of Irish adults who write a list for their main shop, 21% "regularly" forget items on it and 42% "sometimes" do.
      Women 24%, men 16% (Empathy Research Consumer Insights, reported 2016-03-22, sample size not stated,
      https://www.checkout.ie/retail-intelligence/half-consumers-admit-regular-impulse-purchases-25645)
    - `M` "50% of those who wrote their lists on paper confessed to often forgetting to bring it with them or check it."
      Forgetting items was the shopping habit most wanted to break (33%) (Sainsbury's Nectar, 2022-03-15, over 2,000
      shoppers, https://www.grocerygazette.co.uk/?p=28855)
    - `V` "When I forget the thing I have been saying I need to get all week" (r/Cooking reply, 2025-06-24,
      https://www.reddit.com/r/Cooking/comments/1ljp0pi/comment/mzlhk56/)
    - `V` "My list lives on a whiteboard on the fridge so everyone can contribute, but that does mean I have to remember to
      snap a picture before I go shopping!" (r/Cooking reply, 2026-10-09,
      https://www.reddit.com/r/Cooking/comments/1x1i5uy/comment/pets2v9/)
    - `V` "I keep forgetting to buy some things because I don't find them on the list anymore." (Bring!, Google Play 3★,
      2024-05-21,
      https://play.google.com/store/apps/details?id=ch.publisheria.bring&reviewId=4650d63b-4776-4e63-87a6-d6347b3202d9)
- **Evidence against:**
    - `S` In a small US study, every shopper made "some type of mental or physical notation" before the store. About half
      of those with a paper list crossed items off as they went (Newcomb, Pashley and Stasko, CHI 2003, 46 surveyed, 5
      shadowed, observation in 3 stores,
      https://www.dourish.com/classes/ics235aw05/readings/NewcombPashleyStasko-MobileComputingRetail-CHI2003.pdf)
- **How often / how bad:** About one in five list makers forget items regularly (Ireland). Usually low cost per event,
  but it adds trips.
- **Workarounds people use:** list kept on the phone, voice assistant adds, photo of the fridge list.
- **Where current products fail:** see GL-002 (items lost in sync), GL-007 (items ticked by accident) and GL-014 (voice
  adds that fail silently). Bring! drops rarely bought items from its "recently used" area.
- **Open questions:** How much is forgetting to write it down vs. losing the list vs. missing it in the store?

### GL-004: "Adding several recipes gives me a list with the same thing five times and I have to do the maths"

- **Status:** validated
- **Who:** people who plan a few meals and shop once
- **When:** turning the week's recipes into one list
- **Need:** Know the total amount of each ingredient to buy across all the planned recipes.
- **Evidence:**
    - `V` "If one recipe says, “8 onions and 4 apples” and another recipe says “2 onions and 7 apples,” the shipping list
      SHOuLD say 10 onions and 11 apples. Instead, the shopping list is 8 onions, 4 apples, 2 onions, 7 apples" (Mealime,
      App Store 1★, 2020-01-23, https://apps.apple.com/us/app/id1079999103, review 5439156979)
    - `V` "A grocery list with 1 stick of butter written in four different places is like making French buttercream by
      hand while a KitchenAid mixer sits clean on the counter." (NYT Cooking, App Store 3★, 2022-12-23,
      https://apps.apple.com/us/app/id911422904, review 9426057952)
    - `V` "if each recipe requires a certain amount of garlic, you must do the math yourself after looking at each recipe."
      (NYT Cooking, App Store 2★, 2023-01-22, review 9536726046)
    - `V` "If two recipes call for mozzarella cheese, merge the amounts into one rather than creating multiple items."
      (ReciMe, App Store 3★, 2025-01-11, https://apps.apple.com/us/app/id1593779280, review 12171702416)
    - `V` "It also doesn’t recognize repeats from recipes is they’re even the slightest bit different. For example if one
      recipe calls for “pepper” the next “Pepper” and the next “ground pepper” all 3 of those will be automatically be
      added" (Plan to Eat, App Store 3★, 2024-11-04, https://apps.apple.com/us/app/id1215348056, review 11912411992)
    - `V` "Duplicates cause your grocery list to sometimes be stupid. Two different kinds of salt. Yams and sweet potatoes.
      … One time we had green beans show up four times on our list." (Eat This Much, App Store 3★, 2019-02-21,
      https://apps.apple.com/us/app/id981637806, review 3796821349)
    - `X` Plan to Eat merges only when name and unit both match, and will not combine a "pinch" with teaspoons
      (https://learn.plantoeat.com/doc/manually-merge-ingredients-on-your-shopping-list). MemberKitchens says vague units
      like piece, serving or slice cannot be combined
      (https://docs.memberkitchens.com/en/articles/9797217-why-do-i-see-duplicates-on-the-shopping-list).
- **Evidence against:**
    - `V` "the app combined ingredients from multiple recipes so I had a total quantity of what to buy. One lesson
      learned…you need to use the same description/spelling/ingredient name in each recipe so they will add up." (Paprika,
      App Store 5★, 2025-12-20, https://apps.apple.com/us/app/id1303222868, review 13536211974)
    - `V` "The grocery list is excellent. It tells you exactly how much of each ingredient you need according to the
      recipes you’ve saved to your meal plan" (Mealime, App Store 3★, 2021-06-02, review 7417582940). So some products do
      total amounts. The failure is product-specific and depends on ingredient wording.
- **How often / how bad:** Frequent in reviews of recipe apps (5 apps above). It defeats the reason people make the list
  from recipes. Some say it makes the feature useless and they go back to paper.
- **Workarounds people use:** do the sum by hand, keep wording identical across recipes, keep the list in a separate app.
- **Where current products fail:** NYT Cooking (no totals, per these reviews), Mealime 2020, ReciMe 2025, Plan to Eat 2024
  (name variants), Eat This Much 2019. Partial in Paprika, Plan to Eat, MemberKitchens (exact names and compatible units
  only).
- **Open questions:** How should the list show "2 tbsp + 1 cup" of one item? Do people want the total, the parts, or
  both (so they can still drop one recipe)?

### GL-005: "The list from my recipe is missing items, amounts, or the serving size I chose"

- **Status:** validated
- **Who:** people who trust the recipe-to-list step and do not re-check
- **When:** at the store, finding the list incomplete, or at home, finding the amounts wrong
- **Need:** Trust that the list contains every ingredient, in the right amount for the number of people being cooked
  for.
- **Evidence:**
    - `V` "missed frozen peas on the shopping list for Mexican rice….said simply rice when it called for a specific type of
      rice, missed tomato paste. … When I tried to use it to shop… had to cross check with the original. Finally gave up."
      (ReciMe, App Store 3★, 2026-08-13, review 14422522969)
    - `V` "Some items on the list do not include the quantity/amount. I am spending a lot of extra time having to look up
      missing info in the recipes and add it to the shopping list." (Mealime, App Store 3★, 2025-06-17, review 12786794044)
    - `V` "misses many of the ingredients needed when transferring to grocery list" (Mealime, App Store 1★, 2023-12-29,
      review 10758431262)
    - `V` "Changing the servings and adding recipe to shopping list doesn’t preserve the adjusted ingredient amount, so
      shopping off that list will get you the wrong ingredient amounts." (Samsung Food, App Store 2★, 2021-06-21,
      https://apps.apple.com/us/app/id1133637674, review 7490777779)
    - `V` "Some items may be missing when adding ingredients into shopping list from recipes. Very disappointing when
      you’re missing key ingredients." (Samsung Food, App Store 3★, 2021-01-30, review 6934202755)
    - `V` "in any given meal plan, you can’t eat the same recipe twice. … That means when it creates your meal plan, it
      only has half of the ingredients you need." (Mealime, App Store 1★, 2020-01-23, review 5439156979)
    - `V` "all of my recipes that I import from websites look weird and don’t convert into grocery lists properly."
      (Paprika, App Store 1★, 2026-04-04, review 13923146938)
- **How often / how bad:** Reported across 4 apps. Each failure is severe: a missing key ingredient can sink a meal, and
  people stop trusting the list and re-check everything by hand.
- **Workarounds people use:** cross-check the list against the original recipe, keep the recipe open in the store.
- **Where current products fail:** ReciMe 2026, Mealime 2023–2025, Samsung Food 2021, Paprika 2026.
- **Open questions:** How often does this come from bad recipe import vs. the list step itself? (See
  `findingRecipes.md` for import problems.)

### GL-006: "My list is not in the order I walk the store, and my stores are all different"

- **Status:** validated
- **Who:** people who shop the same store each week, people who split a shop across stores (Costco + Kroger, Aldi +
  Walmart)
- **When:** in the store, walking back and forth
- **Need:** Get through the store in one pass, and know which store to buy each item at.
- **Evidence:**
    - `S` When asked to rank features of a shopping aid, people put "Create a grocery list" first, "Arrange a grocery list"
      second and "Provide product location by aisle" third. 72% shop the same store "due to convenience and familiarity of
      store layout" (Newcomb et al., CHI 2003, 46 people)
    - `V` "I like to make my lists in the order my grocery store is arranged, with produce first … However, this app puts
      categories in alphabetical order which cannot be changed" (AnyList, App Store 2★, 2022-02-07, review 8329875784)
    - `V` "I have different lists for different stores, and not all stores are laid out the same way." (OurGroceries, App
      Store 3★, 2022-06-08, https://apps.apple.com/us/app/id325851015, review 8754229021)
    - `V` "Similar items such as fresh salmon and tinned salmon will not be in the same aisle. … Milk is not with eggs
      although they are both dairy." (Bring!, Google Play 3★, 2023-12-16,
      https://play.google.com/store/apps/details?id=ch.publisheria.bring&reviewId=4037ba8e-b23b-403f-a6a0-e1c48b12cbcc)
    - `V` "Why can’t I buy bananas at Aldi and/or Walmart? … MealBoard remembers which store(s) I buy an item from"
      (Paprika, App Store 3★, 2019-03-27, review 3935054665)
    - `V` "Can’t organize groceries by store. … it’s pretty common to grab difficult stuff from different places, e.g.,
      salmon and bulk meats from Costco and smaller packaged goods from Kroger" (ReciMe, App Store 3★, 2025-03-02, review 12374718084)
    - `V` "I carefully curate the list IN ORDER of how the grocery store is laid out on my spreadsheet." (r/Cooking post,
      2026-04-27, https://www.reddit.com/r/Cooking/comments/1sxd7z5/)
    - `V` "My main complaint is I wish the categories would stay in the order I set according to my store layout. I hate
      that I have to reset it every time." (Out of Milk, App Store 3★, 2025-01-11,
      https://apps.apple.com/us/app/id564974992, review 12172373236)
- **How often / how bad:** One of the most repeated requests across list apps (at least 6 apps and 1 thread). Costs time
  and missed items rather than money.
- **Workarounds people use:** hand-made spreadsheets in aisle order, one list per store, renaming categories to aisle
  numbers, a husband's "hard copy list of where everything is in the store" in Word (r/Cooking, 2026-04-28,
  https://www.reddit.com/r/Cooking/comments/1sxd7z5/comment/oiqqqvq/).
- **Where current products fail:** fixed category lists that do not match real aisles (Bring!, Samsung Food, ReciMe),
  category order that is global, not per store (OurGroceries 2022), category order that resets (Out of Milk 2023–2025),
  wrong categories ("salmon is labeled under “uncategorized”", ReciMe 2025, review 12912062006).
- **Open questions:** How many people shop several stores per week? Does store-supplied aisle data reach most stores, or
  only big chains?

### GL-007: "I tick things off by accident in the store, or they vanish, and I miss them"

- **Status:** validated
- **Who:** anyone using a phone or watch list in the store
- **When:** scrolling with one hand, holding a basket, phone in pocket
- **Need:** Be sure, while shopping, that an item is gone from the list only because it is in the cart.
- **Evidence:**
    - `S` "shoppers must use their hands. … Grocery shopping is an especially hands-busy, eyes-busy task." (Newcomb et al.,
      CHI 2003)
    - `V` "it is SO easy to accidentally mark things off my list while scrolling or even just holding onto my phone. So
      many times I have had to go back to the store to get missed items." (Plan to Eat, App Store 3★, 2018-12-29, review 3588653401)
    - `V` "When you check an item as bought from the list, it vanishes. If you click on it accidentally, say using the
      watch, it's gone and you have no way of knowing. This has resulted in two emergency shopping trips by me" (Bring!,
      App Store 2★, 2019-01-21, https://apps.apple.com/us/app/id580669177, review 3677713473)
    - `V` "as many people do, I scroll up a list with my thumb. And very frequently two or three or four list items
      disappear… instantly." (OurGroceries, App Store 3★, 2025-02-03, review 12268221606)
    - `V` "The banner ads load and change while I’m scrolling through a list and it causes the list to shift and I often
      check the wrong item because of it." (Out of Milk, App Store 1★, 2022-06-26, review 8814138789)
- **How often / how bad:** 4 apps. Each event costs a return trip.
- **Workarounds people use:** keep checked items visible, print the list.
- **Where current products fail:** Plan to Eat, Bring!, OurGroceries, Out of Milk (ads moving the list).
- **Open questions:** None of the evidence shows how often this happens per trip.

### GL-008: "Keeping a pantry list is too much work, and it doesn't talk to my shopping list"

- **Status:** validated
- **Who:** people who try inventory apps to fix GL-001
- **When:** setting up the inventory, and keeping it current after each meal
- **Need:** Know what is in stock without spending more effort recording it than the problem costs.
- **Evidence:**
    - `V` "After the hours-long process of inputting everything in my kitchen, I lasted about three days on this app before
      giving up." (Out of Milk, App Store 1★, 2019-12-14, review 5271612534)
    - `V` "I don’t want to have to manage my inventory, either. I’m not a warehouse or an army. One list. Set the amount
      needed. Sort by aisle." (Out of Milk, App Store 1★, 2020-02-20, review 5559356617)
    - `V` "The concept of the pantry is clunky. I don’t want to keep track of food bought and whether it’s used or not."
      (Eat This Much, App Store 3★, 2019-02-21, review 3796821349)
    - `V` "i tried those apps for inventory but i always forget to update them when i use something" (r/Cooking reply,
      2026-10-09, https://www.reddit.com/r/Cooking/comments/1x1i5uy/comment/petmrws/)
    - `V` "I expected the pantry and grocery list to communicate with each other. … I expected it to recognize that I
      already have certain items in stock." (Paprika, App Store 3★, 2020-11-17, review 6656166262)
    - `V` "When you click recipe then the grocery selection, it’ll show up as not being in your pantry because everything
      as to be word for word." (Paprika, App Store 2★, 2019-12-28, review 5332129829)
    - `V` "I’m not manually entering my whole pantry." (Paprika, App Store 2★, 2026-09-14, review 14549268575)
    - `V` "Good app would like the price’s updated in pantry list from shopping list as I find changes during shopping"
      (Out of Milk, App Store 3★, 2025-06-26, review 12821584404)
- **Evidence against:** Some people do keep inventories (spreadsheets, Recipe Keeper for spices only, an "in, out and
  needed" clipboard: r/Cooking, 2026-04-27, https://www.reddit.com/r/Cooking/comments/1sxd7z5/comment/oin1k59/). Partial
  tracking (spices only, or "in stock or not") seems to survive better than full tracking.
- **How often / how bad:** 4 apps and 1 thread. High abandonment after setup is the pattern.
- **Workarounds people use:** track only one category, track "have / don't have" not amounts, photos instead of records.
- **Where current products fail:** Out of Milk (pantry and list not linked, no search), Paprika (exact-word matching,
  manual entry), Eat This Much (pantry required to drive the list).
- **Open questions:** What level of detail is worth the effort: have/none, low/full, or amounts? Who in the household
  keeps it current?

### GL-009: "Pack sizes and deals make me buy more than I'll use, and it goes in the bin"

- **Status:** validated
- **Who:** small households, people cooking from plans whose recipes do not share ingredients
- **When:** choosing quantity in store, a week later at the bin
- **Need:** Buy an amount the household will actually eat before it spoils.
- **Evidence:**
    - `S` Buying more than needed was linked to more self-reported waste (β = 0.31, p < 0.001) (Janssens et al. 2019)
    - `S` Two-for-one offers raised vegetable sales 19.5% over a single-unit discount (43,246 purchases, 8 Swedish
      supermarkets). In a follow-up, 12% of multi-unit buyers said they did not eat it all vs 0% of single-unit buyers, but
      this was not significant (p = 0.064) and only about 1% responded (Gravert and Mormann, Scientific Reports, 2025,
      https://pmc.ncbi.nlm.nih.gov/articles/PMC12102269/)
    - `M` 80% of UK adults buy larger packs because they seem better value. 62% pick smaller packs to suit their household.
      People with "lower competence in judging the right quantity to buy" are among the highest wasters (WRAP Household
      Food Management Survey 2025, 5,509 interviews, published 2026-03-09,
      https://www.wrap.ngo/resources/report/understanding-household-food-waste-uk-household-food-management-survey-2026)
    - `V` "One week everyone will decide they are eating 10 bananas/bags of baby carrots/boxes of crackers a day. Then next
      week when I buy a lot of bananas/carrots/crackers, nobody eats them" (r/Cooking reply, 2025-06-24,
      https://www.reddit.com/r/Cooking/comments/1ljp0pi/comment/mzlhfq1/)
    - `V` "groceries are wasted because the meals don’t focus on using similar ingredients without doing a lot of work. That
      means you’ll usually have too much and throw away the rest." (eMeals, App Store 2★, 2020-09-01,
      https://apps.apple.com/us/app/id575756462, review 6385760198)
    - `V` "unusual ingredients which mean you will have much left over in spices and herbs that you normally don’t use"
      (Mealime, App Store 3★, 2021-06-22, review 7492701581)
- **Evidence against:** van Lin et al. 2023 (Journal of Consumer Research) reportedly found no link between promotions
  and waste, and less waste when households bought more than usual on a deal (secondary report, original not reached).
  Gravert's waste result is itself not significant.
- **How often / how bad:** Over-buying is the cause most consistently tied to waste. The size of the deal effect is
  disputed.
- **Workarounds people use:** freeze, plan meals that share ingredients.
- **Where current products fail:** Meal plans that use each odd ingredient once (eMeals 2020, Mealime 2021).
- **Open questions:** Is the main driver pack size, deals, unpredictable eating, or plans that do not reuse ingredients?

### GL-010: "Online orders come back with wrong substitutes, missing items or 'out of stock' that wasn't"

- **Status:** validated
- **Who:** online grocery users, including people who cannot easily go to the store (no car, after surgery, disabled
  partner)
- **When:** the order arrives, often just before cooking
- **Need:** Get what was asked for, or a replacement the person accepts, in time to cook the planned meal.
- **Evidence:**
    - `M` 84% of US adults 50+ cited "wrong or incomplete orders" as a barrier to online grocery ordering. 88% cited items
      in bad condition (IFIC Foundation and AARP, 2018, 1,004 adults 50+,
      https://www.supermarketnews.com/consumer-trends/online-grocery-has-less-pull-with-older-shoppers)
    - `M` Order accuracy was called essential by 90% of omnichannel shoppers. 23% will look elsewhere online when an item
      is out of stock. Shoppers are least willing to accept substitutes for deli, meat and fish, and most willing for
      shelf-stable and paper goods (84.51° Consumer Digest, Feb 2024, sample not stated,
      https://supermarketnews.com/online-retail/online-shoppers-go-elsewhere-when-items-out-stock)
    - `V` "my shopper ignored all my replacement requests for items that weren’t available at the store and checked out. It
      is super inconvenient to have so many ingredients missing for a recipe if you’re planning to cook that day."
      (Instacart, App Store 1★, 2024-01-18, https://apps.apple.com/us/app/id545599256, review 10837710605)
    - `V` "I’ve got directly to the store as soon as my shopper left and found every single item on my list, when they
      couldn’t find a single one, or their substitute." (Instacart, App Store 1★, 2026-10-03, review 14623219494)
    - `V` "I would plan a meal around my instacart order and most of my essential items would not make it in, or they
      would substitute it with something completely different" (Instacart, App Store 2★, 2020-10-24, review 6568840892)
    - `V` "it was making all of the numbers of items extremely wonky when I was trying to add the grocery list to Walmart."
      (ReciMe, App Store 3★, 2026-07-06, review 14270672739)
    - `V` "The main reason I absolutely loved the app was for the ability to create the shopping list and sent it directly
      to Walmart or Insta cart. That feature no longer works." (Samsung Food, App Store 2★, 2024-01-13, review 10818571874)
    - `X` A shopper's complaint quoted by retail researchers: "I ordered raspberries. They send me cauliflowers." Store
      picking happens after the order, so shelf stock may have changed (Corsten, Laporte and Jagabathula, HBR via NYU
      Stern, 2025-11-17, https://www.stern.nyu.edu/experience-stern/faculty-research/improving-substitutions-online-ordering)
- **How often / how bad:** Many Instacart reviews in 2026 alone. Severe for people who use delivery because they cannot
  shop in person.
- **Workarounds people use:** go to the store anyway, order extra, avoid delivery for meat and produce.
- **Where current products fail:** Instacart (above), recipe-app hand-off to retailer carts (ReciMe to Walmart 2026,
  Samsung Food to Walmart/Instacart 2024, review 10818571874, Mealime crashes mid-cart 2026, review 14407430579).
- **Open questions:** What share of orders have a problem? Instacart's own claims did not open.

### GL-011: "Delivery fees and mark-ups make the online shop cost far more than I expected"

- **Status:** validated
- **Who:** online grocery users, especially those with no other option
- **When:** checkout, and comparing the receipt to in-store prices
- **Need:** Know the full cost of the shop before committing to it.
- **Evidence:**
    - `M` 89% of US adults 50+ cited high delivery or service fees as a barrier. People earning under $35,000 were much more
    likely to name mobility as a major obstacle (30% vs 7% over $75,000) (IFIC/AARP 2018, 1,004 adults)
    - `V` "every single item was more expensive on instacart, sometimes TWICE as much!" (Instacart, App Store 2★,
      2020-10-24, review 6568840892)
    - `V` "Fee, fee, fee, fee, fee, a lot of fee! … But the fee is $32 so it’s total $53" (Instacart, App Store 2★,
      2026-10-15, review 14669682638)
    - `V` "We were spending around $110 a week which is too much for just 2 people imo." (Instacart, App Store 2★,
      2021-04-14, review 7223167452, reviewer's partner is "permanently disabled")
- **How often / how bad:** One survey plus many reviews of one app (one V place). Validated on the `M` evidence.
- **Workarounds people use:** shop in person, order only in emergencies.
- **Where current products fail:** Instacart.
- **Open questions:** None of the evidence is from non-US delivery services.

### GL-012: "I want to know what the shop will cost, and which store is cheapest, before I go"

- **Status:** validated
- **Who:** people on a budget, people shopping several stores
- **When:** planning the shop, and at checkout
- **Need:** Know roughly what the list will cost, and where it costs least, while there is still time to change it.
- **Evidence:**
    - `M` 37% of US shoppers use their phones to compare prices across stores, up 28 points since 2016. 91% of those
      worried about rising prices changed how they shop (FMI U.S. Grocery Shopper Trends 2024, by The Hartman Group, sample
      not stated on the page, 2024-05-16,
      https://perishablenews.com/retailfoodservice/fmi-launches-2024-u-s-grocery-shopper-trends-series-how-consumers-are-finding-value-at-the-grocery-store/)
    - `S` Low-income households travel past the nearest store to shop: for SNAP households the nearest store was 2.0 miles
      away on average, the main store 3.4 miles. 68% of SNAP participants use their own car vs 95% of non-poor households
      (USDA ERS FoodAPS, 2012–13, about 4,800 households. Secondary report seen in a search summary, original not
      reached, not counted. https://www.ers.usda.gov/webdocs/publications/43953/eib138_erratasummary.pdf)
    - `V` "there's no option to add prices to products that I'd need, which would in turn, give an estimated budget of my
      grocery bill spending." (Bring!, Google Play 3★, 2025-07-17,
      https://play.google.com/store/apps/details?id=ch.publisheria.bring&reviewId=0c10f4dd-56b1-45b1-9acf-a764cc740273)
    - `V` "Per-unit pricing is a big miss for grocery shopping. … did you know that computers are good at arithmetic?"
      (AnyList, Google Play 3★, 2026-07-27,
      https://play.google.com/store/apps/details?id=com.purplecover.anylist&reviewId=cf17bf01-68fe-4ee8-a4cc-643eb3622c8b)
    - `V` "Guessing which of the two stores near me will have the best price and the stuff I need in stock" (r/Cooking
      reply, 2025-06-24, https://www.reddit.com/r/Cooking/comments/1ljp0pi/comment/mzlhpdc/)
    - `V` "Still no pricing feature?!" (OurGroceries, Google Play 2★, 2026-10-11,
      https://play.google.com/store/apps/details?id=com.headcode.ourgroceries&reviewId=eb231f31-7cd0-4bff-ad0c-3ca9dccaa1bd)
- **How often / how bad:** Common request. Matters most to the low-income group least heard in this evidence.
- **Workarounds people use:** store apps and flyers, notes fields, Out of Milk's price-and-total feature (named as the
  reason to prefer it in an OurGroceries review, Google Play 3★, 2026-03-15,
  https://play.google.com/store/apps/details?id=com.headcode.ourgroceries&reviewId=e8c88451-3d80-4118-bea8-40940516a3f4).
- **Where current products fail:** Bring!, OurGroceries, AnyList (unit price only with a retailer filter, per the
  review).
- **Open questions:** Do people want an estimate, a running total in store, or a store comparison? How accurate must it
  be to be useful?

### GL-013: "One person carries the whole job of knowing what we need"

- **Status:** validated
- **Who:** mostly mothers in couples with children
- **When:** all week, not only at the store
- **Need:** Share the work of noticing and recording what the household needs, not only the trip.
- **Evidence:**
    - `S` In married or cohabiting households with children, 80% of mothers say they are the primary grocery shopper vs 20%
      of fathers (Pew Research Center analysis of ATUS Eating and Health Module 2014–16, 2019-09-24,
      https://www.pewresearch.org/short-reads/2019/09/24/among-u-s-couples-women-do-more-cooking-and-grocery-shopping-than-men/)
    - `S` Households use "seen but unnoticed" methods to build lists and anticipate needs, which makes the work hard to
      sense or hand to a machine (Hyland et al., "What do you want for dinner?", CSCW journal 27, 2018, abstract only,
      https://dl.eusset.eu/items/340e543b-f805-48a1-a2be-136bc846c468/full)
    - `V` "All household members are notified WHEN I plan to go to the store so they are aware of impending deadline …
      Wanted Doritos and didn't add it to the list? Sorry, go buy your own!" (r/Cooking reply, 2026-04-28,
      https://www.reddit.com/r/Cooking/comments/1sxd7z5/comment/oiq9hz6/)
    - `V` "I tried to like this app, I really tried. … (haven’t even shared with my husband yet since he knows even less about
      this stuff than I do)" (AnyList, App Store 2★, 2026-04-30, review 14014549706)
- **How often / how bad:** The split is well measured. How much of it is the list (vs. the trip) is not.
- **Workarounds people use:** shared lists, fridge whiteboards, "add it when you use the last one" rules.
- **Where current products fail:** Setup is hard enough that the second person never joins (AnyList 2026).
- **Open questions:** Do shared lists actually move work to the second person, or only let them add requests?

### GL-014: "I add items by voice and they never reach the list"

- **Status:** validated
- **Who:** people who add items mid-task (cooking, cleaning, childcare)
- **When:** the moment they notice something ran out
- **Need:** Capture a need the instant it is noticed, with hands busy, and trust it was kept.
- **Evidence:**
    - `V` "I’ve added items to different shopping lists using Siri or Alexa and received clear confirmation that the items
      were added. … when we arrived at the supermarket, many of those items were missing" (AnyList, App Store 2★,
      2025-12-25, review 13553430432)
    - `V` "it no longer syncs my shopping list with Alexa. … So I’m supposed to look at two shopping lists when I go to the
      store?" (Samsung Food, App Store 1★, 2023-09-27, review 10413933987)
    - `V` "Alexa no longer supports adding to more than the first list!!!!" (OurGroceries, App Store 1★, 2025-04-25,
      review 12586020480)
    - `V` "you have to remember the tell part or it adds it to some random Alexa list we haven’t looked at since we bought
      the echo." (r/Cooking reply, 2026-04-27, https://www.reddit.com/r/Cooking/comments/1sxd7z5/comment/oin6ksu/)
    - `V` "Sync issues, adding items on the watch does nothing." (OurGroceries, Google Play 2★, 2026-05-21,
      https://play.google.com/store/apps/details?id=com.headcode.ourgroceries&reviewId=c8f75e7f-b3ea-42df-8adc-48b5ff45510e)
- **How often / how bad:** 4 places. Failures are silent, so people find out in the store.
- **Workarounds people use:** check the list after each voice add, use the phone's own reminders app.
- **Where current products fail:** AnyList, Samsung Food, OurGroceries, changes on the voice platforms' side are often
  the cause.
- **Open questions:** Is the need voice, or capture at the moment of noticing?

### GL-015: "My list app keeps changing, adding ads, or charging, and I lose my list"

- **Status:** validated
- **Who:** long-time users of free or cheap list apps
- **When:** after an update, often in the store
- **Need:** Rely on the list being there and working the same way each week.
- **Evidence:**
    - `V` "No notice; no list. Starting from scratch again." (OurGroceries, App Store 1★, 2024-12-31, review 12128243762)
    - `V` "My wife mistakenly clicked on one while holding the phone and it opened with a loud, embarrassing, threatening
      message in the middle of a store. We have removed the app." (OurGroceries, App Store 1★, 2026-08-24, review 14468118072)
    - `V` "Ever since they switched to Samsung Food, the app doesn’t work well." (Samsung Food, App Store 2★, 2024-01-13,
      review 10818571874)
    - `V` "Over the last several months they’ve changed things and have made it increasingly difficult to do that. Now the
      newest update has made me decide I can’t use this app anymore." (Out of Milk, App Store 1★, 2018-05-04, review 2504289921)
    - `V` "im entirely bummed that it's getting shut down" (Mealime, App Store 1★, 2026-10-03, review 14623758963)
    - `V` "I must have tried all the grocery list apps in the app store and have finally settled with the old-fashioned but
      the best app --- Paper & Pencil." (Hacker News comment, 2021-11-11, https://news.ycombinator.com/item?id=29192288)
- **How often / how bad:** 5 apps. The data shows people abandon a list after one bad change.
- **Workarounds people use:** paper, built-in phone apps (Apple Reminders, Google Keep), which many Reddit replies name.
- **Where current products fail:** OurGroceries 2024–2026, Out of Milk 2018–2026, Samsung Food after the Whisk change,
  Mealime's 2026 shutdown.
- **Open questions:** How much is "the list must never change" a need for stability vs. a dislike of particular
  changes?

### GL-016: "Staples I always have get added every time"

- **Status:** reported
- **Who:** anyone generating a list from recipes
- **When:** reviewing the generated list before shopping
- **Need:** See only the things that actually need buying, without wading through items that are always in the house.
- **Evidence:**
    - `V` "It adds every single ingredient from your recipes automatically, with no option to leave off staples like
      salt/pepper etc. … This causes me to have huge grocery lists with 80+ items and MULTIPLE repeats." (Plan to Eat, App
      Store 3★, 2024-11-04, review 11912411992)
    - `V` "Also it automatically adds every recipe ingredient to the shopping list and there’s no way to turn that off."
      (Plan to Eat, App Store 3★, 2026-09-19, review 14569621159)
    - `V` "I don't put any of the weekly staples on the list, such as milk, but everything else gets added the moment I
      notice I'll run out after one more use." (r/Cooking reply, 2026-10-09,
      https://www.reddit.com/r/Cooking/comments/1x1i5uy/comment/peuph22/)
- **How often / how bad:** Only one app (Plan to Eat, two reviews) draws this complaint. The Reddit reply shows a habit
  of leaving staples off, not a complaint. It makes lists long, which makes GL-003 worse.
- **Workarounds people use:** untick by hand each week, Mealime users "check off food that I already have" (Mealime, App
  Store 3★, 2019-03-04, review 3844204688).
- **Where current products fail:** Plan to Eat (two reviews, 2024 and 2026).
- **Open questions:** Is "staple" a fixed set per household, or does it change with stock levels?

### GL-017: "The store is out of what I planned around, and I have to re-plan in the aisle"

- **Status:** reported
- **Who:** in-store shoppers following a meal plan
- **When:** at the empty shelf
- **Need:** Decide quickly what to buy instead, knowing what that does to the planned meals and what is at home.
- **Evidence:**
    - `V` "Then the store is out of one or more crucial ingredients, forcing me to panic meal plan in the middle of the
      store. It’s hard to remember what I have at home when I’m on the spot like that." (r/Cooking reply, 2025-06-24,
      https://www.reddit.com/r/Cooking/comments/1ljp0pi/comment/mzli1ou/)
    - `V` "you go to trader Joe's and they don't have your sorbet or all the bananas are too green. So, there are things
      you can't account for." (r/Cooking reply, 2025-06-24,
      https://www.reddit.com/r/Cooking/comments/1ljp0pi/comment/mzli66m/)
    - `V` "Guessing which of the two stores near me will have the best price and the stuff I need in stock" (r/Cooking
      reply, 2025-06-24, https://www.reddit.com/r/Cooking/comments/1ljp0pi/comment/mzlhpdc/)
    - `V` "Easily move an item to another list (say, if it's sold out)." (OurGroceries, Google Play 3★, 2025-12-13,
      https://play.google.com/store/apps/details?id=com.headcode.ourgroceries&reviewId=4b97eecd-8a84-40d1-a43c-af1f1486062c)
    - `M` In a March 2020 panic-buying week, respondents could not find 40% of their list items even after visiting an
      average of two stores (eMeals survey, 2020-04-07, sample not stated,
      https://bevnewsonline.com/shoppers-couldnt-find-40-of-items-in-grocery-store/). An extreme period, not normal.
- **How often / how bad:** 2 V places (one thread, OurGroceries). The eMeals survey states no sample and covers one
  unusual week, so it does not validate. Normal-time frequency is unknown.
- **Workarounds people use:** move the item to another store's list, improvise.
- **Where current products fail:** Little product evidence either way.
- **Open questions:** How often are planned ingredients out of stock in normal weeks?

### GL-018: "Whoever else shops buys the wrong brand, size or amount"

- **Status:** reported
- **Who:** households where the list writer is not the shopper
- **When:** the other person is in the store
- **Need:** Pass on exactly which product and how much, so a stand-in shopper gets it right first time.
- **Evidence:**
    - `V` "I like how you can include pictures for those one or two items someone always buys the wrong brand (and it
      remembers them next time you add the item)" (r/Cooking reply, 2026-04-27,
      https://www.reddit.com/r/Cooking/comments/1sxd7z5/comment/oin67ty/)
    - `V` "Now when I want my spouse to buy 1 pint instead of 1 gallon, I have to write it out in the notes." (Out of Milk,
      App Store 3★, 2025-01-25, review 12234369987)
    - `M` 61% of Irish list writers use only generic terms. 17% add a few brand names (Empathy Research, 2016). This
      suggests most lists leave product choice to the shopper.
- **How often / how bad:** 2 V places. Unknown frequency.
- **Workarounds people use:** photos on items, notes, texting from the aisle.
- **Where current products fail:** Out of Milk 2025 (unit hidden when quantity is 1).
- **Open questions:** How often does this cause a return trip vs. mild annoyance?

### GL-019: "No signal in the store, so my list won't open or loses my changes"

- **Status:** reported
- **Who:** shoppers in large or rural stores with poor reception
- **When:** opening or editing the list inside the store
- **Need:** Read and update the list in the store whatever the connection.
- **Evidence:**
    - `V` "My grocery store doesn’t have good cell reception once I step inside so I can’t always open the app unless it’s
      already open." (Out of Milk, App Store 3★, 2026-09-27, review 14599409204)
    - `V` "I’ll add items and prices as I shop only to find those items or prices gone within the next couple of minutes."
      (Out of Milk, App Store 2★, 2018-01-14, review 2089219281)
    - `V` "A lot of grocery stores have low cellular signal in my experience. So the fact that I can’t access these
      recipes offline makes it useless to me." (Samsung Food, App Store 2★, 2023-09-01, review 10323933832)
- **How often / how bad:** 2 apps (Out of Milk, Samsung Food). Not counted as validated.
- **Workarounds people use:** open the app before going in, paper.
- **Where current products fail:** Out of Milk, Samsung Food.
- **Open questions:** How common is poor in-store reception?

### GL-020: "I can't see what's running low or write the list myself" (visual impairment)

- **Status:** reported
- **Who:** blind and partially sighted people
- **When:** at home before shopping, and reading labels in store
- **Need:** Find out independently what has run short, record it, and identify the right product in store.
- **Evidence:**
    - `S` People with visual impairments found "identifying products that have run short" and "itemizing needed products in
      a list" difficult, along with organising purchases at home (Yuan, Hanrahan, Lee, Rosson and Carroll, Universal
      Access in the Information Society, 2019, participatory design, abstract only, sample not stated,
      https://scholar.lib.ntnu.edu.tw/en/publications/constructing-a-holistic-view-of-shopping-with-people-with-visual--2/)
    - `M` 71% of severely visually impaired people find food shopping a challenge. 83% find packaging information hard or
      impossible to access, 83% stick to familiar brands to avoid problems (GS1 UK commissioned survey, reported
      2026-01-08, sample not stated, https://www.asiantrader.biz/visually-impaired-food-shopping-challenges, GS1's own page
      blocked)
- **How often / how bad:** Severe for the group. Evidence is thin and indirect.
- **Workarounds people use:** asking strangers (53% per GS1), familiar brands.
- **Where current products fail:** No product evidence found.
- **Open questions:** Everything. No first-person voices were found.

---

## Top needs in this area

1. **Know what is already at home** at the moment of choosing to buy (GL-001, GL-008). The best-evidenced problem, but
   the people who try to track stock usually give up, and one study found checking stock did not lower waste.
2. **Trust the shared list.** Everyone in the household sees the same current list and nothing goes missing (GL-002,
   GL-014, GL-015). The most repeated complaint in list-app reviews.
3. **Get a complete, correct list from the planned recipes.** Every ingredient, the right amount for the people being
   fed, and one total per ingredient (GL-004, GL-005, GL-016).
4. **Get through the store in one pass**, in each store's own order, knowing which store to buy each item at (GL-006).
5. **Leave the store with everything**: no items forgotten, ticked by accident, or lost for lack of signal (GL-003,
   GL-007, GL-019).
6. **Buy amounts the household will actually eat** (GL-009). Over-buying is the cause most often tied to waste.
7. **Know the cost before committing** (GL-012, GL-011). Matters most to low-income shoppers, who are the least heard
   here.
8. **When the store or the delivery fails, recover the plan quickly** (GL-017, GL-010).
