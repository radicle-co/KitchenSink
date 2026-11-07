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
- **Fix (corrected 2026-11-01):** draw the cover's PRO mark at a fixed 1x size, and add the word "Pro" to the
  card's meta row at the meta role's scaled size. My first fix assumed the card's text already said Pro; it does not,
  so a fixed mark alone would leave large-text readers with no readable Pro. A screen reader hears Pro once.

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

## iOS screenshots (iPhone 17 simulator, iOS 26.5), added the same day

iOS already stops the line height at the cap: at 2.64x the body lines sit 48 pt apart. So H-1 is Android only. The
shared `Text` fix still applies to both, so both platforms use the same arithmetic.

### Ruling: the Google button label does not grow

Above the cap, Apple's "Continue with Apple" button keeps its own label size, and our "Continue with Google" label
grows and wraps to two lines. The two buttons are a pair and must match. Apple draws its label and we cannot scale
it, so the Google label follows Apple: it does not grow with text size, and its accessible label is unchanged. This
matches the sign-in buttons the two platforms draw themselves.

### For the Recipes list port

- At about 2x, the "New recipe" button covers the last card's time and rating. The list needs bottom space equal to
  the button's height plus its margin, so the last card can scroll clear of it.
- The same screen shows M-1 (the PRO mark covers the cover letter) and the segmented control breaking inside a word
  ("Collection / s"). Both rulings above apply.
- At Android 3.1, the Recipes header (title, segments, search, filters, sort) fills the whole screen, so no card can
  be reached. The chrome cap and the 1.5x display cap shrink it. Check it again after those land. If the header still
  fills more than half the screen at the cap, the search and filters must scroll away with the list.

## H-1 closed (fix/im-tamagui-ds, 04681ee68)

At Android 3.1 the body lines on sign-in now sit about 48 pt apart, and the title stops at its 1.5x ceiling. The
brand line, title and body are the same at 2.0 and at 3.1, so the screen stops growing at the cap. The field labels,
button labels and status text still grow until they move onto the shared `Text`.

The Google label ruling applies where the Apple button sits beside it, which is iOS. On Android there is no pair, so
the Google label follows the 1.5x chrome cap, like other one-line control labels.
