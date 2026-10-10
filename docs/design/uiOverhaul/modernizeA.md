# Modernising Commise without making it loud (designer A)

⛔ **DESIGN ADVICE AND SPEC. NOT PRODUCTION CODE.** The owner said: "I like the color palette we have, mostly, but
our app feels… dated. I like Liquid Glass effect too." This file says what reads as dated, what to change, what
Liquid Glass is per Apple, how to bring it to our three platforms honestly, and exactly where it goes.

- **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`, designer A. I did not read the other designer's answer.
- **State checked:** commits `2c801c190` (slice 0) and `87c7b206c` (slice 1) on this branch, the captures in
  `.local-sandbox/uiAudit2026-10-08/`, and the current source.
- **Not user evidence.** Nothing here was tested with users. Sources were fetched today. Judgement is labelled.

## The short answer

1. **"Dated" is mostly not the palette.** It is glass in the wrong layer (on content cards), boxes on boxes, pills on
   everything, small serif type and dead grey placeholders. Slice 1 removed some of it. The rest is listed in §1.
2. **Keep the palette.** One optional tweak: give the cool blue-grey neutrals the brand's teal hue, at the same
   lightness, so contrast does not change (§2).
3. **Use glass the way Apple now says to:** only on the floating layer of navigation and controls, never on content.
   On our app that is the tab bar, the condensed title bar, the floating "New recipe" button, the editor's action bar,
   menus, and the hero's back and ⋯ buttons. Not cards, forms, rows, dialogs or the snackbar (§5).
4. **Per platform:** real Liquid Glass on iOS 26 through `expo-glass-effect`. Material's opaque tonal surfaces on
   Android, with no fake blur. On web, a high-opacity frosted material on at most two surfaces, legible even with no
   accessibility setting (§4).
5. **The quiet modern moves that do most of the work:** flat content with floating controls, concentric corners,
   Inter's display cut for large sans, a few spring motions, and scroll-edge fades instead of hairlines (§6).

---

## 1. What reads as dated today

| #   | What                                                                                                                                                                                                                                                                                                                         | Evidence                                                                                                                                                                            | Still present after slices 0–1?                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | **Glass on content cards.** Every recipe card and every Home placeholder is a frosted pane over the canvas. The frosted-card look peaked as "glassmorphism" around 2020–21 (judgement). Apple now says outright: "Don't use Liquid Glass in the content layer" (HIG Materials, fetched today).                               | `features/recipes/src/card/RecipeCard.tsx:29` imports `glass`/`toWebGlass` for the card fill. `web/src/components/home/skeletons/PlaceholderWidgetCard.tsx:74` renders `GlassCard`. | **Yes.**                                                                        |
| 2   | **A permanent 56–64 px glass band** across the top of every page holding a second copy of the title.                                                                                                                                                                                                                         | Every capture, all widths (`home/*`, `recipesLibrary/*`).                                                                                                                           | Yes. The build spec replaces it with the large title that condenses into a bar. |
| 3   | **Boxes inside boxes.** Gradient cards on a gradient canvas: the greeting card, the glass H1 card on Recipes, the tinted title card on detail.                                                                                                                                                                               | `home/390.png`, `recipesLibrary/390.png`, `recipeDetail/390.png`                                                                                                                    | **Fixed** in slice 1 ("the second gradient boxes … are removed").               |
| 4   | **Pills on everything**, and coral outline pills: Back, More, Prev, Save, Clone.                                                                                                                                                                                                                                             | `recipeDetail/390.png` (Back, More), `recipeEditStep2/390.png` (Prev, Save), step 2's pill inputs                                                                                   | Decided (coral off controls, inputs are rectangles). Not yet built.             |
| 5   | **Playfair at small sizes and in numbers.** Old-style figures make "300 min" and "330 min" hard to read in the stats card. Playfair card titles at 18 px read as a 2010s editorial template (judgement).                                                                                                                     | `recipeDetail/390.png` stats card, card titles in `recipesLibrary/*`                                                                                                                | Partly. Type roles exist (slice 1). The screens adopt them in later slices.     |
| 6   | **Dead grey.** `pearl` `#F5F5F5` skeleton blocks on the Home placeholders, and grey image boxes with a broken-image glyph. A chroma-0 grey on warm sand reads as "not loaded".                                                                                                                                               | `home/390.png`, `home/1280.png`                                                                                                                                                     | Yes. `RecipeCover` and static placeholders are decided, not built.              |
| 7   | **Tag clouds.** Tags stacked one per line as pale pills make cards 230–490 px tall in one row.                                                                                                                                                                                                                               | `home/768.png`, `home/1280.png`                                                                                                                                                     | Yes. Decided (tags as text), not built.                                         |
| 8   | **Hairlines that do nothing.** Borders at 1.19:1 so fields and chips vanish, then hard dividers elsewhere.                                                                                                                                                                                                                   | First audit E11                                                                                                                                                                     | Partly. `pewter` exists (slice 1).                                              |
| 9   | **Heavy Android shadows.**                                                                                                                                                                                                                                                                                                   | Pixel 6 library capture                                                                                                                                                             | **Fixed** in slice 1 (elevation by level).                                      |
| 10  | **Cool blue-grey neutrals against warm sand.** Computed in OKLCH today: sand's hue is 78° (warm). `charcoal`, `slate`, `pewter` and `mist` sit at 217–225° (blue). `pearl` has no hue at all. The brand teal is at 187–188°. So the greys belong to neither the paper nor the brand (judgement on the effect, computed hue). | `ui/src/tokens/colors.ts` values                                                                                                                                                    | Yes. §2 offers a fix.                                                           |
| 11  | **`userInterfaceStyle: "automatic"`** in `mobile/app.json` while the app has no dark design. On a phone set to dark, the system keyboard, alerts and any system glass turn dark around a light app.                                                                                                                          | `mobile/app.json:9`                                                                                                                                                                 | Yes. See §4.1.                                                                  |

## 2. Palette: keep its character

The palette's character is sand paper, charcoal ink, one teal, and a coral warmth. **Keep all of that.** Coral stays
off controls (owner decision). No new hues.

**One optional tweak: re-hue the neutrals to the brand teal (190°), same lightness, very low chroma.** This is a
value change, not a meaning change (`visual-design.md`: changing a token's value is safe, and changing its semantics
is a migration). The contrast pairs move by at most 0.01 (computed today):

| Token      | Today                     | Proposed  | On white          | On sand |
| ---------- | ------------------------- | --------- | ----------------- | ------- |
| `charcoal` | `#2D3436` (12.68 / 11.78) | `#2C3534` | 12.61             | 11.71   |
| `slate`    | `#636E72` (5.24 / 4.87)   | `#626F6E` | 5.23              | 4.85    |
| `pewter`   | `#858F93` (3.31 / 3.07)   | `#84908F` | 3.30              | 3.06    |
| `mist`     | `#B2BEC3`                 | `#B2BFBE` | 1.89 (decorative) | 1.76    |
| `pearl`    | `#F5F5F5` (no hue)        | `#EFF5F4` | 1.10              | 1.02    |

- Why: the greys then share the brand's hue, so the whole interface reads as one family. That is the effect Material
  3's tonal palettes and Apple's tinted system greys aim for (judgement, not a study).
- Cost: five values, the slice 1 contrast tests updated with the new figures, and every pair still passes.
- ⚠️ Owner call: the owner likes the palette "mostly". This changes no visible hue except the greys. If the owner
  declines, nothing else in this file depends on it.

**Deliberately not proposed:** a brighter or more saturated teal, gradients on buttons beyond the existing brand
ramp, a second accent, or a dark theme in this pass. Dark mode is a second design (`visual-systems.md`). The
re-hued neutrals make it easier later.

## 3. Liquid Glass, per Apple

**What it is.** From the HIG, _Materials_ (fetched today):

- "Liquid Glass forms a distinct functional layer for controls and navigation elements — like tab bars and sidebars
  — that floats above the content layer, establishing a clear visual hierarchy between functional elements and
  content."
- "**Don't use Liquid Glass in the content layer.** … including it in the content layer can result in unnecessary
  complexity and a confusing visual hierarchy." The one exception is a transient control, which "takes on a Liquid
  Glass appearance to emphasize its interactivity when a person activates it".
- "**Use Liquid Glass effects sparingly.** … overusing this material in multiple custom controls can provide a
  subpar user experience."
- Two variants. **Regular** "blurs and adjusts the luminosity of background content to maintain legibility". "Most
  system components use this variant." **Clear**: "Only use clear Liquid Glass for components that appear over
  visually rich backgrounds."

From WWDC25 _Meet Liquid Glass_ (session 219, transcript fetched today):

- "It is best reserved for the navigation layer that floats above the content of your app."
- "Always avoid glass on glass. Stacking Liquid Glass elements on top of each other can quickly make the interface
  feel cluttered and confusing."
- Clear only when three conditions hold: it sits on media-rich content, a dimming layer will not hurt the content,
  and the content on top of the glass is bold and bright.
- Tinting: "Use tinting selectively to highlight primary elements and actions. Avoid tinting all elements." "If you
  want to imbue color into your app, do it in the content layer instead."
- Scroll edge effects "work in concert with Liquid Glass to maintain that crucial separation between the UI and
  content layers".

From WWDC25 _Get to know the new design system_ (session 356, fetched today):

- "Scroll edge effects … replace hard dividers with subtle blur." "Apply one scroll edge effect per view."
- "Remove background colors from custom toolbars and tab bars."
- Sheets: "pair Liquid Glass with a dimming layer". As a sheet is dragged up, the glass "becomes more opaque".
- Shapes are concentric: "concentric shapes calculate their radius by subtracting padding from the parent's", and
  large controls use capsules.

**Accessibility settings** (session 219): "Reduced Transparency makes Liquid Glass frostier and obscures more of the
content behind it. Increased contrast makes elements predominantly black or white and highlights them with a
contrasting border, and Reduced Motion decreases the intensity of some effects and disables any elastic properties
for the material." These "are automatically applied when system-level settings are enabled" for the system
material.

**Legibility risks, for us.**

- A translucent surface has no fixed contrast. Its text contrast depends on what scrolls under it, and a WCAG 2.x
  ratio is a fixed pair.
- Our rule: **text and icons on any glass surface must pass 4.5:1 (text) and 3:1 (icons) against the surface's
  opaque fallback colour AND against the surface composited over pure black and pure white.** Apple's regular glass
  adapts its tint to keep legibility. Our web material does not adapt, so it must be opaque enough to pass in the
  worst case.
- Busy food photos are the worst case. That is why recipe content never sits under glass that carries text, except
  the hero's two icon buttons, which sit on their own discs.

## 4. Bringing it to our stack honestly

### 4.1 iOS 26 (Expo 57, React Native 0.86.3)

- **Facts checked today:**
    - `expo-glass-effect` `57.0.4` is published with the `sdk-57` tag. Expo's docs: iOS 26+ only. It "falls back to
      regular `View` on unsupported versions". Android and web are not supported and render a plain `View`.
    - It offers `GlassView` (`glassEffectStyle`: `'regular' | 'clear' | 'none'`, `tintColor`, `isInteractive`,
      `colorScheme`) and `GlassContainer` (merges nearby glass).
    - It also offers `isGlassEffectAPIAvailable()`, because "some iOS 26 beta versions do not have this API
      available, which can lead to crashes".
    - Known limit: setting `opacity` to 0 breaks the effect. Use `glassEffectStyle`'s `animate` instead.
- **System components get Liquid Glass for free when built with the iOS 26 SDK.** Apple's
  `UIDesignRequiresCompatibility` key opts out, temporarily. It is ignored from iOS 27. So our system keyboard,
  alerts, pickers and share sheets will be glass whatever we do.
- **Our tab bar and headers are custom React Native views** (the hand-rolled `AppRoot` stack, no navigation library
  in `mobile/package.json`). They will **not** pick up Liquid Glass by themselves.
- **Plan:**
    1. Add `expo-glass-effect`. Build a `@commise/ui` `ChromeSurface` primitive (native leaf) that renders
       `GlassView glassEffectStyle="regular"` when `isGlassEffectAPIAvailable()`. Below iOS 26 it falls back to the
       existing `expo-blur` path (`ui/src/surface/GlassCard.native.tsx`). With
       `AccessibilityInfo.isReduceTransparencyEnabled()` on, the fallback is the solid `paper` surface.
    2. Set `colorScheme="light"` on every `GlassView`, and change `mobile/app.json` `userInterfaceStyle` to `"light"`
       until dark mode is designed. Otherwise system glass and keyboards go dark around a light app.
    3. **For `staff-architect`:** moving to native tab and stack containers (for example `react-native-screens`' native
       bottom tabs) would give the genuine system tab bar, with its scroll minimise and morphing, and the edge-swipe
       back that slice 2 needs anyway. That is an architecture decision, not a styling one.
- **Motion note:** `mobile/package.json` has no Reanimated. Springs on native use React Native's own
  `Animated.spring` (stiffness and damping), or a dependency decision. The glass's own elastic motion is the
  system's, and it obeys Reduce Motion by itself.

### 4.2 Android (Material 3 / Material 3 Expressive)

- Google announced Material 3 Expressive on 13 May 2025 (Android Developers Blog and press coverage, found today).
  Its expressiveness is **motion (springs), shape and colour**, not translucency. Material has no glass material
  (recall of Material 3 guidance, not re-fetched).
- Our own code already records that `expo-blur` on Android defaults to `blurMethod: 'none'`
  (`ui/src/surface/blurSupport.native.ts`), so a "glass" bar on Android today is just a translucent box.
- **The right equivalent:** Material's **tonal surfaces**.
    - Bars are an opaque `paper` surface at elevation level 2.
    - The condensed title bar fills in with that surface only after content scrolls under it. That is Material's
      top-app-bar "scrolled" state (recall, not re-fetched).
    - No blur, no translucency. On Android the freshness comes from the spring on the FAB's extend/shrink, the
      check-toggle overshoot, and concentric corners.
- This is translation, not porting (`cross-platform-translation.md`): the job (a floating layer that reads as above
  the content) is the same, and the means are each platform's own.

### 4.3 Web

- **Support** (MDN browser-compat-data, read today):
    - `backdrop-filter`: Chrome 76, Firefox 103, and Safari 18 unprefixed (`-webkit-` since 9).
    - `prefers-reduced-transparency`: Chrome 118+, **not in Safari at all**, and behind a flag in Firefox.
    - So an iPhone Safari user who turns on Reduce Transparency gets **no** signal on web.
    - **Therefore the web material must be legible with no setting at all.**
- **The web material** (`ChromeSurface` web leaf):
    - `paper` at **94%** opacity, `backdrop-filter: blur(16px) saturate(140%)`, and a 1 px inner highlight at white
      60%.
    - It falls back to solid `paper` where `backdrop-filter` is unsupported, and under
      `prefers-reduced-transparency: reduce` or `prefers-contrast: more`.
    - **Why 94%, computed today** (paper composited over pure black, the worst case):
        - At 88% the surface is `#E0E0E0`. `charcoal` passes (9.61:1), but `slate` fails (3.97:1). Inactive tab labels
          are `slate`, so 88% is not enough.
        - At 94% (`#F0F0F0`): `slate` 4.60:1, `ocean-dark` 5.44:1, `charcoal` passes easily. 94% is the floor.
        - `pewter` drops to 2.90:1 over that worst case. So no control on glass relies on a `pewter` boundary. Glass
          controls are icons with labels, or filled buttons.
    - The slice's contrast test computes these pairs against both the black and the white worst case.
    - On iOS 26 the system glass adapts its own tint for legibility, so this floor binds the web and the `expo-blur`
      fallback only.
- **Performance** (engineering judgement, with an anecdotal report):
    - Every `backdrop-filter` element is its own compositing pass over what is behind it.
    - One app's release notes report blank screens on iOS and Android from `backdrop-filter` on many items inside a
      scroll container, fixed by disabling it there (newreleases.io, yuvomi v0.52.26, found today).
    - Rules:
        - **At most two blurred surfaces on screen at once.**
        - **Never on a repeated item** (cards, rows, chips).
        - **Never inside a scroll container.** Only on fixed or sticky chrome outside it.
- **When translucency is acceptable on web:** only when content actually scrolls beneath the surface, and the
  surface carries few, bold controls. **Harmful:** on anything that does not move over content (the sidebar over a
  static canvas is just a grey tint), on text-heavy panels, and on low-contrast busy backgrounds.
- **Measure:** EVALUATE runs a Chrome performance trace on a low-end Android phone (a Moto G class device) on Home
  and Discover. Any dropped-frame regression versus the solid fallback switches web compact to solid.

## 5. Exactly where glass goes

**Rule:** glass marks the floating layer of navigation and controls, over content that moves beneath it. One glass
layer at a time (no glass on glass). Tint only the primary action.

| Element                                                      | Glass?                                                                             | iOS 26                                                            | Android                               | Web                                                                                             | Why                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Bottom tab bar** (phones, tablets)                         | **Yes**                                                                            | `GlassView` regular. No background colour (session 356).          | opaque `paper`, level 2, top hairline | material, ≤ 2 rule                                                                              | the canonical case in Apple's HIG                                          |
| **Condensed title bar** (after the large title scrolls away) | **Yes, only once condensed.** Transparent at the top of the page.                  | regular, animated in via `glassEffectStyle.animate` (not opacity) | `paper` fills in on scroll            | material, with a scroll-edge fade under it, not a hairline                                      | content scrolls under it. One scroll-edge effect per view.                 |
| **Editor section bar or strip, recipe `SectionSwitch`**      | **Merged into the bar above as one glass surface**                                 | one `GlassView` holding bar + strip                               | one `paper` surface                   | one material surface                                                                            | stacking two glass bars is glass on glass                                  |
| **Floating "New recipe" button**                             | **Yes, tinted seafoam**, the only tinted glass                                     | `GlassView` regular + `tintColor` seafoam, `isInteractive`        | solid `seafoam` FAB (Material FAB)    | solid seafoam. A blurred FAB over a grid is a third surface.                                    | WWDC: tint "selectively to highlight primary elements and actions"         |
| **Editor action bar** (Save draft / Publish)                 | **Yes**                                                                            | regular. Publish stays a solid seafoam button inside it.          | `paper`, level 2                      | material                                                                                        | a control layer over a scrolling form                                      |
| **Menus and action sheets** (⋯, create chooser, sort)        | **Yes**                                                                            | regular + a dimming layer                                         | Material menu / bottom sheet, opaque  | opaque `paper` popover (it overlaps content briefly, and a third blur would break the ≤ 2 rule) | transient controls. Sheets get "a dimming layer" (session 356).            |
| **Hero back and ⋯ buttons over the recipe photo**            | **Yes, the regular variant**                                                       | `GlassView` regular discs, 44 pt                                  | white 92% discs                       | white 92% discs                                                                                 | over media. Regular, not clear, because user photos can be any brightness. |
| Desktop sidebar                                              | **No blur.** A flat `paper` panel at 70% over the wash, with no `backdrop-filter`. | n/a                                                               | n/a                                   | flat tint                                                                                       | nothing scrolls under it, so a blur shows nothing and costs a pass         |
| `SectionIndex` rail (≥ 960)                                  | No                                                                                 | n/a                                                               | n/a                                   | flat                                                                                            | sits beside content, not over it                                           |
| Recipe cards, Home placeholders                              | **No. Remove today's glass.**                                                      | opaque `paper` card, level 1                                      | the same                              | the same                                                                                        | the content layer (HIG)                                                    |
| Forms, ingredient rows, row-editor sheet, steps              | **No**                                                                             | opaque                                                            | opaque                                | opaque                                                                                          | content and input. Legibility first.                                       |
| Dialogs (delete, discard)                                    | No                                                                                 | opaque + dimming                                                  | opaque                                | opaque                                                                                          | content you must read before acting                                        |
| Snackbar (undo)                                              | No                                                                                 | solid `charcoal`                                                  | solid                                 | solid                                                                                           | a message must read at a glance over any content                           |
| Sign-in, 404, empty states                                   | No                                                                                 |                                                                   |                                       |                                                                                                 | content                                                                    |
| Text-bearing chips over photos (time, PRO, status)           | No                                                                                 | solid `paper` 92%                                                 | the same                              | the same                                                                                        | text on a photo needs a guaranteed contrast strategy (`visual-systems.md`) |

**Accessibility contract for every glass surface:**

- **Reduce Transparency** (iOS system setting; web `prefers-reduced-transparency` where supported): solid `paper`.
  On iOS 26 the system does this for `GlassView`. Our fallback paths check
  `AccessibilityInfo.isReduceTransparencyEnabled()` and the media query.
- **Increase Contrast** (iOS system setting; web `prefers-contrast: more`): solid `paper` plus a 1 px `charcoal`
  border. The system does this for `GlassView`.
- **Reduce Motion:** no elastic or morph motion of ours. The system handles its own glass.
- **WCAG 2.2:**
    - 1.4.3 and 1.4.11 are computed against the fallback colour and the worst case (§3).
    - 2.4.11 Focus Not Obscured: a translucent bar still obscures, so the `scroll-padding` rules in `editorNavA.md`
      apply unchanged.

## 6. Current without chasing fads: type, space, shape, motion, depth, icons

| Area         | Choice                                                                                                                                                                                                                                                                   | Source or principle                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Depth**    | **Flat content, floating controls.** Cards lose their glass and keep only a 1 px edge and `shadow-sm`. Shadows `md` and up are reserved for the floating layer (bars, FAB, menus). That contrast is what makes the glass read as a layer at all.                         | HIG: Liquid Glass "floats above the content layer". `visual-systems.md`: map each elevation level to one meaning.                                                          |
| **Shape**    | **Concentric corners.** Inner radius = outer radius − padding. A 12 px card with 12 px padding holds 0–4 px inner elements, and a flush image takes the card's 12. Pills only for pressable controls (owner decision). Sheets 28 at the top.                             | WWDC25 session 356: "concentric shapes calculate their radius by subtracting padding from the parent's".                                                                   |
| **Type**     | Playfair only at 24 px and up (large title, recipe title). Inter for everything else, with **Inter Display** (Inter 4's `opsz` display designs) for sans at 20 px and up, so large Inter is tighter and crisper. Tabular figures (decided). Bold, left-aligned headings. | Inter 4.0 release notes (2023-11-20): "Six additional 'Display' designs, assigned to an `opsz` variable-font axis". Session 356: typography "now bolder and left-aligned". |
| **Space**    | Keep the 4 px scale. Increase section spacing to 40 px at `@wide` (from 32). Generous space is the cheapest "premium" signal and costs nothing (judgement).                                                                                                              | `visual-design.md`: inconsistent spacing reads as "cheap".                                                                                                                 |
| **Dividers** | Replace hard hairlines under bars with a scroll-edge fade (a 12 px gradient mask on web, the system effect on iOS 26). Keep hairlines only between list rows.                                                                                                            | Session 356: scroll edge effects "replace hard dividers".                                                                                                                  |
| **Motion**   | Springs, critically damped, on four moments only: sheet in/out, the FAB extend/shrink, the bar condensing, and the one signature check overshoot. 150–250 ms equivalents on web. No parallax, no scroll-linked decoration.                                               | `interaction-motion.md`. Owner decision: one signature motion.                                                                                                             |
| **Icons**    | Lucide 1.75 px (decided). Filled glyph only for the active tab. No SF Symbols on iOS: one icon set on both platforms keeps parity.                                                                                                                                       | `visual-systems.md`: one grid, one stroke.                                                                                                                                 |
| **Imagery**  | Photos do the colour work: full-bleed hero on phones, 4:3 card covers, `RecipeCover` tints where there is no photo.                                                                                                                                                      | WWDC: put colour "in the content layer".                                                                                                                                   |

**Things I advise against, because they date quickly (judgement):** neumorphism, glass on cards, gradient text,
oversized bento grids on a phone, auto-playing motion, and coloured glass tints on several controls at once.

## 7. Against `ownerDecisions.md`

| Decision                                                                                   | Holds?                                                                                                                                                                                                   | Note                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The canvas wash stays (issue #145)                                                         | **Yes.**                                                                                                                                                                                                 | It helps. Glass needs something with colour and light beneath it to read as glass, and a flat white page makes glass look like grey plastic (judgement). The wash is subtle enough not to hurt legibility under the regular variant. |
| Coral off controls                                                                         | **Yes.**                                                                                                                                                                                                 | It also stays out of glass tints. The single tint is seafoam, on the primary action only.                                                                                                                                            |
| One signature motion (the check overshoot)                                                 | **Yes, with one clarification to record:** iOS 26's own glass morphing and elastic motion are the **system's**, not ours, and do not count against the budget. They respect Reduce Motion by themselves. |
| A selected chip uses a tint with a check, inputs are rectangles, pills only for pressables | **Yes.**                                                                                                                                                                                                 | These are the "current" shape language already.                                                                                                                                                                                      |
| D5 (sidebar at 840) and D6 (iPad keeps the tab bar)                                        | **Yes.**                                                                                                                                                                                                 | On iPad the tab bar becomes a glass bar on iOS 26, which is the platform's own look.                                                                                                                                                 |

**Nothing in `ownerDecisions.md` needs to change.** Two new owner calls arise:

- **M1:** re-hue the neutrals (§2). I recommend yes.
- **M2:** set `userInterfaceStyle` to `"light"` until dark mode is designed (§4.1). I recommend yes. It is a defect
  fix more than a taste call.

## 8. Build order

1. **Remove glass from the content layer** (cards, Home placeholders). The fastest visible win. Slice 3 (cards)
   already touches these files.
2. **`ChromeSurface` primitive** (web material, iOS 26 `GlassView` with fallbacks, Android tonal), with its
   accessibility switches and contrast tests. Then apply it to the tab bar, the condensed bar (with the merged section
   strip), the editor action bar, the FAB tint, menus and the hero buttons, slice by slice.
3. **Optional palette re-hue** (M1) and `userInterfaceStyle` (M2): one small change each.
4. **Concentric radii, Inter Display, scroll-edge fades:** in the token and primitive slices.
5. **EVALUATE:** on iOS 26 with Reduce Transparency, Increase Contrast and Reduce Motion each on; on a low-end
   Android phone for frame rate; and web at 320–1920 against the worst-case contrast rule.

## References (fetched 2026-10-08 unless marked)

- Apple HIG, [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) (via its JSON
  endpoint)
- Apple WWDC25, [Meet Liquid Glass (219)](https://developer.apple.com/videos/play/wwdc2025/219/) and
  [Get to know the new design system (356)](https://developer.apple.com/videos/play/wwdc2025/356/)
- Apple, [UIDesignRequiresCompatibility](https://developer.apple.com/documentation/bundleresources/information-property-list/uidesignrequirescompatibility)
- Expo, [GlassEffect docs](https://docs.expo.dev/versions/latest/sdk/glass-effect/). npm `expo-glass-effect`
  dist-tags (`sdk-57`: 57.0.4).
- React Native, [AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo) (`isReduceTransparencyEnabled`)
- MDN, [backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter) and
  [prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency),
  plus `mdn/browser-compat-data`
- Android Developers Blog, [Material 3 Expressive for Wear OS](https://android-developers.googleblog.com/2025/08/introducing-material-3-expressive-for-wear-os.html),
  and [Gigazine on the 13 May 2025 announcement](https://gigazine.net/gsc_news/en/20250514-android-16-wear-6-material-3-expressive)
  (secondary)
- [Inter 4.0 release notes](https://github.com/rsms/inter/releases/tag/v4.0)
- [yuvomi v0.52.26 release notes](https://newreleases.io/project/github/ulsklyc/yuvomi/release/v0.52.26) (anecdotal,
  `backdrop-filter` in scroll containers)
- Repo: `ownerDecisions.md`, `buildSpec.md`, commits `2c801c190` and `87c7b206c`,
  `ui/src/tokens/{colors,gradients}.ts`, `ui/src/surface/*`, `RecipeCard.tsx`, `PlaceholderWidgetCard.tsx`,
  `mobile/app.json`, `mobile/package.json`, and the captures.
- Corpus: `visual-design.md`, `visual-systems.md`, `interaction-motion.md`, `cross-platform-translation.md`.

## Artefacts written

- `docs/design/uiOverhaul/modernizeA.md` (design advice). Nothing else.
