# Editor navigation: the section index and "Back to top" (designer A)

⛔ **DESIGN SPECIFICATION. NOT PRODUCTION CODE.** It answers the owner's two proposed additions to the one-page
editor the owner chose: a "Back to top" control, and a vertical "breadcrumb" box that shows where the cook is and
scrolls to a section on click.

- **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`, designer A. I did not read the other designer's answer.
- **Governing decision (owner, round 3):** one-page editor, a section index, autosave, published recipes save on
  "Save changes", guided progress for a first recipe. This file designs inside it.
- **Not user evidence.** Nothing here was tested with users. Claims cite a source fetched today, or are labelled
  judgement.

## Verdicts in short

| Owner's idea                                           | Verdict                                                                                   | In one line                                                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vertical "breadcrumb" box of sections, click to scroll | **KEEP, as the section index, and change its name and its phone form**                    | It is the section index I proposed, not a breadcrumb. A sticky vertical rail on wide screens, a horizontal strip on tablets, a one-line bar that opens a sheet on phones. |
| "Back to top" in the editor                            | **DROP in the editor**                                                                    | The sticky index already does its job, and a floating button would sit beside Publish in the thumb zone and over the keyboard.                                            |
| "Back to top" elsewhere                                | **CHANGE: keep it only on long browse lists on web, and use platform gestures on native** | Labelled, bottom-right, shown only after 4 screens and on upward scroll (NN/g). On native, re-tapping the active tab and the iOS status-bar tap do it.                    |

---

## 1. The "breadcrumb" box is the section index

### 1.1 Same thing, different name

The owner's box and my section index have the same parts: a list of the four sections, the current one marked,
each one a link that scrolls to it. So they are one component. Build it once.

**It should not be called a breadcrumb, in the code or in the UI.**

- NN/g's breadcrumb guidelines (fetched today) say breadcrumbs make "users aware of their current location within
  the hierarchical structure of a website", and are "not intended to show the history of pages traversed".
- They also say: "For sites with flat hierarchies with only 1 or 2 levels of categories, a breadcrumb isn't needed
  as a wayfinding device."
- The editor's sections are not a hierarchy. They are four siblings on one page.
- The right names for this pattern are an in-page table of contents with scroll tracking, or a task list. Naming
  it a breadcrumb would lead an implementer to build a `›`-separated trail, which is the wrong component.

**Name:** `SectionIndex` (in `@commise/ui`, web and native). Visible to users only as the list of section names.
Its landmark name is "Recipe sections".

### 1.2 Prior art it follows

The GOV.UK Design System task list (design-system.service.gov.uk/components/task-list, fetched today) is the
closest published, user-tested pattern. Three of its findings shape this design:

1. **Link the whole row.** "Some users currently try to select task statuses, thinking they are buttons or links…
   now the whole task row is linked."
2. **Make "done" quiet, so "needs action" stands out.** "The 'Completed' task now uses black text with no
   background colour, which will draw more attention to tasks that require action." This matches the quiet-row rule
   both designers adopted for ingredients (Von Restorff).
3. **No uppercase statuses.** "The use of uppercase in task statuses makes them harder to read."

### 1.3 Layout per width

The four sections: **Details · Ingredients · Steps · Photos & publish.**

| Container (`<main>`, or window on native)                       | Form                                                                                                                                     | Placement                                | Why                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@wide` ≥ 960 (web 1280 and 1920, native tablets ≥ 960 dp wide) | **Vertical rail**, 240 px, on the inline-start side. Sticky under the editor header, scrolls inside itself if taller than the window.    | Rail left, form right (form max 720 px). | This is the owner's "vertical box". A wide screen has room for an always-visible overview, which supports recognition over recall (Nielsen #6).                                                                                                                                                                                          |
| `@regular` 600–959 (web 768, native tablet portrait)            | **Horizontal strip**, sticky under the editor header, 48 px. Four items in one row.                                                      | Full width of the column.                | A 240 px rail would leave about 480 px of a 720 px column for the form, too narrow for the ingredient row with its prep column. Four labels fit on one line at 720 even at +35% length.                                                                                                                                                  |
| `@narrow` < 600 (web 320–599, native phone)                     | **One-line section bar**, sticky under the editor header, 44 px. It shows the current section and opens a **sheet** with the full index. | Full width.                              | At 320, the four labels need about 340 px as a strip (estimated from label lengths at 14 px plus padding, not rendered) against a 288 px column, so a strip would scroll sideways and hide sections, which defeats an overview. A one-line bar costs 44 px of the scroll budget, and the sheet shows every section with its full status. |

```
@wide (rail)                                   @regular (strip)
┌ ✕ New recipe ─────────────── Saved ┐         ┌ ✕ New recipe ───────────────────── Saved ┐
│ ┌──────────────────┐  Details (H2) │         ├ ✓ Details  ⚠ Ingredients 2  Steps  Photos ┤ 48, sticky
│ │✓ Details         │  Title         │         │ Details (H2)                             │
│ │▌Ingredients      │  …             │         │ …                                        │
│ │ ⚠ 2 need a match │                │         └──────────────────────────────────────────┘
│ │ Steps            │  Ingredients   │
│ │ Not started      │  …             │         @narrow (bar → sheet)
│ │ Photos & publish │                │         ┌ ✕ New recipe ──────────── Saved ┐
│ │ Optional         │                │         ├ Ingredients · 2 of 4   ⚠ 2   ⌄ ┤ 44, one button
│ │──────────────────│                │         │ ▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░░░░░ │ 4 px progress
│ │612 kcal/serving  │                │         │ Ingredients (H2)                 │
│ │7 of 9 counted    │                │         │ …                                │
│ └──────────────────┘                │         ├──────────────────────────────────┤
├─────────────────── [Save draft] [Publish]┤    │ [ Save draft ] [   Publish    ] │ ActionBar
```

**Labels:**

- Rail and sheet: the full name, "Photos & publish". `wrap:2` in the rail (it is content inside a list row, and
  the row has room to grow).
- Strip: "Photos" as the visible label, with the accessible name "Photos & publish" (SC 2.5.3: the visible label is
  contained in the name). Strip labels never wrap: the wrap rung is closed for a control in one row.
- Phone bar: `{section} · {n} of 4`. `truncate:1`, with the full text in the accessible name. At German +35%,
  "Fotos & Veröffentlichen · 4 von 4" is the worst case. It truncates rather than wraps, and the sheet shows it in
  full.

### 1.4 Statuses per section

One status per section, shown as an icon **and** words, never colour alone (SC 1.4.1). In order of precedence:

| Status                    | When                                                                        | Rail and sheet                                     | Strip     | Phone bar       |
| ------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- | --------- | --------------- |
| **Fix before publishing** | after a refused Publish, the section has a blocking error                   | `error-dark` ⚠ + "Fix 1 thing"                     | ⚠ + count | ⚠ + total count |
| **Needs attention**       | something to look at that does not block, e.g. "2 ingredients need a match" | `warning-dark` ⚠ + the reason, `caption`, `wrap:2` | ⚠ + count | ⚠ + total count |
| **Not started**           | the section is empty                                                        | `slate` "Not started"                              | nothing   | nothing         |
| **Optional**              | Photos, while empty                                                         | `slate` "Optional"                                 | nothing   | nothing         |
| **Complete**              | the section has what it needs                                               | `charcoal` ✓, **no colour, no word**               | ✓         | nothing         |

- **Complete is quiet** (GOV.UK finding 2 above). The rows that need the cook are the only coloured ones.
- **The current section** is a separate channel: a 3 px `ocean-dark` bar on the row's inline-start edge, weight 600,
  and `aria-current="location"`. MDN defines `location` as the value for "the current location within an
  environment or context" (fetched today). It is not `step`, because the cook is not forced through steps in
  order.
- **The status reason comes from the existing validator**, not a second rule set. "Needs attention" counts come from
  the same data the ingredient rows show.
- **Phone progress bar:** 4 segments. A complete section's segment is `seafoam`. A section that needs attention is
  `warning` with a 1 px `warning-dark` top edge. Empty is `pearl`. The bar is decorative (`aria-hidden`), because
  the bar's text and the sheet carry the same facts.

### 1.5 Guided progress for a first recipe (owner's choice)

When the cook has never published a recipe:

- Each rail or sheet row shows a one-line hint under its name: "Name it and say how long it takes" · "Add what goes
  in" · "Say how to make it" · "Add a photo, then publish".
- Details shows "Start here" as its status until something is typed.
- The rail foot (wide) shows "2 of 4 sections done". The phone bar's "2 of 4" already says it.
- After the first publish, the hints never show again.
- Why: goal-gradient. Motivation rises as the goal gets closer, so show progress (`human-factors.md`). I do not use
  endowed progress (a pre-filled first step), because nothing has been done yet and it would not be honest.

### 1.6 Current-section tracking while scrolling

**Rule.** The current section is the last section whose heading has crossed an _activation line_. The line sits at
the bottom of the sticky header stack plus 25% of the remaining viewport height. When the page is scrolled to its
end, the last section becomes current even if its heading has not reached the line (a short final section must
still be reachable as "current").

- **Web:** an `IntersectionObserver` on each section's H2, with a `rootMargin` set from the measured header stack.
  No scroll listener.
- **Native:** `onLayout` stores each section's y offset. `onScroll` (`scrollEventThrottle={16}`) compares the offset
  to the activation line. The current section only changes when the computed value changes, so it does not
  re-render every frame.
- **Strip and phone bar:** when the current section changes, the strip keeps the current item in view inside its
  own row, never scrolling the page sideways.
- **No announcement while scrolling.** A live region that speaks on every scroll is noise. Only a **status change
  caused by the cook's action** is announced, politely: "Ingredients complete", "Photos and publish needs
  attention".

### 1.7 Clicking a section

1. The page scrolls so the section's H2 sits just under the sticky header stack. Web: `scroll-margin-top` on each
   H2, equal to the header stack plus 16 px. Native: `scrollTo({ y: offset - headerStack - 16 })`.
2. **Reduced motion.** Scrolling is smooth only when the user has not asked for reduced motion: web checks
   `matchMedia('(prefers-reduced-motion: reduce)')`, native checks `AccessibilityInfo.isReduceMotionEnabled()`. With
   reduced motion, the jump is instant. This follows SC 2.3.3 Animation from Interactions (Level AAA, beyond our AA
   floor, but cheap): an index-triggered smooth scroll is motion the user did not perform by scrolling. W3C's
   Understanding document allows the user's own scrolling as essential, and lists `prefers-reduced-motion` (C39,
   SCR40) as sufficient techniques.
3. **Focus moves to the section's H2** (`tabindex="-1"`), after the scroll. A keyboard or screen-reader user lands
   where they asked to go (SC 2.4.3 Focus Order). The phone sheet closes first, then focus moves to the H2.
4. **The URL hash updates** with `history.replaceState` (`#ingredients`), so a reload keeps the place and the
   detail page's "Edit ingredients" can deep-link here. `replaceState`, not `pushState`, so browser Back still
   leaves the editor instead of stepping back through sections.

### 1.8 Keyboard and screen reader (WCAG 2.2 AA)

| Criterion                           | How it is met                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.3.1 Info and relationships        | `nav aria-label="Recipe sections"` holding an ordered list of links. Each section is a `section` with its H2 as the label.                                                                                                                                                                                                                                     |
| 1.4.1 Use of colour                 | Every status has an icon and words. Current has a bar and weight as well as colour.                                                                                                                                                                                                                                                                            |
| 2.4.1 Bypass blocks                 | The index is the bypass: one Tab stop per section, in the order of the page.                                                                                                                                                                                                                                                                                   |
| 2.4.3 Focus order                   | DOM order: editor header → index → form → ActionBar. At `@wide` the rail comes first in the DOM and first visually (inline start). Activating a link moves focus to that section's H2.                                                                                                                                                                         |
| 2.4.4 Link purpose                  | Link name = the section name ("Ingredients"). The status is linked by `aria-describedby` ("2 ingredients need a match"), so the name stays short and matches the visible label.                                                                                                                                                                                |
| 2.4.6 Headings and labels           | Each index label is the exact text of its section's H2.                                                                                                                                                                                                                                                                                                        |
| 2.4.7 Focus visible                 | The shared 2 px `ocean-dark` ring, 2 px offset.                                                                                                                                                                                                                                                                                                                |
| 2.4.11 Focus not obscured (minimum) | The sticky header stack (header + strip or bar) and the sticky ActionBar can cover a focused field. Fix: `scroll-padding-top` = header stack height, `scroll-padding-bottom` = ActionBar height + 16 px, on the scroll container. This is W3C's sufficient technique C43, which names "sticky footers, sticky headers" as the usual offenders (fetched today). |
| 2.5.3 Label in name                 | The strip's "Photos" is contained in "Photos & publish".                                                                                                                                                                                                                                                                                                       |
| 2.5.8 Target size                   | Rail and sheet rows ≥ 48 px. Strip items 44 px tall. The phone bar is one 44 px button.                                                                                                                                                                                                                                                                        |
| 4.1.3 Status messages               | Status changes go through the existing polite live region.                                                                                                                                                                                                                                                                                                     |

**The phone bar** is one `button` with `aria-expanded` and `aria-haspopup="dialog"`, named "Sections. Current:
Ingredients, 2 of 4. 2 need attention." The sheet uses `@commise/ui/sheet`: focus moves in, is trapped, Escape and
Back close it, focus returns to the bar unless a section was chosen.

### 1.9 Interaction with the keyboard on phones

- When the on-screen keyboard opens, the phone section bar **unpins and scrolls away**, the same as the ActionBar
  under the existing `compactHeightLayout.md` A1 rule (bars unpin past half the frame). The editor header stays, so
  there is still one bar on the top edge.
- It re-pins when the keyboard closes.
- The tablet strip and the wide rail stay. They have room.

---

## 2. "Back to top"

### 2.1 What the evidence says

NN/g, "Back-to-Top Button Design Guidelines" (fetched today, dated 27 Aug 2017):

- "Use a Back to Top button for pages that are longer than 4 screens."
- "Place a persistent Back to Top button in the lower right side of the page."
- "Label the button Back to Top." An arrow alone "can be ambiguous".
- "Consider delaying the appearance … until after users scroll a few pages AND indicate that they want to scroll up."
- "Make the button stationary."
- And the alternative: **"Sticky menus are sometimes a more elegant solution than Back to Top links. If the main
  purpose of scrolling is to navigate to different topics or sections … having the right menu options available
  when people need them voids the need to go back up."**

### 2.2 In the editor: DROP

1. **The section index is that sticky menu.** People scroll up in the editor to reach another section, and the
   index takes them there in one action. "Details" is the first item, so "the top" is already one of its links.
2. **The editor is often under the 4-screen threshold.** At 390 × 844 the estimate is: Details about 1.5 screens,
   10 ingredients about 1, 7 steps about 1.5, Photos & publish about 1. So about 5 screens for a full recipe, and
   fewer while it is being written. Judgement from the layouts, not measured.
3. **The lower right is taken.** NN/g's position is where the ActionBar's **Publish** / **Save changes** sits on
   phones. A floating button just above it puts a navigation control next to the one consequential control (Fitts:
   do not place frequent or risky targets next to each other).
4. **It would float over the keyboard.** With the keyboard open, a floating control covers the field being typed
   into, which is the commonest mobile form defect (`cross-platform-translation.md`).
5. **iOS already has it.** A tap on the status bar scrolls the nearest scroll view to the top. Apple's
   `scrollsToTop` docs (fetched today): "The scroll-to-top gesture is a tap on the status bar." React Native's
   `ScrollView` exposes it, on by default.
    - ⚠️ Implementation note from the same doc: "On iPhone, the scroll-to-top gesture has no effect if there's more
      than one scroll view onscreen that has" it enabled. So the strip, the sheet and any inner scroll view must set
      `scrollsToTop={false}`, or the gesture silently stops working on the editor.

**If the owner still wants an explicit control in the editor**, the least harmful form is a "Top of page" text link
as the last row of the rail and the sheet. No floating button.

### 2.3 Elsewhere: CHANGE to a narrow, evidence-based use

| Surface                                                                      | Back to top?                      | Form                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web, My recipes and Discover results, once the page is longer than 4 screens | **Yes**                           | A labelled pill, "↑ Back to top", `Button size="sm"` secondary, bottom-right, 16 px from the edge. It appears only after 4 screens **and** an upward scroll, as NN/g advises. It does not move once shown. On My recipes it sits 16 px above the FAB, never on it. It hides while the on-screen keyboard is open.                                                                                |
| Web, recipe detail                                                           | No                                | The sticky `SectionSwitch` (Ingredients · Steps · Nutrition) is the sticky menu.                                                                                                                                                                                                                                                                                                                 |
| Web, Home, Profile, Collections list, forms                                  | No                                | Under 4 screens.                                                                                                                                                                                                                                                                                                                                                                                 |
| Native, all screens                                                          | **No button.**                    | **Re-tap the active tab:** pop the tab's stack to its root, and if already at the root, scroll to the top. NN/g notes the Home button doubling as Back to top is the learned convention on social apps. Plus the iOS status-bar tap. Judgement: for a native app with a tab bar, this is the convention people already use (Jakob's law), and a floating button would add a target over content. |
| Web, tab bar re-tap                                                          | Yes, the same behaviour as native | One behaviour on both platforms for the same gesture.                                                                                                                                                                                                                                                                                                                                            |

**Behaviour of the web button:**

- Pressing it scrolls to the top (instant under reduced motion, as §1.7) and moves focus to the page's H1, so a
  keyboard user is not left focused on a button that has now gone (SC 2.4.3).
- It is a `button` named "Back to top" (the visible label). It is last in the DOM, after the content and before the
  FAB.
- The page's `scroll-padding-bottom` includes its height plus the FAB's, so a focused card is never hidden behind
  either (SC 2.4.11, C43).

---

## 3. Platform translation

| Element                   | Web                                                      | Native                                                                            | Disposition | Why                                      |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------- | ---------------------------------------- |
| Section index at ≥ 960    | sticky rail                                              | sticky rail (tablet landscape)                                                    | kept        | room for an overview                     |
| Section index 600–959     | sticky strip                                             | sticky strip (tablet portrait)                                                    | collapsed   | a rail would starve the form             |
| Section index < 600       | one-line bar → sheet                                     | the same, with the native sheet                                                   | collapsed   | a strip cannot show four sections at 320 |
| Current tracking          | `IntersectionObserver`                                   | `onLayout` + throttled `onScroll`                                                 | translated  | platform APIs                            |
| Scroll to section         | `scrollIntoView` + `scroll-margin-top`, focus to H2      | `scrollTo`, accessibility focus to H2 (`AccessibilityInfo.setAccessibilityFocus`) | translated  | same job                                 |
| Back to top in the editor | none                                                     | none (status-bar tap on iOS)                                                      | dropped     | §2.2                                     |
| Back to top on long lists | labelled pill, bottom-right, after 4 screens + scroll up | tab re-tap + status-bar tap                                                       | translated  | §2.3                                     |
| Hover                     | rail rows get a `pearl` hover tint on a fine pointer     | pressed state                                                                     | translated  | no hover on touch                        |

---

## 4. Build notes

- **One primitive, three presentations:** `SectionIndex` takes the section list (id, label, short label, status,
  reason) and renders the rail, strip or bar by its container. The editor passes the same data to all three.
- The statuses come from the editor's existing validation and resolution state. No new rules.
- It depends on `@commise/ui/sheet` (exists) for the phone sheet and on the editor's sticky ActionBar.
- `staff-architect` confirms the native scroll mechanism: it needs a scroll-view ref, which is the permitted
  "external, non-declarative system" use of a ref.
- **Tests owed:** a component test per status and per presentation; a Playwright check at 320, 768 and 1280 that the
  current section follows scrolling, that a click focuses the H2, and that a focused field is never fully under the
  header or ActionBar (SC 2.4.11); a Maestro flow on phone for the bar → sheet → section path and the status-bar
  tap on iOS.

## References consulted (fetched 2026-10-08)

- NN/g, [Back-to-Top Button Design Guidelines](https://www.nngroup.com/articles/back-to-top/) (2017)
- NN/g, [Breadcrumbs: 11 Design Guidelines](https://www.nngroup.com/articles/breadcrumbs/)
- GOV.UK Design System, [Task list](https://design-system.service.gov.uk/components/task-list/)
- W3C, [Understanding SC 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
  and [Technique C43, scroll-padding](https://www.w3.org/WAI/WCAG22/Techniques/css/C43)
- W3C, [Understanding SC 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
- MDN, [aria-current](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current)
- Apple, [UIScrollView.scrollsToTop](https://developer.apple.com/documentation/uikit/uiscrollview/scrollstotop);
  React Native, [ScrollView `scrollsToTop`](https://reactnative.dev/docs/scrollview)
- Corpus: `human-factors.md` (goal-gradient, Fitts, Von Restorff), `cross-platform-translation.md` (keyboard),
  `compactHeightLayout.md` A1 (repo).

## Artefacts written

- `docs/design/uiOverhaul/editorNavA.md` (design spec). Nothing else.
