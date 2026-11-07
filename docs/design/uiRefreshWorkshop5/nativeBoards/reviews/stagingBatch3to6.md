# Design review: staging batches 3 to 6

Author: UI Designer, 2026-11-02. Branch `fix/im-qastaging6` at `8f4ae9e49`. I read the QA reports and the saved
layout trees. A tool hook blocked image reads in this session, so I did not check the shots by eye. Check 10 (old
UI) and the iOS checks 1 to 3 still need one look at the shots before merge.

## Verdict: pass, with the owed items below

1. Recipe detail and step leading: pass. Leading that scales with the font is correct. Leading fixed at 28 under
   32 sp text was the defect. At 2x the step circle is 48 dp and holds the numeral, as the fixed-frame ruling asks.
2. iOS line-height lift of 0.001 pt: pass. Up to 2 pt of drift low on a long page is not visible. The code must cite
   react-native#58970 and have a test that fails without the lift. When React Native fixes the bug, remove the lift.
3. Touch floor: pass. Android 48 dp, iOS 44 pt. The Profile target is 48 dp on Android. The drawn disc stays at the
   board size. Only the target grows.
4. Recipes title and filter chips on the design-system Text: pass.
5. Collections search band: pass. It matches the pinned-band ruling.
6. Discover "See all": pass. At 2x on Android it fits beside "Trending" and is 56 dp tall.
7. Field text on the cap band: pass for the measured fields. The Title field at the cap is owed. If it uses the same
   single-line input, one shot is enough.
8. "Edit recipe" under the tab bar at rest: pass, no larger inset. Content can scroll under the tab bar. The end room
   only guarantees that the end of the page can scroll clear, the same as the floating-button ruling.

## Owed before merge

- One look at the shots for check 10 and for the iOS checks 1 to 3.
- iOS: the Discover cover letter must not scale, and "See all" must wrap at the cap. Send the cap shots.
- iOS: Collections at the cap with "New collection" on screen. On Android at 2x it is on screen, as a pill at rest
  and a 56 dp disc after a scroll.

## Shot look (Android, small copies)

I looked at Recipes at 1x and 2x, Discover at 2x, Collections at 2x and Recipe detail at 2x in dark mode. No old UI
shows.

- Fix: the description clamp link reads "More". The board says "Read more".
- Accepted: at 2x the Collections search hint clips to "Search your collectio". The clip is at the end of the hint,
  and the field still reads as empty (sign-in ruling).
- Accepted: the Profile disc stays 32 dp and its centre moved 1.9 dp lower inside the 48 dp target.
- QA: the detail shot at 2x carries the "Open debugger" dev toast. Check 9 missed it. No retake is needed for this.

## iOS cap shots (b2316)

- Title field at the cap: pass.
- Collections "New collection" pill and disc: pass. Both stay on screen, 16 pt clear of the tab bar.
- Discover cover letter: it does not scale, which passes. Ruling: the letter never sits under the meta-chip band.
  Centre it, at its fixed size, in the part of the cover above the band's top edge. This holds for every cover with a
  chip band. "See all" wraps under its heading: pass.
- Defect, next batch: at the cap a section heading ("Trending", "5 collections") is larger than the page title. A
  section heading is never larger than its page title, at any scale.
- Defect, next batch: the editor header's "Saved on…" truncates at the cap. Only the bar's title can truncate. The
  status wraps and the bar grows.

## Android detail retake (qaBatch6b, b2336)

"Read more" shows, there is no dev toast, and the shots reach the page end. Open against `RecipeDetailAndroid384`:

1. Nutrition is an open 2x2 grid after the steps. The board has a collapsed row before Ingredients, "Nutrition" and
   "{n} cal per serving", that expands in place. With no counted food, the row reads "Not counted yet", and the
   expanded row shows the explanation lines without the four dashes.
2. At 2x the "·" between "Public" and "Version history" starts the second line. When the pair wraps, drop the
   separator.
3. On Full Detail at 2x the step circles look 1x. Every step follows the fixed-frame ruling. Measurement owed.
4. The page end is 128 to 130 dp above the tab bar. It is 48, because detail has no floating button.
