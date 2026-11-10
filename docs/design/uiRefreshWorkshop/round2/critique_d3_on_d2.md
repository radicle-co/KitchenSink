# Critique: Designer 3 on Designer 2, "Kitchen Press" (round 2)

Reviewed: `round2/d2/concept.md` and `round2/d2/mockup.html`. I read the source and reasoned about how it renders. I
did not render it. The phone frames are Home in light, Home in dark and Recipe detail in light, all at 390 px. The
other frames are Collections at 1280 px, the token strip, the six-chicken stress test and the fallback palette.

I checked the layouts against the current boards (`RecipeDetailMobile.dc.html`, `Collections.dc.html`). I computed
every ratio below from the hexes in the mockup, using WCAG 2.x relative luminance. Colour distances are OKLab ΔE.

## Verdict

This is still the concept I want to ship. Round 2 closed almost everything I asked for. Each night ink now comes
with its ratios, and the overlaps are tokens. The six-chicken stress test is done, and the fallback palette is a frame.
"1 h 50 min" now wraps, the sidebar has an active bar, and today is a ring. The prints now build the same way on
web, iOS and Android, because they are flat fills, masks and one grain tile. Collections as overprints is the best
new frame in the workshop. It earns the desktop width with art, and it keeps the board's layout exactly
(`auto-fill, minmax(15rem, 1fr)`, the same six collections, the same order).

The layouts are kept. Detail matches the board from Community rating to Steps, including Servings, Screen on and
both step timers. Home keeps the 2×2 grid and the three Coming soon widgets.

The work is now in the colour maths of the prints. The concept says "day and night sit in the same band", but that
is true of the inks only. It is not true of the third colour, and it is not true of the grounds. Those two facts
decide whether the library looks like a shelf of prints or a row of muddy tiles in dark. Fix them in round 3, and
this is ready.

## Strongest ideas, keep these

1. **Prints from the recipe's own foods, with the hash driving composition.** This answers my round-1 worry about
   forty chicken recipes. The shelf shows six chicken prints that differ by their second food and by crop, rotation
   and scale. Each one still reads as chicken. This is the idea that makes the app worth opening.
2. **Collections are overprints.** Three A plates fanned out with their pairwise overlaps. It needs no new asset, it
   is specific to this product, and no other recipe app has it.
3. **Precomputed overlaps, no blend modes.** It is the right engineering call. It makes the overlap testable, and it
   makes the three platforms the same.
4. **Shape means press.** Pills for things you press, 6 to 8 px rectangles for badges, chips and the timer (the timer
   is a `span` on the board, so a rectangle is correct). With one action colour, the cook never has to guess what
   is clickable. This is the calmest part of the system.
5. **Two type families.** Dropping DM Mono fixed the "developer tool" read, and it follows the numbers ruling.
   Bricolage at wdth 84 does read as wood type and not as the default 2024 landing page. I accept the defence.
6. **Registration in rendered pixels.** 2.5 CSS px at every size is the detail that makes a print read as a print.
   It is correctly specified as viewBox units divided by the rendered width.
7. **The honest rulings table**, and the fallback frame that puts today's seafoam (4.67:1) beside `#2A6B65`
   (6.20:1). The owner can see the cost and does not have to take it on trust.

I accept the reason for declining the tomato current-step rule. The numeral disc is the control, so the action rule
is the honest signal. I also accept the reasons for declining pull-to-refresh and the two-column desktop card.

## Problems, most important first

### 1. In light, the overlap is the heaviest mark in every print, and it breaks the band

The inks sit at 2.46 to 4.03:1 against the light grounds. The overlaps, which are a straight multiply, do not:

| Overlap (light)         | cream | blush | sage  | mist  | gold |
| ----------------------- | ----- | ----- | ----- | ----- | ---- |
| tomato × sea `#422628`  | 11.57 | 10.63 | 10.96 | 10.83 | 8.97 |
| tomato × leaf `#382E18` | 11.33 | 10.41 | 10.74 | 10.61 | 8.79 |
| sea × leaf `#12404A`    | 9.59  | 8.81  | 9.08  | 8.98  | 7.44 |

So in light the third colour is about three times as strong as the inks, and it is nearly black. The dark overlaps
sit at 3.81 to 5.26:1. So day and night are not in the same band once the overlap counts, and the overlap is the
signature of the idea. Tomato × leaf `#382E18` is a near-black olive-brown, and on food art it reads as burnt. On
the Collections covers, where three plates cross, these dark areas get large.

Lifting the overlap toward the ground does not work. I tested it: at 30 to 50% toward cream, tomato × sea lands at
1.1 to 1.5:1 against its own parent inks, so it becomes a smudge. **Fix:** make the light overlap a deep colour with
real chroma, not a multiply. Aim for about 5 to 6:1 against the ground and at least 1.5:1 in luminance (or
ΔE ≥ 0.11) from both parents. For example, use a plum for tomato × sea, a deep olive for tomato × leaf and a deep
teal for sea × leaf. Or, as well as that, choose motif placements so the overlap is a sliver along the misregistered
edge and not a region. Then state the overlap ratios in the band table, next to the inks.

### 2. In dark, the five grounds are almost the same colour

| Dark ground     | OKLab chroma | against `paper` |
| --------------- | ------------ | --------------- |
| cream `#3A3220` | 0.032        | 1.38            |
| blush `#3A2620` | 0.032        | 1.23            |
| sage `#20362F`  | 0.031        | 1.35            |
| mist `#1F2A3A`  | 0.033        | 1.21            |
| gold `#4E3B16`  | 0.059        | 1.63            |

The distance between pairs of dark grounds is 0.04 to 0.12. Cream against blush is 0.040, and cream against sage is
0.043. So the neighbour rule ("two cards next to each other never share a ground") holds in the data, but nobody can
see it in dark. Three of the five grounds read as brown. The dark Home frame avoids the glow I warned about in round
1, but it gets there by going muddy: four near-identical dark tiles with mid-tone shapes on them. Mist against
`paper` at 1.21 also means that tile's edge almost disappears.

Light has a smaller form of the same problem. Sage against mist is 0.031, and cream against blush is 0.041. Only
gold is clearly its own ground.

**Fix:** keep the lightness of the dark grounds, because it is right for calm. Raise their chroma to about 0.05 to
0.06. Spread the hues so that every pair is at least about 0.07 apart. Move blush toward a clear brick rose and mist toward
a real ink-blue, so they do not drift toward the same brown. In light, push sage and mist apart (sage toward leaf,
mist toward sea). Then render the six-chicken shelf in dark again and check that you can tell the grounds apart at a
glance.

### 3. "One green means press" leaks into the art

Leaf ink `#3F8C6B` is ΔE 0.106 from `action` `#2A6B65` in light. That is the same family: hue 163° against 187°. In
dark, the sea × leaf overlap `#6FA4B2` is 0.102 from dark `action` `#7CC8BE`. On Home, every other cover has a leaf
shape. So the green that means "press" is also the green of the art. The art is boxed inside covers, so this
is not a usability failure. But it does weaken the rule the concept is proudest of. **Fix:** move leaf toward a
yellower herb green (hue about 130 to 140°, the colour of basil and parsley rather than mint). That puts real distance
between it and the teal of `action`, and it is a more honest food colour anyway. Then check the dark sea × leaf
overlap again against dark `action`.

### 4. Gold is both a print ground and an interface colour

The Draft badge and the "for 4" tag both use `--g-gold`. This is the same role leak that tomato had in round 1. A
press ground is now also a status colour. Two concrete results:

- A Draft recipe whose hash picks the gold ground gets a Draft chip at **1.00:1** against the print behind it. The
  text passes (`ink` on gold is 10.43:1), but the chip vanishes into the art. That breaks the "text never on art"
  rule in spirit. The neighbour rule checks card against card. Nothing checks chip against ground.
- In dark, the Draft chip `#4E3B16` is 1.48:1 against `sheet` and 1.63:1 against `paper`. It is a dull brown block.

"for 4" is not a status at all, so it does not need a highlight. **Fix:** give the interface its own warm status
tone. One option is a `draft` role: a deeper amber than the gold ground, used for no ground. Another option is Draft
on `sheet`, with `ink` text and a small honey square in front, like the time chip. Set "for 4" as plain `ink-muted`
text or as a `well` chip. Add a rule: a chip's fill is never the same as the ground under it.

### 5. The selected segment is a 1 px ring and a check, and nothing else

`action-tint` against the `well` track is **1.01:1** in light and **1.04:1** in dark. So "Collections is selected"
rests only on the 1 px `action` inset ring (5.05:1 light, 6.90:1 dark) and the check icon. It passes, but it is the
weakest active state in the system. It is also out of step with the tab bar and the sidebar, which both use a 3 px
bar plus bold text. **Fix:** put the selected segment on `sheet` with a 1.5 px `action` ring and bold `ink` text,
and keep the check. That is what the owner's "a selected chip uses a tint with a check" means in practice. You can keep
the tint. Do not let it be the only fill that shows the state.

### 6. The detail page carries too many outlined rings

Count the pewter 1.5 px rings in the reading column. There are the servings stepper's two buttons, eleven
ingredient boxes, five 44 px step numeral circles, and the switch. Each one is a 3:1 ring,
and the step column alone is a stack of five large circles. That is a lot of chrome in the one place the cook reads
while their hands are busy. It is the least calm part of the deck.

**Fix:** keep the 44 px hit area on each step numeral. Draw the numerals that are not current as plain Inter 600
numbers with no ring. Only the current step gets the filled `ink` disc. A focused numeral button still shows its focus
ring. At rest, its ring adds nothing that the "Mark step N as current" label and the current-step disc
do not already say. The ingredient boxes must keep their rings, because they are the checkboxes.

### 7. The photo scrim was measured on the drawn photo, not a real one

The 5.19:1 for white status text is 55% `ink` over `#F0C27A`, which is the lightest stop of the drawn roast. A real
photo can have a white plate at the top. Over `#FFFFFF`, 55% `ink` gives **3.65:1**. The gradient also fades from
55% at the top edge. At the height of the status text (about 20 to 40 px), the scrim is nearer 40%. That gives about
2.8:1 over white. **Fix:** state the worst case as white, not as the drawn photo. One option is to raise the scrim to
about 65% over the top 60 px. That gives about 4.5:1 over white. The other option is to say plainly that the OS
status bar is not your text.
The back and ⋯ discs are already on glass, so they are safe.

### 8. Gaps the spec still leaves open

- **The triple overlap.** On a collection cover, where all three plates cross, the paint order decides the colour.
  The last pair painted (sea × tomato on `c0`) wins. That is probably fine. Write it down as a rule, so that a second
  implementer does not invent a three-ink token.
- **Collections of photo recipes.** The cover is the A plates of the first three recipes. The spec does not say what
  happens to a recipe with a photo and no print. Say whether photo recipes still get a hidden print for this
  purpose, or whether the cover skips to the next print recipe.
- **"The cover tells you how full the collection is"** is only true for 1 against 3 or more. A collection of 3 and a
  collection of 14 look the same. Soften the claim.
- **The print changes on every edit, and that works against recognition.** Cooks find recipes by the picture they
  remember. Swapping butter for oil re-cuts the cover, so the library stops being a stable shelf. Freeze the motif
  pair at the first publish. After that, re-cut it only for a new top food by weight.
  Never animate it live while the cook types in the editor.
- **The stamps are often not seen.** A photo recipe has no print, so the publish stamp has nothing to stamp. The add
  to collection stamp plays on a cover that is usually off-screen, under the picker sheet. Name the screen where
  each stamp is seen. Cut any stamp the cook cannot see. That makes the amendment smaller and easier to approve.
- **Dark grain.** Light noise at 42% on dark covers is the right direction. But bright specks on a near-black tile
  can read as dust on the screen, especially on OLED. Try it on a device at 25 to 30%, and tint the noise toward the
  ground rather than toward cream. The mockup also still makes the grain from an SVG `feTurbulence` tile, while the
  concept specifies a PNG. Make the mockup match what ships.

### 9. Frames still missing

There is no Recipes grid (My recipes), which is the screen where the "shelf of prints" claim lives or dies. There
is no dark frame at 1280, and no dark Recipe detail. Most importantly, there is no **mixed grid of photos and
prints**. Real libraries will be about half photos. Grained photos next to flat two-ink prints is the composition
the whole language depends on, and it has not been shown once.

## Phone versus desktop

The phone frames are calm and well spaced. The 28 px section rhythm, Bricolage at 36 px with balanced wrapping, and
the solid chips on covers all work at 390 px. The Collections frame is the right desktop answer. At 1280 px the grid
lays out three columns of about 304 px. At that size, the misregistration on each square overprint is easy to see. The phone card title (Inter 15/600) is now the most default-looking element on Home. Try Bricolage 16/650 at
wdth 90 for compact card titles, so the shelf has the same voice as the section headings.

## Two bold suggestions

1. **Let the overlap carry the colour story, on purpose.** Once the overlaps are their own chromatic tokens (problem
   1), give each cuisine or season a preferred ink pair. Then the overlap colour becomes the thing a cook learns:
   plum is a tomato-and-sea dish, deep teal is a green one. That is the riso idea taken to its end. The third colour
   is not a by-product. It is the most recognisable mark in the app, and it still costs nothing at runtime.
2. **Give Collections a "spine" in the list views.** In the Recipes grid and the collection picker, show each
   collection's overlap colour as a 4 px rule on the card's leading edge, like the coloured spine of a bound print
   portfolio. It is the same token, it needs no new layout, and it ties a recipe card back to the shelf it sits on.

## For round 3 (the last round)

1. Chromatic light overlaps at about 5 to 6:1, each separated from its parents, with the ratios in the band table.
2. Dark grounds with chroma about 0.05 to 0.06 and every pair at least 0.07 apart, plus sage and mist pulled apart in
   light.
3. A yellower leaf ink, clearly apart from `action`.
4. Gold out of the interface, with a Draft chip that can never vanish into its ground.
5. Step numerals with no resting ring, and a selected segment on `sheet`.
6. One mixed grid of photos and prints, in light and dark, and one Recipes grid in dark.
