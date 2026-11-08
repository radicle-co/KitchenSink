# Tamagui audit: does the native app match the mobile boards?

Author: `staff-ux-engineer`, EVALUATE mode, 2026-10-31. This file is a list of findings. It is not code and not a
spec.

## Scope

- **Tree A, `e10b5f000`** (`fix/ingredient-matching`). I read the Tamagui config, tokens, fonts and themes, the token
  modules, and the native primitives.
- **Tree B, `f5be04185`** (`fix/im-tamagui-slice1`, not merged). I read the native `Text`, the Tamagui `StatusBadge`,
  `DesignSystemProvider` and `DesignSystemTheme`.
- **The boards.** I compared against the mobile boards on `main` (the working tree has the same boards). I did not
  use the copy in tree A, because that copy is out of date (see B1). My board counts are upper bounds, because they
  include notes. I left out the phone frame, the system alert, the dashed demo outline and the `--os-*` colours.
- **Other sources:** ADR-0080, constitution Principle VII, `ownerFeedback.md`, `redesignSpec.md`, `componentFixes.md`
  and `tokens.css`.
- **Live pages (read 2026-10-31):** the React Native style pages, and the Tamagui v3 pages for Button, sizing, the
  config and the component list.
- **Two owner rulings received during this audit (2026-10-31):**
    - The text-size cap is 2x. Part 3 checks type, wrapping and touch targets at 2x.
    - Native primitives move onto Tamagui's OWN components (Button, Sheet, Dialog, Popover and the rest). `@commise/ui`
      keeps one shared API, with Radix on web. Part 2 judges each primitive.

**V** means I verified it by reading. **I** means I inferred it, so check it on a device. I ran no device, no build and
no screenshot.

## Summary

- On tree A, no `@commise/ui` primitive uses Tamagui. Only the app provider uses it. 55 `@commise/ui` native files and
  164 app and feature files still call `StyleSheet.create` (V).
- On tree B, `Text` and `StatusBadge` use Tamagui, and 54 `@commise/ui` files still call `StyleSheet.create` (V).
- The config is correct where it exists:
    - The colour roles and dark mode match the design system exactly, because the config builds the themes from `role`
      and `roleDark` (V).
    - Spacing and radius match `scale.ts` (V).
    - Each font weight points at its own registered face (V).
- The gaps are missing pieces, not wrong values. The config has no shadows, cover tints, bar, PRO pair, chart colours,
  stacking scale, control heights or surface sub-themes.
- The new ruling adds two bigger gaps:
    - Tamagui's own components read theme keys and a sizing ladder that our config does not define.
    - Tamagui's own components draw their own text, and that text does not get the 2x cap.
- **One departure from the ruling, as a recommendation (H7):** Sheet, Dialog and Popover take Tamagui's parts for
  the look, but React Native's `Modal` stays the host. The `Modal` gives us Android Back, screen-reader trapping and
  the dismiss order today. A Portal gives none of these for free.

**Counts.** For Thing 1 (code): 7 High, 8 Medium and 5 Low. For the boards: 1 High, 4 Medium and 3 Low. Native limits
that change the boards: 4.

---

## Part 1. Fixes for Thing 1 (code)

### High

**H1. Shadows lose a layer, and the focus glow draws nothing.** Trees A and B. The code is V. The device result is I.

- `ui/src/tokens/native.ts:36-37`: `toNativeShadow` keeps only the last layer. So `md` and `lg` lose their first layer.
- `native.ts:136`: `glow` has blur 0, spread 3 and offset 0, so iOS draws nothing. Its Android elevation is 0
  (`:126`), so Android draws nothing too.
- `scale.ts:156` says "native has one shadow per view". That premise is out of date. On the New Architecture,
  React Native 0.86 has `boxShadow`, with many layers, inset shadows and a spread (`spreadDistance`). Tamagui passes
  `boxShadow` through on native, with theme values inside it.
- The boards put a shadow on almost every card: about 455 `shadow-md`, 313 `xl`, 289 `lg` and 147 `sm`.
- The boards draw control edges as inset lines: about 362 at 1 px `line-control` and 113 at 1.5 px `selected-edge`.
  The step marker is an inset 3 px `here-bar`.
- **Fix:**
    - Give `elevation` a native `boxShadow` string. Web's `shadows.ts` makes the same string already.
    - Keep `elevation` as the Android fallback.
    - Draw control edges as inset `boxShadow`. Then a 1.5 px selected edge does not move the layout, as a changed
      `borderWidth` does.
- **Limit:** outset shadows need Android 9 or later, and inset shadows need Android 10 or later. Older phones keep
  today's look. `mobile/app.config.ts` sets no `minSdkVersion`, so the Expo default applies.

**H2. The themes lack colours that the boards paint. Under `color: 'strict'`, nothing can use these colours.** Trees A
and B. V.

- `ui/src/theme/tamaguiThemes.ts:33-47` builds each theme from the roles and the surface tones only.
- The web build emits the keys below, and the boards use them. No Tamagui theme has them.

| Missing key                         | Light                       | Dark                     | Source           | Board uses |
| ----------------------------------- | --------------------------- | ------------------------ | ---------------- | ---------- |
| `bar`                               | `rgba(252, 253, 255, 0.92)` | `rgba(23, 32, 41, 0.94)` | `barMaterial.ts` | 53         |
| `proFill`                           | `#5C646E`                   | `#A3ACB6`                | `tones.ts`       | badge      |
| `proInk`                            | `#FFFFFF`                   | `#171B20`                | `tones.ts`       | badge      |
| `coverSteel`                        | `#E1EDFA`                   | `#202B37`                | `covers.ts`      | 230        |
| `coverCream`                        | `#F7E9D7`                   | `#342817`                | `covers.ts`      | 171        |
| `coverSky`                          | `#DDEEFC`                   | `#1C2C38`                | `covers.ts`      | 391        |
| `coverPeach`                        | `#F5E9DF`                   | `#32281F`                | `covers.ts`      | 174        |
| `coverSuccess`                      | `#E4EDF2`                   | `#232B30`                | `covers.ts`      | 84         |
| `coverWarning`                      | `#F7E9D7`                   | `#342817`                | `covers.ts`      | none       |
| `chartCalories` to `chartFiber` (5) | `chart`                     | `chartDark`              | `colors.ts`      | nutrition  |

- On tree B, the PRO badge paints `$inkMuted` under `$inverseInk` (`StatusBadge.native.tsx:50, :64`). These values equal
  the PRO pair in both themes today, but only by chance. The badge uses a text role as a fill. If the PRO tone moves,
  web moves and native does not.
- **Fix:** in `themeOf`, generate these keys from `barMaterial`, `proTone` and `proToneDark`, `coverTint` and
  `coverTintDark`, and `chart` and `chartDark`. Use the same method as the surface tones. Then point the badge at
  `$proFill` and `$proInk`. Do not add palette swatches. Each key is a role with a meaning.

**H3. There are no surface sub-themes, so text is `$ink` on dark surfaces too.** Trees A and B. The code is V. How often
it shows is I.

- `tamaguiThemes.ts:27-31` flattens each surface tone into keys (`inverseFill`, `inversePress` and so on) inside one
  theme.
- On tree B, `Text.native.tsx:36` makes every text `$ink`. On the `inverse` surface, the ink is `inverseInk`
  (`surfaceTone.ts:57`). So each caller must override the colour. A caller that forgets draws dark text on a dark
  fill.
- **Fix:**
    - Add one Tamagui sub-theme per surface tone: `light_inverse`, `light_muted`, `dark_inverse` and so on.
    - Each sub-theme remaps `ink`, `inkMuted`, `lineDivider` and the chip fill.
    - `Surface` then sets `theme="inverse"`, and every `Text` inside it gets the right ink with no prop. In Tamagui, the
      surface owns its ink.
    - Keep a flat key for a consumer that needs another tone's value.

**H4. A recipe with no photo draws a letter. The boards say "never a letter tile".** Tree A, and the same on tree B. V.

- `ui/src/recipeCover/RecipeCover.native.tsx:5` and `:61-67` draw the title's first letter in Manrope at 40% of the
  cover height. On a 256 pt hero, that is about 102 pt. Owner rule C1 sets 28 pt as the largest size.
- `redesignSpec.md:148-149` says: "A no-photo cover is a `--cover-sky` to `--cover-coral` gradient with a photo icon
  in a paper disc and 'Waiting for its photo'. It never uses a letter tile." There is no `--cover-coral` token, so the
  boards use `--cover-cream`.
- The boards override the component with CSS: "No-photo cover (spec, Surfaces): a sky-to-cream gradient, a photo icon in a paper
  disc and 'Waiting for its photo'. Never a letter tile." (`AppOfflineReadMobile.dc.html` is one example.)
- Every recipe without a photo shows this, and most new recipes have no photo.
- **Fix:**
    - Draw a 135° gradient from `coverSky` to `coverCream`. This needs H2.
    - Add a 48 pt `paper` disc that holds the photo icon in `inkMuted`, and a caption under it.
    - Draw the gradient with `backgroundImage`, or with Tamagui's `LinearGradient` (the app has `expo-linear-gradient`).
    - The web leaf has the same gap, so fix both in one change.

**H5. Tamagui's own components read theme keys and a sizing ladder that our config does not define.** Trees A and B.
Tamagui's docs are V. The effect on our config is I.

- Tamagui v3's Button reads `background`, `background-hover`, `background-press`, `border-color`, `border-color-hover`,
  `outline-color` and `color` (Tamagui Button page, v3.0.0). Our themes use only role names (`$action`, `$ink`).
- Tamagui v3 sizes its controls from a `sizing` ladder of rungs `xs` to `xl` in the config. Each rung names a font
  size, a control font size, inline and block padding, a gap and a radius. The ladder derives the height from the
  line box plus the padding. Our config has no `sizing` key. The default ladder names token keys (`'xl'`, `'2xl'`,
  `'10'`) that our tokens do not have.
- Slice 1 proves the pattern: Tamagui's `Text` read `$color`, our themes had no `$color`, and the device logged a
  warning for each text (`Text.native.tsx:35`).
- **Fix: theme keys.** Make one projection from our roles to Tamagui's keys, as tone sub-themes. Generate them, and do
  not type them by hand.

| Sub-theme          | `background`   | `background-press` | `color`      | `border-color` | `outline-color` |
| ------------------ | -------------- | ------------------ | ------------ | -------------- | --------------- |
| `*_primary`        | `action`       | `actionPressed`    | `onAction`   | `action`       | `focusRing`     |
| `*_secondary`      | `paper`        | `paperPress`       | `ink`        | `lineControl`  | `focusRing`     |
| `*_quiet`          | transparent    | `canvasPress`      | `actionText` | transparent    | `focusRing`     |
| `*_danger`         | `danger`       | `dangerPressed`    | `onAction`   | `danger`       | `focusRing`     |
| `*_selected`       | `selectedFill` | `selectedFill`     | `ink`        | `selectedEdge` | `focusRing`     |
| base (each scheme) | `canvas`       | `canvasPress`      | `ink`        | `lineDivider`  | `focusRing`     |

Also give each scheme `placeholder-color: inkMuted`. Drop `background-hover`, because native has no hover.

- **Fix: sizing ladder.** Define `sizing.sizes` from our scale. Each rung's height is the 20 pt `cardTitle` line plus
  twice the block padding:

| Rung | Our size | Height | `paddingBlock` | `paddingInline` | `gap` | `controlFontSize` | `radius`       |
| ---- | -------- | ------ | -------------- | --------------- | ----- | ----------------- | -------------- |
| `sm` | `sm`     | 36     | `2` (8)        | `3` (12)        | `2`   | `16`              | `controlSm` 18 |
| `md` | `md`     | 44     | `3` (12)       | `3` (12)        | `2`   | `16`              | `controlMd` 22 |
| `lg` | `lg`     | 52     | `4` (16)       | `3` (12)        | `2`   | `16`              | `controlLg` 26 |

Set `sizing.default` to `md`. The rung values are bare token keys, as in Tamagui's own example.

- **Pin each rung's geometry with the ladder's `px` option.** The ladder derives the height from the font's line
  box, and `tamaguiFonts.ts:24-29` gives 16 px a 24 leading. Without a pin, `md` comes out 48, not 44. Do not change
  the fonts' 16 leading to 20: body text is 16/24 (`typography.ts:94`), and the fonts agree with it.
- The label still sets its own leading, because it is our `Text typeRole="cardTitle"` (16/20) as a child (H6).
- The radius is half the base height as a fixed number. Do not use `full`. With `full`, a label that wraps to two lines
  becomes a long stadium, and the text runs into the curve. `Button.native.tsx:10-12` already keeps half the base
  height for this reason (E2 I2).
- This needs three new radius tokens named by control. They belong to the radius scale I own. They are not new board
  values.
- **Do not use `noTextWrap` anywhere.** A label wraps, and is never cut off (the owner's rule on wrapping in controls).

**H6. Tamagui's own components draw their own text, so the 2x cap misses it.** Tree B and later. The cap is V. The miss
is I.

- The cap lives on our `Text` only (`Text.native.tsx:34`). Tamagui's `Button`, `Input`, `Select`, `Toast` and `Tabs`
  draw text through their own parts. That text does not read `FONT_SCALE_CAP`.
- With no cap, that text grows past 2x on iOS while our own text stops at 2x. The result is uneven text, and some labels
  overflow.
- **Fix:**
    - Pass our `Text` as the child of each Tamagui component. The label is then always our type role with the cap.
    - For a part that cannot take a child, restyle it with `styled(…, { maxFontSizeMultiplier: FONT_SCALE_CAP })`. This
      covers the `TextInput` inside `Input` and `TextArea`.
    - Add a guard: a Tamagui text part outside `@commise/ui` fails the build.
    - Set `FONT_SCALE_CAP = 2` (owner ruling). It is `0` on tree B (`Text.native.tsx:30`).

**H7. Tamagui's Sheet, Dialog and Popover draw into a Portal. The current primitives use React Native's `Modal`, and
three behaviours depend on it.** Trees A and B. Our code is V. Tamagui's behaviour is I.

- `Sheet.native.tsx:1-25` depends on `Modal` for three things:
    - Android Back goes to `onRequestClose`, so `@commise/ui/back-intercept` never sees it.
    - Screen-reader focus moves to the title on `onShow`.
    - The iOS slide-out and `onDismiss` order.
- A Portal is not a native modal window. So:
    - Back reaches the screen under the sheet, unless the sheet registers with `BackInterceptProvider`. ADR-0056 explains
      why the provider sits outside the `NavigationContainer`, and the order matters.
    - VoiceOver and TalkBack can reach the screen behind the sheet, unless the frame sets `accessibilityViewIsModal` (iOS)
      and the app root sets `importantForAccessibility="no-hide-descendants"` (Android) while the sheet is open.
- **Fix:**
    - Port the look onto Tamagui's `Sheet.Frame`, `Sheet.Overlay` and `Sheet.Handle`, or onto the `Dialog` parts.
    - Keep `Modal` as the host. Use `modal={false}` on the Sheet, inside our `Modal`.
    - If we drop `Modal`, a test for each of the three behaviours must fail first. Then the Portal version must pass them
      on a device.
    - The behaviour is the contract. The look is what moves.

### Medium

**M1. There is no stacking scale.** Tree A. V.

- `tamaguiTokens.ts:22` holds only `zIndex: { 0: 0 }`, and `zIndex` is `'strict'` (`tamaguiConfig.native.ts:37`).
- The code uses 1 and 10 in four places: `RecipeHero.native.tsx:83`, `Combobox.native.tsx:504`,
  `LargeTitleHeader.native.tsx:113` and `CondensedTitleBar.native.tsx:102`. A strict port of these does not compile.
- **Fix:** name the layers by role: `raised` 1, `sticky` 2, `bar` 10, `sheet` 20 and `toast` 30. Map each current use to
  one of them.

**M2. `size` copies `spacing`, so layout heights have no tokens.** Tree A. V.

- `tamaguiTokens.ts:20` sets `size: { ...spacing }`. The control heights move to the sizing ladder (H5). Other heights
  still need tokens: badge 24, chip 32, bar 56 (`pinnedBarHeight`), hero 256 and placeholder 96 (`mediaHeight`).
- On tree B, the badge's `minHeight: '$5'` (`StatusBadge.native.tsx:43`) is 24 only because spacing step 5 is 24.
- **Fix:** add named `size` tokens for these heights. Android grows 44 to 48 (`Button.native.tsx:10-12`), so a token is
  the visual height and not the hit area.

**M3. `space` and `size` accept any raw number.** Tree A. V, from Tamagui's page, read 2026-10-31.

- `tamaguiConfig.native.ts:38-39` sets `'somewhat-strict'`. For space and size, that mode accepts numbers and
  percentages.
- So an off-scale board value (6, 10, 14, 20) goes into the code with no error. An off-scale radius or colour fails
  the build.
- **Fix:** move `space` to `'strict'` after the board fixes (B3). If the owner keeps a 2 pt step, add it as a named
  token. Until then, a guard lists each raw space number in a `styled()` call.

**M4. The badge glyph is darker than the badge's words.** Tree B. V.

- `StatusBadge.native.tsx:78` draws the glyph with `tone="ink"`, but the label is `inkMuted`.
- On web, the glyph uses `currentColor` (`Icon.tsx:6`), so it takes the label's colour, `inkMuted`.
- So Draft, Private and Public draw a charcoal pencil, lock or globe beside slate words. Web and the boards draw the
  glyph and the words in one colour.
- **Fix:** take the glyph's tone from the badge tone. A neutral badge uses `inkMuted`. Only neutral badges have a glyph
  today.

**M5. `Icon` reads a second theme source.** Trees A and B. The code is V. The risk is I.

- `Icon.native.tsx:25` reads `useTheme().colors` from our own hook, not from the Tamagui theme.
- Inside a Tamagui sub-theme (H3, H5), the glyph and its surface can disagree.
- **Fix:** read the colour through Tamagui (its `useTheme()` or a `$` value). Tamagui's `scaleIcon` on Button needs this
  too.

**M6. One screen draws a fake bold or the system font.** Trees A and B. V.

- `features/recipes/src/versions/VersionPreviewModal.native.tsx:285` sets `cannotRestore: { fontWeight: '600' }`.
- At `:228`, the style is used alone. The text has no face, so it draws the system font at 600.
- At `:241`, the style sits on `type.body` (`Inter_400Regular`). Android then draws a fake bold of the regular face.
- **Fix:** use `<Text typeRole="label">`. Guard G4, which blocks `fontWeight`, needs to cover feature code too.

**M7. Android text can sit lower than on the boards.** Tree B. I.

- `Text.native.tsx` does not set `includeFontPadding: false`. Android adds the font's extra padding above and below the
  text, even with a fixed `lineHeight`.
- So text in a 24 pt badge or a 44 pt pill sits lower than on the boards. A browser drew the boards, and a browser adds
  no such padding.
- **Fix:** set `includeFontPadding: false` on the base `Text`. Then check a badge, a button and a chip on an Android
  phone.

**M8. Some layouts break at 2x.** Trees A and B. See Part 3 for each check. The reading is V. The breakage is I.

- An element with a fixed `height` cuts or hides its text at 2x. Sites on tree B (V):
    - `ui/src/input/TextArea.native.tsx:36, :112`: the height is rows × 24, a leading that does not scale. At 2x each
      line is 48, so the box shows half its rows. Multiply by `useWindowDimensions().fontScale`, capped at 2.
    - `ui/src/createFab/FabFace.native.tsx:75`: a fixed 52 with a one-line label (`:37, :43`). At 2x the label is cut
      with an ellipsis. Use `minHeight` and let the label wrap, or show the glyph alone above 1.5x and keep the label as
      the accessible name.
    - `ui/src/largeTitleHeader/LargeTitleHeader.native.tsx:110`: a fixed 44 row with one line of `meta` (`:89`). At
      2x the line is 40, so it fits but is cut with an ellipsis sooner. This is acceptable.
    - `ui/src/avatar/AvatarDisc.native.tsx:41`: a fixed 32 disc. Check whether it holds initials.
    - `CondensedTitleBar.native.tsx:103` (56) is correct as it is (Part 3).
- A guard can fail any fixed `height` on a view that holds `Text`.
- The tab bar labels, the segmented control and the stepper's digit box each need a decision. See Part 3.

### Low

**L1. The badge uses a 2 pt padding.** Tree B. V.

- `StatusBadge.native.tsx:46` sets `paddingVertical: 2`. It matches web (`py-0.5`), but 2 is not on the scale.
- If M3 makes `space` strict, add a 2 pt step, or record why this case is an exception.

**L2. Layout values are not tokens.** Tree A. V.

- Tamagui does not have `layout.ts` (`pinnedBarHeight`, `contentWidth`, `gutter`, `containerThreshold`) or
  `mediaHeight`. Add them to `size` together with M2.

**L3. There is no animation driver.** Tree A. V.

- `tamaguiConfig.native.ts:13-15` defers motion to its own slice. Until that slice lands, `enterStyle` and `animation`
  do not work, and Tamagui's Sheet and Dialog do not animate their own entry.
- Our `Sheet` reads reduce motion before it slides. The driver keeps that rule. The enter motion is 220 ms
  (`motion/enterMotion.ts`).

**L4. The first frames use the system font.** Tree A. V.

- `mobile/App.tsx:69-74` loads the fonts without blocking, on purpose. On a cold start, the first frames draw in the
  system font. This is a recorded trade-off. Do not compare a first-frame screenshot with a board.

**L5. The migration is at its beginning.** Status, not a defect.

- Tree A has no primitive on Tamagui. Tree B has two. This order gives the most board fidelity for each change:
    1. Theme keys, the sizing ladder and sub-themes (H3, H5).
    2. `Button`.
    3. `Chip`.
    4. `Input`.
    5. `RecipeCover` (H4).
    6. Cards with shadows (H1).
    7. Overlays (H7).

---

## Part 2. Each primitive on Tamagui's own components

**Yes** means it can look and behave like the app with the fixes listed. **Partly** means Tamagui gives the look, and
our code keeps the behaviour. **No** means Tamagui has no matching component, so the primitive stays our own
`styled()` component. Every row assumes H2, H3, H5 and H6 are done.

| Our primitive                                                                                                                                                         | Tamagui component                                                | Result | Fixes that get it to the boards                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                                                                                                                              | `Button`                                                         | Yes    | Tone through `theme="primary"`, `"secondary"`, `"quiet"` or `"danger"` (H5). `size` is `sm`, `md` or `lg`, with the ladder in H5. The label is our `Text typeRole="cardTitle"` as a child (H6). The press fill is `background-press`. Turn off Tamagui's default `press:` opacity, and keep `PressScale` for the press scale. Disabled uses opacity 0.4 (`dimmedOpacity`). A `sm` button keeps its 44/48 hit frame around the 36 pill. Show busy with `Spinner` in `color: onAction`, and keep the width fixed. No `noTextWrap`. No focus ring (X4). |
| `HeroButton`, `CreateFab`                                                                                                                                             | `Button` (`circular` for the icon form)                          | Yes    | Use `lg` (52), radius `controlLg`, and `theme="primary"`. The FAB keeps `shadow-lg` through `boxShadow` (H1).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Chip`, `ChipRow`                                                                                                                                                     | `ToggleGroup` (multiple), or `Button` with `aria-pressed`        | Yes    | The selected state is the `selected` sub-theme (`selectedFill` with a 1.5 px inset `selectedEdge`). Steel never fills a chip. The visual height is 32 inside a 44/48 hit frame. The label is `Text typeRole="label"`. The row scrolls sideways, and labels wrap at 2x (Part 3).                                                                                                                                                                                                                                                                      |
| `SegmentedControl`, `SectionSwitch`                                                                                                                                   | `ToggleGroup` (single) or `Tabs`                                 | Yes    | The track is `surfaceMuted` with a `$1` pad and radius `full`. The selected segment is `action` with `onAction` text. The owner's colour rule allows steel here. At 2x, see Part 3.                                                                                                                                                                                                                                                                                                                                                                  |
| `RadioList`, `ChoiceRow`                                                                                                                                              | `RadioGroup` with `ListItem`                                     | Yes    | Map the indicator to `lineControl` (off) and `action` (on). The selected row is `selectedFill`, never `action`. The row is at least 44 tall. Our `Text` sets the title and the meta text.                                                                                                                                                                                                                                                                                                                                                            |
| `CheckBoxGlyph`                                                                                                                                                       | `Checkbox`                                                       | Yes    | Size 24 with radius `$sm` (8). Off is a 1.5 px `lineControl` edge. On is an `action` fill with an `onAction` check. The row is the hit target.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Input`, `TextInput`, `TextArea`, `SearchField`                                                                                                                       | `Input`, `TextArea`                                              | Yes    | The edge is an inset 1 px `lineControl`. Focus is a 2 px `focusRing`. This field ring is ours to draw (X4). An error is `danger` with `dangerText` copy. The placeholder is `inkMuted`. Text is 16/24 Inter. Height is `minHeight` 44 (48 on Android). Add `maxFontSizeMultiplier` (H6) and `includeFontPadding: false` (M7). `SearchField` adds a leading icon at `zIndex` `raised` (M1).                                                                                                                                                           |
| `Stepper`, `DurationField`                                                                                                                                            | None                                                             | No     | Keep our `styled()` component, built from Tamagui `Button` and `Input`. The digit box sizes to its content, with room for two digits at least, and grows at 2x (Part 3).                                                                                                                                                                                                                                                                                                                                                                             |
| `Combobox`                                                                                                                                                            | None (`Select` is not a combobox, because it cannot take typing) | Partly | Keep our logic. Draw the field with Tamagui `Input`, and the list with `ListItem` inside our `Popover`, or inside our `Sheet` on phones.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Sheet`, `BottomSheetPanel`, `FullScreenSheet`                                                                                                                        | `Sheet`                                                          | Partly | The look ports: `Sheet.Frame` in `paperOverlay` with a top radius of `$xl` (24), `Sheet.Overlay` in `scrim`, and `Sheet.Handle`. Keep the behaviour in our `Modal` host (H7). Snap points are percent or `fit`, never fixed pixels, so the sheet grows at 2x. Keep keyboard lift through `KeyboardAvoider`.                                                                                                                                                                                                                                          |
| `Modal`, `DialogFrame`, `ConfirmDialog`, `DialogActions`                                                                                                              | `Dialog`, `AlertDialog`                                          | Partly | The look ports: the frame in `paperOverlay` with radius `$xl`, the title as `sectionTitle`, and the body as `body`. Actions sit in one row, secondary first and primary last. At 2x, actions that do not fit stack. Same host rule as `Sheet` (H7).                                                                                                                                                                                                                                                                                                  |
| `Popover`, `ActionMenu`                                                                                                                                               | `Popover`, `Menu`                                                | Partly | The frame is `paperOverlay` with radius `$md` and `shadow-xl` (H1). Each item is at least 44 tall. Back closes it through `BackInterceptProvider` (H7). For a menu of more than about six items on a phone, use `Adapt` to a `Sheet`. That count is my judgement.                                                                                                                                                                                                                                                                                    |
| `SnackbarHost`, `UndoSnackbar`                                                                                                                                        | `Toast`                                                          | Partly | The look ports: the `inverse` sub-theme (H3), the action in `inverseAction`, and radius `$md`. Keep our timing and the `LiveRegion` announcement. Tamagui's Toast does not replace them.                                                                                                                                                                                                                                                                                                                                                             |
| `ProgressBar`, `PendingBar`                                                                                                                                           | `Progress`                                                       | Yes    | The track is `surfaceMuted` and the fill is `action`, both radius `full`. `PendingBar`'s delayed reveal stays ours (L3).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `LoadingNotice`, `StateNotice`, `SyncNotice`, `RefreshNotice`, `OfflineReadSlot`                                                                                      | `Spinner`, `Card`                                                | Yes    | `Card` in `paper` with `shadow-sm`, our `Text` roles, and `Spinner` in `inkMuted`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Avatar`, `AvatarDisc`                                                                                                                                                | `Avatar`                                                         | Yes    | `Avatar.Image` with an `Avatar.Fallback` in `surfaceMuted`. Initials use `Text typeRole="label"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RecipeCover`                                                                                                                                                         | `Image`, `LinearGradient`                                        | Yes    | See H4. Keep `expo-image` for its disk cache, and use Tamagui only for the frame and the no-photo state.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `StatusBadge`, `DifficultyBadge`                                                                                                                                      | None (a `styled(XStack)`, as on tree B)                          | Yes    | Already on tree B. Apply M4 (glyph colour), H2 (`proFill`, `proInk`) and M2 (the 24 height token).                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Surface`, `GradientSurface`                                                                                                                                          | `YStack`, `LinearGradient`                                       | Yes    | `Surface` sets the tone sub-theme (H3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ChromeSurface`                                                                                                                                                       | None                                                             | No     | Liquid Glass through `expo-glass-effect` on iOS 26, and solid `paperRaised` elsewhere. Tamagui has no glass material (X1).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `LargeTitleHeader`, `CondensedTitleBar`, `HeaderEyebrowBack`                                                                                                          | None                                                             | No     | Keep our `styled()` components. The bar stays 56 tall, and each title is one line with a tail ellipsis (`CondensedTitleBar.native.tsx:67, :82`). That holds at 2x (Part 3).                                                                                                                                                                                                                                                                                                                                                                          |
| `SectionIndex`, `PhotoControl`, `VariantPartsLine`, `StandIn`, `OptionLabel`                                                                                          | None                                                             | No     | Keep our `styled()` components.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Text`, `Icon`                                                                                                                                                        | `Text` (styled), Lucide                                          | Yes    | `Text` is done on tree B. Apply H6 and M7. `Icon` applies M5. Icons inline with text follow the font scale up to 2x through `scaleIcon`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PressScale`, `EnterTransition`, `KeyboardAvoider`, `ScrollHost`, `HorizontalScroller`, `LiveRegion`, `BackInterceptProvider`, `KeepAwakeToggle`, `BottomChromeFrame` | Not styling                                                      | No     | These hold behaviour, not looks. They stay, and they wrap Tamagui views where they draw anything.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## Part 3. Checks at 2x text size (owner ruling: cap at 2x)

At 2x, the four sizes become 28, 32, 36 and 56. The leadings become 40, 48, 48 to 56, and 64. The owner's 28 pt rule
(C1) covers the default size, not the reader's own setting.

With font scaling on, React Native scales `lineHeight` with the font. This is I, from React Native's text code. Check
it on a device first. Without that scaling, every line at 2x overlaps the next, and that case is High.

| Area                                | At 2x                                                                                                                                                                                                                                 | Verdict                                       | What to do                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body, lists and titles              | Grow and wrap                                                                                                                                                                                                                         | Works with no fixed parent height             | Use `minHeight` everywhere text sits (M8).                                                                                                                                                                                                                                                                                |
| Buttons                             | The label is 32/40. A `md` button is about 64 tall on one line, and about 104 on two.                                                                                                                                                 | Works with the H5 ladder                      | Height comes from the line box, so it grows. The radius stays at half the base height, so a wrapped label stays clear of the curve (H5). Never use `noTextWrap`.                                                                                                                                                          |
| Pinned bar (56) and condensed title | `barTitle` is 32/40 in a 56 bar                                                                                                                                                                                                       | Works                                         | It stays one line with a tail ellipsis (`CondensedTitleBar.native.tsx:67, :82`). The large title on the page carries the full name.                                                                                                                                                                                       |
| Tab bar                             | Three tabs (`TabsNavigator.tsx:41-43`). The label is `caption` (`HomeTabBar.tsx:103`), so 28/40 at 2x. Each tab is about 107 pt wide at 320 pt. "Discover" at 28 pt needs about 120 pt (my estimate), and longer languages need more. | Tight                                         | Owner decision. Option A: the label wraps to two lines and the bar grows. Option B (my judgement): above 1.5x, show the icon alone and keep the label as the accessible name. iOS pairs short tab labels with a Large Content Viewer. React Native does not give us one. So option B gives the reader less than iOS does. |
| Segmented control (2 or 3 parts)    | Labels at 32 pt wrap in a 100 pt part                                                                                                                                                                                                 | Breaks for labels longer than about 6 letters | Above 1.5x, let each label wrap to two lines and let the track grow. If that is not enough, show the choices as a `RadioList`.                                                                                                                                                                                            |
| Chips                               | 14 becomes 28/40, so a chip is about 48 tall                                                                                                                                                                                          | Works                                         | The row already scrolls sideways.                                                                                                                                                                                                                                                                                         |
| Badge                               | Caption at 28/40, so about 44 tall                                                                                                                                                                                                    | Works                                         | `minHeight`, never `height`. The glyph scales with the text through `scaleIcon` (Part 2).                                                                                                                                                                                                                                 |
| Stepper digit box                   | Two digits at 32 pt need about 40 pt                                                                                                                                                                                                  | A fixed width breaks                          | Size the box to its content, with two digits as the minimum.                                                                                                                                                                                                                                                              |
| Inputs                              | 16 becomes 32/48                                                                                                                                                                                                                      | Works with `minHeight`                        | Single-line fields grow. Check that the keyboard does not cover the focused field.                                                                                                                                                                                                                                        |
| Sheets and dialogs                  | Content grows past the snap point                                                                                                                                                                                                     | Breaks with fixed pixel snap points           | Use percent or `fit` snap points, and scroll inside the frame. Dialog actions that do not fit in one row stack.                                                                                                                                                                                                           |
| Cooking mode focus line             | 28 becomes 56/64                                                                                                                                                                                                                      | Works                                         | This is the reader's own choice, so C1 does not cap it.                                                                                                                                                                                                                                                                   |
| Touch targets                       | Hit frames are 44 pt (iOS) and 48 dp (Android)                                                                                                                                                                                        | Works                                         | Text growth only makes targets larger. Fixed icon buttons keep 44/48. No target shrinks.                                                                                                                                                                                                                                  |

**Boards owed:** draw Recipe detail, the Editor, Cooking mode, Home and Recipes at 200% text, on a 320 pt phone. Today
no board shows any screen at 2x.

---

## Part 4. Fixes for the boards (design session)

`tokens.css` says "the authority is the code". So a board value off the design scale is a board fix, and a new token
needs an owner ruling.

### High

#### B1. Tree A's copy of the boards is out of date

- In `e10b5f000`, `RecipeDetailMobile.dc.html` still has 49 sizes at 13, 15 and 17 px, and it still sets letter
  spacing. The boards on `main` have none of these.
- Thing 1 reads its own branch, so it can match sizes that the owner overruled (T1, 2026-10-26).
- `ownerFeedback.md` row C1 still says "everything else stays on 13, 15 and 17". That contradicts row T1.
- **Fix:** Thing 1 compares against the boards on `main`. Change row C1 to say "14, 16 and 18".

### Medium

#### B2. The boards use Manrope where the type roles use Inter

- The boards set dish names (`.dish`) and sheet titles (`.sheet h2`, 18 px) in Manrope 600.
- `typeRole` uses Manrope for `largeTitle` only. `cardTitle` and `sectionTitle` are Inter.
- `redesignSpec.md:7` says card titles stay Inter and Manrope is for large titles only. Line 94 says Manrope is for
  "dish names and the one page title". The spec contradicts itself.
- **Owner decision.** Thing 1 does not add a role until the owner decides.

#### B3. The boards use spacing values that are not on the scale

- The scale is 0, 4, 8, 12, 16, 24, 32, 48, 64 and 96.
- The boards also use 2 (612 times), 3 (217), 5 (108), 6 (875), 10 (869), 14 (779), 20 (204) and 40 (74), mostly as
  gaps and padding.
- **Fix:** move 6 and 10 to 8 or 12, 14 to 12 or 16, 20 to 16 or 24, and 40 to 48. If the owner adds 2 as a step, keep it.

#### B4. The boards use radii that are not on the scale

- The scale is 8, 12, 18, 24 and full.
- Most off-scale radii are half the height: 22 on 44, 26 on 52, 16 on 32 and 28 on 56. These are pills, so native draws
  them with the control radii (H5). They are not findings.
- These are findings: 14 on the 48 and 56 rounded rectangles (`.ghost`, `.stopBtn`, `.fact`, `.tag`), 10 on dots, 6 on
  `.tag`, 5 on `.timeline`, and 3 on small marks.
- **Fix:** move these to 12 or 8. Make the dots `full`.

#### B5. The badge and the button differ from the components

- **Badge.** The board badge (`.badge`) has a gap of 5, padding of 9 and label weight 600. The component on web and
  native has a gap of 4, padding of 8 and `caption` at 500 (`componentFixes.md` §7). Redraw the board to match the
  component.
- **Button.** The board button pads 18 on each side. The component pads 12, so that three buttons fit a 320 pt row
  (`Button.native.tsx:13`). Redraw the board.

### Low

**B6.** `--cover-premium` appears 45 times in the boards, but nothing defines it. The `tokens.css` copy lacks
`dangerPressed`. Refresh the copy from the build.

**B7.** `redesignSpec.md` still gives 13, 15 and 17 (near lines 118-120, 168 and 212), and it still gives letter-spacing
values. Bring it in line with T1.

**B8.** About 44 board rules draw a 2 px focus ring on buttons and rows. See X4.

---

## Part 5. What native cannot draw, so the native boards change

| #   | Board effect                                                                  | Why native cannot match it                                                                                                                           | What the native board shows instead                                                                                                    |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | Bar blur: `backdrop-filter: blur(20px) saturate(1.4)` over `--bar` (8 boards) | React Native has no backdrop blur. Its `filter: blur` works on Android 12 and later, and not on iOS (React Native style docs). Tamagui adds no blur. | On iOS 26, Liquid Glass (`ChromeSurface.native.tsx`). On other iOS versions and on all Android phones, solid `paperRaised`. Draw both. |
| X2  | `text-wrap: balance` on titles (36 rules)                                     | iOS has no balanced line breaking. Android's `textBreakStrategy="balanced"` is close.                                                                | Draw iOS titles unbalanced. The last line can be one short word.                                                                       |
| X3  | `text-decoration-thickness: 1px` on links (32 rules)                          | React Native cannot set the thickness of an underline.                                                                                               | The platform's default underline.                                                                                                      |
| X4  | Drawn focus rings (`inset 0 0 0 2px var(--focus-ring)`, about 44 rules)       | On native, the OS draws focus for VoiceOver, TalkBack and hardware keys. Our ring doubles it.                                                        | Keep the ring on a focused text field only. Remove the rings on buttons and rows from the native boards.                               |

**Not limits.** These look web-only, but native draws them another way, so the boards stay as they are:

- The fade at the bottom of long lists (`mask-image`, 35 boards): a gradient overlay to `paper`. Over a solid surface it
  looks the same.
- Sticky blocks (`position: sticky`): `stickyHeaderIndices`, or an overlay.
- The cover's container query (`@container cover`): `onLayout`. `RecipeCover.native.tsx` does this already.
- Gradients: `backgroundImage`, or Tamagui's `LinearGradient`.
- Shadows with several layers, and inset edges: `boxShadow` (H1).
- Aspect ratio, line clamps and tabular figures: `aspectRatio`, `numberOfLines` and `fontVariant`.

**Device floor:** outset `boxShadow` needs Android 9 or later, and inset needs Android 10 or later. Older phones draw
flat edges. No board uses hover, so there is nothing to translate.

---

## Part 6. Token parity

| Group                   | Design system                                                  | Tamagui (tree A)                                      | Match                                                                                      |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Colour roles, light     | 29 roles in `role`                                             | All 29, by the same names (`$inkMuted`)               | Yes (V). `tamaguiThemes.test.ts` pins it.                                                  |
| Colour roles, dark      | 29 roles in `roleDark`                                         | All 29                                                | Yes (V)                                                                                    |
| Surface tones           | Fill, press and chip fill for each tone                        | `${tone}Fill`, `${tone}Press`, `${tone}ChipFill`      | The values match. There are no sub-themes (H3).                                            |
| Tamagui base keys       | None                                                           | None                                                  | Missing. Tamagui's components need them (H5).                                              |
| Bar, PRO, covers, chart | Emitted on web                                                 | Missing                                               | No (H2)                                                                                    |
| Space                   | 0, 4, 8, 12, 16, 24, 32, 48, 64, 96                            | The same, `$0` to `$9`                                | Yes (V). Raw numbers pass (M3).                                                            |
| Size                    | Controls 36, 44, 52. Badge 24, chip 32, bar 56, hero 256.      | A copy of space. No `sizing` ladder.                  | No (H5, M2)                                                                                |
| Radius                  | 8, 12, 18, 24, 9999                                            | `$0`, `$sm`, `$md`, `$lg`, `$xl`, `$full`             | Yes (V). Control radii are missing (H5).                                                   |
| Type                    | 12 roles. Sizes 14, 16, 18, 28. Leadings 20, 24, 24 to 28, 32. | Two fonts keyed by size. Tree B `Text` keyed by role. | Tree B `Text`: yes (V). The fonts' 16 leading is 24, so the ladder pins its geometry (H5). |
| Faces                   | Inter 400, 500, 600 and Manrope 600. Top weight 600.           | `body` has 3 faces, `heading` has 1                   | Yes (V). `App.tsx:69-74` loads them.                                                       |
| Shadow                  | `sm`, `md`, `lg`, `xl`, `glow`, with 1 or 2 layers each        | None. Native keeps the last layer only.               | No (H1)                                                                                    |
| Stacking                | No names. The code uses 1 and 10.                              | `{0}`                                                 | No (M1)                                                                                    |
| Motion                  | Enter: 220 ms, ease-out, rise and fade                         | No driver                                             | Not yet (L3)                                                                               |
| Opacity                 | `dimmedOpacity` 0.4                                            | None                                                  | A constant is enough.                                                                      |
| Text scale cap          | 2x (owner, 2026-10-31)                                         | `FONT_SCALE_CAP = 0` on tree B                        | No (H6)                                                                                    |

## Not checked

- Any device or screenshot. Each finding marked I needs one. Check React Native's `lineHeight` scaling first (Part 3).
- The Tamagui v3 Sheet, Dialog and Popover source. Part 2 relies on their documented parts and on the general Portal
  model, not on their code.
- The 25 per-page canvases from `designArtifact`, and the tablet boards (834 and 1194). I read only the CSS of the phone
  boards.
- Each of the 54 `StyleSheet` primitives against its board. I sampled `Button`, `SegmentedControl`, `RecipeCover`,
  `ChromeSurface`, `CondensedTitleBar`, `Sheet` and the badge.
- `tamaguiTesting.native.tsx` (tree B), beyond its use of the provider.
