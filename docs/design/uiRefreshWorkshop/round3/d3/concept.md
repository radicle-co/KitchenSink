# Mise en Place, Set — Designer 3, Round 3 (final)

Mockup: [`mockup.html`](mockup.html). It contains:

- Home at 390 px, light.
- Recipe detail at 390 px, light, the full page.
- The same recipe detail at 390 px, **dark**.
- Collections at 1280 px, light.
- Discover at 390 px, light, mostly photos.
- Proof panels: the rule on the flagship plate, the five archetypes, the two contrast checks, eight day-one fallbacks,
  the plate's life, interaction states, and the full wall in light and in dark.
- A token strip: chrome colours, grounds and keys, type.

The copy and the order of elements come from the current boards. This is design judgement. None of it is user
evidence.

Every recipe plate in the file is resolved and laid out by one rule module, with no hand fixes. The same module
emits the CSS tokens and printed the ratio tables in this document. A few figures are typed by hand (the D13 options)
or are estimates (the glass ratios), and they are marked as such.

## The idea

A commis sets out the station before service: the lemon, the thyme and the butter, each in its place. Commise does the
same for a recipe that has no photo. The recipe gets a **plate**. A plate shows the foods that give the recipe its character. They sit on a board of the
**opposite colour**, the way a food stylist picks a board that makes the food stand out. The plate never
draws the finished dish. A function can build it from data the app already has, so it can never invent food.

The chrome stays quiet: oat paper, green-black ink, and one basil colour for everything you press. Two things carry
the excitement:

- **The plate**, which gives every recipe a face from its first publish.
- **The key**, a reading colour taken from the plate's board. On the recipe page it colours the **title**, the
  overline and the group labels. So each recipe looks like its own page in a printed book.

At night each board glows under a lamp tinted by its own colour.

Round 3 is the same idea made sound. Round 2 proved that a generator can build the plates. The critics then found five places where the
generator broke. The face was the wrong food. The plate froze too early. Pale food sat on pale ground. Six grounds
behaved like four. One layout was used for everything. Each of these is now a stated rule, and the mockup shows each
rule working.

## Palette

Role names match today's tokens, so a re-theme changes values only. Ratios use the WCAG 2.x relative-luminance
formula. **T** is a text pair and needs 4.5:1. **N** is a non-text pair (an edge, a glyph, a state fill, a focus
ring) and needs 3:1.

### Light

| Role                | Hex                   | Use                                                                 |
| ------------------- | --------------------- | ------------------------------------------------------------------- |
| canvas              | `#F6F2EA`             | the page, under the wash                                            |
| paper               | `#FFFDF8`             | cards, the strip, fields, chips on plates, pills                    |
| surface-muted       | `#ECE6D9`             | the segmented track                                                 |
| skeleton            | `#DED6C5`             | "Soon" placeholders. **Lifted** from `#ECE6D9`, to match dark       |
| ink                 | `#1F2A22`             | text, inactive tab labels and glyphs                                |
| ink-muted           | `#6B645C`             | D11 slate                                                           |
| line-divider        | `#E3DCCD`             | hairlines only                                                      |
| line-control        | `#8A847C`             | D11 pewter: every control edge, and the empty part of a star        |
| action (basil)      | `#2E6B47`             | filled buttons, a checked box, the current step, the active tab pip |
| action-pressed      | `#24573A`             | the pressed fill                                                    |
| action-text / focus | `#2A6342`             | links, icon buttons, the 2 px focus ring                            |
| action-tint         | `#DDEBDF`             | the tonal button, the selected chip, the selected sidebar row       |
| saffron             | `#A36A00`             | star glyphs only                                                    |
| danger              | `#B23F28`             | destructive text                                                    |
| avatar / avatar-ink | `#E8DCC4` / `#1F2A22` | **new role**: the avatar no longer borrows a plate colour           |

| Pair                                              | Ratio              | Kind                              |
| ------------------------------------------------- | ------------------ | --------------------------------- |
| ink on canvas / paper                             | 13.31 / 14.62      | T                                 |
| ink-muted on canvas / paper / surface-muted       | 5.22 / 5.73 / 4.69 | T                                 |
| ink-muted on the wash, worst ground (slate wash)  | 4.62               | T                                 |
| white on action / pressed                         | 6.34 / 8.40        | T                                 |
| action-text on canvas / paper                     | 6.35 / 6.97        | T                                 |
| danger on canvas                                  | 5.17               | T                                 |
| avatar-ink on avatar                              | 10.95              | T                                 |
| line-control on canvas / paper                    | 3.32 / 3.64        | N                                 |
| focus ring on canvas                              | 6.35               | N                                 |
| active tab pip on glass (0.84) over the plum hero | 5.31               | N                                 |
| ink tab label on glass over the plum hero         | 12.45              | T                                 |
| saffron star on canvas                            | 4.07               | N                                 |
| skeleton on paper                                 | 1.42               | decorative (matches dark at 1.43) |

### Dark ("night kitchen")

| Role                                | Hex                               |
| ----------------------------------- | --------------------------------- |
| canvas / paper / surface-muted      | `#131512` / `#1C1F1A` / `#262A24` |
| skeleton                            | `#353A31`                         |
| ink / ink-muted                     | `#EEEBE3` / `#ABA89F`             |
| line-control                        | `#7A7E73`                         |
| action, with a dark label `#0F1A12` | `#86C99F`                         |
| action-text / focus                 | `#93D3AA`                         |
| action-tint                         | `#22362A`                         |
| saffron / danger                    | `#E8B54A` / `#F08C74`             |
| avatar / avatar-ink                 | `#3A3428` / `#EEEBE3`             |

| Pair                                              | Ratio              | Kind |
| ------------------------------------------------- | ------------------ | ---- |
| ink on canvas / paper                             | 15.41 / 13.99      | T    |
| ink-muted on canvas / paper / surface-muted       | 7.72 / 7.01 / 6.14 | T    |
| ink-muted on the wash, worst ground (butter wash) | 5.42               | T    |
| label on action / pressed                         | 9.24 / 7.57        | T    |
| action-text on canvas / paper                     | 10.61 / 9.63       | T    |
| danger on canvas                                  | 7.61               | T    |
| line-control on canvas / paper                    | 4.42 / 4.01        | N    |
| ink tab label on glass (0.80) over the plum hero  | 13.01              | T    |
| status-bar ink on the dark plum ground            | 9.09               | T    |

### Plate tokens: `plate.ground`, `plate.key`, `plate.glow`, `plate.wash`, `plate.motif`

Six grounds. Round 2's chili and terracotta are **merged** into clay. Tomato is **gone** as a ground: it was loud,
and its key was close to danger. Two cool grounds are **added**: plum, and slate, the one deep board. The wall is now
two warm, one green and three cool.

| Ground | Light     | Dark      | Key, light | Key, dark | Holds heroes that are                           |
| ------ | --------- | --------- | ---------- | --------- | ----------------------------------------------- |
| butter | `#F2D37C` | `#5A4716` | `#7A5A00`  | `#E8C766` | brown (chocolate, cinnamon, mushroom)           |
| clay   | `#DE9A72` | `#62362A` | `#7E5530`  | `#E9B48C` | green (herbs, greens, lime)                     |
| sage   | `#B7C48A` | `#33502B` | `#56602A`  | `#BFC98A` | purple (onion, beet)                            |
| sea    | `#78ABA8` | `#184D4C` | `#2D625F`  | `#8FCBC6` | red (tomato, chili)                             |
| plum   | `#A9829F` | `#523158` | `#7A4870`  | `#D8AFD0` | yellow (lemon, corn, butter)                    |
| slate  | `#2F4A5C` | `#22416A` | `#2F4A5C`  | `#A9C4DA` | orange and pale (carrot, rice, potato, chicken) |

| Check                                                    | Light                     | Dark                                     |
| -------------------------------------------------------- | ------------------------- | ---------------------------------------- |
| key on canvas                                            | 5.72 to 8.34              | 9.59 to 11.19                            |
| key on paper                                             | 6.28 to 9.16              | 8.70 to 10.15                            |
| key on its own wash (the title sits here)                | 5.35 to 7.38              | 7.33 to 7.85                             |
| the flagship title: plum key on the plum wash            | 5.65                      | 7.47                                     |
| ground against canvas                                    | 1.31 to 8.34              | **1.70 to 2.05** (round 2: 1.30 to 1.43) |
| smallest difference between two grounds (OKLab ΔE × 100) | 9.7 (butter against sage) | 5.9 (sage against sea)                   |
| clay key against danger                                  | ΔE 10.3, hue 28° vs 10°   | not used                                 |

- **No key is red.** The clay key moved to a brown `#7E5530` (28°). Danger stays the only red.
- **Grounds never carry text.** A status chip on a plate sits on solid `paper`, with a 1 px `glass-edge` ring so its
  shape holds on a dark ground (paper against the dark grounds is only 1.54 to 1.86).
- **The wash is a token now, `plate.wash`**, pre-mixed per ground and per theme. The mix is 12% in light and 55% in
  dark. Round 2's prose said 12% while its dark code used 60%. The dark wash at 12% is invisible. The generator also
  caps the mix so that ink-muted keeps 4.6:1 and the key keeps 4.5:1 on the wash top. Only slate hits the cap: its
  light wash is 8%.
- **The status bar over a plate** takes ink or paper, whichever is higher. Ink on the plum hero is 4.52 in light.
  Over slate, it takes paper.
- **D15:** `plate.*` is a closed token family. Only the `Plate` renderer reads it, and the role guard fails any other
  read. Motifs are about 50 roles, for example `m-lemon`, `m-ceramic`, `m-glaze`, each with a light and a dark value.

## Type

- **Display: Fraunces**, weight 560, `SOFT` 100, `font-optical-sizing: auto`, at **22 px and up only**: screen titles
  (32, and 48 on desktop), the recipe title (34), every phone section head (**24**, down from 26 to 28), collection
  titles (23).
- **`WONK` 1 only at 34 px and up.** So the recipe title gets one hand-cut letter shape, and the small sizes stay plain.
- **The recipe title takes the key** (d1's suggestion). It is one element, a word you read, never something you
  press. It passes AA at body size, not only as large text (5.35 at the worst).
- **Inter** does all the work, with tabular lining figures for every number. Reading text is 16.5 to 17 / 1.6.
  Overlines and group labels are 12 px caps at **+12%** tracking, in the key.
- **Heading order on Home is fixed.** "Recent recipes" and "Coming soon" are both Fraunces 24. Round 2 made the
  placeholder section louder than the cook's recipes.
- **The Ingredients row fits on one line again**, as on the board: "Ingredients", "for 4", the Servings stepper and
  the Edit button, inside 358 px.

## Surfaces, shape, elevation

- **Flat by default.** Cards are `paper` with a 1 px inset hairline and no shadow. Only plates, the floating tab bar
  and the floating button cast a shadow, so food is the one thing that sits on the page.
- **Radius:** plates 22 (phone) and 24 (desktop and mosaic), cards 20, the recipe sheet's top 28, fields 12. Pills
  are only for things you press.
- **The recipe sheet** overlaps the hero by 28 px. Its grab line is drawn in the key.
- **Glass (D12)** only on the tab bar, the hero buttons, menus and sheets: 0.84 in light, 0.80 in dark. The active
  tab has a filled `action` pip, a filled glyph and weight 750, so it never depends on hue alone.
- **A dark plate has a 1 px inner rim** at `rgba(238,235,227,.08)`, so its edge holds on the dark canvas even where
  its shadow cannot show.
- **Controls in the wash band** (the top 360 px) always have a `paper` fill. Pewter on a light wash can fall to 2.93
  (slate), but against its own paper fill it is 3.64. The search field, the pills and the Filters button follow this.
- **Stars:** a partial star is the saffron glyph clipped to its fraction, over a pewter outline of the whole star
  (3.32 on canvas). Round 2's empty part was 1.22, so 4.8 read as five full stars. Both colours come from roles, so the
  star is right in dark too.

## Imagery: the plate rule

Seven steps. All of them run in the generator.

1. **Inputs.** The title, the ingredient lines in order, and each line's matched catalog food. D20 allows a line with
   no match.
2. **The hero ladder.** Candidates are ranked by:
    - first, a food that the title names, in title order. The match rule: the title names a food through any title
      word that equals the catalog name or a synonym of a matched line's food, with case and plurals folded. So "shallots" names the
      shallot line, which draws the onion motif, and "Garlicky" names garlic.
    - then produce, citrus and spice.
    - then herbs (they garnish almost everything, so they rank below the other produce).
    - then proteins and the main carb.
    - last, staples and the aromatic base (flour, butter, oil, onion, garlic). These are only supports, unless the
      title names them, as in "French onion soup".

    Inside each step, line order decides. Round 2 took the first matched line, so its faces were flour, onion and raw
    chicken. "Lemon and thyme roast chicken" now leads with lemon, then thyme, then chicken: the title, in order.

3. **The ground is the hero's complement.** There is one table row per colour family (the palette table above).
   Yellow goes on plum, red on sea, green on clay, orange and pale on slate, purple on sage, and brown on butter. These are
   opposites on the colour wheel, or opposites in value for pale food. Round 2 put a food on the ground of its own
   family. That matched the hue, so it also matched the value: lemon on butter was 1.01.
4. **The checks.** The generator measures the hero's main colour against its ground.
    - **Light:** below **1.5:1**, the hero sits in a bowl. The generator picks a dark glaze or a pale ceramic bowl,
      whichever gives the hero more contrast against the inside. It then asserts two floors: the hero against the
      bowl is at least 1.5, and the bowl against the ground is at least 1.3. Coconut lime rice is the case on a
      plate (lime on clay is 1.07, and lime in the glaze bowl is 4.74). In the mosaics, broccoli on slate gets a ceramic bowl
      (4.89), and tomato on plum gets one too (3.37).
    - **Dark:** below 1.5:1, the hero keeps its place and gets a warm rim, the lamp catching its edge. Chocolate on
      dark butter (1.08) and onion on dark sage (1.26) are the cases.
    - **Supports:** a support below **1.3:1** on the ground is skipped, and the next candidate takes its place. So a
      plate holds one to three foods, never a food you cannot see. Focaccia's flour and oil both fail on clay, so its
      rosemary stands alone.
    - Across the 22 recipes in the file, every hero passes 1.5 in light except the one vessel case. The worst
      passing pair is tomato on sea at 1.73.
5. **Five archetypes**, chosen by the stored seed. The seed also sets a mirror flag:
    - **station:** hero centred, supports in two corners, an accent in a third.
    - **spill:** a diagonal. Supports overlap the hero by up to a fifth.
    - **bleed:** the hero at full size, running off the tile like an overhead photo.
    - **row:** three foods across a wooden board.
    - **tucked:** supports pressed against the hero's rim.

    A wall no longer repeats one diagram.

6. **The accent** is a whisk, spoon, twine, fork, pinch bowl or cloth. It is never food. Round 2's crumbs were food,
   so they are gone. Butter is redrawn as a wrapped block with a folded paper end and a cut face, so it no longer
   reads as a folder icon.
7. **Wide heroes** (the recipe page) keep every object inside a safe area: the middle of the width, clear of the back
   and more buttons, and above the sheet's overlap.

**Every food is cut paper.** Shapes are flat with no outlines. An edge runs all the way round each shape, plus a
1.6 px offset, so layers read as paper. Round 2's edge was only on the bottom. The grain is a multiply grain in light
and a light speck in dark, and it is never under text.

**Fallback.** A recipe with no hero yet gets a fallback. A hash of the stored seed picks:

- the ground.
- the cloth: stripe, check, linen or none.
- the cloth's corner.
- the tool: spoon, whisk, fork, ladle, rolling pin or twine.
- the tool's size and angle.

The mockup shows seeds 100 to 107 in order, with no picking. The ground ignores the dish on purpose: the bean chili is
on sage, the apple pie on sea. A fallback is **temporary**. It is never frozen (see below).

**Photos.** A real photo always wins. It sits on a **4 px mat**, which is the photo's main colour family through the
same complement table, 8% darker. Round 2's 6 px mat in the family colour read as a selection ring, and it
sometimes clashed. Inside a collection mosaic, a photo fills its cell with no mat.

**Collection covers are one tile now.** A mosaic takes **one shared ground**, from its first plate, and shows only
each recipe's hero: four objects, not fifteen. The same contrast check runs on the shared ground. A hero that fails it sits in a
bowl. A one-recipe collection shows its full plate.

**Accessibility.** A plate is decorative (`alt=""` / `accessible={false}`). The title already names the dish.

### The plate's life (the round 2 freeze defect, fixed)

Round 2 froze the plate at first save. But the editor saves a draft before any ingredient exists, so almost every
typed recipe kept the fallback forever under that rule. Now the seed and the content are split:

| Moment                                                                                                                                                                                | What happens                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| First save                                                                                                                                                                            | The **seed** is stored: archetype, mirror, accent. It never changes.                                                                                  |
| While a draft                                                                                                                                                                         | The foods on the plate follow the lines, quietly, with no motion. The fallback shows until a hero exists.                                             |
| First publish (`recipes.first_published_at`, ADR-0058), or the end of an import. Publish means the recipe leaves draft status. It does not mean public: a private recipe freezes too. | The foods are **frozen**. The assembly plays once, the next time the recipe page opens. It never plays in the editor.                                 |
| A drawn food leaves the recipe                                                                                                                                                        | Only then does the plate change: the next candidate takes the slot in a 400 ms cross-fade. So the plate never shows a food the recipe no longer uses. |

The proof panel walks one recipe through all four moments. While it is a draft with two lines, the chicken leads.
A freeze at that point keeps the wrong face.

### Proposal for the owner: the drawn foods in the list

On the light recipe page, the three foods drawn on the plate carry a 22 px glyph at the end of their line (d2's
suggestion). The cook sees "that's my lemon", and the plate becomes part of the recipe. It adds no row and no motion.
But it is a new element on the board. So it is shown in light only, and it needs the owner's yes.

## Dark: the lamp, per ground

There is still one mechanism and no filter. Round 2's single warm lamp turned every ground the same brown, and sea
became khaki. Now each plate has:

- a lamp tinted by **its own ground's daytime colour** at 20%.
- a small warm hotspot (`#FFD9A0` at 8%) on top.
- a deep ground lifted to **1.70 to 2.05:1** against the canvas (round 2: 1.30 to 1.43).
- the 1 px inner rim.

Sea stays sea, and plum stays plum. Motifs keep almost their daytime values. Only the cream and paper colours drop,
so they do not glow. The dark wall panel shows the same twelve plates as the light one.

## Motion

- **The one signature:** the checkbox overshoot. The box fills basil, and the strike-through draws left to right in
  180 ms.
- **Once in a recipe's life:** the plate assembles the first time the recipe page opens after first publish. The board,
  then the hero, then the supports, then the accent drop 6 px into place, 70 ms apart, about 400 ms in all.
- **Quiet:** tiles fade up 8 px at 240 ms on a screen's **first paint only**, not on every scroll, so a long grid
  never ripples. The sheet settles over the hero at 280 ms ease-out. A change of the first tile cross-fades the
  wash over 400 ms. A drawn food that leaves cross-fades over 400 ms. New recipe shrinks to its icon on scroll (D4).
  Nothing loops or parallaxes.
- **Reduced motion:** everything becomes an instant cross-fade. The plate appears finished, and the checkbox shows its
  end state.

## What makes it exciting

- Libraries, Discover and collections become walls of bright, cut-paper prints made from the cook's own food. The
  complement boards make each food pop, and the slate tile gives the wall a rhythm.
- Each recipe page has its own colour: the board, the wash and a coloured Fraunces title. A plum roast chicken, a sea
  tomato soup, a slate carrot soup.
- The bleed archetype lets a lemon or a sprig of rosemary fill its tile like an overhead photo.
- At night each board glows in its own colour under a lamp.

## What keeps it calm

- One action hue, and it only means "you can press this". The key only means "read this".
- Colour lives in plates, the wash, one title and a few labels. Cards have no borders on borders and no shadows.
- A plate holds one to three foods and at most one accent. A collection cover holds four foods.
- Sections sit 36 to 40 px apart. There is one signature motion, and the assembly happens once per recipe.
- The editor, where cooks spend the most time, has no plate on purpose. Its progress dots are now `ink-muted`, not
  basil, because progress is not a control.

## Owner rulings touched

| Ruling                                              | Status                                                                                                                                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D13** (seafoam to basil)                          | **Amended, owner call.** The plates carry the identity, so the action hue is free to change. A "no" costs two tokens: seafoam `#31807A` (white 4.67) with its link tone `#286C67` (5.48 on oat). The states panel shows both. |
| **#145** (canvas wash)                              | **Kept.** It takes the first tile's ground, as the `plate.wash` token.                                                                                                                                                        |
| **D11** (warm greys)                                | **Honoured**: slate `#6B645C` and pewter `#8A847C` as specified.                                                                                                                                                              |
| **Covers** (`covers.ts`, the six typographic tints) | **Replaced** by plates and shared-ground mosaics. This is bigger than a re-theme.                                                                                                                                             |
| **D15** (roles only)                                | **Kept**, through the closed `plate.*` family. The avatar and the stars no longer use raw hex.                                                                                                                                |
| **D12** (glass on navigation only)                  | **Honoured**, and readable with the blur on and off.                                                                                                                                                                          |

## What changed since round 2, and why

From d1's and d2's round 2 critiques. Each fix is drawn in the mockup.

1. **The freeze rule.** The seed is stored at first save. The foods freeze at first publish or import. The assembly
   plays on the recipe page, not in the editor. Both critics found the round 2 rule froze almost every typed recipe
   as a fallback.
2. **The hero ladder.** The hero is a food the title names, then produce, then herbs, then proteins. Staples come
   last. Round 2's "first matched line" gave flour, onion and raw chicken. Across the 22 recipes in the file there are
   now **15 distinct heroes**, and no hero appears more than three times (lemon).
3. **Complement grounds and real checks.** Round 2's rule put pale food on pale ground (lemon on butter, 1.01). The
   vessel, the dark rim and the skipped support are now generator checks, not notes, and the edge runs round the
   whole shape.
4. **Six grounds that behave like six.** Chili and terracotta are merged, tomato is retired, and plum and slate are
   added. The dark grounds are lifted to 1.70 to 2.05:1 against canvas, and each lamp keeps its ground's hue. Both walls
   are shown side by side.
5. **Five archetypes**, with up to 20% overlap. They answer d2's "a wall of diagrams".
6. **Calm covers.** One shared ground and heroes only. The photo fills its cell.
7. **Fallbacks vary in five ways** and are temporary. Eight are shown, from consecutive seeds.
8. **The key owns the title** (d1). `WONK` 1 at 34 px and up, and +12% tracking on the overline (d2).
9. **Smaller fixes:**
    - crumbs are replaced by twine and a pinch bowl.
    - butter is redrawn so it no longer reads as a folder.
    - the avatar has its own role.
    - stars come from roles, with a pewter outline.
    - the editor dots are `ink-muted`.
    - Home's two section heads match.
    - section heads are 24, so the Ingredients row fits on one line.
    - dark chips have a ring.
    - the wash is a token, with the dark mix stated.
    - controls in the wash band have a paper fill.
    - the light skeleton is lifted.
    - the photo mat is 4 px.
10. **New frames.** Discover at 390 with mostly photos (both critics asked). The recipe page in dark, which shows the
    lamp and the key title together.
11. **The board's sub-lines are back** on the ingredient lines ("about 1.8 kg", "zested and halved"). Round 2 had left
    them out.

**One suggestion I did not take.** d1 suggested that two neighbouring tiles never share a hero. But a plate is the
recipe's identity. A plate that depends on its neighbours changes each time the cook sorts or filters. Then "find it
by sight" breaks. The ladder and the archetypes do that job instead.

## Open for the owner

- **D13** and **covers**, as above.
- **The drawn-food glyphs** in the ingredient list (proposal).
- **The motif-coverage audit has not been run.** It is owed before build. Method: take the top 300 matched catalog
  foods by recipe count, and mark which ones have a motif. Pass bar: the hero ladder finds a hero for at least 80% of
  published recipes. Below that, more recipes show the fallback, and the library work comes first. The only diversity
  figure here (15 heroes across 22 recipes) comes from this file's own recipes, not from real libraries.

## Open risks

- **The motif library is real illustration work.** About 120 motifs cover most matched lines. Each needs a light and a
  dark value and must pass the checks on its ground.
- **The checks measure one main colour per motif.** A motif with a pale highlight, like the lemon's pith, can still
  blur at its edges at thumbnail size. The all-round edge carries that case. It is checked by eye, not by number.
- **The colour families are a table someone must keep.** A new food has to be given a family. A wrong family puts it
  on the wrong board, but the check still catches a failing contrast.
- **The dark grounds differ in hue more than in value.** The smallest dark difference is ΔE 5.9 (sage against sea).
  This is visible side by side, but not dramatic.
- **The glass ratios are flat-blend estimates** with no blur. The real result sits between those numbers and the
  solid fallback.
- **Fraunces adds about 90 KB** (one variable latin file) on web, and two static faces on native.
