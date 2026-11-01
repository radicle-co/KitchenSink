# Design review: Android device screenshots, slice 1 and the sign-in screens

Author: designer session, EVALUATE mode, 2026-11-01. Source: Thing 1's Pixel 6 emulator run, light and dark, at
font scale 1.0, 2.0 and 3.1. I looked at a sample of the screenshots, not every one.

## Verdict: two fixes needed in the shared Text and the cover badge

The sign-in screen at 3.1 works. Every control is in reach. The "Create an account" link fits on one line, the
placeholders do not clip, and the text glyphs stop at 2x. The PRO badge draws on the list card in dark mode at 2x.

## Findings

### High

**H-1. Line height is not capped. At 3.1, text glyphs stop at 2x, but the space between lines grows to 3.1x.**
Shot V (measured), Code I.

- The brand line "Your recipes, in one place." is body, 16 pt with a 24 pt line. At 3.1 the two lines sit about
  75 pt apart, which is 24 × 3.1. At the 2x cap they should sit 48 pt apart.
- The title "Sign in to Commise" shows the same gap: about 100 pt, not 2 × its line.
- So the cap stops the letters but not the layout, and the screen at 3.1 is about 50 % taller than at 2x. That is
  the space the cap exists to save, and it pushes controls down on every capped screen.
- **Fix:** in the shared `Text`, scale the line height by the capped scale, not the system scale. Add a test that
  draws a two-line body at font scale 3.1 and checks a 48 pt line.

### Medium

**M-1. At 2x, the PRO mark on a card cover hides the cover's letter.** Shot V.

- The PRO mark grows with the text, so at 2x it covers the top of the letter tile's "M".
- **Fix:** the PRO mark on a cover is a mark on a picture, like an icon. Draw it at a fixed size that does not grow
  with text, and keep its accessible label. The card's text still carries "Pro" at full size for anyone who needs it.

### Low

**L-1. Two 2x captures still have the keyboard up** (`pro_card` in the 2.0 folders). Retake them with the keyboard
closed, as for the draft card.

## For later ports (not ported yet, so not findings against this slice)

At 3.1, Home, Profile and the Recipes tabs show the same kind of failure. Each one goes into the shared control that
draws it, not into each screen:

- **Tab bar:** labels break inside a word ("Recip / es", "Disco / ver"). A label never breaks inside a word. On iOS,
  follow the system: tab bar labels do not grow with text size, and a long press shows the large label. On Android,
  stop at the 2x cap.
- **Segmented control:** "Collect / ions" breaks inside a word. Same rule: break only between words, and stop at 2x.
- **Home:** the date clips to "Sunday, Novemb...". Wrap it, do not cut it.
- **Profile:** "Display name" breaks inside a word, and its value clips. A label and value row stacks the value
  under its label at large text.
