# Horizontal scroll hint: hidden scrollbar and a "more to the right" chevron

> **What this is:** a SPECIFY design spec by `staff-ux-engineer`, written 2026-10-17. **What it is not:** code, or a
> mockup. I did not render anything for it. `fe-1` builds the feature-side changes from it. The new primitive goes in
> `@commise/ui`, which the design system owns.

## 0. The rule (owner, verbatim)

> "scrollbars should be hidden until the user scolls. Use a chevron pointing right at the right side of the scrollbox
> telling the user that there is more content to the right. As soon as the user scrolls the chevron disappears; when
> the user scrolls all the way back to the left, the chevron reappears in the original position. This applies for all
> horizontal scrollable elements in the app" — then: "Change the real app."

Excluded by the owner: the recipe photo carousel (`features/recipes/src/detail/PhotoCarousel*.tsx`). It already has
arrows and dots.

## 1. Which scrollers this covers

I searched `packages/apps/commise` for `horizontal`, `overflow-x`, `overflowX` and `scrollbar`, leaving out tests.

| Scroller                               | Web                                                  | Native                                                            | Rule applies?                                                            |
| -------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `ChipRow` with `overflow: 'scroll'`    | `ui/src/chip/chipClass.ts:51`, used by `ChipRow.tsx` | `ui/src/chip/ChipRow.native.tsx:63` (`ScrollingLine`)             | **Yes**                                                                  |
| `SectionSwitch` links                  | `ui/src/sectionSwitch/SectionSwitch.tsx:30`          | does **not** scroll today (see 1a)                                | **Yes, both**                                                            |
| Browse rail, loaded                    | `features/recipes/src/discovery/RailTrack.tsx:40`    | `RecipeBrowseRailResults.native.tsx:40`                           | **Yes**                                                                  |
| Browse rail, loading placeholders      | `RailTrack` with `decorative`                        | `RecipeBrowseRailLoading.native.tsx:29` (`scrollEnabled={false}`) | **No.** There is no content yet, so there is nothing to promise (see 4). |
| Photo carousel                         | `PhotoCarousel.tsx:53`                               | `PhotoCarousel.native.tsx:72`                                     | **No.** The owner excluded it.                                           |
| `SegmentedControl`                     | no scrolling (`segmentClass.ts`)                     | no scrolling                                                      | **No.** Nothing scrolls.                                                 |
| `RecipeEditorView.native.tsx:203`      | n/a                                                  | a vertical `ScrollView`                                           | **No.** It is vertical.                                                  |
| `RecipeDiscoveryResults.native.tsx:55` | n/a                                                  | a vertical `ScrollView`                                           | **No.** It is vertical.                                                  |

No web route under `web/src` has its own horizontal scroller. The three scrollers in scope therefore cover every
horizontal scroller in the app except the carousel.

### 1a. Native `SectionSwitch` must start to scroll

The web bar scrolls its links on purpose. Squeezed links ran under the trailing toggle at 320 px and off the page at
+35% text (F14, `SectionSwitch.tsx:28`). The native bar puts its links in a `flex: 1, minWidth: 0` row with no
scroller (`SectionSwitch.native.tsx:63`). It has the same three links as web (`RecipeDetailBody.native.tsx:233`). At
+35% text or a large font, these links get squeezed or cut. I found this in the source. I did not render it.
**Disposition: changed.** The native links move into the new primitive and scroll inside the bar, just as on web. The
trailing control stays pinned outside the scroller.

## 2. The design-system decision: one primitive

**There is one new primitive, `HorizontalScroller`, at `packages/apps/commise/ui/src/horizontalScroller/`**, with a web
leaf and a `.native.tsx` leaf. It is exported as `@commise/ui/horizontal-scroller`. Every "Yes" scroller in §1 uses
it. No screen builds its own copy.

Why one primitive: the owner asked for one behaviour everywhere. If the rule lives in each component, it breaks
separately in each one. This already happened here. The chip row's web fade is a fixed mask. It never tracks the
scroll (see the "⚠️ The fade is a static mask" note in `chipClass.ts`). The native fade does track it.

**These two things move into the primitive, so each lives in one place.**

- **A pure predicate, `scrollHintOf`**, in `horizontalScroller/scrollHint.ts`, with the 1 px slack. Two copies of this
  check exist today: `hasMoreAhead` (`ChipRow.native.tsx:42`) and `railScrollState` (`railScroll.ts:35`). `hasMoreAhead`
  is deleted. `railScrollState` is rewritten on top of the shared predicate so the rail buttons and the chevron cannot
  disagree.
- **Scroll-on-focus.** A child that takes focus scrolls into view. This is lifted from `SectionSwitch.tsx:38`, and
  that `onFocus` is then deleted.

**Prop contract** (both leaves):

| Prop                                                                                                           | Type                                                                          | Why                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `children`                                                                                                     | `ReactNode`                                                                   | The row's content.                                                                                                                                |
| `surface`                                                                                                      | `'canvas' \| 'overlay' \| 'bar'` (default `'canvas'`)                         | Native only. It picks the colour the fade blends into: `canvas`, `paperOverlay` or `paper`. On web it is ignored, because the web fade is a mask. |
| `scrollRef`                                                                                                    | a callback ref (`HTMLElement \| null` on web, `ScrollView \| null` on native) | `RailTrack` hands its track to `RailContext` so Previous and Next can move it (`RailTrack.tsx:71`).                                               |
| web: `role`, `aria-label`, `tabIndex`, `onKeyDown`, `className`                                                | passed to the scroll element                                                  | The rail track is a focusable `region` that moves with the arrow keys (`RailTrack.tsx:72-81`). `className` carries snapping and padding only.     |
| native: `role`, `aria-label`, `contentContainerStyle`, `snapToInterval`, `snapToAlignment`, `decelerationRate` | passed to `ScrollView`                                                        | These are the rail's snapping props (`RecipeBrowseRailResults.native.tsx:47-50`).                                                                 |

These stay fixed inside the primitive, so callers cannot set them: native `horizontal`, `scrollsToTop={false}`,
`keyboardShouldPersistTaps="handled"`, and `scrollEventThrottle={32}`.

Group roles stay in the components that own them. `ChipRow`'s Radix root, and the `SectionSwitch` `nav` and its `ul`,
become the scroller's **only child**, or wrap it. The scroller itself carries no role unless one is passed in, as the
rail does.

⚠️ For the implementer: the web leaf takes a ref and listens to scroll events. So the enforced `@pattern` tag applies
(`docs/CODING_STANDARDS.md` §11.2). Use `@pattern Adapter over a scroll container's position and ResizeObserver`.
`staff-architect` checks the API at BLUEPRINT, because three packages will call it.

## 3. Decisions

### 3.1 Scrollbar: hidden at rest, shown only while scrolling

- **Native:** set `showsHorizontalScrollIndicator` back to its default, `true`, everywhere in scope. Today it is
  `false` in `ChipRow.native.tsx:67` and `RecipeBrowseRailResults.native.tsx:47`. The iOS and Android indicators already
  hide at rest and appear only during a scroll, which matches the owner's words. ⚠️ Check this on a device. It is a
  platform convention, and I did not check it here.
- **Web:**
    - Always set `scrollbar-width: thin`. The scrollbar never switches between `none` and `thin`, because on systems with
      classic, always-visible scrollbars (Windows and Linux with a mouse) that switch adds height and moves the layout on
      every scroll.
    - At rest, set `scrollbar-color: transparent transparent`. The space stays reserved, but nothing is drawn.
    - While scrolling (`data-scrolling` set on the scroller), set `scrollbar-color: var(--color-line-control)
transparent`. The thumb is `lineControl`. Its computed WCAG 2.x ratios are 3.44:1 on `canvas` and 3.70:1 on
      `paper` in light. In dark they are 4.72:1 on `canvas` and 3.50:1 on `paperOverlay`.
    - `data-scrolling` is set on `scroll` and cleared on `scrollend`. If `scrollend` does not arrive, it is cleared 500 ms
      after the last `scroll` event. The 500 ms is my judgement. It is close to how long a native indicator stays after a
      scroll stops.
    - The page as served by the server keeps the browser's default scrollbar colour. The primitive applies the
      transparent rest state only after it mounts. So if JavaScript has not loaded, the scrollbar stays visible.
      `scrollbar-width` is in the stylesheet from the start, so mounting moves nothing.
    - `scrollbar-color` is Baseline 2025, so it works in every current browser (MDN, checked 2026-10-17). Do not also
      style `::-webkit-scrollbar`: MDN says browsers ignore it whenever `scrollbar-color` is not `auto`.
- ⚠️ **One deliberate change to the owner's literal rule. The owner needs to check it.** On a fine pointer
  (`@media (hover: hover) and (pointer: fine)`), the thumb also shows **while the pointer is over the scroller**.
  Here is why. Take a person with a mouse wheel and classic scrollbars. Without this rule, they see no way to scroll
  a chip row or the section bar. A vertical wheel does not scroll sideways. The chevron cannot be pressed. Only the
  rails have Previous and Next. Touch screens have no hover, so they keep the owner's rule exactly. If the owner says no, delete
  the one `:hover` rule. Nothing else changes.

### 3.2 Chevron: what it is and where it sits

| Property          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Glyph             | `<Icon name="chevronRight" size={20} tone="inkMuted" />` (`ui/src/icon/props.ts`). `chevronRight` is in `MIRROR_IN_RTL`, so it turns around by itself in right-to-left.                                                                                                                                                                                                                                                   |
| Size              | 20. This matches the rail's Previous and Next glyphs (`RecipeBrowseRails.tsx:107`).                                                                                                                                                                                                                                                                                                                                       |
| Colour            | `inkMuted`. On web the glyph sits on the real ground, because the content under it is masked to transparent. On native it sits on a solid strip of the ground colour. Computed WCAG 2.x ratios in light: 5.41:1 on `canvas`, 5.83:1 on `paper`. In dark: 8.70:1 on `canvas`, 7.98:1 on `paper`, 6.44:1 on `paperOverlay`. All clear SC 1.4.11's 3:1.                                                                      |
| Position          | At the inline-end edge (right in LTR, left in RTL), centred top to bottom in the scroll box. The glyph is centred in a 24 px solid zone, so it sits 2 px in from the edge.                                                                                                                                                                                                                                                |
| Surface behind it | A **hint band 40 px wide**: a 16 px ramp, then a 24 px fully opaque zone at the edge. Web: the scroller's `mask-image` goes from black to transparent across the ramp, and the content is fully transparent under the glyph. Native: an `expo-linear-gradient` from the transparent ground colour to the full ground colour across the ramp, then solid. That is the existing `ChipRow.native.tsx:83` technique, widened. |
| Hit-testing       | `pointer-events: none` (web) or `pointerEvents="none"` (native). A tap or a swipe goes through to the content underneath. A band that took touches would also take a swipe that starts at the edge, and the edge is where people start one. ⚠️ Known risk: the 24 px zone is opaque, so a tap on the chevron can toggle a chip or open a card that the user cannot see. EVALUATE checks this on a device (§7).            |
| Semantics         | **Decorative:** `aria-hidden`, not focusable, no name.                                                                                                                                                                                                                                                                                                                                                                    |

**Why it is decorative and not a button:**

1. It disappears on the first scroll. As a button, a press removes the focused element and drops focus to `<body>`.
   That fails SC 2.4.3 and leaves keyboard users lost.
2. It is not needed for SC 2.1.1. Every scroller already has a keyboard path. Chips are tab stops with arrow keys, and
   focus brings them into view (§2). Section links are tab stops. The rail track is a focusable region that moves with
   the arrow keys, and it also has Previous and Next.
3. A clickable chevron hidden from assistive technology is a control with no name or role. That is a risk under
   SC 4.1.2. A named button adds a tab stop that vanishes once used.
4. On touch, swiping is the way to scroll, and the cards that peek in from the edge already invite it.
5. SC 2.5.8 does not apply, because it is not a target.

**The chevron does not get its own circle or shadow.** The rail's Previous and Next are 36 px round ghost buttons
(`RecipeBrowseRails.tsx:53`). A chevron on a round disc looks like one of them. It invites a press that does nothing.
A bare glyph on a fade reads as a hint.

**The one thing this does better than the obvious version:** the fade and the chevron are two separate rules. The
chevron says "this scrolls", and it shows only at the start, as the owner asked. The fade says "more is still ahead",
and it follows `buildSpec.md` §1.11 as written: "a 24 px fade at the trailing edge while more exists." The primitive
needs a scroll listener for the chevron anyway. The `chipClass.ts` note says that listener is the one thing the static
web mask lacks. So the web fade finally tracks the scroll, in one place, for every scroller.

⚠️ **Amendment to `buildSpec.md` §1.11.** While the chevron shows, the trailing fade grows from 24 px to the 40 px hint
band. The reason: a 24 px fade has no opaque zone where a glyph can sit over a photo.

### 3.3 When each part shows

`scrollHintOf({ startOffset, viewport, content, measured })` is pure and returns `{ chevron, fade }`:

- `startOffset` is the distance from the **start** edge. Web LTR: `scrollLeft`. Web RTL: `-scrollLeft`, since every
  current engine counts negative from 0. Native: `contentOffset.x`, corrected for `I18nManager.isRTL`. A negative value
  is overscroll (the iOS bounce) and counts as 0.
- `overflows = content − viewport > 1`
- `atStart = startOffset ≤ 1`
- `moreAhead = content − viewport − startOffset > 1`
- **`chevron = measured && overflows && atStart`**
- **`fade = measured && moreAhead`** (drawn under the chevron's band while both are true)
- Before the first measure, neither shows.

The 1 px slack absorbs sub-pixel `scrollLeft` on zoomed displays, as `railScrollState` already does.

| Event                                                     | What happens                                                                                                                                                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First layout, content wider than the box                  | The chevron and the band fade in.                                                                                                                                                                                                |
| Content fits the box                                      | No chevron, no fade, and nothing to scroll.                                                                                                                                                                                      |
| The user drags, swipes or wheels more than 1 px           | The chevron fades out. The 24 px fade stays while more is ahead.                                                                                                                                                                 |
| A programmatic scroll (rail Next, focus scroll-into-view) | The same as a user scroll. The chevron goes.                                                                                                                                                                                     |
| Scrolled to the end                                       | No chevron, no fade.                                                                                                                                                                                                             |
| Back at the start, by any means                           | The chevron and the band come back in the same place.                                                                                                                                                                            |
| A proximity snap that returns to 0                        | The chevron goes, then comes back. This is expected.                                                                                                                                                                             |
| Resize, rotation or a font-size change                    | Measure again (web: a `ResizeObserver` on the scroller **and** its first child. Native: `onLayout` and `onContentSizeChange`.) and apply the rule again. The platform keeps the scroll position.                                 |
| Content changes (a chip added or removed)                 | Measure again, as above.                                                                                                                                                                                                         |
| RTL                                                       | Mirrored: the band and the chevron are at the left edge, and the chevron points left. ⚠️ Check native RTL `contentOffset.x` on both iOS and Android before trusting the correction. React Native differs between platforms here. |

### 3.4 Motion

The chevron and its band change `opacity` only, over 150 ms with `ease-out`. 150 ms is the closest existing value
(`buildSpec.md` motion table: "Skeleton → content 150 ms cross-fade").

- Web: `motion-safe:transition-opacity motion-safe:duration-150`.
- Native: an `Animated` opacity gated by `useReduceMotion()` (`ui/src/motion/useReduceMotion.native.ts`).
- With reduce motion on, or while the preference is still `undefined`, the change is instant.
- The web mask switches from 40 px to 24 px instantly, because gradients do not animate between values. It happens
  while the content is already moving.

### 3.5 Focus and the band (SC 2.4.11)

On web, the scroller sets `scroll-padding-inline-end: 40px`. A child can take focus (`focusin` with a target that is
not the scroller). Then the primitive calls `target.scrollIntoView({ block: 'nearest', inline: 'nearest' })` with no smooth
behaviour, so reduce motion is respected. A focused chip half under the band is then pulled clear of it. This only
changes snap-**end** padding, and every scroller here snaps to the start, so snapping does not change. The rail keeps
`scroll-ps-4` for its start padding.

The web mask also clips anything drawn outside the scroller's border box. So the rail track's outer focus ring
(`RailTrack.tsx:40`, `focus-visible:ring-2`) is lost wherever the band or the fade shows. **Decision:** the track's
ring becomes `focus-visible:ring-inset`, as the section links already do (`SectionSwitch.tsx:50`). The mask also hides
the scrollbar thumb while the thumb passes under the band. That is minor, and it is accepted.

## 4. States

**Primitive, both platforms:**

| State                                       | Chevron   | Fade                | Scrollbar                                     |
| ------------------------------------------- | --------- | ------------------- | --------------------------------------------- |
| Not measured yet / page not yet interactive | no        | no                  | web: browser default colour. Native: default. |
| Fits, no overflow                           | no        | no                  | nothing to show                               |
| Overflows, at start                         | **yes**   | under the band      | hidden                                        |
| Scrolling                                   | no        | while more is ahead | **visible**                                   |
| Stopped in the middle                       | no        | yes (24 px)         | hidden                                        |
| At the end                                  | no        | no                  | hidden                                        |
| Back at start                               | **yes**   | under the band      | hidden                                        |
| Fine pointer over the scroller (web)        | unchanged | unchanged           | visible (§3.1, the owner needs to check it)   |

**Per component:**

| Component          | Platform     | Loading                               | Empty                                                       | Error                                 | Notes                                                                                                                                                                                                                                                                                                           |
| ------------------ | ------------ | ------------------------------------- | ----------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChipRow` scroll   | web + native | n/a                                   | a row with no chips: fits, so nothing shows                 | n/a                                   | `wrap` rows are untouched. `surface` comes from the row's existing `surface` prop (`canvas`/`overlay`).                                                                                                                                                                                                         |
| `SectionSwitch`    | web + native | n/a                                   | n/a                                                         | n/a                                   | `surface: 'bar'`. The web bar is `paper/90` with a blur, and the mask shows through to it. Native draws the fade to `paper`.                                                                                                                                                                                    |
| Rail, loaded       | web + native | n/a                                   | renders `railEmpty` text with no scroller, so nothing shows | the rail's error body has no scroller | Web Previous and Next (fine pointer) stay and use the shared predicate.                                                                                                                                                                                                                                         |
| Rail, placeholders | web + native | **no chevron, no fade, no scrolling** | n/a                                                         | n/a                                   | Web: give the `decorative` track `overflow-x-hidden` instead of `auto`. It is `aria-hidden` and has nothing to scroll to. That matches native's `scrollEnabled={false}` and still keeps the 320 px containment that E1 fixed. When the cards arrive, the chevron fades in under the existing 150 ms cross-fade. |

## 5. Copy

None. The chevron is decorative, so there is no new string and no localisation key. The rail region keeps its name
`discoveryMessages.railRegion`.

## 6. Platform translation

| Element                       | Web                                                                              | Native                                           | Disposition           | Why                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Scrollbar                     | transparent thin scrollbar, coloured while scrolling (and on fine-pointer hover) | the system indicator, shown only while scrolling | kept, platform-native | Each platform's own transient indicator.                                                                   |
| Fade technique                | `mask-image`                                                                     | a gradient to the `surface` colour               | kept                  | React Native has no CSS mask. A mask shows through to the real background, including the dark canvas wash. |
| Rail Previous / Next          | fine pointer only                                                                | none (swipe, peek and chevron)                   | kept as today         | Touch has the swipe.                                                                                       |
| Hover reveal of the scrollbar | fine pointer only                                                                | none                                             | dropped on touch      | There is no hover on touch.                                                                                |
| `SectionSwitch` links         | scroll                                                                           | **now scroll** (§1a)                             | changed               | This keeps long or translated labels from being squeezed.                                                  |

- 320 CSS px: each scroller scrolls inside its own box and never moves the page (SC 1.4.10). The band is drawn over
  the box, not added to its width.
- At 320, a rail's peek is about 32 px (`railScroll.ts:84`), so at rest the 40 px band covers it. At rest the chevron
  takes over the peek's job. Once the user scrolls, the peek shows under the 24 px fade. At 390 the peek is about
  86 px, and most of it stays visible.

## 7. Edge cases and things to check

- **Not checked, because I rendered nothing:**
    - legibility over a card photo under the native gradient.
    - the seam where the native fade meets the dark canvas wash (`canvas` is flat but the wash is a gradient. The chip fade
      already has this risk).
    - the `SectionSwitch` blur ground.
    - the native indicator's behaviour and the native RTL offsets.

    EVALUATE renders each of these at 320 and 390 px, in both themes.

- The section bar today sets `[scrollbar-width:none]` (`SectionSwitch.tsx:30`). With `thin`, a classic scrollbar
  reserves a band under the links. **Decision:** the bar uses `thin` like every other scroller, because mouse users need
  a visible way to scroll it. The `hereBar` stays on the link's bottom edge, so it can sit a few px above the bar's
  divider. EVALUATE measures the bar's height and the `hereBar` gap in Chromium on Linux, which draws classic
  scrollbars.
- Tap pass-through under the opaque zone (§3.2). EVALUATE checks on a device how often a tap on the chevron hits a
  hidden chip or card.
- Font scaling on native: the band's height follows the scroll box, and the glyph stays at 20.
- Hardware keyboard on native: not in scope here. No focus behaviour changes.

## 8. Tests the build owes (TDD, `docs/CODING_STANDARDS.md` §7.1)

- **Unit:** `scrollHintOf` as a fixture table covering fits, at start, middle, end, overscroll, RTL, unmeasured and
  the 1 px boundary on both sides.
- **Component:** each leaf in every row of the §4 table.
- **Playwright:**
    - The chevron is visible at rest on an overflowing chip row and on a rail.
    - It is gone after `scrollBy`, and back after `scrollTo(0)`.
    - It is absent on content that fits, and on placeholders.
    - It is mirrored under `dir="rtl"`.
- **Maestro:** swipe a chip row and the chevron is gone. Swipe back and it returns.

## 9. Out of scope

- The photo carousel.
- Vertical scrollers.
- Making the chevron a control.
- Any new string.
