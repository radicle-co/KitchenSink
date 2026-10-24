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

- **One bar height, 56 pt, and it never changes** (buildSpec §3.3). It is one token, `pinnedBarHeight`
  (`ui/src/tokens/layout.ts`). Native reads it as `PINNED_BAR_HEIGHT` (`ui/src/largeTitleHeader/barGeometry.ts`). Web
  reads it as `--pinned-bar-height`, and as `--pinned-bar-block`, which adds the notch inset (`ui/src/tokens/themeCss.ts`).
  The round 9 board draws 52, and that board is updated to 56.
- **Status bar.** The bar sits at the top of `ScreenFrame`'s safe area (`mobile/src/navigation/ScreenFrame.tsx`),
  which already clears the status bar. The bar adds no inset of its own, as the existing measurement note requires.
  Nothing interactive sits inside the status-bar inset. A tap there keeps doing what iOS does, which is scroll to the
  top. That is a platform feature we no longer collide with.
- **The scroller fills the frame and runs under the bar**, so the bar's material has content behind it. On a canvas
  page, the content's top padding is 56 pt. The frame owns that padding and hands it to the page as an `inset`
  (`{ paddingTop: PINNED_BAR_HEIGHT }`). The page's scroller merges it in. So does a loading or error wrapper that does
  not scroll. No page restates the bar's height. This replaces the header's 44 pt `underRow` plus the 8 pt body
  padding. The H1 lands within a few points of where it is today, so nothing jumps.
- **On a photo page** (recipe detail), the content's top padding is 0. The hero starts under the bar, as on the board.
- ⚠️ **Screen-reader focus under the bar** (the native form of WCAG 2.2 SC 2.4.11). A VoiceOver or TalkBack swipe
  scrolls the next element into the scroller's bounds, and those bounds include the strip under the bar. This must be
  checked on a device (section 8). If a focused row can end fully under the bar, use this fallback:
  `contentInset` and `scrollIndicatorInsets` of 56 on iOS 26, where the glass needs content behind it. On Android
  and older iOS, which have no glass, start the scroller below the bar. ⚠️ The fallback breaks the condensed rule
  below. If you apply it, re-derive that rule and `atTop` (see the next point).
- **Large title.** It stays in the content and scrolls under the bar. It does not shrink or move on its own, so no
  transform is applied. When its last line is fully under the bar's bottom edge, the bar's one-line title appears.
  **The native rule stays `y >= headingBottom`** (`ui/src/scrollHost/scrollState.ts`), and the native `ScrollHost`
  takes no bar height. Two 56s cancel. `headingLayout` reports the title's y relative to the header `View`, and the
  header starts at content y 56, because of the inset. So the title's bottom is at content y `56 + headingBottom`. The
  bar covers the top 56 of the scroller, so its bottom edge is at content y `scrollY + 56`. The title is under the bar
  when `scrollY + 56 >= 56 + headingBottom`, which is `scrollY >= headingBottom`. This holds only while two things are
  true. First, **the header is the first thing in the content**, and it starts at the inset. Second, **the scroller
  starts at the top of the frame**, under the bar. Anything drawn above the header in the content breaks it. So does
  the `contentInset` fallback above, because the offset then starts at −56: the rule becomes `scrollY >= headingBottom − 56`, and `atTop`
  becomes `scrollY <= −56`. Starting the scroller below the bar keeps the rule, because then there is no cover and no
  inset. A test pins the cancellation (`ScrollHost.native.test.tsx`, "needs no inset for a pinned bar").
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
  Material. Both sizes meet the 24 × 24 of WCAG 2.2 SC 2.5.8.
- **Position.** The chevron's 24 pt box starts on the 16 pt content gutter (N6), on a phone and on a tablet. Native
  pushed pages pad their content by `spacing[4]` at every width, so 16 is the gutter there. The bar's start padding is
  derived, not a spacing step: `barStartPadding(floor) = 16 − (floor − 24) / 2` (`barGeometry.ts`). That is **6 on
  iOS** and **4 on Android**. So the touch frame's left edge is at x = 6 or x = 4, and the glyph is at 16 on both. A
  test or a Maestro assertion on the frame's bounds expects 6 or 4, not 16. Android's number is the platform's own.
  Compose's `TopAppBar` pads its navigation icon by 4 dp (`TopAppBarHorizontalPadding` in `AppBar.kt`, androidx-main,
  read 2026-10-23). That puts a 24 dp icon in a 48 dp button at 16. On a tablet the frame grows to hold the parent's
  name. The control then pads its own start by the glyph's room (`backGlyphInset`). The glyph stays at 16. ⚠️ Native pushed pages do not use the per-class gutter (`gutter.medium` is 24). If they change to it,
  `barGeometry.ts` must read the same number. If it does not, the chevron leaves the gutter at tablet width.
- **Label.** Phone: chevron only. Tablet (container class medium and up): chevron plus the parent's name, on one line,
  truncated with an ellipsis at 40% of the bar's width (a judgement, not a cited figure). This matches the round 9 tablet back link, and HIG's advice
  not to label the button "Back". The accessible name is always the full "Back to {parent}"
  (`profileMessages.backToProfile`, `collectionMessages.detail.backTo`, and the others), so truncation never reaches
  a screen reader. **One page names its parent the same at every width.** So the settled version history names the
  recipe's title ("‹ Pasta e fagioli"). There are two reasons. The large header's eyebrow at 840 and
  wider already names it (`RecipeVersionList.tsx`, `recipeTitle ?? recipeParent`). And once the H1 and its subtitle
  scroll away, the bar is the only place that says whose history this is. Loading and error do not know the title yet,
  so they say "‹ Recipe" (`versionList.recipeParent`). When the page settles, only the label text changes. The chevron
  does not move.
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

| State                                        | Bar                                                                                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top of page, canvas                          | Back (plain chevron) and ⋯ only. Transparent: no material, no title.                                                                                                                                                  |
| Top of page, photo (recipe detail)           | Back and ⋯ drawn as `HeroButton` discs over the photo. No material.                                                                                                                                                   |
| Content under the bar, H1 still visible      | Canvas: material on. Photo: unchanged until the H1 passes.                                                                                                                                                            |
| H1 fully under the bar                       | Material on, and the one-line title shows. On a photo page the discs become plain glyphs: the **same** pressable with the same accessibility node, only its look changes.                                             |
| A page that does not scroll                  | Stays in the top-of-page look. It never gains material.                                                                                                                                                               |
| Loading                                      | Back. The title shows too where the page knows it ("Version history"). Recipe and collection loading show Back with no title.                                                                                         |
| Generic error                                | Back is in the bar. The notice keeps Try again only. For a not-found error only (`isNotFoundError`), callers pass `back` to `CollectionLoadError`, and later to `RecipeLoadError`. Web from 840: see below the table. |
| Not found                                    | Back is in the bar. The notice keeps "Back to {parent}" as its one action, because it is the only next step and it sits in reach. This is allowed exception 1.                                                        |
| Empty (version history, no earlier versions) | Back is in the bar. The empty state keeps its "Back to recipe" button, for the same reason as not found. This is allowed exception 2.                                                                                 |
| Offline or refresh notices                   | In the content, under the H1, unchanged.                                                                                                                                                                              |

**The two allowed exceptions** share one rule. A state whose only next step is to go back keeps that step as its one
action, inside the content and in thumb reach. Its accessible name is the same as the bar's, so a screen reader meets
"Back to {parent}" twice on that state. That is accepted, because both go to the same place. No other state has a
second element with that name.

**Each state mounts its own frame.** The bar is not outside `QueryBoundary`. The settled bar's title, and on version
history its parent's name, exist only once the read settles. So loading, error and settled each render
`PushedPageFrame` with the same `back`, and the bar sits in the same place in all three. When the read settles, the
bar remounts. That is the accepted cost. It is invisible, because the control's position and name do not change. The
frame belongs to the route, not to the presentational leaves (`RecipeVersionsFrame.tsx`,
`CollectionDetailContainer.tsx`, `RecipeVersionsScreen.tsx`, `CollectionDetailScreen.tsx`).

**Web from 840, a state with no header** (collection loading and collection generic error). The bar is hidden there,
and the state has no large header, so it has no eyebrow. Without a fix it has no Back at all. **From 840 it shows the
settled header's "‹ Collections" eyebrow, above the notice** (`hidden nav:inline-flex`, the classes of `BackLink` in
`LargeTitleHeader.tsx`). Below 840 the eyebrow is `display: none`, so it is not in the accessibility tree, and the
bar's Back is the only one. Export the eyebrow from `@commise/ui/large-title-header` as its own leaf, so the header and
these states draw one element. Do not add a "Back" button to the notice. That competes with Try again, and it puts
Back in a different place from the settled page.

## 6. Web

- **840 and wider: no change.** The eyebrow link above the H1 stays in the content. A desktop has no status bar to
  collide with, and it has the sidebar, the browser's Back and Alt+Left. A pinned bar costs height on every page and
  gives no new route out. This is a translation, not a port.
- **Below 840 (web 390 and 768, where the canvas says "like the phone"): adopt the same bar,** using the web leaf of
  `CondensedTitleBar` inside the web leaf of `PushedPageFrame`. The bar is `fixed` at `top: 0` and `nav:hidden`. Where
  the viewport uses `viewport-fit=cover`, it pads its top by `env(safe-area-inset-top)`. Its rendered height is one
  property, `--pinned-bar-block` (the bar's 56 plus that inset). Back stays a `RouteAction` with `href`, so a modified
  click still works.
- **The frame mounts its own `ScrollHost`, nested in the shell's.** On web the **document** scrolls, and the app shell
  already mounts a host for it. That host has no `headingId`, so it never reports `condensed`. So the frame mounts a
  second host with the page's `headingId`. Both hosts read the same document scroll. The shell's chrome (the tab bar)
  reads the shell's host. The page and its bar read the frame's host. The frame's host takes `topInset`, which is the
  bar's height **as rendered**, measured from the element (`useRenderedHeight`). An `IntersectionObserver` margin takes
  px only, not `calc()` or `env()`, and on a notched phone the bar is taller than 56. The observer's top margin is
  `-topInset`. So the H1 counts as gone under the bar, not under the viewport's top. Without it, web has the
  same dead band as native had. From 840 the bar is `display: none`, so its measured height is 0, and the rule falls
  back to the viewport's top.
- **`<main>` takes the bar's height on a pushed page below 840, and the frame adds no padding.** The shell draws its
  connectivity notice at the top of `<main>`, above the page. Padding on the page puts the notice behind the bar. So
  `globals.css` keys on the frame being in the page (`html:has([data-pushed-page])`) and sets two things from
  `--pinned-bar-block`. One is `--main-top`, the top padding of `<main>` (`HomeChrome.tsx`). With it, the notice sits
  under the bar, and the H1 lands at the bar's height. The other is `scroll-padding-top`, so a focused control
  scrolled into view is never under the bar (WCAG 2.2 SC 2.4.11). From 840 both go back to the defaults. The web
  frame's `inset` is 0.
- **The bar is first in `<main>`.** The shell offers a slot ahead of its notice (`PinnedBarSlotContext`), and the frame
  draws the bar into it by a portal. So the DOM order is Back, then the notice, then the page, as on the screen. With no
  slot (the first render, or a test) the frame draws the bar in place, so the server-rendered page has its Back.
- **From 600 (`medium`), the web bar shows the parent's name**, as the native tablet bar does: "‹ Collections". It is
  truncated, and capped at 40% of the bar's width. The accessible name stays "Back to {parent}". Below 600 it is the
  chevron alone.
- ⚠️ **Owed: the web bar's chevron is not on `<main>`'s gutter.** The bar pads by `px-2` and centres the glyph in a
  44 px box. Below 600 the glyph is at about 18 px, and the gutter is 16. From 600 the name shows, the box loses its
  centring room, and the glyph is at about 8 px, where the gutter is 24. Native puts it on the gutter at both widths
  (section 4). The web bar must derive its start padding from the gutter in the same way, in
  `ui/src/largeTitleHeader/CondensedTitleBar.tsx`.
- Recipe detail's `nav:hidden` `HeroButton` (`web/src/components/recipes/RecipeDetailContainer.tsx`) hands over to the
  bar as on native. That happens in the change where recipe detail adopts the frame.

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
        back: HeaderBack; // existing type, largeTitleHeader/props.ts
        headingId: string; // the H1's id; web watches it, native finds the heading by its layout
        title?: string; // the bar's one-line title; absent while loading
        menu?: ReactNode; // the page's ⋯, moved out of the content
        children: (bind: ScrollBind, inset: PushedPageInset) => ReactNode; // inset: section 3 (native), 0 on web
    }
    ```

    Owed with recipe detail, and not built before it: `appearance?: 'canvas' | 'photo'` (default `'canvas'`),
    `sections?: readonly string[]` (passed to the host), and `activationOffset?: number` (the frame adds
    `PINNED_BAR_HEIGHT`).

    ⛔ **One native scroller binding per page.** On native, the frame's `ScrollHost` is the page's only host. Today
    `RecipeDetailView.native.tsx` still mounts its own. Recipe detail's adoption of the frame removes it. With a
    second inner host, the scroller binds to it while the bar reads the outer one, so the bar never changes. On web the
    frame's host is a second reader of the one document scroll, nested in the shell's host (section 6). It is not a
    second scroller.

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
- `ScrollHost`:
    - Native: with no inset, a title under a 56 pt bar reports `condensed`, and one not yet under it does not (the
      cancellation in section 3).
    - Web: with `topInset`, the observer's top margin is `-topInset`, and a heading above that line is gone.
- `barGeometry`: the glyph's box starts at 16 for a 44 and a 48 frame, and the start padding is never negative.
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
- the tablet back label: "‹ Collections", the short form (owner ruling 2026-10-24, `ownerFeedback.md` N8)
- the topBar height corrected to 56.

Keep P4: the bar is neutral and only the chevron is steel.
