# Food naming rules (owner rulings, 2026-09-23 to 2026-09-27)

The audience is a US home cook who chooses a recipe ingredient. Use US English and US food names only.

## Scope

1. Do not ingest restaurant or fast-food items. These are the items in USDA's "Restaurant Foods" and "Fast Foods" categories, and any item whose USDA description says "restaurant" (owner, 2026-09-27). Together they are 432 SR Legacy items. The two restaurant-prepared espresso items (171891, 174125) stay, because they are the only espresso items. Mark the others `x` (excluded). The rule covers the USDA baseline too, not only the curated foods. Exception (review 2026-09-28, vetoable): USDA files supermarket frozen pizzas (for example DiGiorno, "Pizza, cheese topping, regular crust, frozen, cooked") under Fast Foods, but stores sell them, so rule 1c keeps them. The School Lunch pizzas stay out, because only food service buys them.
   1a. Do not ingest mechanically separated meat (owner, 2026-09-27). No store sells it. Mark it `x`. Like rule 1, this covers the USDA baseline too.
   1b. Do not ingest livestock lungs (beef, veal, lamb and pork). US federal rules bar them as human food (9 CFR 310.16(a)), so no store sells them. Mark them `x`. This was settled in the review loops under the owner's instruction of 2026-09-28 to resolve open questions, on the same reasoning as rule 1a.

1c. THE COVERAGE GOAL (owner, 2026-09-28). The catalog should hold most of the foods that people can buy in US grocery stores, not only recipe ingredients. Snacks, candy, cereal, soda, frozen dinners and baby food are grocery foods. A food may exist with no nutrition data; the numbers can come later from other databases, from users or by hand. FoodOn is a naming aid, not a gate: a USDA item with no FoodOn term can still make or join a curated food. Rule 1 (restaurant and fast food), rule 1a and rule 1b still exclude what no store sells.

## What is one food

2. The raw and cooked forms of a food are ONE food. The item labels carry the difference.
3. A food is what a US cook asks for by name. If the cook adds a sub-type as extra detail, that sub-type is a detail, not a food. Every beef brisket cut (flat, point, navel end, whole) is under "beef brisket". Every chuck roast (arm, blade, under blade, shoulder clod pot roast) is under "beef chuck roast".
   3a. Fresh, frozen, canned and dried are SEPARATE foods, because that is how people shop and cook. Fresh is implied, so the fresh food has no form word ("green beans", "frozen green beans", "canned green beans", "dried apricots"). Within one form, the raw and cooked items stay together (rule 2): "frozen green beans" holds both frozen and frozen-then-boiled items.
   3c. THE GRANULARITY PRINCIPLE (owner, 2026-09-26). A sub-type is its own food when shoppers treat it as its own kind: they look for it by name, stores sell it apart, and recipes call for it. A sub-type is a detail when shoppers treat the kinds as interchangeable and choose by price. The reason is often historical or cultural, not botanical or anatomical. The evidence is how US grocery stores market the food. Look up EVERY food in real store listings (Kroger, Walmart, Safeway, Whole Foods, Instacart or Target), with no exceptions, and cite the listing. Follow what the stores do: the food's name, its splits and its merges follow the store products. If no store sells the food (wild game, Alaska Native foods, industrial products), log "no store listing" and keep it as it is.
    - Own foods: Cornish game hen (a chicken, but people know it as its own food). Hungarian red pepper (a red pepper, but recipes call for it by name, unlike a hothouse red pepper). Beef chuck eye roast (stores and shoppers treat it apart from a regular chuck roast). Chicken breasts, thighs, drumsticks and wings. For poultry parts, skin and bone also make separate foods, because shoppers choose "boneless skinless chicken breasts" or "bone-in, skin-on chicken thighs" by name.
    - Details: the kinds of chuck roast (arm, blade, under blade), because most shoppers take any of them and compare price. The part of a veal shank (fore or hind). Brisket flat and point.
    - Tahini is its own food, apart from whole-seed sesame paste. Fresh pasta is its own food apart from dry pasta, which is plain "pasta".
      3b. Meat food names are the names US stores print on the label, the URMIS common names (https://www.meattrack.com/urmis/), for example "beef chuck roast", "flat iron steak", "Denver steak", "pork New York chop", "pork porterhouse chop", "beef stew meat". The butcher's or wholesale name (under blade, arm, clod, knuckle, cube roll, IMPS names) goes in the item label, so a chef can still pick the exact cut. Research the URMIS common name when unsure.
4. Veal follows rule 3c like every other meat: a veal product that stores sell by name (for example veal cutlets, veal chops, osso buco) is its own food, and the rest is details of "veal". Ground veal and veal organ meats (liver, kidney, brain, tongue, heart, sweetbreads) stay separate foods, like ground beef and beef liver.
5. Poultry: "turkey meat" holds all turkey meat that is described only by color or skin (light meat, dark meat, meat only, meat and skin, all classes). The same rule applies to "chicken meat", "duck meat" and other birds. A named part (breast, thigh, drumstick, wing, whole bird) stays a separate food, because US recipes call for it by name. Ground and processed meat also stay separate foods.
6. A processed form is a separate food. Tomato paste, tomato puree, tomato sauce and canned tomatoes are four foods. The same rule applies to other paste, puree, sauce and juice products.
   6a. Juice made from frozen concentrate (diluted) is a detail of its juice, not a separate food (owner, 2026-09-27). Its label says `frozen concentrate, diluted`. Undiluted frozen concentrate stays its own frozen food ("frozen pineapple juice concentrate"), because it has 3 to 4 times the calories of the juice (owner, 2026-09-28).
7. An imitation product is a separate food ("imitation scallops"). If it has only one item, that item IS the food.
8. Baby food is a separate food, never a detail of the adult food. Its name is "<food> baby food" ("ham baby food", "creamed corn baby food"). The stage (strained, junior, toddler) is a detail, so each baby food is one food, and its stages are details.
9. A distinct variety with its own US name is a separate food. Enoki mushrooms are not brown mushrooms.
10. An item whose name equals its food is the food itself, with the label `plain`. In a food with a single item, that item is `plain`, unless its label carries a fact that changes nutrition, a cooking method or a baby-food stage. The `plain` item merges into the food: it is the food's own item, never a variant (owner, 2026-09-29: "if we ever have plain for a usda variant, that's a good indication that the variant is actually just the root and should be merged where possible").
11. Pork: a boneless top loin chop or a boneless center loin chop is a "New York pork chop".
12. Black beans and black turtle beans are one food ("black beans", AKA "black turtle beans").

## Food names

13. Never write `raw`, `cooked` or `boneless` in a food name. The one exception is poultry parts, where stores print `boneless skinless` in the name (rule 3c). Write `bone-in` only if every item is bone-in and a boneless form of the same cut is common in US stores. A cut that is always bone-in (porterhouse, T-bone, rack) never says `bone-in`.
14. Write lowercase, except proper nouns ("Denver steak", "Sauvignon Blanc"). The app capitalizes the first letter.
15. If US cooks say a name alone, drop the extra word: "Denver steak", not "beef Denver steak". "Sauvignon Blanc", not "Sauvignon Blanc wine".
16. AKA is a well-known US synonym for search ("Fumé Blanc", "first cut brisket", "New York strip steak").
    16a. When stores print a different name for a whole family (fresh, frozen and canned), every form takes the store name, and the old name and the FoodOn name stay as AKA (owner, 2026-09-27). Examples: "tart cherries" (AKA "sour cherries"), "sweet peas" (AKA "green peas").

## Detail labels

17. A label says only what separates the item from its siblings. It never repeats the food name. It keeps every fact that changes nutrition.
18. Raw is implied. Never write `raw`, `uncooked`, `unprepared` or `dry` in a label. The item that equals the food is `plain`.
19. For a cooked item, write the method (`grilled`, `boiled`, `roasted`, `braised`, `rotisserie`, `pan-fried`, `microwaved`, `steamed`). If USDA gives no method, write `cooked` or `prepared`. Drop `drained`.
20. NO STATE FIELD (owner, 2026-09-30: "Go ahead and drop the purchasable/cooked field"; it replaces the 2026-09-26 purchasable/cooked state and rule 31). Whether an item is cooked is a fact of its label: a cooking method part (`boiled`, `roasted`, `brewed`, `prepared`) or `homemade` says the numbers describe the food after cooking. A store-cooked product (rotisserie chicken, deli meat) carries its method in the label like any other.
21. For an import, end the label with `product of <country>`, the USDA country-of-origin form (owner, 2026-09-27: origin goes LAST, because readers scan the cut first). Example: `navel end, lean only, braised, product of New Zealand`.
22. Keep USDA cut and variety words. Keep them even where the food name implies them. Examples: `top loin` under strip steak, `snap` under green beans, `center loin` under New York pork chop.
23. Keep a traditional name that USDA records for a Native food. The people's name is the origin, so it goes last (rule 24). Example: `Neeshjizhii, steamed, Navajo` (the example read `Navajo, Neeshjizhii, steamed` until the label-part review of 2026-09-28).
24. Every label part has one attribute, and the parts go in this order (label-part review, 2026-09-28, which the owner delegated to two agents):
    1. cut (`top loin`, `arm picnic`, `light meat`)
    2. bone (`bone-in`, `without bones`)
    3. skin (`skin-on`, `skinless`, `with skin`)
    4. form or variety (`Hass`, `ground`, `sliced`, `fully cooked`, `homemade`)
    5. baby-food stage (`strained`, `junior`)
    6. pack (`in water`, `in juice`, `heavy syrup`, `drained solids`, `with added solution`)
    7. lean or fat (`lean only`, `70/30`, `low-fat`)
    8. trim (`1/8-inch trim`, `lip-on`, `denuded`)
    9. grade (`choice`, `select`)
    10. cooking method (`braised`, `boiled`)
    11. salt, then sugar, then added nutrients
    12. brand (`Quaker`, `Nasoya`)
    13. origin: `product of <country>`, a US region (`Florida`) or a Native people (`Navajo`)

    The seed writes each part with its attribute, so no reader needs a separate list. A few parts mean different things in different foods (`whole` is a cut in ham and a form in onions), and the seed tags each of those by its food.

25. Use these exact forms. Meat: `lean only`, `separable lean and fat`, `fat only`, `70/30`, `1/8-inch trim` (write `-inch`, never `"`, so a screen reader speaks the unit; owner, 2026-09-27), `choice`, `select`, `prime`, `all grades`, `bone-in` (never `boneless`). Skin: `skin-on`, `skinless`, `with skin`, `peeled`. Salt: `with salt`, `no salt added`. Sugar: `sweetened`, `unsweetened`, `no sugar added`. Nutrients: `enriched`, `unenriched`, `fortified`, `added vitamin C`. Corn: `cut`, `corn on the cob`. Grains: keep `precooked` and `instant`.
26. Labels are distinct within a food. If two USDA items are samples of the same thing, add one word from the second item's USDA text, and write the note `d: same food as <fdc>`.

## Default item

28. A root's own item follows the election rule: a `plain` item (rule 10: it is the food itself, even when its USDA text names a step the maker took, such as roasted groats), else the most-eaten uncooked item (no cooking step in its label or its USDA text, rule 20), else the uncooked item with the middle calorie value, else the same steps over all items. At every step, prefer items from the current market (the US) over imported ones (owner, 2026-09-27).
    28a. One food, newest data (owner, 2026-09-27). When a USDA Foundation item (2026) is a sample of the same food as an SR Legacy item (2018), the Foundation item supplies the numbers. The SR item becomes an alias (state `a`), so its name still finds the food. If the Foundation item has no energy value, the direction reverses: the SR item keeps supplying the numbers, and the Foundation item is the alias. The same food means the same form, cut, fat level and state. A different energy value alone does not make a different food, because a newer sample of the same product can measure differently (review loop 2026-09-28: chicken, leaf lettuce, portabella).
29. When USDA samples two cuts raw as one item ("chops or roasts") and one of them has only cooked items, the cut with only cooked items joins the food that holds the raw sample. Its name stays as AKA, and its labels name the cut (owner, 2026-09-27: beef chuck steak, lamb rib chops, pork rib roast and pork sirloin roast).

30. MERGE AND DEFAULT (owner, 2026-09-29: "if a variant merges into a root, then it shouldn't be visible as a variant"). The `plain` item, and the item a food uses as itself when no item is `plain` (rule 28), are the food itself, never variants. When the food's own item is not the product stores sell, make the store product `plain`, proved by a store listing; the item the election used before then stays an ordinary visible variant.
31. Retired by rule 20 (owner, 2026-09-30). Brewed coffee and tea need no state: `brewed` is in their labels.
32. FORM IN THE NAME (owner, 2026-09-29). A product that US stores sell only frozen, or only canned, carries that word in its name (rule 3a), even when USDA's text states no form.
33. BRAND ON A ONE-ITEM FOOD (owner, 2026-09-29). A brand stays in the label of a food's only item only if the food is unique to that manufacturer or known by the brand ("Pillsbury cinnamon rolls"). Otherwise the brand leaves the label, and the item is `plain` unless another part changes nutrition.
34. KINDS SOLD APART (owner, 2026-09-29). Whole and ground spices, flat-leaf and curly parsley, extra virgin olive oil, fresh mozzarella and similar kinds are their own foods, because stores and recipes treat them apart (rule 3c). Decide such cases from store, recipe and database evidence, without asking.
35. Variety names as synonyms, and same-food twins, are decided from market, grocery and recipe data, without asking (owner, 2026-09-29). Evidence from other databases, cooking apps and store listings decides names and kinds (rule 36 covers numbers).
36. NUTRITION BELONGS TO THE ROOT OR THE VARIANT (owner, 2026-09-29: "variant food items have associated nutritional data. Root food items ... also have nutritional data if it is available via usda or out in the internet if no usda item is available (or none if no data can be found)"; amended 2026-09-30: "Use all data sources that we can legally use"). Every variant has its USDA item's numbers. A root with an SR Legacy or Foundation item has that item's numbers. A root with no such item takes the numbers of one cited source, chosen by match quality and then by source in this order: a USDA SR Legacy or Foundation item for the same substance in another form, USDA FNDDS, CIQUAL, CoFID, BLS, Japan's Standard Tables, Matvaretabellen, Livsmedelsdatabasen, the Swiss Food Composition Database, the Canadian Nutrient File's own rows, and then a USDA Branded Foods product or the manufacturer's own Nutrition Facts label. With none, the root has no numbers. Every number cites its source. A source is used only when its licence allows commercial reuse with no share-alike term (ADR-0052): Open Food Facts stays out because ODbL is share-alike, which the 016 legal framework forbids (FR-033), and commercial nutrition APIs and cooking apps stay out because their terms bar automated copying.

## Older decisions

27. Rules 3, 3a, 3b, 3c and 8 are the owner's NEWEST rulings (2026-09-26). If an item or food marked fixed conflicts with one of them, apply the rule, and log the change with the word `override` and the rule number. Examples: the frozen corn items under "yellow sweet corn" move to "frozen yellow sweet corn". The stage-split baby foods merge into one food each.
