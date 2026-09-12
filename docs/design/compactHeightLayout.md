# Compact height, the pinned-footer limit, and Branded serving text

> **What this is.** A design spec (SPECIFY) by `staff-ux-engineer`, written 2026-10-01. It covers three asks. **A**
> is a phone held sideways on a short screen (mobile only). **B** is the pinned `Done` limit (web and native, owner
> decision taken). **C** is Branded serving text (owner decision taken).
>
> **What it is not.** It is not production code. Nothing here was seen on a device. Every height budget is
> computed from the styles in code, on one reference device, and marked as computed. §13.3 lists the device checks.
>
> **Who builds it.** The implementing engineer, test first (`CLAUDE.md`). An EVALUATE follows.
>
> **Binding text it amends.** `ingredientSpecialization.md` §S8.1 and §S8.1a (item B). Other agents are editing
> that file, so its replacement text is in this spec's hand-off report, not here.

## 0. The decisions

| #   | Ask                          | Decision                                                                                                                                                                                                                                                                                                                | Section |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A0  | One compact-height predicate | `isCompactHeight(windowHeight) = windowHeight < 480` dp. This is Material's "compact" window-height class. It keys the screen frames, and on web the recipe filter bar's Sheet layout (below 640 px wide or 480 px tall, `ingredientSpecialization.md` §S8.1a). Every other rule is measured or continuous, and says so | §2      |
| B   | Pinned `Done`                | One pure rule, `isFooterUnpinned`. The footer is pinned up to a limit: the pinned top row and the footer together are **at most half** the frame. Past it, the footer unpins. It is measured. Close (×) stays pinned                                                                                                    | §3      |
| A1  | Wizard controls              | **The same rule as B, on web and native.** The header (Back) stays pinned. The controls unpin past the limit. Not "hide while the keyboard is up"                                                                                                                                                                       | §4      |
| A2  | List and discovery headers   | In compact height the heading shares a row with the search field. The filter controls share one wrapping row. In compact height with a keyboard open, everything except the field steps aside                                                                                                                           | §5      |
| A3  | Sheet with the keyboard up   | B, A4 and A6 cover it. Nothing else is specific to a sideways phone                                                                                                                                                                                                                                                     | §6      |
| A4  | Android full-screen editor   | Every text input turns it off, through a new design-system adapter `@commise/ui/text-input`. A guard enforces it, like `@commise/ui/modal`. No `SearchField` primitive in this change                                                                                                                                   | §7      |
| A5  | Hero and photo heights       | `mediaBoxHeight = min(preferred, floor(0.4 × window height))`, at every size (not keyed on A0). The hero crops. The carousel keeps 4:3 and narrows. A slide's width comes from the strip's own layout                                                                                                                   | §8      |
| A6  | Sheet side padding           | Agreed. Pad each side by `max(0, inset − gap to that window edge)`                                                                                                                                                                                                                                                      | §6      |
| A7  | Account erase dialog         | A new primitive, `@commise/ui/dialog-frame` `DialogFrame`. The three centred dialogs adopt it. It shares one keyboard avoider with the Sheet                                                                                                                                                                            | §9      |
| A8  | Lightbox Close               | 48 × 48, inside the safe-area insets. The photo box is inside them too                                                                                                                                                                                                                                                  | §8.3    |
| A9  | Subscription nudge           | Adopt `@commise/ui/sheet` `Sheet`, `size="content"`. New key `home.nudge.close`                                                                                                                                                                                                                                         | §10     |
| C   | Branded serving text         | No client surface shows a portion today. So nothing client-side is built now: no formatter, no display. The readable-unit mapping belongs in food's portion normalizer. "Common measures" ships later                                                                                                                   | §11     |

## 1. Purpose

**Who and what.** A cook holds a phone sideways, propped on the counter or in a stand. They create a recipe, search
their recipes, filter, read a recipe and erase their account. The app now rotates (`mobile/app.json`
`"orientation": "default"`). WCAG 2.2 SC 1.3.4 requires it to work in both orientations.

**The constraint.** A phone held sideways is about 393 dp tall (Pixel 5, 851 × 393) or 390 (iPhone 14, 844 × 390).
A keyboard takes about 200 to 240 of that. Chrome that was cheap upright now fills the window. This spec decides
what stays, what moves and what steps aside on each surface. It puts each rule in one shared place.

**The one thing.** One rule decides "pinned or not" for every pinned footer (the Sheet, the wizard). It is
measured. So it fires in two cases only: a sideways phone with its keyboard open, and very large text. An upright
phone at normal text is unchanged.

### 1.1 The reference device, used for every budget below

| Quantity                             | dp      | Source                                                                                                     |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| Window, sideways                     | 393     | Pixel 5 (851 × 393), from the brief                                                                        |
| Top inset (status bar)               | 24      | from the brief                                                                                             |
| Side inset (3-button navigation bar) | 48      | from the brief. The bottom inset is then 0                                                                 |
| Usable height, keyboard closed       | 369     | 393 − 24                                                                                                   |
| Keyboard, sideways                   | 220     | the midpoint of the brief's 200 to 240                                                                     |
| Usable height, keyboard open         | 149     | 369 − 220                                                                                                  |
| `RecipesScreen` TabBar               | 53      | `RecipeSourceTab` 44, plus `paddingBottom: spacing[2]` 8, plus a 1 dp border (`RecipesScreen.tsx:325-331`) |
| Search pill                          | 46      | `paddingVertical: spacing[3]` twice, plus one `fontSize.bodyMd` line                                       |
| `Wizard.Header` / `Wizard.Controls`  | 61 / 69 | from the brief, checked against `Wizard.native.tsx:449-482`                                                |

⚠️ Every budget is **computed from code**. None was rendered. The iPhone 14 is within a few dp of these figures. Held
sideways, it has no top inset and a 21 dp bottom inset.

## 2. The compact-height predicate

```ts
// packages/apps/commise/ui/src/layout/compactHeight.ts
/** Below this window height, in dp, the window is compact in height. Material's window size classes. */
export const COMPACT_HEIGHT_BELOW_DP = 480;
/** Whether the window is compact in height. Pure. Strict `<`, as Material states it. */
export function isCompactHeight(windowHeight: number): boolean;
/** Whether the screen frames step aside for the keyboard. Pure. Both must hold. */
export function isFrameCollapsed(compactHeight: boolean, keyboardOpen: boolean): boolean;
```

**Source.** Android's window size classes (developer.android.com, "Use window size classes", read 2026-10-01).
Compact height is `height < 480dp`. Medium is `480dp ≤ height < 900dp`. Expanded is `≥ 900dp`. The page says compact
height covers 99.78% of phones held sideways. It names phones held sideways as the case where the height class
matters. Every iPad and every upright phone is 480 dp tall or more.

**Keyed on the window, never on the keyboard.** The input is `useWindowDimensions().height`. ⛔ Never use the height
left above the keyboard. A layout that changes with the keyboard can remount the focused field. Then the field
loses focus, the keyboard closes, and the layout changes back. The keyboard has its own input (`useKeyboardShown`).
⚠️ A device check is owed (§13.3). Opening the keyboard on Android must leave `useWindowDimensions().height`
unchanged.

**Hooks (native).** `useCompactHeight(): boolean` in `ui/src/layout/useCompactHeight.native.ts`.
`useFrameCollapsed(): boolean` in `ui/src/layout/useFrameCollapsed.native.ts`. `useKeyboardShown` moves from
`ui/src/sheet/` to `ui/src/layout/useKeyboardShown.native.ts`. The Sheet imports it from there.

**Export.** A new package export, `@commise/ui/layout`, maps to `src/layout/index.ts`. It exports the pure rules
(§2, §3, §8) and the native hooks. It names the `.native.js` files explicitly, the precedent of
`@commise/ui/screen-reader-focus`. No web app imports it. The web `SheetPanel` imports the pure rule and its web
hook by relative path, from inside `@commise/ui`.

**What keys on it, and what does not.**

| Rule                                                   | Keyed on                                        | Why                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Screen-frame layout: heading inline, controls in a row | `isCompactHeight`                               | A layout choice by window class. It must not flip with the keyboard                    |
| Screen-frame collapse, and the hidden TabBar           | `isFrameCollapsed` (compact **and** a keyboard) | Upright, the keyboard leaves room. Hiding chrome there costs and buys nothing          |
| Footer unpinned (Sheet, wizard)                        | **Not keyed.** Measured (§3)                    | Large text on a small upright phone needs it too. A window class cannot see font scale |
| Media heights                                          | **Not keyed.** Continuous (§8)                  | An iPad's carousel is taller than its window too. The defect is not specific to phones |
| Sheet side padding                                     | **Not keyed.** Geometry (§6)                    | It depends on width and insets only                                                    |
| No full-screen editor                                  | **Not keyed.** Every input (§7)                 | The operating system makes that choice. The app cannot predict it                      |
| Centred-dialog keyboard avoidance                      | **Not keyed** (§9)                              | The keyboard covers a dialog in any orientation                                        |

## 3. The pinned-footer limit (item B)

### 3.1 The rule

```ts
// packages/apps/commise/ui/src/layout/pinnedFooter.ts
/**
 * Whether the footer scrolls with the content instead of staying pinned. Pure.
 * `pinnedTop`: the pinned row above the scroll region that holds the exit (the Sheet's title row with Close; the
 * wizard's header with Back). `footer`: the footer's height. `frame`: the frame's height. All in dp or px.
 * An unknown or zero `frame` answers `false`.
 */
export function isFooterUnpinned(measure: {
    readonly pinnedTop: number;
    readonly footer: number;
    readonly frame: number;
}): boolean; // frame > 0 && pinnedTop + footer > frame / 2
```

- **Strict `>`.** Exactly half stays pinned.
- **The Sheet's toolbar is not counted.** The owner's words name the title row and the footer. The toolbar's
  controls never move (§S8.1, stability). With a keyboard open and focus there, the footer already hides
  (collapse). Counting the toolbar only unpins earlier. I follow the owner's words.
- **The exit never unpins.** Close (×) and the wizard's Back stay in the pinned top row at every size.
- **The frame's height does not depend on the decision, so it cannot flap.** A content-sized frame is
  `min(T + toolbar + content + F, available)` in both states. A full-height frame is `available` in both. A
  content-sized sheet with nothing to scroll looks the same pinned or unpinned.
- **Before the first measurement,** the footer is pinned (`frame` is 0).
- **While collapsed** (§S8.1), the footer is hidden, as today. Its last measured height is **kept** while it is
  unmounted. ⛔ Never reset it to 0 on unmount. Otherwise the first decision after the collapse uses a footer of 0.

### 3.2 Web: `ui/src/sheet/SheetPanel.tsx`

The footer moves **inside** the scroll region, as its last child, in both states. Only a class changes.

| Node                   | Classes                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scroll region          | `flex min-h-0 flex-1 flex-col overflow-y-auto`. Inline style `scrollPaddingBottom: <footer height>px` **while pinned and shown**. Otherwise unset |
| Children wrapper (new) | `grow shrink-0 px-6 py-4`. This is the padding the scroll region had                                                                              |
| Footer                 | `shrink-0 border-t border-mist bg-card px-6 py-4`, plus `sticky bottom-0` while pinned                                                            |

- `grow` on the wrapper puts the footer at the bottom of a short `full` sheet. `shrink-0` stops the wrapper from
  shrinking below its content. So long content scrolls.
- `bg-card` on the footer stops content showing through as it scrolls beneath.
- **Measurement.** `usePinnedFooter()` is the web leaf in `ui/src/layout/usePinnedFooter.ts`. One `ResizeObserver`
  watches three elements through callback refs. They are the `SheetPanel` root (the frame), the title row
  (`pinnedTop`) and the footer. It returns `{ frameRef, topRef, footerRef, unpinned, footerHeight }`. This is a ref
  around an external, non-declarative system (`ResizeObserver`), the case `CLAUDE.md` permits. The ref clause makes
  the `@pattern` tag mandatory: `@pattern Adapter over ResizeObserver`.
- **Focus.** The footer node never remounts. So focus on `Done` survives a flip (SC 2.4.3).
- ⛔ **SC 2.4.11 (Focus Not Obscured, AA).** A sticky footer can hide a focused row completely. The
  `scroll-padding-bottom` above is the fix. It is W3C technique C43, sufficient for 2.4.11
  (w3.org/WAI/WCAG22/Techniques/css/C43, read 2026-10-01). The browser then scrolls a focused row clear of the
  footer. Test: tab to the last row in a sheet whose content overflows. The row's box must end above the footer.
- **Accepted consequences.** Content scrolls beneath a pinned footer, and the scrollbar runs beside it. Both are the
  normal look of a sticky footer.
- **The keyboard on web.** The Sheet's height already follows the visible box (`--sheet-visible-height`). So the
  observer sees the keyboard shrink the sheet, and the rule fires on web with no extra wiring. E2 I7's sideways
  phone case (the footer 135 and 154 px past the dialog) becomes a footer that scrolls.

### 3.3 Native: `ui/src/sheet/BottomSheetPanel.native.tsx`

React Native has no reliable sticky footer in a plain `ScrollView`. So the footer renders in **one of two fixed
slots**.

```
<Animated.View onLayout={frame}>            // the panel: the frame
  <View titleRow onLayout={top} {...pan}/>   // pinned
  {toolbar}                                  // pinned, unchanged
  <ScrollView contentContainerStyle={{}}>
    <View style={children wrapper}>{children}</View>
    {footerShown && unpinned ? <Footer/> : null}      // slot A: the last item of the scroll region
  </ScrollView>
  {footerShown && !unpinned ? <Footer/> : null}       // slot B: pinned
</Animated.View>
```

- **Children wrapper (new).** It takes the content container's padding: `paddingHorizontal:
SHEET_EDGE_PADDING_DP`, `paddingTop: spacing[2]` and `paddingBottom: SHEET_EDGE_PADDING_DP`. With no footer it
  also takes `endPadding`, as today. The content container has no padding. So a footer in slot A spans the full
  sheet width. Its hairline runs edge to edge, and its height is the same in both slots.
- **Footer** (both slots, one style): `styles.footer` plus `endPadding`, and `onLayout={footer}`. `endPadding` is the
  bottom inset. It is dropped while a keyboard is open, as today. The hairline (`StyleSheet.hairlineWidth`,
  `palette.mist`) stays above the footer in both slots. Unpinned, it separates the end of the content from the
  actions.
- **Measurement.** `usePinnedFooter()` is the native leaf in `ui/src/layout/usePinnedFooter.native.ts`. It gives
  three `onLayout` handlers and the decision. It uses no refs. `@pattern Adapter over React Native layout events`.
- **The slots are fixed.** Each slot is a conditional at a fixed position. ⛔ Never use one ternary that moves the
  `ScrollView`'s index. That remounts the scroll region and anything focused in it.
- **Accepted consequence.** A flip remounts the footer. A screen-reader cursor on `Done` at that moment is lost.
  Flips are rare. Three events cause them: rotation, a change of content height, and the keyboard opening or
  closing. In the last case focus is in a text input, not on `Done`. React Native cannot read where the cursor is, so it
  cannot restore it.
- ⚠️ **Android with the keyboard (E2 I6).** Measured on Android 15 (2026-10-03): the window does not resize. The
  frame stays full height and the keyboard covers `Done` and the sheet's field. The cause, read in React Native 0.86:
  the app is edge to edge (`edgeToEdgeEnabled=true` in `mobile/android/gradle.properties`), the house `Modal` sets
  `navigationBarTranslucent`, which calls `enableEdgeToEdge()` on the dialog window (`ReactModalHostView.kt`), and an
  edge-to-edge window is not resized by `adjustResize`. The fix: `ModalKeyboardAvoider` pads with `behavior="padding"`
  on both platforms. React Native 0.86's `KeyboardAvoidingView` measures the overlap from its own frame, so the panel,
  the frame this rule reads, shrinks by the keyboard, and a window that does resize gets no padding. ⚠️ Not yet proved
  on a device: that React Native reports the keyboard (`keyboardDidShow`, read from the activity's root view) while a
  `Modal` window holds it. The large-text half of B works on Android in every case.

### 3.4 The contract text

`SheetProps.footer` (`ui/src/sheet/props.ts`) becomes:
`/** The actions, under a hairline. Pinned, unless the title row and the footer together are taller than half the
sheet: then the last item of the scroll region. Hidden only while collapsed. */`

### 3.5 States

| State (filter sheet, `size="content"`, no toolbar)       | T + F      | Frame       | Footer                                                 |
| -------------------------------------------------------- | ---------- | ----------- | ------------------------------------------------------ |
| Upright, 100% text, keyboard closed                      | 132 to 152 | up to 779   | pinned                                                 |
| Upright, 100% text, keyboard open                        | 132        | 300 or more | pinned                                                 |
| Sideways, 100% text, keyboard closed, facets overflow    | 132        | 369         | pinned (132 < 184.5)                                   |
| Sideways, 100% text, keyboard open                       | 132        | 149         | **unpinned** (132 > 74.5). iOS now. Android: §3.3      |
| Sideways, 200% text, keyboard closed                     | 170        | 369         | pinned (170 < 184.5). Computed, and close to the limit |
| Upright small phone (568 tall), 200% text, keyboard open | 170        | 300         | **unpinned**                                           |
| A sheet with a toolbar, collapsed                        | none       | none        | hidden (§S8.1, unchanged)                              |

**Copy and announcements.** None change. There is no new key. A flip announces nothing, because the footer's content
and names are the same in both slots.

## 4. The wizard's pinned controls (A1)

### 4.1 Decision: the same rule as B

`Wizard.Header` is the pinned top row. It holds Back, the only exit. `Wizard.Controls` is the footer. The frame is
the editor's height inside its keyboard avoider.

**Against U32.** U32 fixed one failure. The primary control scrolled away under a long ingredient list, and a cook
had to scroll the whole list to reach `Next`. The rule keeps that fix wherever it can hold.

- At 100% text the controls stay pinned in every upright case. They stay pinned on a sideways phone with its
  keyboard closed (table below). U32 is untouched there.
- At 100% text they unpin in one case: a sideways phone with its keyboard open. Pinned, they leave 19 dp of content,
  and the field being typed in does not fit. Unpinned, the content gets 88 dp.
- At 200% text they also unpin on a small upright phone with its keyboard open. There the wrapped bar is two or three
  rows tall. B's reason holds: pinned, the bar leaves almost no room for the field.
- Then `Next` is one keyboard dismissal away, not a scroll away. The cook closes the keyboard with the return key,
  with Android back, or with a tap on empty space (the scroller has `keyboardShouldPersistTaps="handled"`). The frame
  then gets its height back, and the bar pins again. U32's failure was a scroll the cook had no way to avoid. This is
  not that.
- **Rejected: hide the controls while the keyboard is up.** That removes `Next` on an upright phone too. There the
  bar fits, and a cook who picks an ingredient result goes straight on. It costs U32 in the common case to fix the
  rare one. It is also a second rule for the same question.

### 4.2 Build: `mobile/src/screens/RecipeEditor.tsx`

```
<KeyboardAvoidingView style={flex 1} behavior="padding">                       // both platforms (§3.3, E2 I6)
  {submitError alert}                                                          // unchanged
  <Wizard …>
    <View style={{ flex: 1 }} onLayout={frame}>                 // NEW: the frame, INSIDE the avoider
      <View onLayout={top}><Wizard.Header /></View>
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12 }}
                  keyboardShouldPersistTaps="handled">
        <View style={styles.body}>                               // gap 16, paddingHorizontal 16, paddingBottom 48
          <Wizard.Rail /> {four Wizard.Step}
        </View>
        {unpinned ? <View onLayout={footer}><Wizard.Controls /></View> : null}   // slot A
        {reveal.spacer ? <RevealSpacer {...reveal.spacer} /> : null}                // E1: last while a list is open
      </ScrollView>
      {unpinned ? null : <View onLayout={footer}><Wizard.Controls /></View>}     // slot B
    </View>
  </Wizard>
</KeyboardAvoidingView>
```

- **Measure inside the avoider.** With `behavior="padding"`, the avoider's own frame does not shrink. Its padding
  grows instead. The `flex: 1` child does shrink, on both platforms: Android's edge-to-edge window is not resized
  (§3.3, E2 I6).
- **The body wrapper** takes the content container's old side and bottom padding. So the controls in slot A span
  the full width, and their top border runs edge to edge.
- **The controls row wraps.** `controlsRow` in `Wizard.native.tsx` gains `flexWrap: 'wrap'` and `rowGap:
spacing[2]`. At 200% text on a 360 dp phone, three buttons do not fit one line. `Next: Ingredients` alone is about
  330 dp, and today the row cannot wrap. The primary (`Next` or `Publish`) stays last. So a wrapped row puts it at
  the bottom end, on the thumb's side. The row wraps. No label wraps inside its button.
- **Docs.** In `Wizard.native.tsx`, the module doc and the `WizardControls` doc change "PINNED" to: pinned, unless
  the header and the bar together are taller than half the editor (`@commise/ui/layout` `isFooterUnpinned`).
- **The ancestry test.** `tests/screens/RecipeEditor.native.test.tsx:540` asserts that the bar is not a descendant
  of the scroller. ⛔ Rewrite it. Do not loosen it. Its doc comment says why it changed. It asserts three things.
  With a frame of 779, the bar is not a descendant of the scroller. With a frame of 149, it is the scroller's last
  child. The header is outside the scroller in both. Fire `layout` events with those heights.
- **Accepted consequences.** A flip remounts the bar (§3.3). The blocked-advance notice has `role="alert"`. If a flip
  happens while it shows, Android can announce it again. It repeats a true sentence.

### 4.3 States (computed, reference device)

| State                                       | Header + Controls                         | Frame                             | Controls     | Content      |
| ------------------------------------------- | ----------------------------------------- | --------------------------------- | ------------ | ------------ |
| Upright, 100% text, keyboard closed         | 130                                       | 779                               | pinned       | 649          |
| Upright, 100% text, keyboard open           | 130                                       | 296 or more (iPhone SE, 568 tall) | pinned       | 166 or more  |
| Sideways, 100% text, keyboard closed        | 130                                       | 369                               | pinned       | 239          |
| Sideways, 100% text, keyboard open          | 130                                       | 149                               | **unpinned** | 88           |
| Sideways, 200% text, keyboard closed        | 144                                       | 369                               | pinned       | 225          |
| Sideways, 200% text, keyboard open          | 144                                       | 149                               | **unpinned** | 88           |
| Upright 360 × 640, 200% text, keyboard open | 210 to 276 (the bar wraps to 2 or 3 rows) | about 300                         | **unpinned** | about 239    |
| Blocked advance shown (one or two lines)    | plus 20 to 40                             | any                               | by the rule  | not computed |

⚠️ Measured on Android 15, upright, keyboard open (2026-10-03): with a two-line notice and a wrapped row, the bar is
about 172 dp, not 69 plus 40. It stayed pinned (234 dp against 264). The font scale is unknown. The foods it hid,
and the ruling, are `rowEditorOpenDecisions.md` E1.

### 4.4 Web: `features/recipes/src/wizard/Wizard.tsx`

The web wizard uses the same rule (lead ruling, 2026-10-03, closing `v3Evaluation.md` V3-M2's residual). At
640 × 360 and 200% text, the band (137 px) and the pinned bar (121 px) left 102 px of the 360 px viewport for the
step and its combobox.

- **The frame is the viewport.** The page scrolls under a band stuck to its top. So the inputs are the band's height
  as the pinned top row, the bar's height as the footer, and `document.documentElement.clientHeight` as the frame
  (`controlsPinning.ts`).
- **Two slots.** Pinned, the bar stays where it is: fixed at the foot below `lg`, and in the band's own flow at `lg`.
  Unpinned, the Root places the bar after the step bodies, in the page's flow.
- **The measure cannot flip back.** At `lg` the band's height includes the bar, so the bar's height is taken off.
  The band then measures the same wherever the bar is. The band's gap moved into the bar's own top padding for the
  same reason.
- **What reports a change.** A `ResizeObserver` on both nodes (text size, a refusal notice in the bar) and the
  window's `resize` (`useControlsUnpinned.ts`). A server render measures nothing, so the bar is pinned on the first
  client render too, and hydration agrees.
- **The import.** The rule comes from `@commise/ui/pinned-footer`. `@commise/ui/layout` brings the native hooks, and
  react-native, into the web build.
- **Focus survives a flip (WCAG 2.4.3), as on the Sheet's web leaf (§3.2).** A flip moves the bar to another place
  in the tree, which remounts it. A flip can follow a click: `Next` shows the blocked-advance notice, the bar grows,
  and it crosses the limit. So the hook that decides the flip notes which bar control has focus before it re-renders,
  and moves focus to the same control in the new bar. Native cannot do this (§3.3), and web can.
- **The popup in case D (`v3Evaluation.md` V3-M2a, built 2026-10-03).** With the bar unpinned, the combobox popup gets
  about 130 px. The database line moves below the foods when our database found one, so the first food's top shows
  at rest, and ArrowDown scrolls the active option into view inside the card.

## 5. The recipe list and discovery frames (A2)

### 5.1 Three layouts

| Layout    | When                  | What changes                                                                                                       |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Regular   | not compact           | Nothing visible. The tree is regrouped (below), so the field never moves between layouts                           |
| Compact   | `useCompactHeight()`  | The heading and the search field share one row. The filter controls share one wrapping row. The frame gaps shrink  |
| Collapsed | `useFrameCollapsed()` | Compact, and these do not render: the TabBar, the quick-filter chips, the create dial and the discovery filter row |

### 5.2 Stability: the field never changes parent or index

This is §S8.1's stability rule, applied to screens. A remounted `TextInput` loses focus and its keyboard.

- Each frame always wraps the heading and the field in one **header group** `View`. Regular: `flexDirection:
'column'`, `gap: spacing[4]`. Compact: `flexDirection: 'row'`, `flexWrap: 'wrap'`, `alignItems: 'center'`, `gap:
spacing[3]`. The field is the group's last child in both.
- Discovery also wraps the filter trigger, Back to browse and the sort group in one **controls group** `View`.
  Regular: `column`, `gap: spacing[4]`. Compact: `row`, `flexWrap: 'wrap'`, `alignItems: 'center'`, `gap:
spacing[2]`. Collapsed: the slot renders `null`.
- `RecipesScreen` renders one tree for tab and pushed surfaces: `<View style={containerStyle}>{showTabBar ?
<TabBar/> : null}{screen}</View>`, with `showTabBar = isTab(current) && !collapsed`. Today it renders two trees
  (`RecipesScreen.tsx:162-169`). With two trees, a hidden TabBar shifts `screen`'s index and remounts the focused
  field.

### 5.3 `features/recipes/src/list/RecipeListFrame.native.tsx`

| Element                                             | Regular                                                              | Compact                                                                                                       | Collapsed                                                       | Disposition (compact)                                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Title band                                          | `GradientSurface gradient="hero"`, padding `spacing[4]`, `radius.lg` | none. The heading is a plain `Text` with the same type (`fontFace.display.bold`, `fontSize.displayMd`)        | as compact                                                      | collapsed. Judgement: in compact height the band's 32 dp of padding is decoration. The discovery frame has no band, so the two frames converge |
| Heading                                             | in the band                                                          | first in the header row                                                                                       | stays. It is inline, so it costs no height unless the row wraps | moved                                                                                                                                          |
| Search field                                        | full width                                                           | `flexGrow: 1`, `flexBasis: 240`, `minWidth: 0`. It wraps below the heading at 200% text or in a narrow window | stays, focused                                                  | kept                                                                                                                                           |
| Frame gap                                           | `spacing[4]`                                                         | `spacing[2]`                                                                                                  | `spacing[2]`                                                    | changed                                                                                                                                        |
| Quick-filter chips (`RecipeListResults.native.tsx`) | shown                                                                | shown. They wrap                                                                                              | not rendered                                                    | deferred while typing                                                                                                                          |
| Create dial (`RecipeListResults.native.tsx`)        | shown                                                                | shown                                                                                                         | not rendered                                                    | deferred while typing                                                                                                                          |
| TabBar (`RecipesScreen`)                            | shown                                                                | shown                                                                                                         | not rendered                                                    | deferred while typing                                                                                                                          |

`RecipeListResults` reads `useFrameCollapsed()` itself. It stays presentational: it reads device state only, the
precedent that `BottomSheetPanel` sets.

### 5.4 `features/recipes/src/discovery/RecipeDiscoveryFrame.native.tsx`

| Element                              | Regular                                       | Compact                                                                  | Collapsed                            |
| ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| Heading                              | stacked                                       | first in the header row                                                  | stays                                |
| Search field                         | stacked                                       | header row, `flexGrow: 1`, `flexBasis: 240`                              | stays, focused                       |
| Recent searches                      | below the field, while it is focused and idle | the same                                                                 | the same, and **scrollable** (below) |
| Filter trigger, Back to browse, sort | stacked                                       | one wrapping controls row, in that order. The reading order is unchanged | not rendered                         |
| Live region                          | mounted                                       | mounted                                                                  | mounted. It must outlive every body  |

**The recent-search panel scrolls, in every layout.** The panel takes `flexShrink: 1`. Its rows sit in a
`ScrollView` with `keyboardShouldPersistTaps="handled"`, so the first tap on a recent query lands. Today it is a
plain `View`. It can overflow under a keyboard on a short upright phone too.

### 5.5 Budgets (computed, reference device, sideways)

| Surface                   | Today, keyboard closed | Compact, keyboard closed | Today, keyboard open | Collapsed (keyboard open) |
| ------------------------- | ---------------------- | ------------------------ | -------------------- | ------------------------- |
| List, no chips            | 164                    | 254                      | about 0              | 87                        |
| List, with chips          | 104                    | 202                      | about 0              | 87                        |
| Discovery                 | 76                     | 202                      | about 0              | 87                        |
| Discovery, Back to browse | 16                     | 202. It shares the row   | about 0              | 87                        |

87 dp holds the field and the top of the first result. That is the physical limit of a 149 dp window. Closing the
keyboard gives the results their room back.

**Precedent.** iOS hides the navigation bar while a search is active. `UISearchController.
hidesNavigationBarDuringPresentation` defaults to `true` (developer.apple.com, read 2026-10-01). Collapsed follows
that convention, and only where it is needed.

## 6. The Sheet on a sideways phone (A3, A6)

**A3.** Nothing beyond B (§3), A4 (§7) and A6. The Sheet already drops the bottom inset while a keyboard is open
(§S8.1). Sideways, with the filter sheet's ingredient search focused, `Done` unpins and the facets get the room
(§3.5). Android pads through `ModalKeyboardAvoider` (§3.3, E2 I6).

**A6, agreed.** `sheetPresentation.ts` gains one rule.

```ts
/** The padding one side of the sheet needs for a device inset on that side. Pure. */
export function sheetSideInsetPadding(windowWidth: number, inset: number): number;
// gap = windowWidth >= SHEET_WIDE_FROM_DP ? (windowWidth - SHEET_MAX_WIDTH_DP) / 2 : 0
// return Math.max(0, inset - gap)
```

`BottomSheetPanel` pads its left side by `sheetSideInsetPadding(width, insets.left)` and its right side by
`sheetSideInsetPadding(width, insets.right)`. It does not use the raw insets. The sheet stays centred in the
**window**, on the scrim's axis. At 851 wide with a 48 inset, the padding is 0. At 600 wide with a 48 inset, it is 28. Below 600 wide the sheet is full width. The gap is then 0 and the full inset applies, as today. Unit-test those
three values and an uneven pair (left 48, right 0).

## 7. Text inputs: no full-screen editor (A4)

### 7.1 Decision

Every text input sets `disableFullscreenUI`. React Native's docs describe it (reactnative.dev/docs/textinput, read
2026-10-01). It is Android only, and its default is `false`. With `false`, Android can move editing into a
full-screen text mode. It does so for a field with little room around it, as on a phone held sideways. With `true`,
the cook always edits in the field itself.

**Every input, not only search fields.** That editor hides the whole app. It hides the field's label, the subject of
SC 3.3.2. It hides a search's results. It hides the phrase the erase dialog asks the cook to copy. It hides the
ingredient row a quantity belongs to. In this app almost every field means something only beside its surroundings. Sorting 27 inputs
by that judgement is 27 decisions that drift. So the rule is made once.

**Multiline too.** The full-screen editor gives a long instruction more room. It also hides which step the cook is
editing. The app now keeps the focused field above the keyboard (§3, §4, §5). So the loss of the editor's room is
small. Decided: off for multiline inputs as well.

### 7.2 Build: an adapter, like `@commise/ui/modal`

- **New:** `ui/src/textInput/TextInput.native.tsx`, exported as `"./text-input": "./src/textInput/TextInput.native.tsx"`.
  `export type TextInputProps = Omit<ComponentPropsWithRef<typeof NativeTextInput>, 'disableFullscreenUI'>`. React
  Native's `TextInputProps` declares no `ref`, so the props come from the component. `export const TextInput:
FC<TextInputProps> = (props) => <NativeTextInput {...props} disableFullscreenUI />`. `@pattern Adapter over React
Native's TextInput`.
- **Refs pass through.** React 19 gives a function component its `ref` as a prop, so the spread forwards it.
  `IngredientPicker`'s `searchRef` (`IngredientPicker.tsx:265, 545`) keeps working. A test asserts that
  `ref.current.focus` exists.
- **Every site switches**, including the design system's own `ui/src/input/Input.native.tsx`. These 15 files have a
  raw `<TextInput` today. In `features/recipes`, all `.native.tsx`: `ChipInput`, `RecipeDiscoveryFrame`,
  `RecipeBasicsFields`, `RecipeIngredientsFields`, `CollectionRecipePicker`, `ParseJobReview`, `RecipeFilterBar`,
  `RecipeInstructionsFields`, `RecipeListFrame`, `ParsePasteForm` and `CollectionForm`. Elsewhere:
  `AuthoredFoodCreateForm.tsx`, `IngredientPicker.tsx`, `AccountEraseDialog.native.tsx` and `Input.native.tsx`.
- **Guard:** `packages/infra/global/__tests__/textInputAdapterImports.test.ts`, modelled on
  `modalAdapterImports.test.ts`. A value import of `TextInput` from `react-native` anywhere in the apps, outside the
  adapter, fails. `import type { TextInput }` for ref typing is allowed.
- **iOS** has no such editor. The prop does nothing there.

### 7.3 Why not a `SearchField` primitive now

The five search fields have four looks: a pill, a rounded rectangle, an icon-and-badge composite, and a plain box. A
`SearchField` is a visual consolidation, and it is worth doing. But it does not fix A4. It also restyles four
surfaces in a change about orientation. §14 records it as a design-system opportunity, with one finding for it.

## 8. Media heights (A5) and the lightbox (A8)

### 8.1 The rule

```ts
// packages/apps/commise/ui/src/layout/mediaBox.ts
/** The largest share of the window's height one media box may take. */
export const MEDIA_MAX_WINDOW_FRACTION = 0.4;
/** A media box's height: its preferred height, capped by the window. Pure. */
export function mediaBoxHeight(preferred: number, windowHeight: number): number;
// Math.min(preferred, Math.floor(windowHeight * MEDIA_MAX_WINDOW_FRACTION))
/** The photo strip's box: 4:3 at the available width, capped by the window, narrowed to keep 4:3. Pure. */
export function carouselBox(availableWidth: number, windowHeight: number): { width: number; height: number };
// height = mediaBoxHeight(availableWidth * 3 / 4, windowHeight)
// width = Math.min(availableWidth, Math.round(height * 4 / 3))
```

**Why 0.4.** On a sideways phone the detail screen spends 24 (inset), 44 (the Back row) and 16 (padding) before the
hero. At 0.4 the hero is 157 tall, and the title band starts at about 241 of 393, on the first screen. At 0.5 it
starts near 280, and a two-line title at 200% text does not fit. The principle: the first screen shows what the
cook opened (the title). This is judgement, not a published threshold.

**Not keyed on A0.** Upright phones are untouched (0.4 × 851 = 340, more than 256). An iPad held sideways (1180 × 820) has a carousel 861 tall today, taller than its window. The same rule caps it.

### 8.2 Hero and carousel

| Surface                                  | Rule                                                                                                                                                                         | Pixel 5 upright       | Pixel 5 sideways | iPad 1180 × 820 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------- | --------------- |
| Hero cover (`RecipeHero.native.tsx`)     | Height `mediaBoxHeight(nativeTokens.mediaHeight.hero, windowHeight)`. Full width. `contentFit="cover"`, centred crop. The scrim follows the box                              | 256 (unchanged)       | 157              | 256             |
| No-cover placeholder                     | `mediaBoxHeight(nativeTokens.mediaHeight.heroPlaceholder, windowHeight)`. It never binds at 96. It uses the rule so that there is one rule                                   | 96                    | 96               | 96              |
| Photo strip (`PhotoCarousel.native.tsx`) | `carouselBox(stripWidth, windowHeight)`. Each slide is exactly the box. The strip is centred (`alignSelf: 'center'`). `contentFit="cover"`: expo-image's default, now stated | 361 × 271 (unchanged) | 209 × 157        | 437 × 328       |

- **The hero crops. The carousel narrows.** The hero is a banner over the title, and a wide crop of a cover reads as
  a banner. The carousel shows the cook's own photos as photos. A 4.9:1 slice of a plated dish is not a photo of it.
  Keeping 4:3 keeps the framing. The full photo is one tap away, in the lightbox.
- ⛔ **A slide's width comes from the strip's own layout, not the window.** Today each slide is `width: window width`
  (`PhotoCarousel.native.tsx:54`). The strip is 32 dp narrower, because of the detail body's `paddingHorizontal:
spacing[4]` (`RecipeDetailBody.native.tsx:466`). The side insets make it narrower again. `pagingEnabled` pages by
  the strip's width, so slide N is off by N × (32 + insets). **This defect also ships on an upright phone.** The fix:
  the container `View` has `onLayout`, and its width is `availableWidth`. The strip renders after the first layout.
  It sits below the fold on every phone, so the one-frame wait does not show (reasoned).
- The dots row stays centred under the strip.

### 8.3 The lightbox (`PhotoCarousel.native.tsx`, the `Modal` at `:79`)

| Element   | Today                                                    | Spec                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window    | `transparent`, `fade`                                    | add `statusBarTranslucent` and `navigationBarTranslucent`, the Sheet's form. Then the insets are real on both platforms                                                                                                                                                                                                                                                   |
| Photo box | the full window                                          | inside all four safe-area insets (`useSafeAreaInsets`). `contentFit="contain"` is unchanged. A side navigation bar or a cutout never covers the photo                                                                                                                                                                                                                     |
| Close     | `top: 44`, `right: 16`, 40 × 40, white circle, "×" at 22 | `top: insets.top + spacing[2]`, `right: insets.right + spacing[2]`. **48 × 48**: Material's 48 dp is the stricter of it and Apple's 44 pt, and the Sheet's Close is 48. `borderRadius: 24`, `palette.white` fill. Glyph "×", `fontSize: 24`, `lineHeight: 24`, `palette.charcoal`, with `aria-hidden` on the glyph. The name stays `detail.lightboxClose` ("Close photo") |

No RTL locale ships today. If one ships, Close mirrors to the top-left and uses `insets.left`.

## 9. Centred dialogs: `DialogFrame` (A7)

### 9.1 Decision: a primitive

Three dialogs hand-roll the same backdrop, card and scroll. They are `ui/src/confirmDialog/ConfirmDialog.native.tsx`,
`features/recipes/src/actions/RecipeDeleteDialog.native.tsx` and
`features/account/src/danger/AccountEraseDialog.native.tsx`. They have already drifted. Card width: 420, 420, 480.
Height cap: `100%`, `100%`, `85%`. Radius: 16, 20, 16. Padding: 20, 24, 20. The scrim is `rgba(44, 62, 80, 0.4)`, a
charcoal that is not `palette.charcoal`. None avoids the keyboard, and none clears the safe area. That is a third
occurrence with a shared reason to change. Fix it once.

### 9.2 The contract (new): `@commise/ui/dialog-frame`

The files are `ui/src/dialogFrame/DialogFrame.native.tsx`, `props.ts` and `index.ts`. The export is
`"./dialog-frame": "./src/dialogFrame/index.ts"`. It is native only, like `@commise/ui/input`. Its tag:
`@pattern Template Method: the fixed chrome (scrim, insets, keyboard, card, scroll, title), with the host's body and
actions as the step`.

```ts
export interface DialogFrameProps {
    /** When `false`, renders nothing. */
    readonly open: boolean;
    /** Android back (`Modal.onRequestClose`). The scrim is not a dismiss route, as today. */
    readonly onRequestClose: () => void;
    /** The visible heading (header role) and the dialog's name. */
    readonly title: string;
    /** `alert` for a yes-or-no question that interrupts (the delete and discard dialogs). `dialog` otherwise. Only the role changes. */
    readonly role: 'alert' | 'dialog';
    /** Body and actions, in reading order. They scroll inside the card. */
    readonly children: ReactNode;
}
```

| Part     | Spec                                                                                                                                                                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window   | `Modal` from `@commise/ui/modal`, with `visible`, `transparent`, `animationType="fade"`, `statusBarTranslucent`, `navigationBarTranslucent` and `onRequestClose`. `onShow` advances a count                                                                                                                                                                    |
| Scrim    | `flex: 1`, centred, `tint(palette.charcoal, 0.4)`. The padding on each edge is `Math.max(nativeTokens.spacing[4], the inset on that edge)`                                                                                                                                                                                                                     |
| Keyboard | `ModalKeyboardAvoider` (below), `flex: 1`, `width: '100%'`, centred                                                                                                                                                                                                                                                                                            |
| Card     | `width: '100%'` and `maxWidth: 480` (`DIALOG_CARD_MAX_WIDTH_DP`). One value serves all three. Two dialogs grow by 60 dp, which no phone shows. `maxHeight: '100%'` of the avoided box. `palette.white`, `nativeTokens.radius.lg`, and a 1 dp `nativeTokens.borderSubtle` border. Props: `role`, `aria-modal`, `accessibilityViewIsModal`, `aria-label={title}` |
| Scroll   | `ScrollView` with `style={{ flexGrow: 0 }}` and `contentContainerStyle={{ padding: spacing[5], gap: spacing[3] }}`. **`keyboardShouldPersistTaps="handled"`**: with the keyboard up, the first tap on Erase presses Erase. It does not only close the keyboard                                                                                                 |
| Title    | First in the scroll. `Text accessibilityRole="header"`, `fontSize.headingMd`, weight 600, `palette.charcoal`. It takes screen-reader focus on each show (`useScreenReaderFocusOnSignal(shownCount)`), the Sheet's rule                                                                                                                                         |

**A shared avoider (new, internal).** `ui/src/modal/ModalKeyboardAvoider.native.tsx` is a `KeyboardAvoidingView` with
`behavior="padding"` on both platforms (§3.3, E2 I6). The Sheet and `DialogFrame` both use it. It is not a package
export.

**No pinned footer in dialogs.** In all three dialogs, the actions come after what they act on. In the erase dialog
they come after the phrase the cook must type. Reaching them by scrolling follows the task's order. B's rule is not
needed here.

### 9.3 Adoption

| Dialog                      | `role`   | Children                                                   | Behaviour change                                                              |
| --------------------------- | -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ConfirmDialog.native`      | `alert`  | the description, then the actions row (controls unchanged) | insets, keyboard, title focus on show                                         |
| `RecipeDeleteDialog.native` | `alert`  | the body, the two `Button`s, the deleting and error lines  | the same                                                                      |
| `AccountEraseDialog.native` | `dialog` | everything after the title, in the same order              | the same. Also: the cap changes from 85% to the avoided box, and taps persist |

Each dialog's existing test keeps passing unchanged, with one exception. If the erase dialog has a height-cap
test, it moves to `DialogFrame`'s tests. Say where in the commit. `DialogFrame` gets its own tests:

- It renders nothing while closed.
- The padding on each edge is `max(16, inset)`.
- The avoider's `behavior` is `padding` on iOS and unset on Android.
- The scroll has `keyboardShouldPersistTaps="handled"`.
- The title is a header, and it names the card.
- The role passes through.

### 9.4 The erase dialog on a sideways phone (computed)

With the keyboard open, the card gets 149 − 32 (scrim padding) = 117 dp. The title, the phrase field and the actions
scroll inside it. On Android the native `ScrollView` scrolls a focused field into view. On iOS that is not certain
inside a `KeyboardAvoidingView`. A device check is owed (§13.3).

## 10. The subscription nudge on the Sheet (A9)

`mobile/src/components/home/SubscriptionNudge.tsx` replaces its hand-rolled `Modal` with `Sheet` from
`@commise/ui/sheet`.

| Element        | Today                                                         | On the Sheet                                                                                                                                                        | Disposition              |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Presentation   | a full-width bottom panel. No insets, no width cap, no scroll | `size="content"`. The Sheet's insets, its 560 dp cap from 600 dp wide, its scroll region, and its slide (none with reduce motion)                                   | moved into the primitive |
| Title          | `home.nudge.title`, "Unlock Commise Pro", 18 semibold         | `title={home.nudge.title}`, in the Sheet's title type (`displayFontFace.semibold`, `fontSize.headingMd`)                                                            | kept, restyled           |
| × Close        | none                                                          | `closeLabel={home.nudge.close}`, **"Close upgrade offer"**. The house form is `Close {thing}`                                                                       | added                    |
| Body           | `home.nudge.body`, 14, slate                                  | the children: a `Text` in `nativeTokens.fontSize.bodySm` and `palette.slate` (5.24:1)                                                                               | kept                     |
| Actions        | an end-aligned row of `Pressable`s, about 36 dp tall          | `footer`: a row with `flexWrap: 'wrap'` and `gap: spacing[3]`. Each action is a `View` with `flexGrow: 1` that holds a `Button` from `@commise/ui/button`           | changed                  |
| `Maybe later`  | slate text                                                    | first. `Button variant="secondary"`, icon `Feather "clock"`, label `home.nudge.dismiss`                                                                             | kept                     |
| `See plans`    | a seafoam pill                                                | last. It sits at the end, on the thumb's side. In a wrapped row it sits at the bottom. `Button` (primary), icon `Feather "arrow-right"`, label `home.nudge.upgrade` | kept                     |
| Dismiss routes | `Modal.onRequestClose`                                        | every Sheet route (×, scrim, swipe, Android back) calls `onOpenChange(false)`. That maps to `onDismiss`                                                             | added                    |

- **Wrapping.** `flexGrow: 1` has no basis. So each action is as wide as its label until the row is full. At 200%
  text the two actions wrap onto two lines, each full width, before any label wraps inside its button.
- **Copy.** There is one new key, in `mobile/src/i18n/messages.ts`: `home.nudge.close`, en `"Close upgrade offer"`.
  Add it to `MobileMessages['home']['nudge']` with a doc line. The brief's "Not now" and "Upgrade" are not the
  strings. The strings are "Maybe later" and "See plans", unchanged.
- **Focus.** The title takes the cursor on show (the Sheet's rule). Returning focus to the opener is the host's job
  (§S8.1). No gated control exists in v1. The first gated widget (005 to 009) owes a close count and
  `useScreenReaderFocusOnSignal` on its control.
- **Deceptive-pattern screen, run.** Both choices are full-size buttons and equally easy. "Maybe later" is neutral.
  The primary emphasis on "See plans" is ordinary. No element distorts the decision, by the DSA Article 25 test. It
  passes. ⚠️ **Settle one thing before the first gated widget ships.** "See plans" only dismisses
  (`SubscriptionNudge.tsx:65`). A control named for a destination that goes nowhere breaks Nielsen #1 and #4. Wire
  it to 010's plans, or keep the nudge unreachable.
- **Web keeps its own dialog** (`web/src/components/home/SubscriptionNudge.tsx`, Radix). The web `Sheet` is full
  screen below 640 px, which is wrong for three lines of text.

| Element    | Web                                   | Mobile        | Disposition     | Why                                                                                      |
| ---------- | ------------------------------------- | ------------- | --------------- | ---------------------------------------------------------------------------------------- |
| × Close    | none. Escape and the overlay close it | the Sheet's × | added on mobile | Mobile has no Escape. × is the visible single-pointer route. The swipe is not (SC 2.5.7) |
| Swipe down | none                                  | the Sheet's   | added on mobile | platform convention                                                                      |

## 11. Branded serving text (C)

### 11.1 The premise, and what follows

The brief is right. **No web or mobile surface shows a portion today.** The apps never receive
`household_serving_fulltext`. The wire carries food's normalized portions, `{ unit, gramsPerUnit }`
(`packages/schemas/food/src/schemas/foods.schema.ts`, `normalizedPortionSchema`). They are used only for gram
conversion (`recipe-core/src/units.ts:442`, `unitToGrams`).

Three facts decide this:

1. `normalizeUnitToken` (`food-service/src/foods/nutrition/portionNormalization.ts`) strips one trailing `.` or `,`,
   and then a trailing `s`. So the client receives `onz`, `oza`, `grm`, `fl` (from `12 fl. oz.`) and `crust`. For
   `1 . oz` it receives nothing.
2. That file's own doc states KTD-3. Food owns portion interpretation, and "recipe keeps no interpreter", because
   "two services parsing the same label can disagree". ⛔ A client table from `onz` to `oz` is that second
   interpreter.
3. My earlier ruling (`ingredientStatusExplanation.md`, the review table, row 10) says "Common measures" is **later,
   not a V1 gap**. It ships "as their own unit, with the map".

### 11.2 Decisions

**(1) Where it shows: nowhere now.** Build no portion line and no formatter in this change. A formatter with no
surface is dead code. The owner ruled: "`1 ONZ` reads `1 oz`." And: "The stored text stays as USDA published it." The ruling is
applied where the unit is **produced**. That is food's normalizer, at read time. The stored text is untouched, as
OQ-1 requires. That one fix makes conversion and every future display right.

**(2) The mapping, for food's normalizer.** This is a recommendation to the food-service owner and to
`staff-architect`, because it is food's contract, not mine. The normalizer emits recipe-core's canonical unit for
every token that names one. Then the wire, `unitToGrams` and any future display agree.

| Published token (Branded extract count)                                                                              | Emit                 | Authority                                    |
| -------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------- |
| `ONZ` (38), `OZ` (2), `oz` (12)                                                                                      | `oz`                 | UN/CEFACT Rec 20: ONZ is ounce (avoirdupois) |
| `OZA` (3), `fl oz`, `fl. oz.` (two tokens)                                                                           | `fluid ounce`        | Rec 20: OZA is fluid ounce (US)              |
| `GRM` (9), `g` (12)                                                                                                  | `g`                  | Rec 20: GRM is gram                          |
| `MLT`, `ML` (1), `ml` (1)                                                                                            | `milliliter`         | Rec 20: MLT is millilitre                    |
| `Tbsp` (49), `tbsp` (6)                                                                                              | `tablespoon`         | recipe-core `UNIT_ALIASES`                   |
| `tsp` (47)                                                                                                           | `teaspoon`           | recipe-core `UNIT_ALIASES`                   |
| `cup` (51), `CUP` (4)                                                                                                | `cup`                | recipe-core `UNIT_ALIASES`                   |
| `PIECES` (11), `pieces` (4), `PIECE` (4)                                                                             | `piece`              | recipe-core `UNIT_ALIASES`                   |
| any other word: `PACKET`, `COOKIES`, `OLIVES`, `PATTIE`, `Cube`, `SCOOP`, `BAR`, `CAN`, `ROLL`, `SAUSAGE`, `PACKAGE` | lower case, singular | catalog data (D11)                           |

The Rec 20 codes were read on 2026-10-01 from the UNECE list as published in `datasets/unece-units-of-measure`.

**(3) The future "Common measures".** It ships later as its own unit (ruling row 10), on both platforms, in the panel's
§6c slot.

| Part      | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows      | one per portion in a volume or count unit; a mass unit is left out (owner ruling, below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Heading   | `nutritionPortionsHeading`, "Common measures" (already named in `ingredientStatusExplanation.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Row text  | `nutritionPortionTemplate`, amended to `{amount} {unit} = {grams} g`. `amount` is always 1, because `gramsPerUnit` is per one unit. Format it with `Intl.NumberFormat(locale)`. `grams` uses the panel's gram format, `Intl.NumberFormat(locale, { maximumFractionDigits: 1 })` (`nutritionFigureRows.ts:35`)                                                                                                                                                                                                                                                                                     |
| Unit name | A canonical unit (a member of recipe-core `UNIT_VOCABULARY`) is **interface vocabulary**. It gets a `unitNames` message block with one key per member. A test asserts that every member has a key. The en values for mass and volume: `g`, `kg`, `mg`, `oz`, `lb`, `ml`, `l`, `fl oz`. For spoons and cups: `cup`, `tbsp`, `tsp`, `gill`, `wineglass`, `saltspoon`, `dessertspoon`. For large volumes: `pint`, `quart`, `gallon`. For counts: `clove`, `slice`, `piece`, `stick`, `pinch`. Any other word is **catalog text** (D11). It shows as received, in lower case, with `lang="en"` on web |
| Plural    | Not needed. The amount is always 1, so the map holds the form read after "1"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Owner ruling (2026-10-01): mass units stay out of "Common measures".** A portion in a mass unit (`1 oz = 28 g`)
restates the unit, not the food, and a mass unit converts exactly without it. A Branded serving shows on a serving
line of its own, so the owner's `1 oz` example shows on the serving line, not as a measure.

### 11.3 Food normalizer findings (outside my lane, for the food-service owner)

Food-service applied the mapping in (2) and fixed N1 to N5 and N7 (curated catalog plan KTD-28). The Rec 20 codes
are aliases in recipe-core's unit table, and the normalizer emits recipe-core's canonical unit. A unit that
`normalizeUnit` does not keep fixed, such as `glass`, is no longer emitted. N6 is a typo in the data and still
reads `piec`. The same work found that SR Legacy and Foundation labels were stored without USDA's amount, so the
normalizer read 2 of 14,572 seeded USDA servings. Labels now carry the amount.

| #   | Input                               | Today                             | Effect                                                                                                                     |
| --- | ----------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| N1  | `8 OZA`                             | unit `oza`                        | **Functional.** `unitToGrams` normalizes both sides. `oza` never equals a cook's `fluid ounce`, so that line gets no grams |
| N2  | `12 fl. oz.`                        | unit `fl`                         | The same as N1. Only the first unit token is read                                                                          |
| N3  | `1 . oz`                            | portion dropped                   | The gram weight is lost                                                                                                    |
| N4  | `1 ONZ`, `100 GRM`                  | `onz`, `grm`                      | No harm to conversion, because mass lines convert directly. The text on the wire is wrong                                  |
| N5  | any singular word that ends in `s`  | the `s` is cut (`glass` → `glas`) | The plural rule cannot tell a plural from a word that ends in `s`                                                          |
| N6  | `piecs` (a typo in the data)        | `piec`                            | Not a unit. Nothing matches it                                                                                             |
| N7  | `Tbsp` and `tablespoon` on one food | two portions                      | Dedup keys on the raw token, not the canonical unit. No harm, because the first match wins                                 |

Test the fix over the committed 302-row extract (`brandedExtract20260430.jsonl`). Every emitted unit is canonical, or
a lower-case singular word. None is punctuation. None is `onz`, `oza` or `grm`.

## 12. Accessibility contract

| Criterion                                     | How this spec meets it                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.3.4 Orientation (AA)                        | Every surface here works sideways. The Maestro flow proves typing sideways (§13.2)                                                                                                          |
| 1.4.4 Resize Text (AA)                        | The footer unpins past half. The wizard row wraps. The nudge's actions wrap before their labels do. Titles wrap and are never clamped                                                       |
| 1.4.10 Reflow (AA)                            | No horizontal scroll. Header rows and control rows wrap. The carousel narrows instead of overflowing                                                                                        |
| 2.4.3 Focus Order (A)                         | The reading order is the same in every layout, because each group keeps its children's order. On web, `Done` keeps focus through a flip. Native accepts a lost cursor on a rare flip (§3.3) |
| 2.4.11 Focus Not Obscured (AA)                | Web: `scroll-padding-bottom` under a pinned sticky footer (C43). Native: a pinned footer is outside the scroller, so it cannot cover a focused item                                         |
| 2.5.7 Dragging Movements (AA)                 | The nudge gains ×, a single-pointer route. The swipe is never the only route                                                                                                                |
| 2.5.8 Target Size (AA), with Material and HIG | The lightbox Close is 48 × 48 dp. The nudge's actions use the `Button` primitive's 44 dp floor. WCAG asks 24 × 24                                                                           |
| 3.2.1 On Focus (A)                            | Collapsing chrome changes content, not context. Focus, window and screen stay. The field does not move in the tree                                                                          |
| 3.3.2 Labels or Instructions (A)              | No full-screen editor hides a field's label (§7)                                                                                                                                            |
| 4.1.2 Name, Role, Value (A)                   | `DialogFrame` names the card by its title and passes the role. The nudge's × is named by `home.nudge.close`                                                                                 |
| Screen-reader focus on show                   | `DialogFrame` and the nudge's Sheet put the cursor on the title. Returning it to the opener stays the host's job (unchanged for the three dialogs, §14)                                     |

## 13. Proof

### 13.1 Tests, written first

| Tier        | What                                                                                                                                                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (pure) | `isCompactHeight` at 479 and 480. `isFrameCollapsed`'s four rows. `isFooterUnpinned`: exactly half gives `false`. One over gives `true`. A `frame` of 0 gives `false`. One row proves the toolbar is not an input. `mediaBoxHeight` and `carouselBox` with the table in §8.2. `sheetSideInsetPadding` with §6's values |
| Component   | See the list below                                                                                                                                                                                                                                                                                                     |
| Guard       | `textInputAdapterImports.test.ts` (§7.2)                                                                                                                                                                                                                                                                               |
| Maestro     | `mobile/.maestro/recipes/landscape.yaml` (§13.2)                                                                                                                                                                                                                                                                       |
| Playwright  | None. Item B's web Sheet has no web-app consumer yet                                                                                                                                                                                                                                                                   |

Component tests:

- `SheetPanel` (web). The footer is the same node before and after a flip. It is `sticky` only while pinned.
  `scroll-padding-bottom` is set only while it is pinned and shown.
- `BottomSheetPanel`. When pinned, the footer is outside the scroller. When unpinned, it is the scroller's last
  child. The hairline is there in both. The footer's height is kept through a collapse.
- `RecipeEditor`. The rewritten ancestry test (§4.2).
- Both frames. The field is the same element across the regular, compact and collapsed layouts: focus it, change
  the layout, and it keeps focus. Collapsed renders no chips, no dial and no filter row.
- `RecipesScreen`. It hides the TabBar in the collapsed state only.
- `DialogFrame` (§9.3).
- `PhotoCarousel`. A slide's width equals the strip's laid-out width. The lightbox Close is 48 and offset by the
  insets.
- `SubscriptionNudge`. Every route calls `onDismiss` once. × is named "Close upgrade offer".
- The `TextInput` adapter. `disableFullscreenUI` is `true` and cannot be overridden. A ref reaches `focus`.

### 13.2 `landscape.yaml`: what it newly proves

Remove the portrait round trip. Remove the header bullet that says the flow does not prove typing on a sideways phone. Keep
the flow read-only. On a sideways phone:

1. **List search, collapsed.** `tapOn: 'Search recipes'`. `inputText` the first word of the lamb recipe.
   `assertNotVisible: 'Discover'`: the TabBar stepped aside. With the keyboard open, assert the list's count row,
   `'^1 recipe$'`. It is the first row, so it fits in 87 dp. The card's title can sit below its image. Then
   `hideKeyboard`, `assertVisible: 'Discover'` (it came back) and `assertVisible: '${E2E_RECIPE_LAMB}'`. Clear the
   field.
2. **The filter sheet with the keyboard up.** On Discover: `tapOn: 'Filters'`, `tapOn: 'Search ingredients'`,
   `inputText: '${E2E_PROBE_INGREDIENT}'`, `scrollUntilVisible: 'Filter by ${E2E_PROBE_INGREDIENT}'`, and tap it.
   Then `scrollUntilVisible: 'Done'` and `tapOn: 'Done'`. This proves that an unpinned `Done` is reachable. Clear the
   filter as `searchNavigation.yaml` does. ⚠️ While I6 is open on Android, this step proves reachability only.
3. **Wizard typing.** `tapOn: 'Title'`, `inputText: 'Maestro Landscape Draft'`. With the keyboard still open,
   assert the field, not the header. `Wizard.Header` also shows the title, so match the second node:
   `assertVisible: { text: 'Maestro Landscape Draft', index: 1 }`. Then `hideKeyboard` and `assertVisible: 'Next: Ingredients'` with
   **no scroll**: the bar pinned again. Tap it.
4. **Picker typing.** `tapOn: 'Search ingredients'`, `inputText: '${E2E_PROBE_INGREDIENT}'`. Wait for its result
   and tap it. `hideKeyboard`. Assert that the line was added.
5. Keep the steps for the draft that survives rotation, and for the discard dialog.

⚠️ **Maestro cannot prove that the full-screen editor is absent.** Its hierarchy can still report the app's nodes
under the editor. The proof is the adapter's unit test, the guard, and a device check.

### 13.3 Owed on a device (no test tier in this repo can prove these)

- Opening the keyboard on Android leaves `useWindowDimensions().height` unchanged (§2).
- E2 I6, answered: an edge-to-edge window does not resize (§3.3). Still owed: React Native reports the keyboard while
  a `Modal` window holds it, so `ModalKeyboardAvoider` pads the Sheet and `DialogFrame` on Android.
- On iOS, a focused field inside a `ScrollView` inside a `KeyboardAvoidingView` scrolls into view (the erase dialog,
  the wizard).
- No full-screen editor appears for any field on a sideways phone, with Gboard and with one OEM keyboard.
- The lightbox Close clears a side cutout on an iPhone held sideways.

## 14. Out of scope, and findings outside this change

- **A `SearchField` primitive** (design system, later). The five search fields have four looks. Their borders are
  `rgba(178, 190, 195, 0.3)` on white, about 1.1:1. For a field that holds text, the placeholder no longer
  identifies it. So that border likely fails SC 1.4.11 for the field's boundary. §S8.2 already specifies
  `border-slate` (5.24:1). A `SearchField` fixes that once.
- **The `Button` primitive's native floor** is 44 dp (`Button.native.tsx`, `MIN_TOUCH_HEIGHT`). §S13 asks 48 dp for
  native action buttons. The hand-off reports it. This change does not alter it.
- **The buttons in `ConfirmDialog.native` and the erase dialog** are about 36 dp tall. The erase dialog's recipe
  checkboxes are about 28 dp. They pass WCAG 2.5.8 and fail HIG and Material. This change does not alter them.
- **Focus return** for the three centred dialogs. No host returns the screen-reader cursor to the opener today.
- **Web on a short window** (844 × 390). §S8.1a's open check for U15 stands. Item A is mobile only.
- **`RecipesScreen` keeps the bottom inset while a keyboard is open.** On a sideways 3-button phone that inset is 0.
  So this change leaves it alone.

## 15. Success measure

**Signal.** A cook can create a recipe with one ingredient, search, filter and read a recipe on a phone held
sideways, without turning it. The extended `landscape.yaml` passes on every CI run, and the device checks in §13.3
pass once.

**Guardrail.** The upright flows that guard U32 (`pinnedActionBar.yaml`, `create.yaml`, `searchNavigation.yaml`)
stay green, unchanged. They run at the default font scale. If one needs an edit, the rule fired on an upright phone
at 100% text, which §4.3 says it does not.

**First sign of trouble.** A Maestro flow that has to scroll to reach `Next` on an upright phone at 100% text.

## 16. Pattern register

| Unit                                                      | Pattern                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `isCompactHeight`, `isFrameCollapsed`, `isFooterUnpinned` | Specification (pure predicates)                                                      |
| `mediaBoxHeight`, `carouselBox`, `sheetSideInsetPadding`  | Policy (pure rules)                                                                  |
| `TextInput` (`@commise/ui/text-input`)                    | Adapter over React Native's `TextInput`, with one prop fixed (the `Modal` precedent) |
| `usePinnedFooter` (web)                                   | Adapter over `ResizeObserver`. It uses refs, so the tag is mandatory                 |
| `usePinnedFooter` (native)                                | Adapter over React Native layout events                                              |
| `DialogFrame`                                             | Template Method: fixed chrome, the host's body                                       |
| `ModalKeyboardAvoider`                                    | Adapter over `KeyboardAvoidingView`, with one platform rule                          |
| `SheetPanel`, `BottomSheetPanel`                          | Template Method (unchanged). On native the footer gains two fixed slots              |
| The frames' header and controls groups                    | No pattern. Layout only, so no tag (the layer rule)                                  |
