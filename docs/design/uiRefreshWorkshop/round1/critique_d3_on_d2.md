# Critique: Designer 3 on Designer 2, "Kitchen Press" (round 1)

Reviewed: `round1/d2/concept.md` and `round1/d2/mockup.html` (the source, read for how it renders). The mockup is a
sample: Home and Recipe detail at 390 px, Recipe detail in dark, Home at 1280 px, and a token strip. I judge it as a
sample. I do not mark it down for the screens it leaves out, but I do say where the missing frames leave a key claim
untested.

All ratios below are WCAG 2.x relative luminance, which I computed from the hexes in the mockup.

## Verdict

This is the strongest answer to the real problem I have seen in this workshop. The problem is not the chrome. It is
that most recipes have no photo, so the library is a wall of pale tints. Kitchen Press makes that empty state the
signature of the app. A recipe with no photo gets a small two-ink print. That is fresh, it is ownable, and it has a
reason to exist. It is not a trend applied for its own sake. On light paper the result is calm and warm, and the
layouts are kept exactly. On Detail, every section from the rating down to Steps matches the current board in order.
On Home, the 2×2 recent grid and the three Coming soon widgets match too.

What is weak sits around the idea, not in it. Dark mode is unproven where it matters most. Tomato has too many jobs.
The type system is more fashionable than the prints, and it is louder than they are.

## Strongest ideas, keep these

1. **Press prints for recipes with no photo.** This is the core of the concept. It solves "meh" at the source, and the
   rules are disciplined: two inks at most, one cover per card, decorative and `aria-hidden`, and seeded from the
   existing `RecipeCover` hash. The focaccia cover (a saffron slab, dimples cut out of the ground, a basil rosemary
   sprig) is the best single image in the deck. It is witty, it reads at 170 px, and it is obviously focaccia.
2. **Text never sits on art.** The time, Private, Draft and PRO all sit on solid chips. So the contrast holds whatever
   the art underneath is. This is the right rule. Put it into the spec as written.
3. **The ticket.** Total, Prep and Difficulty, the servings stepper and the nutrition row all become a sheet with
   dashed rules. It gives the detail page a tactile kitchen object without adding a single element. It is a good
   metaphor at low cost.
4. **One action colour.** Basil `#1D5E4F` with a white label is 7.59:1, and `#7FD1B6` with `#0F1A17` in dark is
   9.91:1. Basil is also only a step away from today's `ocean-dark` `#2A6B65`, so it is an evolution of the owner's
   palette, not a replacement. Present it that way (see problem 10).
5. **Flat paper, no shadows on content.** Shadows go only on things that float (the FAB, the tab bar, the hero discs).
   This keeps D12 honest, and it is a big part of why the light frames feel calm.
6. **Registration settle** as the motion signature: 4 px into register, 360 ms, once per cover per session. It is
   specific to the metaphor, quiet, and fully removed under reduced motion.

## Problems, most important first

### 1. Dark mode covers are not shown, and the maths says they will be the loudest thing on screen

The only dark frame is Recipe detail, which has a photo hero. Not one press print is shown in dark, yet "theme-aware
art" is a headline claim. Working it through from the tokens: in dark, each ink is `screen`-blended over a dark
ground. Saffron over `#3A3220` gives `#F5CD70`, which is **8.4:1** against its ground. Basil gives `#8FDBC3` at
**8.0:1**, and tomato gives `#FF9D80` at **7.0:1**. In light, the same inks sit at 1.6 to 3:1 against their grounds.
So a Recipes grid in dark becomes a wall of bright pastel blobs on near-black. That is the reverse of the 10 pm
kitchen calm the concept promises.

The grain also vanishes in dark. The grain filter outputs near-black noise (the matrix gives roughly
`#1C2422`), and black under `screen` changes nothing. So "the grain drops to 16%" is in fact zero.

**Fix:** define a set of night inks with lower lightness. Each ink then sits about 3 to 4:1 against its dark ground,
not 8:1. Invert the grain to light noise in dark. Then add a Home frame in dark with all four covers. Until
that frame exists, dark mode is a hypothesis.

### 2. Tomato does five jobs, and two of them send the wrong signal

Tomato is the brand mark and the active tab "ink spot". It is also the current-step rule and the strike through
checked ingredients. And it is the parent of the error colour (`tomato-text`).

- **The ink spot reads as a notification badge.** A small red dot inside a tab glyph is the most common sign in
  mobile UI for "something new here". Cooks will look for the unread item. The basil bar, bold label and
  `aria-current` already mark the active tab, so the spot adds no meaning and only adds risk. Drop it, or switch to a
  filled glyph in `ink`.
- **A red strike through a checked ingredient reads as "wrong" or "removed".** The cook did the right thing, and the
  row looks like a mistake. Strike in `ink-muted` and keep the basil check. That is enough.
- Keep tomato in the art, the brand mark and the current-step rule. That rule is the one state use that works, because
  it is a rule and not a dot.

### 3. The cook's name in basil breaks the concept's own rule

The concept says basil means "interactive" and nothing else. Then "Eliza Ramirez" in the greeting is set in basil, on
both phone and desktop. At 40 to 64 px in the action colour, it reads as a link to the profile. **Fix:** set the name
in `ink`. If the greeting needs more warmth, change the weight or use the `opsz`/`wdth` axes, not colour.

### 4. The ticket's "1 h 50 min" probably overflows its cell on a 390 px phone

`.ticket .v` is DM Mono 17 px with `white-space: nowrap`. Each of the three cells is (390 − 32) / 3 − 28 padding,
about **91 px** of content. DM Mono advances about 0.6 em. With the −0.02 em tracking, each character is about
9.9 px. So the 10 characters of "1 h 50 min" need about **99 px**. It runs over the dashed rule into Prep. German ("1 Std. 50 Min.") and French are
worse. **Fix:** set the values at 15 px, let a value wrap onto two lines, or make the Total column `1.3fr`. Check the
longest string you localise, not the English one. The same check applies to the 76 px quantity column ("2 tablespoons"
does not fit).

### 5. Saffron is too faint wherever it sits on something light

- **Covers:** saffron ink on the saffron ground is **1.58:1**. Two of the four covers on Home (pancakes and focaccia)
  are yellow on yellow. Focaccia survives because of its sprig. Pancakes read as a soft smudge at thumbnail size.
  Make each ink differ from its ground by about 2.5:1 or more. To do that, pair saffron with a sea or basil ground
  more often than with its own tint.
- **Difficulty bars:** filled saffron bars on `sheet` are **1.82:1**, while the empty bar has an `edge` outline at
  3.85:1. So the empty bar reads more strongly than the filled ones, which inverts the meaning. The word "Medium"
  saves it for accessibility, but it looks wrong. **Fix:** fill the bars with `ink` or `honey` (`#9A6A12`, 4.61:1).
- **"Today" in the week widget:** `basil-tint` against `well` is **1.01:1** in light and 1.08:1 in dark. Only the dot
  marks today. The concept says "today in basil". Either give the today cell a 1.5 px basil inset ring, or reword the
  claim.

### 6. The shape grammar sits between abstract and literal

The pancake stack (three rounded bars and a disc) reads as a burger or sausages. The pad thai waves read as water,
not noodles. The soup is the clearest of the three. A pictogram invites a literal reading, and a wrong literal reading
is worse than an abstract one. There is also a scale problem. A cook with forty chicken recipes gets forty prints
that differ only in colour. **Fix:** (a) let the hash also drive composition: rotation, scale, crop, count, and which
plate is on top. (b) Choose each motif by testing that it reads at 160 px. (c) Name the fallback for recipes with no
tags or cuisine, which will be most new drafts.

### 7. The rendering method will not survive native as written

The mockup depends on `mix-blend-mode` between SVG groups, an `feTurbulence` grain on every cover, and an SVG mask
for the halftone. `react-native-svg` does not do the blend between shapes or `feTurbulence`. And 30 or more live
turbulence filters in a scrolling web grid is a real cost. **Fix:** do the blending at build time. Multiply and screen
are plain arithmetic, so the overlap colour of each ink pair can be a token, and every print becomes flat fills. That
is identical on web, iOS and Android, cheap, and testable for contrast. Use one tiled noise bitmap of about 128 px
for the grain. The misregistration stays, because it is only a 2 px translate.

### 8. The type is more trend than voice

In 2024 and 2025, Bricolage Grotesque plus a mono for metadata became the standard indie and startup landing-page
look. That is the "use a trend as the answer" trap the brief warns about. The display face itself can stay, because it
is warm and its axes are well used here. The mono is over-applied. It earns its place in quantities and times. But it
also sets dates, overlines, tags, "Soon", PRO, "for 4", the URL bar and the token labels. Spread that widely,
it stops saying "kitchen ticket" and starts saying "developer tool". **Fix:** keep DM Mono for the quantity column,
the ticket values and timers only. Set dates, overlines and tags in Figtree with tabular figures. Also record the web
font cost of three families, with Bricolage carrying three variable axes, and say what loads first.

### 9. Small items

- "Version history" sets `min-height: 36px` while every other link uses 44. That passes 2.5.8, but make it 44 to be
  consistent.
- Cards are `sheet` on `paper` at 1.11:1, with a `line` inset at 1.22:1. That is fine for cards that are not
  controls. But the desktop sidebar's active row uses the same treatment, so the active state rests only on bold text
  and the tomato spot. Once the spot goes (problem 2), give the row a 3 px basil inset bar to match the tab bar.
- "Shelf of prints you made" is weaker on Discover, where the prints belong to other cooks. That is not a flaw, but
  the concept needs to say how another cook's print reads.

### 10. Frame the palette change honestly, and make it smaller

Today's `seafoam` `#31807A` and `ocean-dark` `#2A6B65` to basil `#1D5E4F` is a small move, so call it a refinement.
The real amendment is coral `#E8917A` to tomato `#E4543A`, a much hotter red. The owner said they like the current
palette "mostly". So I ask for the cautious fallback the concept mentions (the prints in today's hues) as one
more frame. The owner can then see the real cost of the change, not only read about it.

## Phone versus desktop

The phone is the stronger of the two. The desktop four-card row is good: Bricolage titles at 20 px, dashed card
footers, and a generous 36 px rhythm. But the desktop Home is the most generic frame in the deck. Without
the prints it is any warm SaaS dashboard. Let desktop earn its width. On a 1280 px Home, show the recent prints
larger. For example, let the first card span two columns, with the same order and the same grid. Then the art
carries the screen, not the metadata.

## Two bold suggestions

1. **Make Collections an overprint.** The layout stays the same, and only the cover art changes. A collection's cover
   is the plates of its first three or four recipes, printed over each other with the precomputed overlap colours. A
   collection then literally looks like its recipes mixed together. That is unique, it needs no new asset, and it
   carries the press metaphor through to the one screen not shown.
2. **Make misregistration the one motion the app owns.** Use it for pull to refresh: the plates drift a few
   pixels apart, and the new data snaps them back into register. Use it for a successful save or publish, where the
   cover "stamps" once. Use it nowhere else. Brands remember one signature motion, not ten nice ones, and it removes
   the temptation to add generic springs everywhere. It stays calm because it is about 4 px and it happens once.

## What I need to see in round 2

A Home and a Recipes grid in dark with prints. Night inks with stated ratios against their grounds. The overlap
colours as tokens. A second set of prints for a library heavy on one category (for example, six chicken dishes).
Tomato reduced to the art, the brand mark and the current-step rule. The fallback palette frame.
