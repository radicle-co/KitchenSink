# Pilot round 4: content proposals and photo credits

These are content ideas. They are deliberately **not** in the mockup, because the pilot keeps the content and the
layout as they are. Each idea cites the need records, and the status codes are the ones in
`docs/research/userNeeds/README.md`. These are judgement calls from desk research, not user evidence. Nothing here
was tested with cooks.

## Recipe detail

1. **Show the amount inside the step (CK-001, validated).** In step 2, write "Mash the 3 tbsp butter". This removes
   the trip back up to the ingredient list, and the amount follows the servings stepper (CK-012). It is the largest
   gain for the least screen. Cost: the parse pipeline must link each step to its ingredient lines.
2. **Put the recipe before the extras (FR-001, validated, the rank 1 need).** Today a cook passes the description,
   tags, rating, comments and nutrition before the first ingredient. Move rating, comments and nutrition below the
   steps, and keep the summary above them. The section switch already jumps there, so this is mainly an order change.
3. **Show nutrition once, not twice.** It appears inline and again as a section-switch target. Keep one place, below
   the steps.
4. **Show the whole job before starting (CK-007, CK-013, CK-022).** The facts say "1 h 50 min total". That is 20 min
   of prep plus 1 h 30 min in the oven. The 15 min rest in step 5 is not in it, so the real time to the plate is
   2 h 05. The recipe's own data shows the CK-013 problem. Add a short line under the facts row: "20 min hands-on ·
   1 h 30 min in the oven · 15 min rest · 2 h 05 to the table". It answers "can I do this tonight?" and shows where
   the prep fits.
5. **Make "Edit recipe" secondary for good (FR-001).** The mockup already makes it quieter. Make cooking the main
   action on this screen: "Start cooking", which opens cook mode with keep-awake on (CK-002, CK-008). Then the
   keep-awake caption can go.
6. **Mark the time-critical step (CK-021).** Step 2 has a busy stretch: buttering under the skin while the oven is
   hot. Add a quiet "have ready" line to the steps that cannot wait. It helps the cook who struggles, and an
   experienced cook can read past it (brief §3b).

## Home

7. **The week preview assumes a weekly plan (MP-017, MP-027).** Of 23,283 French planners, 79% plan only a few days
   ahead (MP-027), and many people do not plan at all (MP-017). When the feature is built, make "This week's meals"
   show the next few days, and make it work with nothing planned.
8. **Let "Recent recipes" answer "what tonight?" (FR-006, MP-003, MP-022).** The section shows what was opened, not
   what fits tonight. The time on each tile is a start. A later step can favour recipes that fit the evening
   (FR-007).
9. **Let the no-photo tile offer to add a photo (FR-004).** For the cook's own draft, change "No photo yet" to a
   quiet "Add photo" action. In the pilot it stays a display state, so no action is added.

## Voice

10. **Write every screen in the voice the spec sets out.** It is warm, plain and exact, with no jokes near times,
    temperatures, allergens, ratings or errors. Round 3 rewrote only the strings on these two screens. A short voice
    guide in the design system keeps the other screens in step. It needs rules, a word list and before-and-after
    pairs, like the round-3 table.
11. **Give the finished recipe a small reward (CK-023, brief §3).** The step motion ends at the last step. That moment
    can carry one warm line and the photo, for example "Done. Enjoy it." It is the one place a little more feeling
    fits. This moment needs its own design round.

## Photos

12. **Give user photos one quiet treatment (FR-004, FR-013).** Real recipe photos come from phones, cookbooks and
    websites, and they vary much more than this set. Run the same light grade on upload: exposure, a slight warm
    balance and capped saturation. Keep the original too, and offer no filters or styles. The aim is a library that
    looks like one collection. FR-013 is about trust in what is real, so the grade must never change what the food
    looks like.

## Structure

13. **Give the main action a fixed place (FR-001, CK-002).** Round 4 makes the screen read as an app, but it still
    has no cooking action. After proposal 5 is built, give `Start cooking` a fixed place: a filled
    button at the bottom of the sheet, and an icon button in the scrolled top bar. Then the main job is always one tap
    away, wherever the cook is on the page.
14. **Fold the done steps by default (CK-003, CK-008).** Round 4 folds a done step to two lines, as a display state.
    Doing this for every finished step keeps the current step near the top of the screen as the cook moves on. A tap
    opens a folded step again.

## Photo credits

Each photo is from Wikimedia Commons. I cropped, resized and colour-graded each one (see `spec.md`, "Photo
treatment"), and saved each as WebP at 20 KB or less. A changed CC BY-SA photo stays under CC BY-SA.

| Used for                    | File                                                                                                                      | Author                          | License                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------- |
| Recipe hero (roast chicken) | [Max's Roasted Chicken, Evan Swigart](https://commons.wikimedia.org/wiki/File:Max%27s_Roasted_Chicken_-_Evan_Swigart.jpg) | Evan Swigart, from Chicago, USA | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/)       |
| Lemon ricotta pancakes      | [Ricotta Pancakes (211739913).jpeg](<https://commons.wikimedia.org/wiki/File:Ricotta_Pancakes_(211739913).jpeg>)          | Anna                            | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)       |
| Weeknight pad thai          | [Pad thai con camarones.jpg](https://commons.wikimedia.org/wiki/File:Pad_thai_con_camarones.jpg)                          | ProtoplasmaKid                  | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Sunday rosemary focaccia    | [Focaccia Crust.jpg](https://commons.wikimedia.org/wiki/File:Focaccia_Crust.jpg)                                          | Fred Benenson                   | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

The round-2 focaccia (a plain Genoese focaccia) was soft and flat at tile size. Round 3 uses a sharp close-up of a
rosemary and salt focaccia, with the same crop and grade as the other photos.

The Roast tomato soup tile has no photo on purpose. It shows the no-photo state.
