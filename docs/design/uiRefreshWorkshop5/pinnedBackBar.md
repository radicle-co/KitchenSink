# Pinned back bar on pushed pages — SPECIFY

> **What this is:** the committed design for one shared control. It is the back control on every pushed page, on
> native (phone and tablet) and on web. **What it is not:** production code, or a redesign of any page body. Author:
> `staff-ux-engineer`, 2026-10-23. It binds with `ownerFeedback.md`. Fold it into the redesign canvas (section 9).

## 1. The problem, and its two causes

Measured on iOS (CI run 39949307086, and locally): after a scroll, "Back to Profile" sat at bounds `[16,-2][60,41]`.
The tap landed on the status bar, and iOS scrolled the page to its top instead of going back.

The code has two defects. A lower scroll threshold fixes neither of them.

1. **A dead band.** `LargeTitleHeader.native.tsx` puts Back in a 44 pt row _above_ the H1, inside the scroller.
   The rule for `CondensedTitleBar` is `y >= headingBottom` (`ui/src/scrollHost/scrollState.ts`). So Back scrolls away
   about 44 pt plus the title height before the bar's Back appears. During that band the page has no reachable Back.
2. **An off-screen duplicate.** Once the bar shows, the header's Back is still in the accessibility tree, scrolled off
   but not hidden. The page then has two elements named "Back to Profile". The measured x of 16 is the content gutter
   (`spacing[4]`). The bar's Back sits at `spacing[2]`. So Maestro found the off-screen copy, and a screen-reader user
   swiping in order meets it too.

This is a class of defect, not one screen's bug. Where each screen stands today:

| Screen (native)   | Back today                                                                          | Condensed bar | Loading has Back         |
| ----------------- | ----------------------------------------------------------------------------------- | ------------- | ------------------------ |
| Profile           | `LargeTitleHeader` row (`mobile/src/screens/profile.tsx:111`)                       | Yes (`:146`)  | n/a                      |
| Data sources      | Same (`DataSourcesPushedPage.native.tsx:45`)                                        | Yes (`:55`)   | n/a                      |
| Collection detail | Header row (`CollectionHeader.native.tsx:115`), plain `ScrollView`, no `ScrollHost` | **No**        | **No** (`LoadingNotice`) |
| Version history   | Header row (`RecipeVersionList.native.tsx:83`)                                      | **No**        | Yes (skeleton header)    |
| Recipe detail     | `HeroButton` disc over the photo (`RecipeDetailScreen.tsx:261`)                     | **No**        | **No** (skeleton)        |

There is a shared primitive: `LargeTitleHeader` plus `CondensedTitleBar` (`packages/apps/commise/ui/src/largeTitleHeader/`).
Recipe detail does not use it, and builds its own Back from `HeroButton`. Profile and Data sources each build the same
frame (scroll host, header, bar) by hand. ⚠️ Unverified: I found no scroller in the native version-history path
(`RecipeVersionsView.tsx` → `RecipeVersionList.native.tsx`). If there is none, a long history cannot scroll at all.
Check this on a device. Adopting the frame below gives the page its scroller either way.

## 2. Decision: Back is pinned. The large title scrolls under it

**The invariant:** on a native pushed page, Back is pinned at the top of the safe area at every scroll position and
in every state. It is never a child of the scroller. Exactly one element in the tree carries the name
"Back to {parent}". The one exception is the not-found notice's own action (section 5).

Why:

- **Platform convention.** Apple HIG, _Toolbars_ (fetched 2026-10-23): "By default, a large title transitions to a
  standard title as people begin scrolling the content, and transitions back to large when people scroll to the top."
  Only the _title_ moves. The navigation bar, and the Back in it, stay put. Android, _App bars_ (Compose docs,
  fetched 2026-10-23): `navigationIcon` "Appears on the left of the app bar". `exitUntilCollapsedScrollBehavior`
  collapses the large bar to the small bar, and the navigation icon stays. We do **not** use `enterAlways`, which
  hides the whole bar while you scroll down.
- **Reach and recovery.** A cook deep in a long recipe must be able to leave without scrolling back up. An edge swipe
  is an invisible gesture, and its visible alternative must be on screen (corpus `interaction-motion.md`, Gesture).
  Back does sit in the top corner, which is a stretch on a large phone. That is the cost of following the convention
  every other app on the device has taught (Jakob's Law, corpus `device-ergonomics.md`, Platform convention). The
  edge swipe and Android's system back remain the low-reach routes.
- **The owner's decisions.** This is the same rule as R1 and R2: the way out stays reachable from wherever the cook
  is. The round 9 scrolled boards (`pilot/round9/mockup.html`, `recipeScrolled`) already draw it: a slim top bar
  with Back, the title and More, and the ingredients bar under it.

## 3. Geometry, status bar and safe area

- **One bar height, 56 pt, and it never changes** (`BAR_HEIGHT` in `CondensedTitleBar.native.tsx`, and buildSpec §3.3).
  Export it as `PINNED_BAR_HEIGHT`. The round 9 board draws 52, and that board is updated to 56.
- **Status bar.** The bar sits at the top of `ScreenFrame`'s safe area (`mobile/src/navigation/ScreenFrame.tsx`),
  which already clears the status bar. The bar adds no inset of its own, as the existing measurement note requires.
  Nothing interactive sits inside the status-bar inset. A tap there keeps doing what iOS does, which is scroll to the
  top. That is a platform feature we no longer collide with.
- **The scroller fills the frame and runs under the bar**, so the bar's material has content behind it. On a canvas
  page, the content's top padding is 56 pt. This replaces the header's 44 pt `underRow` plus the 8 pt body padding.
  The H1 lands within a few points of where it is today, so nothing jumps.
- **On a photo page** (recipe detail), the content's top padding is 0. The hero starts under the bar, as on the board.
- ⚠️ **Screen-reader focus under the bar** (the native form of WCAG 2.2 SC 2.4.11). A VoiceOver or TalkBack swipe
  scrolls the next element into the scroller's bounds, and those bounds include the strip under the bar. This must be
  checked on a device (section 8). If a focused row can end fully under the bar, use this fallback:
  `contentInset` and `scrollIndicatorInsets` of 56 on iOS 26, where the glass needs content behind it. On Android
  and older iOS, which have no glass, start the scroller below the bar.
- **Large title.** It stays in the content and scrolls under the bar. It does not shrink or move on its own, so no
  transform is applied. When its last line is fully under the bar's bottom edge, the bar's one-line title appears.
  ⚠️ This fixes a measurement: `headingLayout` reports y relative to the header `View`, not to the scroll content. The
  rule must be `y + PINNED_BAR_HEIGHT >= headingBottom`, measured in content coordinates.
- **Material.** The bar uses `ChromeSurface edge="bottom"`: Liquid Glass on iOS 26, `paperRaised` with a
  `lineDivider` hairline on Android and older iOS. P4 applies: the chevron is `actionText`, and the surface is never
  steel.
- **Android.** Android is edge to edge, and the same inset applies. System back and predictive back stay with the
  navigator. `BackInterceptProvider` is unchanged (ADR-0056).
- **The sticky section switch on recipe detail.** The native detail still has the 48 pt sticky switch
  (`RecipeDetailView.native.tsx`, `ACTIVATION_OFFSET_PT`). R3 removes it, and R3 is not built. A sticky header sticks
  at the top of its scroller, so under this frame it parks under the bar. **Decision: recipe detail adopts the frame
  in the same change as R3.** It does not adopt it before.
- **Stacking on recipe detail (R1, P2).** From the top: the status-bar inset, the pinned bar (56), then the ingredients
  bar, whose top is derived from `PINNED_BAR_HEIGHT` rather than a literal. At the bottom, the timer dock sits above
  the tab bar.

## 4. Control, accessibility and motion

- **Target size.** The frame is 44 × 44 pt on iOS (Apple HIG) and 48 × 48 dp on Android (Material). Use
  `HeroButton`'s `touchFloor()` precedent. Today's `CondensedTitleBar` Back is 44 × 44 with no `hitSlop`, which fails
  Material. Both sizes meet the 24 × 24 of WCAG 2.2 SC 2.5.8. The bar's start padding is `spacing[2]`. The glyph is
  centred in the frame, so it lines up with the 16 pt content gutter (N6).
- **Label.** Phone: chevron only. Tablet (container class medium and up): chevron plus the parent's name, on one line,
  truncated with an ellipsis at 40% of the bar's width (a judgement, not a cited figure). This matches the round 9 tablet back link, and HIG's advice
  not to label the button "Back". The accessible name is always the full "Back to {parent}"
  (`profileMessages.backToProfile`, `collectionMessages.detail.backTo`, and the others), so truncation never reaches
  a screen reader. ⚠️ Version history passes `versionList.backToRecipe` as both the label and the parent. The parent
  must become the recipe's title (or "Recipe"), or the tablet label reads "‹ Back to recipe".
- **Reading and focus order.** The bar is rendered **before** the scroller in the tree and drawn over it by absolute
  position, so tree order and screen position agree. The order is: Back, then ⋯ (if any), then the H1, then content.
  The bar's title repeats the H1 and stays `aria-hidden`. Route focus stays on the H1 (`focusSignal`), as today.
- **iOS escape gesture.** Bind the frame's `onAccessibilityEscape` to `back.onPress`, so the VoiceOver two-finger
  scrub goes back, as it does in native iOS apps.
- **No duplicate.** On native, `LargeTitleHeader` stops rendering a Back control at all. It keeps the `back` prop,
  because web uses it for the 840+ eyebrow. It draws its 44 pt row for an `action` and for nothing else.
- **Motion.** The timing is the platform's. On iOS 26 the glass animates through its own `glassEffectStyle`. The
  title and the solid surface use `ENTER_DURATION_MS` (`ui/src/motion/enterMotion.ts`), the one motion token there is,
  as an opacity fade only. Under Reduce Motion (`useReduceMotion`) the change is instant. Glass changes through `ChromeSurface`'s `visible` and never through an
  opacity on its ancestor (existing ⛔ in `CondensedTitleBar.native.tsx`).

## 5. Every state

| State                                   | Bar                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top of page, canvas                     | Back (plain chevron) and ⋯ only. Transparent: no material, no title.                                                                                                                      |
| Top of page, photo (recipe detail)      | Back and ⋯ drawn as `HeroButton` discs over the photo. No material.                                                                                                                       |
| Content under the bar, H1 still visible | Canvas: material on. Photo: unchanged until the H1 passes.                                                                                                                                |
| H1 fully under the bar                  | Material on, and the one-line title shows. On a photo page the discs become plain glyphs: the **same** pressable with the same accessibility node, only its look changes.                 |
| A page that does not scroll             | Stays in the top-of-page look. It never gains material.                                                                                                                                   |
| Loading                                 | Back. The title shows too where the page knows it ("Version history"). Recipe and collection loading show Back with no title.                                                             |
| Generic error                           | Back is in the bar. The notice keeps Try again only. Native callers stop passing `back` to `RecipeLoadError` and `CollectionLoadError`.                                                   |
| Not found                               | Back is in the bar. The notice keeps "Back to {parent}" as its one action, because it is the only next step and it sits in reach. This is the only allowed second element with that name. |
| Offline or refresh notices              | In the content, under the H1, unchanged.                                                                                                                                                  |

The bar is mounted by the screen, **outside** `QueryBoundary`, so loading, error and settled share one bar and Back
never moves between states.

## 6. Web

- **840 and wider: no change.** The eyebrow link above the H1 stays in the content. A desktop has no status bar to
  collide with, and it has the sidebar, the browser's Back and Alt+Left. A pinned bar costs height on every page and
  gives no new route out. This is a translation, not a port.
- **Below 840 (web 390 and 768, where the canvas says "like the phone"): adopt the same bar,** using the web leaf of
  the same component. Today **nothing uses** the web `CondensedTitleBar` (`fixed`, `nav:hidden`). So pushed web pages
  below 840 lose Back on scroll, as native does. On web the **document** scrolls, and `AppShell.tsx:90` already
  mounts the page's one `ScrollHost`. So the web frame mounts no host of its own and reads that one. The bar is fixed
  at `top: 0`. Where the viewport uses
  `viewport-fit=cover`, it pads its top by `env(safe-area-inset-top)`. Below 840 the
  `html` element sets `scroll-padding-top: 56px`, so a focused control is never hidden under the bar (WCAG 2.2 SC
  2.4.11). The web `condensed` rule (`ui/src/scrollHost/ScrollHost.tsx`, an `IntersectionObserver` on the H1) takes a
  top `rootMargin` of `-56px` on pushed pages. Without it, web has the same dead band. Recipe detail's
  `nav:hidden` `HeroButton` (`web/src/components/recipes/RecipeDetailContainer.tsx:260`) hands over to the bar as on
  native. Back stays a `RouteAction` with `href`, so a modified click still works.

## 7. Where it lives

- **Change** `CondensedTitleBar` (`ui/src/largeTitleHeader/`, both leaves, and `props.ts`). Replace `visible` with two
  display facts: `surfaceShown` and `titleShown`. A given `back` or `menu` is **always** rendered and pressable.
  Add `appearance: 'canvas' | 'photo'`, which only changes how the controls are drawn. Home
  (`mobile/src/screens/HomeScreen.tsx:78`, which passes no Back) sets both facts to `condensed` and looks as it does
  today.
- **Change** `LargeTitleHeader.native.tsx` so it renders no Back control (section 4).
- **New** `PushedPageFrame` (`ui/src/pushedPage/`, native and web leaves, package export `@commise/ui/pushed-page`).
  Profile and Data sources already build this frame by hand. Five screens need it, so it is extracted once (DRY). Pattern: `@pattern Template — scroll host, pinned bar, content padding`.

    ```ts
    interface PushedPageFrameProps {
        back: HeaderBack; // existing type, props.ts
        title?: string; // the bar's one-line title; absent while loading
        menu?: ReactNode; // the page's ⋯, moved out of the content
        appearance?: 'canvas' | 'photo'; // default 'canvas'
        sections?: readonly string[]; // passed to ScrollHost
        activationOffset?: number; // plus PINNED_BAR_HEIGHT, added by the frame
        children: (bind: ScrollBind) => ReactNode;
    }
    ```

    ⛔ **One `ScrollHost` per page.** Today `RecipeDetailView.native.tsx`, `DataSourcesPushedPage.native.tsx` and
    `profile.tsx` each mount their own. Those inner hosts are removed, and each page takes the frame's host and `bind`.
    With a second inner host, the scroller binds to it while the bar reads the outer one, so the bar never changes.

    `surfaceShown` is `!atTop` on a canvas page and `condensed` on a photo page. `titleShown` is `condensed`. Both come
    from the frame's own `ScrollHost`. A screen in its loading or error state renders the frame with a child that does
    not scroll.

- **Adopters:** Profile, Data sources, collection detail, version history (list, skeleton and error), and recipe
  detail. On collection detail and recipe detail the ⋯ menu moves into the bar. Collection's Add recipes button stays
  in the content. Recipe detail's `heroControls` no longer carry Back or ⋯.
- **Out of scope:** the editor (a focused task with Close, `RecipeEditorScreen.tsx:105`) and tab roots.
- **Cheaper path:** change the two components and adopt the frame on Profile and Data sources only. That removes
  both defects on the screen that failed in CI. The other three screens follow. They have no bar today, so until then
  they still lose Back on scroll.

## 8. Tests the build needs (test-first, every tier)

**Component tests (vitest and RTL, both leaves).**

- `CondensedTitleBar`:
    - Back is pressable whether `surfaceShown` and `titleShown` are false or true.
    - The title stays `aria-hidden`.
    - `photo` versus `canvas` produce the same single element.
    - The Android frame is ≥ 48.
    - Reduce Motion leaves no transition.
- `LargeTitleHeader.native`: renders no button named after `back.label`.
- `PushedPageFrame`:
    - A test per state in section 5: top, under, condensed, does not scroll, photo handover.
    - Exactly **one** element named "Back to {parent}" at every scroll position.
    - Back comes before the H1 in tree order.
    - `onAccessibilityEscape` calls back.
- `scrollState.ts`: a pure test of the corrected `condensed` threshold, in content coordinates.
- Screen tests (Profile, Data sources, collection detail, version history, recipe detail):
    - Loading, generic error, not-found and settled each have one Back, in the bar.
    - Generic error: the notice has no Back.

**On a device, with VoiceOver and with TalkBack.** Swipe down through a long page, then back up. A focused element must
never end fully under the bar. If one does, apply the fallback in section 3.

**Maestro, on iOS and Android.**

- `dataSources.yaml`: **delete the workaround at lines 48–57** (the optional `scrollUntilVisible` UP). Scroll to the
  end, `tapOn: 'Back to Profile'` with no scroll up, then assert Profile. A tap that hits the status bar scrolls to
  the top, and that assertion then fails, so this flow is the regression check.
- Add the same check to the recipe detail (a long recipe, scroll to the last step), collection detail and version
  history flows.

**Playwright (web).**

- At 390 on each pushed page: scroll to the end, then the Back control is `toBeInViewport()`, there is exactly one
  visible match by `getByRole`, and a click on it opens the parent page.
- Tab through the page with the bar present, and assert that no focused element is fully covered (SC 2.4.11).
- At 1280: the eyebrow link is unchanged, and the fixed bar is not displayed.

## 9. The redesign canvas

Fold this in. The round 9 `recipeScrolled` boards already assume it, so this spec makes the board's top bar the rule
for every pushed page. Owed boards:

- the scrolled state for collection detail, version history, data sources and profile, on phone and on 834
- the tablet back label
- the topBar height corrected to 56.

Keep P4: the bar is neutral and only the chevron is steel.
