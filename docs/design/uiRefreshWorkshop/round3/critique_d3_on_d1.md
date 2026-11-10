# Critique: Designer 3 on Designer 1, "Still Life, Lit" (Round 3)

I read `concept.md` and the full source of `mockup.html`, including the cover parts in `<defs>`. Every number below is
computed from the hex values in the file. Contrast is WCAG 2.x relative luminance. ΔE is CIE76 in Lab. This is
design judgement, not user evidence.

## The verdict in short

This is the strongest and most complete system in the workshop, and the round-2 fixes are real in the markup:

- The recipe's own light is now visible. Terra is ΔE 6.8 from plaster (it was 4.2). Blush is 7.1 (it was 2.8).
- The light is safe. I re-derived the table, and `inkMuted` on every wash is 4.90 to 4.98, as stated.
- The current step is quiet, and it no longer reflows. In the CSS, `.step.now` changes only the fill and the numeral.
- The dark plate no longer glares (5.33, was 10.47).
- The covers no longer repeat.

Three things keep me from signing off as-is:

- **The dark recipe page ships a status bar that cannot be read: 1.38:1.** It is a data-model bug, not a slip.
- **The most common day-one state, a library of studies, is still not shown.** The parts that make it up look faint
  and the same.
- **Home, the screen people open, carries the least of the new idea.**

Round 3 is the last round. So below I split "fix before build" from "record as residual".

## The strongest ideas, worth keeping

- **The recipe's light in OKLCH at a fixed lightness.** The hue moves and the lightness does not. So contrast holds by
  construction, and no runtime guard is needed. This is the best colour-engineering decision in the workshop. I
  checked the extremes: `actionText` on a wash is 5.20 to 5.30, and the solid numeral on a glow is 3.74 to 3.85.
- **The chroma floor for cool hues.** The ink and sky washes now read as a cool dawn (ΔE 8.8) instead of a dirty grey.
- **Five composition families and four hero slots.** Tomato soup (a centred bowl) and gazpacho (a cropped bowl at
  155%) are now plainly different pictures. No cover has a garnish mark in its top-right corner.
- **The spec is frozen on save and is the same for every viewer.** The hero is ranked by mass share times catalog
  distinctiveness. This is the right owner and the right moment.
- **"A mark never moves once it is placed."** This one rule makes "draws itself" calm and not a slot machine.
- **The unfinished study.** It is a real answer to the fallback, and the ripening strip (title only, then chickpeas,
  then spinach, then saved) is the best single frame on the board.
- **One step box.** Every step has `padding 10 14 12 4`. Only the fill changes. The numeral has a 44 px hit area and
  a pewter ring at rest (3.62). Over all twelve hues, the glow is ΔE 8.9 to 11.5 from canvas. It is clearly visible but not a sticky note.
- **A cook's photo is never altered.** It gets the mat and the ring only.
- **The checked box is tint and edge in both themes.** Checked boxes no longer count as solid seafoam shapes. (The
  current numeral still does. See problem 5.)

## Problems, most important first

### 1. The dark recipe page has an unreadable status bar (1.38:1)

On the dark detail frame, the hero uses `.status.sb-dark`. That is hard-coded ink `#24201C`. It sits on the dark
terra ground `#4A3326`, which gives **1.38:1**. On the stripe band it is 1.58. The clock and the battery vanish.
Light text (`#F2ECE2`) on the same ground is 9.97.

The cause is in the spec, not the mockup. `statusBar` is stored once in the `CoverSpec`, at save. But a generated
cover's ground **changes with the theme** (`--gr-terra` is `#E8C9AE` in light and `#4A3326` in dark). So one stored
value cannot be right for both themes. The same bug hits every light ground in dark mode. That is most of the
library.

**The fix:**

- For a generated cover, do not store `statusBar`. Derive it at render time from the ground of the active theme. It
  is a pure function of two values the renderer already has.
- For a photo, keep the stored sample. A photo does not change with the theme.
- If you must cache it, store `statusBar: { light, dark }`.
- Fix the dark frame to show light status text.

### 2. The day-one library is the riskiest state, and it is still not on the board

In round 2 I asked for a day-one library of 8 to 12 recipes. The ripening story is now your centre, so this is the
frame that proves it or breaks it. The board shows two studies among twelve covers. Here is what a wall of them looks
like, read from the source:

- **They are all the same picture.** Both studies (bibimbap, chili) and the first ripening frame are a centred
  `s-bowl` with r 112. The library has three study parts: bowl, plate and spoon. The covers got five families. The
  studies got one. So a day-one library of imports brings back the repetition you just fixed: a row of centred bowl
  rings.
- **The pool fills the frame.** The glow pool is `r=150` on a 400 × 300 cover. Its diameter is the full height. So the
  "paper ground" is only the four corners. At card size, a study reads as a pale pink or peach tile, not a drawing on
  paper.
- **The line is faint.** `stroke-width 3` in a 400-unit viewBox renders at about 1.2 px on a 172 px card (its cover is 160 px wide inside the mat). It is pewter
  on the pool, not on paper. On the Korean pool that is **2.97:1**, and on blush it is 2.98. The concept's "study line
  on paper 3.62" is true only at the corners. The line is decorative, so WCAG does not require 3:1. But at 1.2 px and
  under 3:1 it reads as a watermark, and that is the "empty" look the study exists to avoid. This is a light-mode
  problem only: in dark the line is `#B3A99C`, which is 6.80 on the Korean dark glow.

**The fix:**

- Apply the five families to studies too: a cropped rim arc, a pair, a close-up.
- Shrink the pool to about r 110, so the paper reads as paper.
- Draw the study line in the recipe's own hue at OKLCH L about 0.50, C about 0.05, instead of pewter. It is about
  4.5:1 on the pool. Each cuisine then gets its own coloured drawing on day one.
- Keep the line at least 1.75 px at any render size (`vector-effect: non-scaling-stroke`).
- Then draw the frame: Recipes at 390 px, light, with eight studies and two ripened covers.

### 3. Home carries the least of the new idea

The new language lives in covers and in the recipe's light. Home gets neither, except four covers about 170 px wide.
From the status bar down, Home is:

- a plaster page with a soft serif greeting
- the same warm corner as rounds 1 and 2
- four matted cards
- three linen "Soon" cards with grey line sketches

That is calm and well made. It is also the look people already know from editorial cooking apps: cream, Fraunces
SOFT and one muted green. The brief asks that cooks feel excited the moment they open the app. On this board, the
excitement starts when they open a recipe, and not before. See bold suggestion A.

The "Coming soon" half of Home is also the flattest part of the most-seen screen. It has linen badges (`inkMuted` on
linen, 4.62, which passes), pewter sketches and Inter titles. It is fine to keep it quiet, since it is a promise and
not content. But draw the sketches in the study language from problem 2: a line on a small pool. Then the bottom of
Home does not fall back to a grey wireframe look.

### 4. The timer chip disappears on the current step

The timer chip is linen `#ECE4D7`. On the terra glow `#FEE2CD` it is **1.02:1** against its background, so the chip
has no visible shape. The text (ink, 12.82) and the icon (`actionText` on linen, 4.91) still pass. But the step you
are cooking is the one whose timer you are about to start. On the desktop frame, step 4 is current and has the
"1 h 30 min" chip, and it is the weakest chip on the page.

**The fix:** give the timer chip a paper fill, `#FFFCF7`. Paper on the glow is ΔE 14.7, and it matches the rule you
already have ("every outlined thing keeps its own paper"). In dark, use `paperRaised` on the dark glow.

### 5. "One solid button per screen" is still not literally true

The current numeral is solid `--action`, and its hit area is `role="button"`. So the phone recipe page has two solid
pressable shapes: Edit recipe and the numeral. On the 1280 frame there are three: the sidebar's New recipe (with a
floating shadow), Edit recipe, and the numeral. The numeral is a state marker more than an action. So keep it solid
and change the wording. The sidebar button is kept by D13, so the rule is the thing to change, not the
button.

**The fix:**

- Say "one solid action per content region, plus the current-step marker", or make Edit recipe tonal (tint and an `actionText` edge) on desktop
  only.
- Drop `--shadow-fab` from the sidebar button. It does not float, so a floating shadow there is a false signal.
- The wordmark dot uses `--action`. That is control colour on a non-control, the same class of issue as round 2's
  cuisine overline. Use ink, or no dot.

### 6. The dark food colours do not follow the stated rule

The concept says each form "reads swatch variables". It also says the dark column is "generated as OKLCH L − 0.08",
and that the build asserts no form has a hard-coded fill. In the markup:

- **The vessel fills are inline hex values on each cover.** For example `style="--fill:#C94A32"` on the tomato soup,
  `#D58D34` on the curry and `#E09A3E` on the dal.
- **They sit outside `.food`,** so in dark they get no adjustment at all. The tomato soup's surface is the same
  `#C94A32` in both themes.
- **Pad thai is treated differently.** Its whole ground, `#D49E5A`, is inside `.food`, so in dark it gets
  `brightness(.92)`.

Two dishes are treated two ways, and neither follows the L − 0.08 rule. The forms are clean. The **per-cover swatch
values** are where the hard-coding moved to.

**The fix:** a cover refers to a swatch key (`tomato`, `turmeric`, `lentil`), never a hex value. The swatch table
has a light column and a dark column. The build assertion covers covers, not only forms.

### 7. A smaller point on where the light lands

The glow and the wash are close: terra glow against terra wash is ΔE 3.4, and ink is 2.9. Today no step sits inside
the solid part of the wash, on phone or desktop. But a short recipe on desktop, or a future collapsed header, can
put step 1 inside the wash. Then the glow almost vanishes, and only the numeral carries the state. State the rule
"the wash must end above the first step" in the spec. Or let the glow be measured against the colour it lands on.

## Colour, type, surfaces, motion, dark mode, layouts

- **Colour.** The chrome is disciplined and every key pair passes. I checked `ink` on canvas 13.78, white on
  `action` 4.67, `actionText` on tint 5.05, pewter on paper 3.62, and honey on a wash 3.72 to 3.79 (stars only, which
  is right). The weak link is no longer the numbers. It is that the chrome has not moved since round 1.
- **Type.** It is sound and it is kept. The serif for names only, with Inter for everything the app says, is a clear
  and correct line. Word spacing on Fraunces is a nice touch.
- **Surfaces.** The concentric mat (18 = 12 + 6, 24 = 18 + 6) and three levels with one meaning each are excellent.
  The 10% warm edge on dark paper is the right substitute for a shadow.
- **Motion.** It is well judged. The print grows into the hero, then the light blooms once, in 240 ms. It plays once
  per open, there is a cross-fade under reduced motion, and nothing loops. The editor's 180 ms mark fade with "never
  moves" is right.
- **Dark mode.** It is much better. The wash is ΔE 6.7 from dark canvas and the glow 12.8, so both read. The plate is
  fixed. The checkbox matches light. Problem 1 is the one defect, and it blocks.
- **Phone against desktop.** The 390 frames are complete pages. The 1280 recipe page keeps today's 12-column split
  (head in 5, photo and panels in 7, then ingredients beside steps). The light spreads across the main column without
  staining it. The cards and panels are paper, and the text that sits on the wash (overline, title, facts,
  description, tags) passes there: `inkMuted` 4.90 or more, `actionText` 5.20 or more. Good.
- **Layouts kept.** Yes. Home order, recipe page order, and the desktop grid all match the boards. No IA changes.

## Residuals to record (round 3 is final, so these do not come back)

- **Never shown:** Recipes at 390, Discover at 390, the editor, Collections, dark Home. The "wall of your own food"
  and the "photo wall" are your two biggest claims, and the board draws neither at real density. Treat both as
  unproven until a build with real recipes and real phone photos.
- **The hero rule needs mass data.** Without unit-to-grams for every line, it falls back to distinctiveness alone, and
  the lamb-against-sumac problem returns.
- **The title-to-vessel lexicon for studies is unspecified.** "Bibimbap" → bowl needs a dish table. Without it, every
  study is the default vessel, which makes problem 2 worse.

## Two bold suggestions to push it further

**A. Let Home be lit by the last recipe you opened.** Home's warm corner stops being a fixed butter colour. It takes
the recipe-light hue of the first card in "Recent recipes". It uses the same OKLCH wash token at L 0.944. So every
contrast you proved still holds. Open the app the morning after a tomato soup, and the room is faintly
rosy. After a ramen, it is a cool dawn.

- It needs no new component and no new string.
- It never animates while you look at it. Home sets the colour once, when it renders.
- It moves the "every recipe is its own room" idea onto the one screen that has to make people excited to open the
  app.
- It is an owner call, because it amends the canvas-wash ruling (#145) a second time.

**B. Make the study a colouring-in page.** Today a study shows only matched foods, in colour. Go further. Draw every
parsed ingredient that has a mark as an outline in the recipe's hue (see problem 2), and fill each one in when it is
matched. A new cook then sees what is missing at a glance, as shapes rather than a warning. Matching becomes the
satisfying act of colouring in, and the reward sits exactly where D20 needs effort (nutrition).

- "A mark never moves" still holds, because the outline already sits in the mark's final slot.
- The mark lookup must work from the parsed name without a catalog match. If it cannot, keep today's rule.
- It is the "draws itself" idea carried from the editor into the library, so one visual language runs from day one
  to a full wall.

## What must change before this is built

1. Derive `statusBar` per theme for generated covers. Fix the dark frame (1.38 → about 10).
2. Studies: families, a smaller pool, a line in the recipe's own hue at least 1.75 px, and a day-one Recipes frame.
3. Timer chip on paper.
4. Desktop: reword the one-solid rule or make Edit recipe tonal. Drop the sidebar button's floating shadow and the
   seafoam wordmark dot.
5. Per-cover fills as swatch keys with a dark column. Extend the build assertion to covers.
