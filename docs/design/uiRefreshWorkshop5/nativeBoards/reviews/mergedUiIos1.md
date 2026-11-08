# Design review: merged UI on iOS (shipping head 9ec332492)

Author: UI Designer, EVALUATE mode, 2026-11-02. Source: `~/.local/state/kitchensink/shots/mergedUi/ios/` (48 shots,
1x and accessibility-xxx-large). This is the merged UI, not the redesign lanes. I looked at the cap shots of Home,
Recipes, Recipe detail and Profile, and Recipes at 1x.

## Verdict: blocking. The text caps do not apply on iOS

At 1x the screens look like the Android set, and the Android findings carry over. At the cap the type roles do not
stop at their ceilings. Chrome stops: the tab bar labels and the My recipes / Collections segments stay near their
1.5x cap. So the chrome cap works on iOS, and the `Text` role cap does not.

## Findings

### Critical

**C-1. Type roles grow past their caps on iOS.** At accessibility-xxx-large, about 3.1x:

- "Recipes", "Profile" and "Good morning" draw at about 3x. `largeTitle` must stop at 1.5x (42 pt).
- Words break inside themselves: "Recipe / s", "Good mornin / g", "Peruvia / n". A capped title fits whole words
  at 390 pt.
- Body, meta, chip and field text grow to about 3x too: "Under 30" and "All" chips, the search placeholder, "8
  recipes", "Recently edited", the Profile rows.
- Android at 2.0 and 3.1 stops at the caps (`authScreens.md` device check). Corrected 2026-11-02: the cause is plain React Native `Text`
  leaves, which each lane moves to the design-system `Text`. It is not one shared fix.

**C-2. Recipes at the cap: no card can be reached.** The header block (title, segments, search, chips, count, sort,
view toggle) stays fixed and leaves a viewport of about 23 pt. C-1 causes most of this. But even after C-1, the
header must scroll away with the list on a phone. (Corrected 2026-11-02, see `designAnswers.md`: no condensed bar,
and only the search field sticks.)

### High

**H-1. Recipe detail title truncates ("Trayb…").** A recipe title never truncates. It wraps (ruling c). The redesign
lane builds the new title, so check it there at the cap.

## Answers

- **RecipeDetailScrolled at the cap:** accepted. The redesign removes the section switch on phones.
- **Date wrap at 2x ("Monday, November / 2"):** a wrap at a word boundary is fine. Never stop it with nowrap. With
  the year gone, the line is shorter anyway.
- **Tamagui warning toast:** a dev-build artifact. Retake any shot it covers once the cause is fixed.
