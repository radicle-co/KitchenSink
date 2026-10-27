# Component fixes in @commise/ui: Try again, button shape, sheet handle, chips

A design spec, not code. The owner approved all four (2026-10-26). On 2026-10-26 the owner also chose pill buttons, so
section 2 keeps buttons as pills and section 4 gives chips a treatment that cannot be mistaken for a secondary button. Paths are under `packages/apps/commise/ui/src`.

## 1. Try again is a quiet control

Today:

- `stateNotice/StateNotice.native.tsx` renders the first action as a default `Button`, which is `primary`, at full
  width. The canvas board `AppRouteErrorMobile` shows a filled steel "Try again" under a small message.
- `stateNotice/StateNotice.tsx` (web) renders the same action as `secondary`, so the two platforms differ.
- `loadMore/LoadMoreControl.native.tsx` and `refreshNotice/RefreshNotice.native.tsx` hand-roll their own `Pressable`
  pills (`radius.full`) instead of using `Button`.

Target:

- Every Try again uses the new `quiet` Button variant at size `md`, on both platforms, with the `retry` icon. The
  `quiet` variant has no fill and no border at rest, an `--ink` label at 16/600, and the icon in `--action-text`. It
  takes the ink wash on hover and press. It has no tonal fill, because that fill now marks a chip (section 4).
- StateNotice: the first action is `quiet`, and the second (a way out, such as Back to Home) stays `ghost`. Native
  stops stretching the action to full width. The action sits under the message, at its label's width.
- LoadMoreControl and RefreshNotice use `Button variant="quiet"` instead of their own Pressable, so they inherit the
  radius, busy and disabled states from one place.

Accessibility: the name is "Try again", and the failure reason is its description (web `aria-describedby`, native
`accessibilityHint`). The target is 44 pt, and 48 dp on Android. While a retry runs, the same control shows busy and
keeps focus, as Button's busy state already does. The quiet control has no fill, so the 16/600 label and the
icon carry it. Contrast of ink on `--surface-muted` passes WCAG 1.4.3.

Surfaces: AppRouteError, RecipeLoadError, RecipeVersionsError, CollectionsError and RecipesError, on Mobile and web.
Also the load-more and refresh notices on every list, and the 006, 007 and 019 screens that show Try again.

## 2. Buttons are pills on web and native

Owner ruling, 2026-10-26: buttons stay pills. `button/surfaceClass.ts` (web) and `button/Button.native.tsx` already round
a button to half its height, so the code needs no change here. The redesign canvas no longer overrides the web button to
12 px (`redesignCanvas/redesign.css`).

The cue that a control acts is its size and its surface, not its shape:

| Control            | Height   | Label                                    | Rest surface                               |
| ------------------ | -------- | ---------------------------------------- | ------------------------------------------ |
| `primary` button   | 52 or 44 | 16/600, `--on-action`                    | `--action` fill                            |
| `secondary` button | 44 or 36 | 16/600, `--ink`                          | `--paper` fill, 1 px `--line-control` edge |
| `quiet` button     | 44       | 16/600, `--ink`, icon in `--action-text` | none                                       |
| chip (section 4)   | 32       | 14/500, `--ink`                          | `--surface-muted` fill, no edge            |

Accessibility: no change. Targets stay 44 pt (48 dp on Android), and the focus ring follows the pill.

## 3. Sheets get a grab handle

Today: `sheet/BottomSheetPanel.native.tsx` dismisses on a downward swipe of the title row (`useSwipeToDismiss`), but
it draws no handle, so the swipe is hidden. `sheet/Sheet.tsx` (web) has no swipe at all.

Target, native bottom sheet only: a handle 36 by 5 pt, radius 3, `--line-divider`, centred, 8 pt from the top, with 4 pt
below it. Its row joins the swipe zone, so a drag that starts on it dismisses with the same thresholds.

Not the full-screen sheet, which has no swipe, and not the web sheet. A handle with no drag behind it is a false cue.
If web later gains swipe-to-dismiss below `sm`, it gets the same handle in the same change.

Accessibility: the handle is decorative (`importantForAccessibility="no-hide-descendants"`, no role, no focus).
The labelled Close button stays the accessible way to dismiss, which also meets WCAG 2.5.7 for the drag.
Surfaces: every native bottom sheet: ingredients, Add to plan, meal detail, Pro offers, the store sheet and menus.

## 4. A chip cannot be mistaken for a secondary button

Today a chip at rest (`chip/chipClass.ts` `CHIP_REST`, `chip/chipStyle.ts` `chipPill`) is `--paper` with a 1 px
`--line-control` edge and an `--ink` label. That is exactly the secondary button (`button/surfaceClass.ts`), so a lone
chip next to a secondary button reads as a second button. With pill buttons, the shape cannot separate them.

Target, on both platforms:

- Height 32 (`CHIP_HEIGHT` 32, web `min-h-8`), not 36. The hit area stays 44 pt (48 dp on Android) through the
  existing overlay and hit frame.
- At rest: `--surface-muted` fill and no edge (web `border-transparent bg-surface-muted`, native `borderWidth: 0`).
  Pressed and hover keep the ink wash.
- Label: the `caption` role, 14/500, `--ink`. Never the 16/600 a button uses.
- Selected: unchanged. `--selected-fill`, a 1.5 px `--selected-edge`, an `--action-text` label, and the 16 px check
  before the label, so selection never rests on colour alone.
- A chip always says what it is. A filter chip shows its check when on. A chip that opens a menu ends with a 16 px
  chevron. A count follows the label in `--ink-muted` tabular figures. A removable input chip ends with its x.
- Placement: a chip row sits under its own label (for example "Meal" or "Filters"), never in the same row as buttons.

Contrast: `--ink` on `--surface-muted` passes WCAG 1.4.3. The chip's fill against `--canvas` is low, so the chip
row's label and the 32 px height carry the grouping, and the selected edge passes 1.4.11.

Surfaces: `Chip`, `ChipRow` (choice and filter modes), and every hand-drawn chip on the redesign and feature boards
(cuisine and tag chips, Discover segments drawn as chips, import kind-of-source choices). The redesign canvas already
draws this treatment (`assembleRedesign.py` `CHIP_PATCHES` and `redesign.css`), so the canvas and the code should match
once this lands.

## 5. Screen on is a secondary switch pill

Decided 2026-10-27 by the design lead, after the redesign moved into `@commise/ui`. KeepAwakeToggle is a switch
(`role="switch"`), drawn as the secondary pill: 44 tall, 16/600, the sun glyph, and the label "Screen on". Off, it is the
secondary pill. On, it takes `selected-fill` with a `selected-edge` outline. It presses like Button: the same PressScale
and the same press fill (`surface-muted` over paper, `line-divider` over a muted surface). It is not a chip, because a
chip filters a list and this changes a device setting. The quiet control on RecipeDetailMobile is stale.

## 6. A selected chip shows its check, and only the check moves the layout

Decided 2026-10-27. The 16 px check on a selected chip stays: without it, selection is shown by colour alone (WCAG
1.4.1). The check may widen the chip, because that change happens where the cook just tapped. The edge must not move
anything: a chip carries a 1.5 px edge at rest in a transparent colour, so selecting it changes the colour, not the
size. A selected chip has a hover and press state too: `selected-edge` at 2 px.

## 7. Neutral badges show on every surface

Decided 2026-10-27. A neutral status badge (draft, private, public, soon, note) is `paper` with a 1 px `line-divider`
edge and `ink-muted` text, so it reads on canvas, paper and `surface-muted` alike. The PRO badge is slate `#5C646E` with
snow text in light, `#A3ACB6` with charcoal text in dark. DifficultyBadge follows the neutral rule.

## 8. The selected segment keeps paper and gains an edge

Decided 2026-10-27. Steel is an accent, not a fill, so the selected segment stays `paper` on the `surface-muted` track.
Paper on that track is about 1.18:1, which fails WCAG 1.4.11, so the selected segment gains a 1 px `line-control` edge
(3.09:1 light, 3.93:1 dark) and keeps its shadow. Its label stays ink 600; the others are ink-muted 600.

## 9. As built (2026-10-27): deviations the design lead accepted

The parity fixes merged into `@commise/ui` on fix/ingredient-matching with these changes from §3 to §8:

1. The grab handle's radius is `radius.full`, not 3: the same pill on a 5 pt bar, on the scale. The gap below it is
   4 pt, from the handle's margin, because the title row's own 4 pt top padding is removed.
2. A centred dialog sheet's bottom corners are 24, like its top.
3. The dark focus ring: each `ring-offset-*` site names `ring-offset-canvas`, and a guard refuses an offset width with
   no colour. A theme-level value cannot work, because Tailwind registers the offset colour as non-inherited.
4. There is no separate press token. A press uses `surface-muted`, and `line-divider` over a muted parent, through a
   Button prop `over="muted"` on web and native.
5. Radii: notices, cards, menus, popovers and comboboxes use `radius.lg` (18). Dialogs, sheets and full-screen modals
   use `radius.xl` (24). Pills use `radius.full`. Nothing uses a radius outside the scale.
6. A pressed primary button takes `actionPressed` on both platforms. A pressed danger button takes `dangerPressed`:
   `#A33F2A` light (white label 6.36:1), `#CC6A52` dark (dark label 4.99:1).
7. The neutral, difficulty and PRO badges are pinned as values retuned after the handoff.
8. Radii, more cases: an in-page view's cards, banners and alerts are 18 even when the view resolves a conflict
   (RecipeConflictView); only a true dialog container is 24 (VersionPreviewModal). A box whose radius is half its height
   (Button, so a label wrapped at 200% keeps its shape) stays computed. Skeleton bars use `radius.sm` (8). Tiny bars and
   dots use `radius.full`.
9. A glyph owns its own geometry: CheckBoxGlyph's 4 px corner is a named constant inside the glyph module, read by web
   and native, and only a module whose `@pattern` names it a glyph may own one. There is no `xs` radius step.

## 10. A surface states itself once (amends §9 items 3 and 4)

Decided 2026-10-27, after the push check found the `over="muted"` prop on only one of six controls that sit on a muted
card, and a focus-ring gap painted in `canvas` around controls on paper, sheets and muted cards (in dark, a `#0E161E`
ring on `#172029`). A per-call-site prop and 43 hand-copied ring classes cannot stay correct, so each surface container
states its surface once and every control reads it.

- The surfaces are `canvas` (the default), `paper`, `paper-raised`, `paper-overlay` (sheets, dialogs, menus),
  `surface-muted` and `inverse`.
- Web: the surface container sets an inheriting custom property `--surface` to its own colour token. A control reads it:
  the focus ring offset is `--surface`, and the press fill is `surface-muted`, or `line-divider` when the surface is
  `surface-muted`. On `inverse` the press fill is the inverse wash and the focus ring is `inverse-action`.
- Native: a surface context with the same values, set by the same containers. Button and the other pressables read it
  by default.
- The `over` prop and the per-site `ring-offset-canvas` classes are retired. A guard refuses a hand-written ring-offset
  colour or press fill on a control.
- A container that does not set a surface inherits its parent's, so a missed container falls back to the page, never
  to a wrong colour.

### 10a. Press fills, chips on a muted surface, and floating controls (measured 2026-10-27)

A press fill is the surface with the ink laid over it, the way Material 3's pressed state layer works: ink at 10% in
light, the dark ink `#EBEFF2` at 12% in dark. Floor: a press differs from its surface by at least 1.2:1. The old light
press, `surface-muted` on canvas, was 1.05:1, so light changes too.

| Surface       | Light fill → press           | Dark fill → press            |
| ------------- | ---------------------------- | ---------------------------- |
| canvas        | `#EFF3F6` → `#D9DDE1` (1.22) | `#0E161E` → `#293037` (1.37) |
| paper         | `#FCFDFF` → `#E5E6E9` (1.23) | `#172029` → `#303941` (1.40) |
| paper-overlay | `#FFFFFF` → `#E8E8E9` (1.22) | `#26313D` → `#3E4853` (1.42) |
| surface-muted | `#E9EDF2` → `#D4D8DD` (1.22) | `#212B36` → `#39434D` (1.42) |

- The table is one fact: the press role per surface is derived as that mix, never typed per site.
- A chip on a `surface-muted` surface rests on `paper` with no edge (light 1.16:1, dark 1.15:1). Its label identifies
  it, and a muted chip on a muted card would be invisible. On every other surface a chip rests on `surface-muted`.
- A control that floats over a photo or over scrolling content (the FAB, PhotoControl, any control on `photo-chip`) has
  no single surface, so its focus ring is two-tone: a 2 px `paper-overlay` inner ring, then a 2 px `focus-ring` outer
  ring. It reads on any background (WCAG 2.4.11 and 2.4.13).
- Notices use `radius.lg` (18). ResumeNotice's `rounded-md` is drift.
