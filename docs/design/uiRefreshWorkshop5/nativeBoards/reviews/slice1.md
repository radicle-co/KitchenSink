# Design review: Tamagui slice 1 (Text, StatusBadge, provider)

Author: `staff-ux-engineer`, EVALUATE mode, 2026-11-01. This is a review, not code and not a spec.

- **Branch:** `fix/im-tamagui-slice1`, head `758e0934f`, against `e10b5f000`. I read the code with `git show`. I did
  not check it out.
- **Components:** `@commise/ui/text` (`Text.native.tsx`), the native `StatusBadge`, and `@commise/ui/tamagui-provider`
  (`DesignSystemProvider`, `DesignSystemTheme`).
- **Rules used:** owner ruling 2026-10-31 (port onto Tamagui, still look and act like our app, no pixel baselines,
  text cap 2x), T31, the earlier audit (`../tamaguiAudit.md`), the type roles in `ui/src/tokens/typography.ts`,
  `ownerFeedback.md`, and WCAG 2.2 AA.
- **I did not write this code.** I wrote the audit this slice answers, so I checked my own audit claims again here.

**Labels.** **Code** or **Shot** says where a finding comes from. **V** means verified (read in code, measured in a
screenshot, or computed). **I** means inferred.

## Verdict: pass with fixes

There is no High finding. Nothing here blocks the merge. Every intended change works as stated in code. The dark
screenshots verify the glyph colour fix (M4) and the Android font padding fix (M7).

There are two real defects, both Medium. The neutral badge has two heights. The card row that holds it is sized
for the wrong number at 2x. Both existed before this slice. Fix the first one in this slice. The largest
gap is in the evidence: no screenshot shows the badge above 1x, in light mode, or in the PRO or attention tone.

## Findings

### High

None.

### Medium

**M-1. The neutral badge has two heights, 26 pt and 24 pt. Neither the code nor the test matches what the device
draws.** Code V, Shot V.

- **What the screenshots show (measured):**
    - The Draft badge on Recipe detail is **26.0 pt** tall on Android and on iOS.
    - The same badge in the My recipes card row is **24.0 pt** on both platforms.
    - In the card, the top and bottom border rows are still there. So the badge is squeezed, not cut. Its text moves
      about 1 px off centre.
- **Why (from code):**
    - The parts add up to 26: a 20 pt leading (`caption`), plus 2 pt padding above and below
      (`StatusBadge.native.tsx:47`), plus a 1 pt border above and below (`:53`). `minHeight: '$5'` (`:44`) is only a
      floor.
    - In the card, `OneLine` (`features/recipes/src/card/RecipeCard.native.tsx:59-63`) sets a fixed height of 24
      (`oneLine.ts:44-47`) with `overflow: 'hidden'` (`RecipeCard.native.tsx:528`). That squeezes the badge.
    - PRO and attention have no border, so they are 24 everywhere. The neutral badge is the only one with two heights.
- **What claims otherwise:**
    - The doc comment (`:7-8`) says "24 pt tall".
    - The test "is 24pt tall with the sm radius" (`__tests__/StatusBadge.native.test.tsx:168`) checks the style value,
      not the laid-out box. So it passes while the device draws 26.
- **This existed before the slice.** The old `StyleSheet` had the same parts. The port is the right time to fix it,
  because L1 is about the same 2 pt.
- **Fix:**
    - Simplest: in the `neutral` variant of `Badge` (`:53`), add `paddingVertical: 1`. Then the 1 pt border uses the
      space the padding gave up, and every tone is 24 at 1x.
    - Do this together with L1: `1` and `2` are both off the scale. Then change the height test to measure the box
      (padding + border + leading), not the style value.
    - If the owner wants the border to take no space, a native `outline` or an inset `boxShadow` can draw it. Check
      first that Tamagui 3 and RN 0.86 accept it on Android 9 and later. I have not checked this.

**M-2. At exactly 2x, the card row is 2 pt too short for the neutral badge. Above 2x it adds empty space.**
Code V (the maths). The effect on screen is I: no capture shows it.

- `badgeLineHeightOf` (`features/recipes/src/card/oneLine.ts:44-47`) gives `ceil(20 × scale) + 4`. At 2x that is 44.
  A neutral badge capped at 2x is 40 + 4 + 2 = 46. At 1x it squeezes 2 pt (M-1). At 2x it squeezes 2 pt the same way.
- The row reads the raw `useWindowDimensions().fontScale` (`RecipeCard.native.tsx:409`). The badge now stops at 2x.
  At 3.1x the row is sized for 3.1x words beside a 2x badge. Today the meta text next to it is not on the primitive
  yet, so it still grows, and the row is not wrong. When meta moves to `Text`, every badge row above 2x will have
  empty space.
- **Fix (feature code, for `fe-1`):**
    - In `oneLine.ts`, clamp the scale with the exported `FONT_SCALE_CAP` (`Text.native.tsx:30`).
    - Count the neutral border, or take the badge height from one function exported by `@commise/ui` beside the badge.
      Then the row and the badge cannot disagree again.
    - M-1's fix removes the border part of this.
- **Pattern:** the row height and the badge height are two copies of one fact, kept in two packages. That is why
  they drifted. The fact belongs in the design system.

**M-3. No device image shows the badge at 2x, in light mode, or in the PRO or attention tone.** Shot V.

- `captures/scale2.0/` is a byte-for-byte copy of the dark 1x captures (same md5 for all three files).
  `captures/scale3.1/` is empty.
- The font-scale probe (`captures/scale/`) is dark, not light as stated. Its 1.0 panel is Recipe detail, and its 2.0
  and 3.1 panels are Home. The labels "Dra.." and "Pri..." on the Home covers are `CoverChip`
  (`RecipeCard.native.tsx:67-79, :99-107`), not `StatusBadge`. So the probe shows no text drawn by the slice's
  primitive at any scale.
- **What this leaves unverified on a device:**
    - The 2x cap itself, and the badge wrapping at 2x.
    - Every light-mode colour.
    - PRO (`proFill`/`proInk`) and attention (`attentionTint` under `ink`) in either scheme.
    - A live switch of the device scheme. The test `DesignSystemProvider.native.test.tsx` covers it in jsdom only.
- **What covers these instead:**
    - The code, and the contrast I computed (table below).
    - That the line height scales with the capped multiplier, which I verified in RN 0.86 source:
      `RCTTextAttributes.mm:141` (`_lineHeight * self.effectiveFontSizeMultiplier`) on iOS, and
      `TextAttributes.kt` `effectiveLineHeight` (`toPixelFromSP(lineHeight, effectiveMaxFontSizeMultiplier)`) on
      Android. So the audit's "lines overlap at 2x" High risk does not happen.
- **Fix (the captures that settle it):**
    - Recipe detail with the Draft badge at OS text sizes 2.0 and 3.1, on Android and iOS. If the badge looks the same
      in both, the cap works.
    - The same screen in light mode.
    - One screen with a PRO badge (the visibility field in the editor) and one with an attention badge (an ingredient
      row that needs review), in both schemes.

### Low

**L-1. The glyph's colour is fixed to `inkMuted`, not taken from the badge tone.** Code V.

- `StatusBadge.native.tsx:79` passes `tone="inkMuted"` for every glyph. Today only neutral badges have a glyph, so it
  matches (M4 is closed). If a glyph is ever added to PRO or attention, it draws slate on a grey fill or on amber.
- **Fix:** add a `GLYPH_TONE_OF: Record<BadgeTone, IconTone>` beside `TONE_OF`, or have the label colour be the one
  source once `Icon` reads Tamagui (audit M5).

**L-2. The glyph and the label read two different theme sources.** Code V. The risk is I.

- The label colour comes from the Tamagui theme. The glyph colour comes from our own `useTheme()`
  (`icon/Icon.native.tsx:23`). They agree today, because both themes come from `role`/`roleDark`. Inside a future
  Tamagui sub-theme (audit H3), they will not.
- **Fix:** audit M5. `Icon` reads its colour through Tamagui's `useTheme()` or a `$` token.

**L-3. The words grow with the text size, but the glyph stays 16 pt.** Code V. Shot V (the Home 2x/3.1x cover chips show the same
shape).

- `Icon size={16}` (`:79`) does not scale. At 2x the words are 28/40 next to a 16 pt pencil. This is not a WCAG failure,
  because 1.4.4 covers text. But it looks wrong.
- **Fix:** scale the glyph with the capped font scale (`min(fontScale, FONT_SCALE_CAP) × 16`), in `Icon` once, as the
  audit's Part 2 plans for `scaleIcon`.

**L-4. In dark mode, the neutral badge's edge almost disappears on `surfaceMuted`.** Code V (computed). This is my
judgement, not a WCAG finding.

- The `lineDivider` edge is 1.06:1 against a dark `surfaceMuted` parent. The badge has no visible shape there.
- 1.4.11 does not apply. A status badge is not a control, and its words carry the meaning at 7.16:1. Only flag this if
  a board puts a badge on `surfaceMuted`.

## Contrast (computed from the slice's themes)

The fill is painted over its parent. The words are painted over the fill. The bar for 1.4.3 is 4.5:1.

| Scheme | Tone      | Fill / words                         | Words on fill | Edge or fill vs parent (paper, canvas, surfaceMuted) |
| ------ | --------- | ------------------------------------ | ------------- | ---------------------------------------------------- |
| Light  | PRO       | `#5C646E` / `#FFFFFF`                | 5.99          | fill 5.89, 5.37, 5.10                                |
| Light  | Attention | warning at 20% / `ink #171B20`       | 13.3 to 15.1  | fill 1.10 to 1.13                                    |
| Light  | Neutral   | `paper #FCFDFF` / `inkMuted #5C646E` | 5.89          | edge 1.27, 1.16, 1.10                                |
| Dark   | PRO       | `#A3ACB6` / `#171B20`                | 7.52          | fill 7.16, 7.93, 6.24                                |
| Dark   | Attention | warning at 20% / `ink #EBEFF2`       | 8.2 to 10.5   | fill 1.50 to 1.52                                    |
| Dark   | Neutral   | `paper #172029` / `inkMuted #A3ACB6` | 7.16          | edge 1.21, 1.34, 1.06                                |

- **1.4.3 passes** for every tone, in both schemes, on every parent. PRO's values are the same as before, as stated.
- **The neutral glyph** is the same colour as its words, so it clears 1.4.11's 3:1 for a meaningful graphic.
- **The dark screenshots match the theme exactly:** fill `(23,32,41)` = `#172029`, edge `(38,47,56)` = `#262F38`,
  and one ink colour `(163,172,182)` = `#A3ACB6` for both the glyph and the words, on Android and on iOS.

## Accessibility

- **Name:** the words are plain text, so a screen reader reads "Draft". The glyph is `aria-hidden`
  (`Icon.native.tsx:31-33`). The badge itself has no role, which is right for a status that is not a control. Code V.
- **Colour alone:** no. Every badge states its status in words. The tone only adds emphasis. Code V.
- **1.4.4 / text cap:** the cap is 2 (`Text.native.tsx:30, :34`), and the line height scales with it (RN source, see
  M-3). The badge uses `minHeight`, `flexShrink: 1` on the label and `maxWidth: '100%'`, so the words wrap and are not
  cut. Code V. Device: not shown (M-3).
- **The PRO badge in the card** is wrapped with its own `accessibilityLabel` (`RecipeCard.native.tsx:110-116`). That
  is feature code and unchanged.

## Type roles and fonts

- **Sizes:** 14, 16, 18 and 28 only. **Weights:** 400, 500 and 600, none higher. **Leadings:** 20, 24, 28 and 32, all
  on the 4 px baseline (`typography.ts:89-101`). Code V.
- **Fonts:** each role sets one registered face for its weight through `faceOf` (`tokens/native.ts:63-72`). No role
  sets `fontWeight`, so neither platform draws a fake bold. iOS and Android use the same face names. Code V.
- **Leading as a px string** (`Text.native.tsx:45` and the others): the screenshot confirms a 20 pt leading (the 26 pt
  detail badge is 20 + 4 + 2). Shot V.
- **M7 on a device:** the Draft words sit 7.24/8.0 pt from the top and bottom of the badge on Android, and 7.67/7.67 on
  iOS. The platforms agree within 0.4 pt. Shot V.

## The audit, finding by finding

| Audit                                     | Status after this slice                                                                                                                                                                                                                     | Evidence                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **H2** (missing theme keys)               | **Partly closed.** `proFill`/`proInk` are generated from `proTone`/`proToneDark` (`theme/tamaguiThemes.ts:48`), and the badge uses them (`StatusBadge.native.tsx:51, :65`). `bar`, the cover tints and the chart colours are still missing. | Code V                                                    |
| **M4** (glyph darker than words)          | **Closed.**                                                                                                                                                                                                                                 | Code V (`:79`). Shot V: one ink colour on both platforms. |
| **M7** (Android text sits low)            | **Closed** for `Text` (`Text.native.tsx:38`).                                                                                                                                                                                               | Code V. Shot V (within 0.4 pt of iOS).                    |
| **H6** (2x cap misses Tamagui's own text) | **Partly closed.** Our `Text` is capped at 2. No Tamagui component with its own text is ported yet. The guard against a Tamagui text part outside `@commise/ui` is not added. Text not yet on the primitive is still uncapped.              | Code V. Shot V (Home at 3.1x grows past 2x).              |
| **2x analysis** (line height must scale)  | **Resolved.** RN 0.86 scales the leading by the capped multiplier on both platforms.                                                                                                                                                        | RN source V. Device not shown.                            |
| **L1** (2 pt padding off the scale)       | **Open, deferred to M3 as stated.** M-1 adds a reason to settle it now.                                                                                                                                                                     | Code V                                                    |
| **M2** (no height tokens)                 | **Open.** `minHeight: '$5'` (`:44`) is 24 only because spacing step 5 is 24.                                                                                                                                                                | Code V                                                    |
| **M5** (Icon reads a second theme)        | **Open.** See L-2.                                                                                                                                                                                                                          | Code V                                                    |
| **H3** (no surface sub-themes)            | **Open, and now more exposed.** `Text` defaults to `$ink` (`Text.native.tsx:36`). On an `inverse` surface it draws dark on dark. The caller must set the colour. No caller puts `Text` there yet.                                           | Code V                                                    |

## Owner register

- **T31 (16 pt side spacing):** does not apply. The badge's 8 pt inner padding is not side spacing.
- **Wrapping in controls:** kept. No `noTextWrap`, no `numberOfLines` on the badge label.
- **No oversized UI (28 pt max):** kept. Caption is 14 at 1x. The 2x growth is the reader's own setting.
- **Pro naming:** the slice adds no copy.

## Out of scope, for a later slice

- `CoverChip` on the Home cover cuts its words with an ellipsis at 2x ("Dra..", "Pri...") because of `numberOfLines={1}`
  (`RecipeCard.native.tsx:103`). This breaks the badge's own rule that status words are never cut. When `CoverChip` moves to the primitive, make it a
  `StatusBadge` tone (on `photoChip`), not a second chip.

## What I checked and could not check

- **Checked:** the four components and their diff. Also `tamaguiThemes.ts`, `tokens/native.ts`, the type roles and
  the card rows that hold the badge. I measured all six dark captures with pixel scripts and read the four scale
  captures. I read the RN 0.86 text-attribute source and the owner register.
- **Not checked:** any light capture, PRO or attention on a device, the badge above 1x on a device, a live scheme
  switch, VoiceOver or TalkBack output, and the other badge call sites (`IngredientCheckRow`, `IngredientRow`,
  `MatchSettledRow`, `OptionLabel`, `RecipeVisibilityField`) on a device.

## Hand-off

- **M-1 and L1:** the design-system owner, in this slice (`StatusBadge.native.tsx` and its height test).
- **M-2:** `fe-1`, in `features/recipes/src/card/oneLine.ts`. Better: `@commise/ui` exports the badge height, and
  `oneLine.ts` uses it.
- **M-3:** the Thing 1 session, with the captures listed in M-3. Do this before slice 2 builds on the cap.
- **L-1 to L-3:** fix these with audit M5, in the slice that moves `Icon` to Tamagui.
