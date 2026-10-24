# Two-theme colour spec: light (warm greys) and dark

⛔ **DESIGN SPECIFICATION. NOT PRODUCTION CODE.** It gives a value in both themes for every colour role in
`packages/apps/commise/ui/src/tokens/colors.ts` (`role`), every tone in `tokens/tones.ts`, and every surface the
overhaul uses. It also says how the theme is chosen, emitted and consumed. It applies `ownerDecisions.md` D11
(warm greys), D12 (glass on the control layer only) and D15 (dark mode inside the overhaul).

- **Date:** 2026-10-08. **Agent:** `staff-ux-engineer` (SPECIFY). **Floor:** WCAG 2.2 AA: 4.5:1 text, 3:1 large
  text and non-text (SC 1.4.3, 1.4.11).
- **Every ratio below was computed today with `culori` (`wcagContrast`, the repo's `node_modules/culori`).** Alpha
  fills are composited over the surface named. Dark values were built in OKLCH: warm neutrals at hue 70°, the hue of
  `sand`, and brand teal at 188°.
- **Result: every pair passes in both themes.** The warm-grey change made one light pair fail: `attention` on
  linen, 4.41:1. Re-measuring also confirmed two light gaps already recorded in the code: `attention` on
  `attentionTint` over sand (4.24:1) and the Medium difficulty badge on sand (4.34:1). **All three are closed by one
  value change:** `warning-dark` becomes `#8C5A00` (§1, row `attention`).

---

## 1. The role table (light and dark)

New roles are marked **NEW**. Each is an addition (A19 expand-contract). No existing key changes meaning.

| Role                                                       | Job                                                                       | Light                                        | Dark                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| `canvas`                                                   | the page (under the wash)                                                 | `#FAF6F0` sand                               | `#141210`                                        |
| `paper`                                                    | cards, inputs, level 1                                                    | `#FFFFFF`                                    | `#1E1B18`                                        |
| `paperRaised` **NEW**                                      | sticky bars, level 2 (tab bar, action bar, condensed title, section bars) | `#FFFFFF`                                    | `#272320`                                        |
| `paperOverlay` **NEW**                                     | menus, sheets, dialogs, level 3                                           | `#FFFFFF`                                    | `#302C28`                                        |
| `surfaceMuted` **NEW** (replaces `palette.pearl` in tones) | status badges, quiet fills                                                | `#F3EEE6` linen (D11)                        | `#2B2825`                                        |
| `ink`                                                      | text and icons                                                            | `#2D3436` charcoal                           | `#EDE9E4`                                        |
| `inkMuted`                                                 | secondary text, inactive tabs                                             | `#6B645C` stone (D11, was `#636E72`)         | `#B6B0A9`                                        |
| `lineControl`                                              | input, chip, checkbox and secondary-button edges                          | `#8A847C` taupe (D11, was `#858F93`)         | `#857F79`                                        |
| `lineDivider`                                              | hairlines, decorative only                                                | `#C9C1B6` (D11, was `#B2BEC3`)               | `#3B3734`                                        |
| `action`                                                   | the one primary fill (white label), the FAB                               | `#31807A`                                    | `#31807A` (unchanged)                            |
| `actionText`                                               | text buttons, links, selected labels                                      | `#2A6B65`                                    | `#7DC7C0`                                        |
| `selectedFill`                                             | selected chip and segment fill                                            | `#E2EDEC` (14% seafoam on white)             | `#243935` (30% seafoam on dark `paper`)          |
| `selectedEdge`                                             | selected chip edge                                                        | `#31807A`                                    | `#65B5AE`                                        |
| `hereBar`                                                  | the "you are here" bar (tabs, nav, current section)                       | `#31807A`                                    | `#65B5AE`                                        |
| `focusRing`                                                | 2 px ring, 2 px offset                                                    | `#2A6B65`                                    | `#7DC7C0`                                        |
| `rating`                                                   | filled stars, never text                                                  | `#A86A12` honey                              | `#EAA950`                                        |
| `attention`                                                | caution text ("Choose a match")                                           | **`#8C5A00`** (was `#966400`, closes 3 gaps) | `#EFBA64`                                        |
| `attentionTint`                                            | caution fill, `ink` label                                                 | `rgba(245,176,65,0.2)`                       | `rgba(245,176,65,0.2)` (same alpha)              |
| `danger`                                                   | destructive fill (white label), confirm dialogs only                      | `#C05238`                                    | `#C05238` (unchanged)                            |
| `dangerText`                                               | error and destructive text                                                | `#B1442B`                                    | `#EC8E76`                                        |
| `inverse` **NEW**                                          | snackbar surface                                                          | `#2D3436`                                    | `#EDE9E4`                                        |
| `inverseInk` **NEW**                                       | snackbar text                                                             | `#FFFFFF`                                    | `#2D3436`                                        |
| `inverseAction` **NEW**                                    | snackbar "Undo"                                                           | `#5BA8A0`                                    | `#2A6B65`                                        |
| `photoChip` **NEW**                                        | solid chips and discs on photos (time, PRO, status, back, ⋯)              | `paper` at 92%                               | `paperOverlay` at 92%                            |
| `scrim` **NEW**                                            | modal dimming                                                             | `#2D3436` at 40%                             | `#000000` at 60%                                 |
| `heroScrim` (existing `gradient.scrim`)                    | bottom fade on the hero photo                                             | charcoal 60% → 0                             | unchanged (the photo is the same in both themes) |
| `disabled` (rule, not a colour)                            | disabled controls                                                         | content at 38% opacity                       | the same                                         |

**Disabled.** Disabled controls are exempt from SC 1.4.3 and 1.4.11 (`accessibility.md`). The 38% opacity is
Material's convention (recalled, not re-fetched). A disabled control always has a reason on attempt
(`interaction-motion.md`).

**Pressed and hover** keep their light-theme rule in both themes: `action` → `#2A6B65` on press (white 6.20:1).
Hover is a `selectedFill`-strength wash of `ink` at 6% on a fine pointer.

## 2. Tones (`tokens/tones.ts`)

| Tone                   | Light fill → label                                   | Light ratio (over paper / over canvas)                  | Dark fill → label            | Dark ratio (over paper / over canvas) |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------- | ---------------------------- | ------------------------------------- |
| Easy                   | `success` 15% → `actionText`                         | 5.40 / 5.05                                             | `success` 18% → `actionText` | 6.57 / 7.35                           |
| Medium                 | `warning` 15% → `attention`                          | **5.35 / 5.00** (was 4.65 / 4.34, now passes on canvas) | `warning` 18% → `attention`  | 6.60 / 7.41                           |
| Hard                   | `coral` 15% → `ink`                                  | 11.28 / 10.53                                           | `coral` 18% → `ink`          | 10.30 / 11.42                         |
| Draft, Private, Public | `surfaceMuted` → `ink`                               | 10.98                                                   | `surfaceMuted` → `ink`       | 12.13                                 |
| Premium (PRO)          | `premium` `#D4A574` → `#2D3436` (fixed, both themes) | 5.70                                                    | the same                     | 5.70                                  |

The ⚠️ note in `tones.ts` ("Medium measures 4.37:1 over the sand canvas") and the ⚠️ note on `attentionTint` in
`colors.ts` can be deleted once `attention` is `#8C5A00`. Their test pins move with it.

## 3. Contrast, every text and control pair

### 3.1 Text roles on every surface (ratio, minimum 4.5 for text, 3 for edges and graphics)

| Pair                             | canvas L | paper L | linen L | canvas D | paper D | raised D | overlay D | muted D |
| -------------------------------- | -------- | ------- | ------- | -------- | ------- | -------- | --------- | ------- |
| `ink`                            | 11.78    | 12.68   | 10.98   | 15.46    | 14.18   | 12.90    | 11.46     | 12.13   |
| `inkMuted`                       | 5.41     | 5.83    | 5.05    | 8.70     | 7.98    | 7.25     | 6.44      | 6.82    |
| `actionText`                     | 5.75     | 6.20    | 5.36    | 9.61     | 8.82    | 8.02     | 7.12      | 7.54    |
| `attention`                      | 5.45     | 5.87    | 5.08    | 10.57    | 9.69    | 8.81     | 7.83      | 8.29    |
| `dangerText`                     | 5.23     | 5.63    | 4.87    | 7.74     | 7.10    | 6.45     | 5.73      | 6.07    |
| `lineControl` (≥ 3)              | 3.44     | 3.70    | 3.21    | 4.72     | 4.33    | 3.94     | 3.50      | 3.71    |
| `focusRing` (≥ 3)                | 5.75     | 6.20    | 5.36    | 9.61     | 8.82    | 8.02     | 7.12      | 7.54    |
| `rating` (≥ 3)                   | 4.12     | 4.43    | 3.84    | 9.16     | 8.40    | 7.64     | 6.78      | 7.18    |
| `hereBar` / `selectedEdge` (≥ 3) | 4.34     | 4.67    | 4.04    | 7.81     | 7.16    | n/a      | n/a       | n/a     |

(L = light, D = dark. In light, `paperRaised` and `paperOverlay` are white, so their column is the `paper` column.)

### 3.2 Fills and their labels

| Pair                                                                     | Light                         | Dark                                  |
| ------------------------------------------------------------------------ | ----------------------------- | ------------------------------------- |
| white on `action`                                                        | 4.67                          | 4.67                                  |
| `action` fill against `canvas` (FAB edge, ≥ 3)                           | 4.34                          | 4.00                                  |
| `action` fill against `paperRaised` (≥ 3)                                | 4.67                          | 3.34                                  |
| white on `danger`                                                        | 4.66                          | 4.66                                  |
| `actionText` on `selectedFill`                                           | 5.18                          | 6.31 (on `paper`), 6.89 (on `canvas`) |
| `ink` on `selectedFill`                                                  | 10.60                         | 10.15                                 |
| `ink` on `attentionTint` (over paper / canvas)                           | 11.19 / 10.54                 | 9.20 / 10.25                          |
| `attention` on `attentionTint` (over paper / canvas)                     | 5.18 / 4.88 (was 4.50 / 4.24) | 6.29 / 7.00                           |
| `dangerText` on `danger` tint (light 10%, dark 20%; over paper / canvas) | 4.95 / 4.62                   | 5.80 / 6.37                           |
| `inverseInk` on `inverse` (snackbar)                                     | 12.68                         | 10.49                                 |
| `inverseAction` on `inverse` (Undo)                                      | 4.56                          | 5.13                                  |

### 3.3 The canvas wash

`ownerDecisions.md` keeps the wash. The dark wash follows the same three-stop path (warm → green → blue), at the dark
canvas's lightness:

| Stop | Light (today) | Dark (new) |
| ---- | ------------- | ---------- |
| 0%   | `#FAF6F0`     | `#141210`  |
| 50%  | `#F0F7F4`     | `#101714`  |
| 100% | `#E8F4F8`     | `#0F181A`  |

Worst-case text on the wash, at its coolest stop:

- **Light** (`#E8F4F8`): `ink` 11.31 · `inkMuted` 5.20 · `actionText` 5.53 · `attention` 5.23 · `dangerText` 5.02 ·
  `lineControl` 3.30 · `rating` 3.95 · `hereBar` 4.16.
- **Dark** (`#0F181A`): `ink` 14.90 · `inkMuted` 8.38 · `actionText` 9.27 · `attention` 10.19 · `dangerText` 7.46 ·
  `lineControl` 4.55.

### 3.4 Glass and blur surfaces (web and the `expo-blur` fallback)

Rule from D12: each bar stays readable with the blur off. So each pair is measured against the bar composited over
the worst case: pure black and pure white beneath it.

| Surface                  | Value                                           | Pair (worst case)                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Light bar                | `paper` 92% + `blur(12px)` (build spec level 2) | over black (`#EBEBEB`): `ink` 10.64 · `inkMuted` 4.89 · `actionText` 5.20 · `attention` 4.92 · `dangerText` 4.72 · `hereBar` 3.92 · `lineControl` 3.11 · `rating` 3.72                                                                              |
| Dark bar                 | `paperRaised` 94% + `blur(12px)`                | over white (`#34302D`): `ink` 10.82 · `inkMuted` 6.08 · `actionText` 6.72 · `attention` 7.39 · `dangerText` 5.41 · `hereBar` 5.46 · `lineControl` 3.30. Over black (`#25211E`): `ink` 13.21 · `inkMuted` 7.43 · `actionText` 8.22 · `hereBar` 6.67. |
| `photoChip`, light       | `paper` 92%                                     | `ink` over a black photo 10.64 (text and icon)                                                                                                                                                                                                      |
| `photoChip`, dark        | `paperOverlay` 92%                              | `ink` over a white photo 8.91, over black 12.09                                                                                                                                                                                                     |
| Hero ‹ and ⋯ discs, dark | `paperOverlay` 90%                              | `ink` icon over white 8.37, over black 12.14                                                                                                                                                                                                        |

The light bar stays at 92%. With the warm stone grey, `inkMuted` passes at 92% (4.89). The 94% floor in
`modernizeA.md` was computed for the old slate.

- **iOS 26:** `GlassView` with `colorScheme="auto"`. Now that dark mode ships, `"auto"` replaces the `"light"` pin
  that `modernizeA.md` proposed. Keep `userInterfaceStyle: "automatic"` in `mobile/app.json`.
- **Android:** no blur. Bars are solid `paperRaised` (D12).

## 4. Elevation, imagery, covers

**Elevation in dark: surfaces get lighter as they rise, and shadows mostly go.**

- Apple HIG, _Dark Mode_ (fetched today): iOS uses "base" and "elevated" background colours. "The base colors are
  dimmer, making background interfaces appear to recede, and the elevated colors are brighter, making foreground
  interfaces appear to advance."
- Material 3 replaced its opacity-overlay model with tone-based "surface container" roles, from lowest to highest
  (material.io blog, "tone-based surface color", 23 Mar 2023, via search. The page did not render for me).
- `visual-systems.md`: "Shadows barely work on dark surfaces … Dark mode expresses elevation as surface lightness."

| Level     | Light                                      | Dark                                                                          |
| --------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| 0 canvas  | `canvas`, no shadow                        | `#141210`, no shadow                                                          |
| 1 card    | `paper` + `lineDivider` edge + `shadow-sm` | `#1E1B18` + `lineDivider` edge, **no shadow**                                 |
| 2 bar     | `paper` 92% + blur + `shadow-md`           | `#272320` 94% + blur, **no shadow**, `lineDivider` hairline on the inner edge |
| 3 overlay | `paper` + `shadow-lg` + `scrim`            | `#302C28` + a soft `rgba(0,0,0,0.5)` shadow-lg + `scrim` (`#000` 60%)         |

Each dark step is +0.035 to +0.04 OKLCH lightness. That is visible, and keeps `ink` ≥ 11.46:1 on the top level.

**Imagery.**

- **User photos are never filtered.** They are the content. Food must look the same in both themes.
- Illustrations (empty states, 404) ship a dark variant: lines in `ink`, fills in `paperRaised`. HIG: "If an asset
  looks good in only one mode, modify the asset or create separate light and dark assets."
- Logos or images with white grounds get a 1 px `lineDivider` edge in dark, so they do not glow. HIG: "Soften the
  color of white backgrounds."

**Typographic recipe covers (`RecipeCover`).** These are the same six hues, composited at 22% over dark `paper`, with
`ink` lettering:

| Tint    | Light (spec) | Light `ink` | Dark (22% over `#1E1B18`) | Dark `ink` |
| ------- | ------------ | ----------- | ------------------------- | ---------- |
| seafoam | `#E6F0EF`    | 10.91       | `#22312E`                 | 11.23      |
| coral   | `#FAE9E4`    | 10.77       | `#4A352E`                 | 9.44       |
| sky     | `#DFF0F8`    | 10.84       | `#374245`                 | 8.57       |
| premium | `#F6EBE0`    | 10.80       | `#46392C`                 | 9.23       |
| success | `#E2F2EA`    | 10.94       | `#283C2E`                 | 9.78       |
| warning | `#FDEFD9`    | 11.19       | `#4D3C21`                 | 8.76       |

**Hero scrim.** `gradient.scrim` (charcoal 60% → 0) is the same in both themes, because the photo beneath is the
same. It carries no text (build spec: text never sits on a photo except on `photoChip` discs). So no text contrast
pair applies to it.

## 5. How the theme is chosen

- **Follow the system setting.** Web: `prefers-color-scheme`. Native: `Appearance` / `useColorScheme()`. It updates
  live when the system changes.
- **Manual override: recommend NOT in this overhaul.** Apple HIG, _Dark Mode_ (fetched today): "Avoid offering an
  app-specific appearance setting". People "generally expect all apps … to respect their preference."
    - An override adds a persisted preference, a third state ("system") and a test matrix, for little gain.
    - It is a two-way door, and can come later.
    - **Owner's call.** If the owner wants one, put it on Profile › Preferences as "Appearance: System · Light ·
      Dark", default System.

## 6. How web emits it (`tokens/themeCss.ts`)

1. **Keep the roles in the `@theme` block, not `@theme inline`,** as `--color-{role}` with the light values. Tailwind
   v4 utilities such as `bg-paper` and `text-ink` then compile to `var(--color-paper)`, so overriding the variable
   re-themes every utility. This includes alpha modifiers (`bg-ink/6`), which Tailwind composes with `color-mix()`
   over the variable. `tailwindTheme.integration.test.ts` must prove one compiled utility reads the variable.
2. **Append a dark block after `@theme`**, generated from a `roleDark` record beside `role` in `colors.ts`:
    ```css
    @media (prefers-color-scheme: dark) {
        :root {
            --color-canvas: #141210;
            --color-paper: #1e1b18; /* …every role… */
        }
    }
    :root {
        color-scheme: light dark;
    }
    ```
    `color-scheme` makes native form controls, scrollbars and autofill follow the theme.
3. **The wash** gets the same treatment: `--gradient-hero` (or whatever property `globals.css` paints `body` with) has
   a dark value in the same media block.
4. **The glass edge variables** (`--color-glass-{tier}-edge`) get dark values in that block too: white 12% in dark
   instead of white 60%.
5. **One source.** `roleDark` is typed `Record<Role, string>`, so a role without a dark value is a compile error. A
   test asserts every pair in §3 from the two records, both themes.
6. **The guard (D15):** components use role utilities only. No palette-tier utilities (`bg-seafoam`, `text-slate`),
   no hex, no `dark:` variants. The media block is the only theme switch. `semantic` and `palette` stay for tokens and
   legacy readers and are not themed. Their consumers move to roles before the dark build ships.

## 7. How native consumes it

1. **`nativeTokens.roles = { light: role, dark: roleDark }`** in `tokens/native.ts`, from the same two records as
   web.
2. **`useTheme()`** (new, `@commise/ui`): reads `useColorScheme()` and returns `nativeTokens.roles[scheme]`, the
   scheme name, and the elevation surfaces. It is one hook, so a future override (§5) plugs in one place.
3. **No colour in a static `StyleSheet`.** `StyleSheet.create` runs once at import, so a colour there is baked to
   one theme.
    - Static sheets hold layout only (size, spacing, radius, type).
    - Colours come from `useTheme()`, applied as a style array (`[styles.card, { backgroundColor: t.paper }]`) or
      from a `makeStyles(theme)` memoised on the scheme.
    - The guard (D15): a test scans `*.native.tsx` and `StyleSheet.create` calls for colour keys (`color`,
      `backgroundColor`, `borderColor`, `shadowColor`, `tintColor`) whose value is not a theme read.
4. **System chrome:** status-bar style `auto`, Android navigation bar colour from `paperRaised`, `GlassView`
   `colorScheme="auto"`, and the keyboard follows the system.
5. **Elevation:** Android `elevation` levels stay (`sm` 1, `md` 2, `lg` 3). In dark, the surface colour per level
   (§4) does the work. Android's own dark shadows are near-invisible, which is the intended result.

## 8. Not in this file

- Chart colours (`chart` in `colors.ts`) need dark values when the nutrition charts ship.
- The cook view's `ink-deep` (`proposalB.md`) is superseded by the dark theme's `canvas`.

## References (fetched 2026-10-08 unless marked)

- Apple HIG, [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) (via its JSON
  endpoint)
- Material, [tone-based surface color](https://material.io/blog/tone-based-surface-color-m3) (via search, page not
  rendered)
- `culori` (repo `node_modules`), WCAG 2.x `wcagContrast`
- Repo: `ownerDecisions.md` D11–D15, `buildSpec.md` §1.4, §1.8 and the elevation table, `modernizeA.md`,
  `modernizeB.md` (warm grey values), `tokens/{colors,tones,themeCss,native,gradients}.ts`
- Corpus: `visual-systems.md` (dark mode, elevation), `visual-design.md`, `accessibility.md`

## Artefacts written

- `docs/design/uiOverhaul/darkTheme.md` (design spec). Nothing else.
