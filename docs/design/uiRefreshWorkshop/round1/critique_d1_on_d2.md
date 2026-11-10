# Designer 1 on Designer 2, round 1: Kitchen Press

Files reviewed: `round1/d2/concept.md` and `round1/d2/mockup.html`. I read the HTML source and reasoned about how it
renders. I checked every contrast figure in D2's table again from the hexes. They are all correct. The numbers
below are the ones D2's table does not cover.

## Verdict

This concept has the strongest single idea in round 1. Most recipes have no photo, and D2 turns that gap into the
best thing on the screen. A shelf of two-ink prints is warm and personal, and it belongs to this app. It does not
look like a UI kit. The calm comes from discipline: colour lives in the art, controls use one green, and content
has no shadows. That is the right balance for this brief.

The weak points are not about taste. Some of the concept's own rules are broken in the mockup. Several owner rulings
are crossed without being named. The signature effects are misregistration, grain and blend modes. As built, they
are too small to see at card size, they disappear in dark mode, and nobody has shown them working on native.

## Keep these

1. **Press-print covers for recipes with no photo.** The cover is built from role tokens, it is deterministic from
   the id hash `RecipeCover` already uses, and it re-inks for dark. This is the centre of the concept. Protect it.
2. **Text never sits on art.** Time, Private, Draft and PRO sit on solid chips, so their ratios hold whatever is
   underneath. This is the right rule, and it belongs in the build spec as written.
3. **One action colour.** Basil is the only colour that means "you can press this". This is the main reason the
   concept stays calm with so much colour on the screen.
4. **The ticket.** The facts strip, servings stepper and nutrition row become a dashed-rule order ticket. "Commise"
   is a kitchen word (the commis chef), so the ticket fits the brand and is not just decoration.
5. **Placeholders drawn in the same style.** The "Soon" widgets use a dotted ring, a seven-day row and a print
   outline instead of grey skeletons. Even the empty parts of Home feel designed.
6. **Difficulty as three bars with the word beside it.** Good. Colour is never the only signal (but see fix 6 on the
   bar colour).
7. **Warm paper and green-black.** Neither theme uses pure white or pure black. That suits a kitchen at 6 am and at
   10 pm.

## Fix these, most important first

### 1. Name every owner ruling you cross, as you did for the palette

The conflicts section lists the palette and D13. It misses five more. All of them are in `ownerDecisions.md`, in the
"Adopted from the joint recommendations" list and in D11.

| Ruling                                                                 | What D2 does                                                                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Only pressable controls are pills."                                   | D2 says "no pills on controls" and cites modernizeA, which is the opposite. Buttons have a 14 px radius and the FAB has 18 px.                      |
| "Numbers use Inter with tabular digits."                               | Every number is in DM Mono, and Figtree replaces Inter.                                                                                             |
| "The app has one signature motion: the overshoot on the check toggle." | The stamp tick scales 0.85 → 1 with no overshoot. D2 adds three more motions: registration settle, the step rule growing, and the title cross-fade. |
| "The canvas wash stays (issue #145)."                                  | The canvas is flat `paper` with no wash.                                                                                                            |
| D11 warm greys: slate `#6B645C`, pewter `#8A847C`.                     | D2 says D11 is "kept as is", but `ink-muted` is `#5C574E` and `edge` is `#86806F`. These are new values in the same family. Say so.                 |

None of these rules out the concept. But each one needs to be a stated amendment with a reason, or the owner will
find it during the build. My advice: keep the overshoot ruling and make the stamp tick the overshoot: 0.85 → 1.06 → 1.
That gives you the owner's one motion for free.

Second, the palette fallback (today's seafoam and coral, used as inks) is only described. The owner said they like
the current palette "mostly". Show that fallback as one cover row and one button, so the owner can choose between two
things they can see.

### 2. The mockup breaks the concept's own colour rules

- **Basil on the greeting name.** In `.lt-title .name`, "Eliza Ramirez" is basil. Basil means "pressable", and the
  name is not pressable. This weakens the one rule that keeps the concept calm. Use `ink`. If the name needs to stand
  out, use weight or the `wdth` axis instead.
- **Tomato on state.** The concept says "the other inks never mark a control". But the mockup uses tomato for the
  active tab's ink spot, the active sidebar row, the checked ingredient's strikethrough and the current step's left
  rule. It also crosses "Coral leaves every control". A red strikethrough also reads as "wrong" or "deleted", not
  "done". Make the strikethrough `ink-muted`, and make the current-step rule and the tab spot basil. Tomato stays in
  the art, the brand mark and destructive text.

### 3. The press effects are too small to see at the size most covers are shown

- **The misregistration cannot be seen at card size.** The second plate moves by `translate(2 1)` in a 400 × 300
  viewBox. A phone card is about 171 px wide (390 − 32 − 12 = 346, divided by 2), so the scale is 0.43. The offset is
  2 × 0.43 ≈ **0.86 css px** sideways and 0.43 px down. That is under one device pixel at 1×, and it reads as blur at
  3×. The idea that gives the concept its name does not show on the phone grid. Set the offset in rendered pixels
  (about 2.5 to 3 css px whatever the size), not in viewBox units. The "settles 4 px into register" motion also needs a
  clear end state: is the end state in register (0 px) or the resting offset?
- **The grain does nothing in dark mode.** The `#grain` filter's colour matrix gives near-black noise (0.11, 0.14,
  0.13). In dark, `--blend` is `screen`, and screening near-black onto a dark ground changes almost nothing. So
  "grain drops to 16%" in dark really means "no grain". Use a light grain colour in dark (for example, the `ink`
  colour through the same matrix), or define a separate dark matrix.

### 4. Show one cover row in dark, and balance the inks between the themes

The user asked for a sample, not the full set, so I am not counting missing screens. But this one gap matters,
because the dark frame shows a photo hero. Not one press-print cover is shown in dark, and covers are the concept.
The numbers suggest the two themes will behave very differently:

| Ink on its own ground   | Light    | Dark      |
| ----------------------- | -------- | --------- |
| Saffron on saffron tint | **1.58** | 7.58      |
| Tomato on tomato tint   | **2.9**  | not shown |
| Basil on basil tint     | 6.16     | not shown |

The covers are `aria-hidden`, so these are not WCAG failures. They are a craft problem. In light, the pancakes and the
focaccia (two of the four Home covers) are pale yellow on pale yellow. In dark, the same art will be about five times
louder than in light. Light covers will look washed out, and dark covers will probably glow. Fixes:

- Tune the ink strength per theme so each cover's internal contrast lands in the same band in light and dark. Around
  2.5 to 4:1 between ink and ground is a good target.
- Add a neighbour rule to the hash: two cards next to each other in the 2 × 2 grid never get the same ground. Today,
  pancakes and focaccia are both saffron and sit on the same diagonal.
- Add a dark cover row to the mockup next round.

### 5. Prove the cover pipeline works on native before it becomes the identity

The covers depend on SVG `mix-blend-mode`, `feTurbulence`, a pattern mask, and Bricolage's `wdth` and `opsz` axes. I
have not verified what `react-native-svg` and React Native fonts support on Expo 57 / RN 0.86, and the concept does not
say either. Check it. But there is a build that works whatever the answer:

- **Precompute the overlap colour.** The multiply (light) or screen (dark) result of each ink pair is a fixed colour
  per theme. Draw the overlap as a third shape filled with that colour. No runtime blending is needed, and web and
  native match pixel for pixel.
- **Use one tiled grain bitmap** (a small PNG per theme) instead of a turbulence filter per cover. On web this also
  matters for speed. A Recipes grid of 60 covers, each running its own `feTurbulence` filter, is a real paint cost on
  a mid-range Android phone.
- **Use static font instances.** Pick the two or three `wdth`/`opsz`/weight combinations you actually use (about 86 /
  700 display and 90 / 650 section) and ship them as static files. Otherwise native can fall back to the default
  width, and the display type loses its character.

### 6. Fix the type sizes that are likely to overflow at 390 px, and that will overflow at 320 px

These are estimates. They assume DM Mono's advance width is about 0.6 em. Check them by rendering.

- **Ticket "Total" value.** `.ticket .v` is DM Mono 17 px with `white-space: nowrap`. The cell is (358 / 3) − 28 px
  padding ≈ **91 px**. "1 h 50 min" is 10 characters ≈ 10 × 9.86 ≈ **99 px**, so it runs into the dashed rule. "3 h
  15 min" is the same length. At 320 px the cell is about 68 px. Use 15 px on phones, or let the unit wrap below the
  number.
- **Ingredient amount column.** The grid gives quantities a fixed **76 px** column. Monospace is the widest choice for
  a fixed column. D21 says the row shows the cook's own amount and unit. So "1 1/2 cups" (≈ 84 px at 14 px) and
  "2 tablespoons" will wrap. Size the column to the longest real string, or set amounts in Figtree with tabular figures
  (which is also what the owner's numbers ruling says). Keep mono only for the ticket and the overlines, where it
  earns its place.

### 7. The status bar on the photo hero is unreadable

`.statusbar.on-photo` sets white text over the top of the hero. The photo there is about `#F0C27A` to `#D39348`:
white on it measures **1.65 to 2.6:1**. The SVG already has a scrim `rect` with `opacity="0"`, which looks like it was
started and not finished. Finish it: a top gradient from `rgba(28,36,34,.45)` to 0 over the first 96 px. Or choose
the status-bar style from the photo's brightness. The glass back and ⋯ discs are fine, because they carry their own
ground.

### Smaller points

- **Difficulty bars.** Saffron `#F3B23A` on `sheet` is **1.82:1**. The word "Medium" carries the meaning, so nothing
  fails, but the filled bars are faint next to the outlined off bar (3.85). Use `honey` (4.61) for filled bars.
- **Desktop active nav row.** The phone tab bar marks the active tab with a 3 px basil bar. The desktop sidebar row
  only gets `sheet` on `paper`, which is **1.11:1**, plus a hairline. Give the sidebar row the same basil bar (on its
  left edge), so both platforms say "you are here" the same way.
- **Long greeting.** At 40 px in a column about 300 px wide, "Good morning, Eliza Ramirez" takes three lines. A longer
  display name takes four, and Recent recipes moves below the fold. Test it with a 30-character name. Then decide the
  line count at which it steps down to 34 px.
- **Two metaphors.** The print shop (covers, grain) and the restaurant pass (ticket, mono stamp) are both good. Name
  them as one family, "printed matter from a working kitchen", so the next designer does not add a third.
- **Bricolage and Figtree.** Both are good. Both are also on every "Inter alternative" list in 2024 to 25, so the type
  by itself will not make the app feel new. The narrow `wdth` setting does most of the work. Keep it narrow and avoid
  default widths.

## Two bold suggestions

1. **Make the cover come from the recipe, not just its tags.** Most cooks tag little, and a mapping from tag to shape
   will fall back to the same few abstract shapes across a 200-recipe library. Every recipe already links to
   catalog foods. Take the top two by weight. Map each food category to a shape (grain → slab, leafy → leaf, fruit →
   disc, noodle → wave). Use the id hash only for the ink pair, the layout and a small rotation. The print then
   really is a print of what is in the dish. When the cook changes the recipe, the print changes too.
   That is a small, honest reward for editing. Define a fallback composition, keyed on the hash, for a recipe with no matched foods.
2. **Collections as overprints.** Keep the Collections layout, and make each collection's cover a stack of its
   first three recipes' plates, printed over each other at small offsets with the precomputed overlap colours. A
   collection then looks like what it is, a pile of the cook's own prints. No other recipe app has this. It also
   gives the registration-settle motion a meaningful home: after the cook adds a recipe to a
   collection, the plates land one by one, once. Under reduced motion they appear at once. The motion then marks something the cook did, instead of
   playing on first view of every cover.
