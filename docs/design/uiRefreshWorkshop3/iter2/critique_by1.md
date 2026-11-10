# Iteration 2 critique, by Designer 1 (Pilot Light)

I read `iter1/option2.md` and `iter1/option3.md`, and rendered both HTML files in Chromium at 390 px, light and dark.
Contrast is WCAG 2.x from the hex values. "Lc" is APCA 0.0.98G, computed the same way.

**First, a collision I caused.** In iteration 1, Fresh Cut moved its primary to black ink. Pilot Light moved to Iron
ink in the same round. Fresh Cut's Peppercorn `#141317` against my Iron `#0F1A17` is 1.04:1. Our grounds, white
and Fog, are 1.12:1. Two of the three options now have a black pill on near-white. Black is the core of Fresh Cut's
poster idea. It is not the core of mine. So Fresh Cut keeps black, and Pilot Light will move off it.

## Option 2: Fresh Cut

**Fresh?** Yes. Archivo set wide and heavy on pure white, with cut-open produce, reads as a modern poster. Nothing in it
looks like paper. The risk is now different: the app shell is plain black on white, so all of the identity sits in the
art. If the shape set is weak, what is left is a generic startup look.

**Simple?** Yes. Every control is a familiar one, and the fixes all landed: check-off, outlined step numbers, two
timers for step 4, and the chevron under the Home picture. One small thing: a ticked row changes only from Peppercorn
to Clove (18.5 to 7.6). At arm's length that change is faint. The filled black box carries the state, which is enough.

**Palette.** It is calm and accessible. Two checks:

- **Dark Zest `#45390F` reads as olive mud,** and it is the only colour inside the cooking view. It is 1.52:1 on dark
  Sheet. The light ink edge carries the state, so this passes, but it does not look like lemon.
- **Dark heroes stay deeply saturated.** Persimmon `#C93A1E` fills the top of the screen. Material's dark-theme guidance
  says saturated colours "vibrate" against dark surfaces, and it asks for desaturated tones [1]. Dimming to 92% is not
  enough in a dark kitchen.

**At the stove.** This is the best of the three: 22 px current step, lemon block, ink edge, and two timers.

**Keep:** "text never sits on art", and the two-shape tile.

**Fixes, in order:**

1. Draw the 20-recipe shape test now. The detail drumstick still reads as a mushroom or an ice-cream cone at a glance.
   Google found that unlabelled images were not recognised [2]. The title saves the row, but the hero has no title over it.
2. Desaturate the dark grounds by about 15–20% chroma, not only brightness.
3. Lift dark Zest toward a true lemon tone, such as `#5A4A10`. Peppercorn text on it is 7.8:1 and Clove
   is 5.6:1.

**Bold push:** make the art the cooking clock. As each step is marked done, its ingredients' shapes in the hero settle
into a plate, once, with no loop. The cook's own action is the only thing that moves it, so it stays calm [3].

## Option 3: Enamelware

**Fresh?** Partly. Removing the drawn dishes and putting cobalt on one plate was right. But blue-grey ground, navy
dark mode, a cobalt button and cobalt links make a palette that looks like banking or fintech. The food photo has to
supply all of the appetite.

**Simple?** Mostly. Three things need explaining:

1. **The rim reads as loading.** A partial arc around a picture is the platform sign for loading. Android defines its
   circular indicator as "a circle whose stroke grows… such as loading or processing data" [4]. On first open, "40%"
   around the photo looks like the image is still loading. "Step 2 of 5" helps, but it sits below the arc.
2. **Step 4 has one timer of "1 h 30 min"** for a two-phase step. The cook will miss lowering the oven at 20 min. Fresh
   Cut fixed this. Split it.
3. **Slashed zeros.** Atkinson Hyperlegible Next slashes 0 by default, so the page shows "8Ø0 g", "22Ø°C" and
   "2Ø26". Amounts never contain the letter O, so the slash only adds noise.

**Palette.** It is rigorous. Doubtful pairs:

- **Dark Slate on Well is Lc −70.9.** That pair holds the 15 px hint "Keeps the screen awake while you cook". It is
  below the Lc 75 body minimum [5].
- **Dark Cobalt link on surface is Lc −64.5.** That is fine for short links, but not for any link in running text.

**At the stove.** This is strong. The 21 px current step, cobalt rule, filled number and "Current step" are all clear.

**Keep:** one glossy cobalt pill, quiet "Edit" text links, and ticked rows that fade with no strikethrough.

**Fixes, in order:**

1. Make the ring not look like loading. Draw five segments, one per step, with step marks, and put "Step 2 of 5"
   inside the arc's gap.
2. Split the step 4 timer.
3. Turn the slashed zero off, or use tabular figures without it.
4. Lift dark Slate on Well to Lc 75 or above.
5. Update "How it stays distinct". It describes options 1 and 2 as they were.

**Bold push:** warm the table, not the plate. Keep cobalt for the action, and move the ground from blue-grey to a cool,
neutral white enamel. Apple's new material "gives way to content" [6]. Let the photo, not the blue, set the mood.

## Sources and what each changed

1. Material Design, Dark theme: https://m2.material.io/design/color/dark-theme. It says saturated colours vibrate on
   dark surfaces and asks for desaturated tones. This is why I ask Fresh Cut to desaturate its dark grounds.
2. Google Design, Expressive Design research:
   https://design.google/library/expressive-material-design-google-research. Unlabelled images were not recognised.
   This is why the hero drumstick must read on its own.
3. Amber Case, Principles of Calm Technology: https://calmtech.com/. This is why only the cook's action moves the
   bold push.
4. Android Developers, Progress indicators: https://developer.android.com/develop/ui/compose/components/progress. A
   circular stroke that grows means "loading or processing data". This is the basis of my main Enamelware finding.
5. APCA introduction (Myndex): https://github.com/Myndex/apca-introduction. Lc 75 is the body-text minimum. This is
   why I flag dark Slate on Well.
6. Apple Newsroom, new software design (June 2025):
   https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/. Controls give
   way to content. This is why I ask Enamelware to quiet its blue ground.
