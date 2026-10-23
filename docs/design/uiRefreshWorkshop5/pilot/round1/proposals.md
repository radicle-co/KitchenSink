# Pilot round 1: content proposals and photo credits

These are content ideas. They are deliberately **not** in the mockup, because the pilot keeps the content and the
layout as they are. Each idea cites the need records. Status uses the codes in `docs/research/userNeeds/README.md`.
These are judgement calls from desk research, not user evidence. Nothing here was tested with cooks.

## Recipe detail

1. **Show the amount inside the step (CK-001, validated).** In step 2, write "Mash the 3 tbsp butter". This removes the
   trip back up to the ingredient list. The amount follows the servings stepper (CK-012).
   It is the largest gain for the least screen. Cost: the parse pipeline must link each step to its ingredient lines.
2. **Put the recipe before the extras (FR-001, validated, the rank 1 need).** Today a cook passes the description, tags,
   rating, comments and nutrition before the first ingredient. Move rating, comments and nutrition below the steps, and keep
   the summary above them. The section switch already jumps there, so this is mainly an order change.
3. **Show nutrition once, not twice.** It appears inline and again as a section-switch target. Keep one place, below
   the steps.
4. **Show the whole job before starting (CK-007, CK-013, CK-022).** The facts say "1 h 50 min total". That is 20 min of
   prep plus 1 h 30 min in the oven. The 15 min rest in step 5 is not in it, so the real time to the plate is 2 h 05.
   The recipe's own data shows the CK-013 problem. Add a short line under the facts row: "20 min hands-on · 1 h 30 min
   in the oven · 15 min rest · 2 h 05 to the table". It answers "can I do this tonight?" and shows where the prep fits.
5. **Make "Edit recipe" secondary for good (FR-001).** The mockup already makes it quieter. Make cooking the main action on this
   screen: "Start cooking", which opens cook mode with keep-awake on (CK-002, CK-008). Then the keep-awake caption can
   go.
6. **Mark the time-critical step (CK-021).** Step 2 has a busy stretch (buttering under the skin while the oven is
   hot). Add a quiet "have ready" line to the steps that cannot wait. It helps the cook who struggles. The same line is
   easy for an experienced cook to skip (brief §3b).

## Home

7. **The week preview assumes a weekly plan (MP-017, MP-027).** Of 23,283 French planners, 79% plan only a few days
   ahead (MP-027), and many people do not plan at all (MP-017). When it is built, make "This week's meals" show the
   next few days, and make it work with nothing planned.
8. **Let "Recent recipes" answer "what tonight?" (FR-006, MP-003, MP-022).** The section shows what was opened, not
   what fits tonight. Adding the time already on each tile is a start. A later step can favour recipes that fit the
   evening (FR-007).
9. **Let the no-photo tile offer to add a photo (FR-004).** For the cook's own draft, change "No photo yet" to a
   quiet "Add photo" action. In the pilot, it stays a display state, so that no action is added.

## Photo credits

Each photo is from Wikimedia Commons. I cropped and resized each one, and saved it as WebP at 20 KB or less. A
cropped CC BY-SA photo stays under CC BY-SA.

| Used for                    | File                                                                                                                                                                                                   | Author                                    | License                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------- |
| Recipe hero (roast chicken) | [Roasted Lemon Herb Whole chicken with Carrots and Onions 1 (28791114980).jpg](<https://commons.wikimedia.org/wiki/File:Roasted_Lemon_Herb_Whole_chicken_with_Carrots_and_Onions_1_(28791114980).jpg>) | Sharon Chen, from Austin, United States   | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)       |
| Lemon ricotta pancakes      | [Ricotta hotcakes (8625761799).jpg](<https://commons.wikimedia.org/wiki/File:Ricotta_hotcakes_(8625761799).jpg>)                                                                                       | pelican, from Tokyo, Japan                | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |
| Weeknight pad thai          | [Pad Thai Noodles - Little Thai, Brighton 2024-03-21.jpg](https://commons.wikimedia.org/wiki/File:Pad_Thai_Noodles_-_Little_Thai,_Brighton_2024-03-21.jpg)                                             | Andy Li                                   | [CC0](https://creativecommons.org/publicdomain/zero/1.0/)       |
| Sunday rosemary focaccia    | [Focaccia con rosmarino.jpg](https://commons.wikimedia.org/wiki/File:Focaccia_con_rosmarino.jpg)                                                                                                       | Parkerman & Christie, from San Diego, USA | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)       |

The Roast tomato soup tile has no photo on purpose. It shows the no-photo state.
