# Editor navigation: the section index, and "Back to top" (answer B)

⛔ **DESIGN ANSWER. NOT PRODUCTION CODE.** It answers the owner's two proposed additions to the one-page
editor. I did not read the other designer's answer.

- **Date:** 2026-10-08. **Agent:** `staff-ux-engineer` (author of proposal B).
- **Governing decision:** the owner chose the one-page editor. It has a section index, autosave, **Save
  changes** for published recipes, and guided progress for a first recipe. This answer designs inside
  that choice.
- **Not user evidence.** Sources were read today and are listed in §5. Anything without a source is
  labelled judgement.

## §1. The verdicts in short

| Addition                          | Verdict                                                                                                          | Why, in one line                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (2) The vertical "breadcrumb" box | **KEEP the idea, CHANGE what it is.** It is the section index, not a breadcrumb. One component, placed by width. | A breadcrumb shows where a page sits in the site's hierarchy (NN/g). This box shows where you are inside one page, plus each section's state. That is an in-page table of contents. |
| (1) Back to top                   | **DROP it from the editor. CHANGE it elsewhere** into conventions that already exist.                            | In the editor, the index's first item already goes to the top. A separate button sits in the same corner as Publish and the FAB, and under the keyboard.                            |

## §2. The section index (the owner's "breadcrumb box")

### 2.1 It is the same thing as proposal A's section index

**Yes. Build one component, not two**. NN/g defines breadcrumbs as "a list of links representing the
current page and its 'ancestors'". It says they show "the hierarchical structure of the site", not a
path or a session. The editor's sections are not ancestors. They are four parts of one page.

So the right pattern is in-page navigation with three jobs:

1. show the parts of the page
2. show where you are
3. show what each part still needs

Calling it a breadcrumb has a cost. The word carries the wrong mental model, and it invites the wrong
markup: a breadcrumb `nav` with an ordered trail and `aria-current="page"`. So the component is named
**`SectionIndex`**. Its vertical box form is the owner's drawing, at wide widths.

### 2.2 Placement by width

The container class is measured on `<main>`.

| Width                                                                      | Form                                                                                                  | Where                                                                                                                            | Why                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@wide` (960 and up): web 1280 and 1920, native tablet at 960 dp and wider | **The vertical box**, a sticky side rail, 240 px                                                      | Inline start, under the editor header. Sticky at `top: header height + 16`. A rail taller than the window scrolls inside itself. | The owner's drawing. There is room, and a rail stays in view while the form scrolls, so position never needs recall (Nielsen #6).                                                                                                                                                                           |
| `@regular` (600–959): web 768, native tablet portrait                      | **A horizontal strip**, 48 px, sticky under the header                                                | Full width of the editor column                                                                                                  | Four labels with their state glyphs fit in about 600 px. A 240 px rail takes a third of a 720 column from the form.                                                                                                                                                                                         |
| `@narrow` (below 600): web 320 and 390, native phone                       | **A one-line section button** in the header's second row, which opens a **sheet** with the full index | Sticky under the header, 40 px                                                                                                   | Four labels with states do not fit one line at 320. Measured from the type: about 303 px of labels and padding against a 288 px column. A strip that scrolls sideways hides the fourth section, which is a discoverability failure. A sheet shows everything, with room for the reasons ("3 need a match"). |

**The phone section button**, in detail:

- It reads "Ingredients · 2 of 4" on the start side and "⚠ 3 to fix" on the end side (only when
  something needs attention), with a ▾.
- The whole 40 px row is the target.
- Tap: a content-height bottom sheet (`@commise/ui/sheet`) titled "Sections". The sheet lists four 56 px
  rows, each with its state glyph, its name and its one-line reason.
- Tap a row: the sheet closes, and the page scrolls to that section (§2.5).

**Why not a top strip on phones, as proposal A drew?** I recommend the sheet, and this is judgement. The
labels do not fit at 320 (above). On phones, the index matters most for its reasons, and a strip has
no room for them. The cost is one extra tap to jump. **Flip:** the owner shortens the labels to fit one
line at 320 with +35% translations. Then a strip without reasons is acceptable.

### 2.3 Sections and their states

The sections are **Details · Ingredients · Steps · Photos & publish**.

Each section has exactly one state at a time. A state never relies on colour alone: each has a glyph,
a word in the accessible name, and a reason line (SC 1.4.1).

| State           | Glyph                  | Reason line (`caption`)                 | Rule                                                                                                 |
| --------------- | ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Not started     | ○ pewter outline       | "Not started"                           | No field in the section has a value                                                                  |
| In progress     | ◐ half-filled, ink     | "Title needed", "Add at least one step" | Some fields are filled, and a field required to publish is still empty                               |
| Needs attention | ⚠ warning-dark         | "3 need a match", "1 error"             | Something blocks publishing: an unmatched ingredient, or a field error found by Publish              |
| Done            | ✓ seafoam              | none, or a count: "9 ingredients"       | Everything the section needs to publish is present                                                   |
| Optional        | a short ink-muted dash | "Optional"                              | Photos & publish, with no photo yet. A photo is not required, so the section is never "not started". |

What "done" means per section:

- **Details:** a title.
- **Ingredients:** at least one line, and every line matched to a food.
- **Steps:** at least one step with text.
- **Photos & publish:** done once Details, Ingredients and Steps are done. Its reason line then says
  "Ready to publish".

Visibility is in Details (resolution R51).

These rules reuse the publish validator, so the index and Publish can never disagree. One source of
truth, the same rule as DRY of knowledge in CLAUDE.md.

**The current section** gets one more marker on top of its state: a 3 px seafoam bar on the start edge
(rail), or under the label (strip). The label becomes ink at weight 600. Current is a position, not a
state, so it stacks with any state.

### 2.4 Guided progress for a first recipe

The owner chose guided progress for a first recipe. The index carries it, so no tour is needed (the
paradox of the active user, `human-factors.md`).

- **First recipe only** (the account has no published recipe): each item shows its number, 1 to 4. A
  "Next: Ingredients" line sits under the current item, once the current section is done.
- **Endowed progress:** the rail's header reads "2 of 4 done". The goal-gradient effect says visible
  progress raises completion, provided the progress is honest (`human-factors.md`). It counts only real
  "done" states.
- **After the first publish,** numbers and the "Next" line disappear. An experienced cook gets a plain
  index with states only.
- **Order is a suggestion, not a gate.** Every item is reachable at any time. The owner chose one page,
  and a gated index turns it back into a wizard.

### 2.5 Tracking the current section while scrolling

- **Web:** one `IntersectionObserver` watches each section's H2. The "reading line" sits just under the
  sticky chrome (header, plus the strip or section button below `@wide`), plus 24 px. The current section
  is the last one whose H2 is above that line. At the bottom of the page, the last section is current.
  No scroll listeners.
- **Native:** the editor's scroll view reports `onScroll` with `scrollEventThrottle={16}`. Each section
  reports its top through `onLayout`. The same reading-line rule picks the current section.
    - Jumping to a section needs `scrollTo` on the scroll view, and that needs a ref. CLAUDE.md allows a
      ref only for a genuinely external, non-declarative system. `staff-architect` decides whether a
      scroll view qualifies (also flagged in proposal B §7.2).
- **No announcement on scroll.** The current marker changes silently. A live region that speaks on every
  scroll is noise for a screen-reader user, who moves by headings anyway.
- **No focus movement on scroll.** Focus moves only after an explicit jump (§2.6).

### 2.6 Jumping to a section, with keyboard and screen readers

**Markup:**

- `<nav aria-label="Recipe sections">` holds a list of four links, `<a href="#ingredients">`.
- The current one carries `aria-current="location"`. That is the ARIA value for "current location
  within a context". I read the spec summary today, not its full text.
    - Not `"step"`, because the sections are not a sequential process. The owner chose one page.
    - Not `"page"`, because the link does not change the page.
- Each link's accessible name holds the state: "Ingredients, needs attention, 3 need a match". The
  visible label "Ingredients" is contained in it (SC 2.5.3).
- Not `role="tablist"`. Tabs hide the other panels, and these sections are always on the page.

**Activation** (Enter, click, or tap):

1. The page scrolls the section's H2 to sit just below the sticky chrome. Use `scroll-margin-top` on
   each H2, equal to the chrome's height.
2. Then focus moves to that H2, which has `tabindex="-1"`, using `focus({ preventScroll: true })`. So a
   keyboard or screen-reader user lands where a sighted user looks (SC 2.4.3, focus order).
3. Web: `history.replaceState` writes `#ingredients`. Reloading returns there, and the browser's Back is
   not filled with jumps.
4. In the phone sheet, the sheet closes first and returns focus to its trigger, then steps 1–2 run.

**Reduced motion.** The jump scrolls smoothly by default (`behavior: 'smooth'`, about 300 ms). Under
`prefers-reduced-motion: reduce` (and native's reduce-motion setting) it jumps instantly.

- WCAG 2.3.3 Animation from Interactions is Level AAA, and its Understanding document calls scrolling
  the user started "essential", so smooth scrolling is allowed.
- We honour the preference anyway, because a long smooth scroll is exactly the large motion that hurts
  people with vestibular disorders (`interaction-motion.md`). Above the AA floor, by choice.

**Focus not obscured (SC 2.4.11, AA).** The editor has sticky chrome at both edges: the header and the
strip or section button at the top, and the action bar at the bottom.

- Set `scroll-padding-top` to the top chrome's height and `scroll-padding-bottom` to the action bar's
  height on the scrolling element. The W3C lists CSS scroll-padding (technique C43) as a sufficient
  technique for exactly this sticky-header and sticky-footer case.
- Native: keep the focused field above the action bar and the keyboard with the existing
  `KeyboardAvoider`, plus `scrollIntoView` with `block: 'nearest'` on focus.

**Tab order** (DOM order equals visual order):

1. editor header: close, title, save status
2. the section index (four stops at `@regular` and up, one stop for the section button on phones)
3. the form
4. the action bar: Preview, Publish

- On desktop the rail sits on the start side, so this order also matches reading order.
- **SC 2.4.1 Bypass Blocks:** the form is in a `<main>` landmark, and the index is a named `nav`. A
  screen-reader user can go straight to the form. Four tab stops cost a keyboard user little.

### 2.7 The index with the on-screen keyboard

- **Phones:** while the keyboard is open, the section button **hides**. Only the header stays.
    - This follows the existing `compactHeightLayout.md` A1 rule: bars unpin past half the frame. On a
      390 × 844 phone the keyboard takes about 40% of the height. So every pixel of top chrome comes out
      of the field being typed in.
    - The button returns as soon as the keyboard closes.
- **Tablets and desktop:** the strip and rail stay. They do not sit in the keyboard's area.

## §3. "Back to top"

### 3.1 What the research says

NN/g ("Back-to-Top Button Design Guidelines", Hoa Loranger, 2017):

- use one only "for pages that are longer than 4 screens"
- place it at the "lower right side of the page"
- label it "Back to Top", because an icon alone is ambiguous
- show only one, and keep it stationary
- consider showing it only after several screens of scrolling, plus an upward scroll
- never auto-scroll

### 3.2 In the editor: drop it

- **It duplicates the index.** "Details", the first index item, scrolls to the top of the form and moves
  focus to the first heading. On phones, the section button opens the same jump. A second control for
  one job breaks Nielsen #4 and adds a decision (Hick).
- **It lands in the busiest corner.** NN/g's lower-right spot is exactly where the editor's **Publish**
  sits in the action bar. Destructive or rare controls must not sit next to frequent ones (Fitts,
  `human-factors.md`). A mis-tap there costs a publish attempt.
- **The keyboard covers that corner** on phones whenever a field is focused, which in an editor is most
  of the time.
- **The page is often short enough.** NN/g's own threshold is four screens. A typical recipe passes it
  only on phones with long lists. The index already covers that case.

### 3.3 Elsewhere: change it into the conventions that already exist

| Where                                            | Instead of a Back to top button                                                                                                                                                                                                                                                                                       | Why                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Native, iOS                                      | The status-bar tap scrolls the active scroll view to the top. React Native's `ScrollView` exposes `scrollsToTop`. Keep exactly one scroll view per screen with it on.                                                                                                                                                 | A system convention iOS users already know (Jakob's law). From platform knowledge, not checked today, so `fe-1` must test it on a device. |
| Native and web phones, every top-level screen    | **Tap the active tab again** to scroll that screen to the top (a second tap on a pushed screen pops to the tab's root).                                                                                                                                                                                               | A common tab-bar convention on iOS and Android apps (judgement, not checked today). It costs no screen space.                             |
| Recipe detail                                    | The sticky jump bar (Ingredients · Steps · Nutrition) already reaches every section.                                                                                                                                                                                                                                  | Same reason as the editor.                                                                                                                |
| Desktop web: Discover results and a long library | **A labelled "Back to top" button**, exactly per NN/g, only once the page is longer than 4 screens. It appears after 2 screens of scrolling **and** an upward scroll. It sits at the lower right of the content column, 24 px above the window foot. When the FAB is there (My recipes), it sits 16 px above the FAB. | These are the long, unsectioned pages NN/g's guideline is for. On desktop there is no keyboard and no action bar in that corner.          |

### 3.4 If the owner still wants a Back to top in the editor

Then build it this way. Every rule exists to avoid a collision named in §3.2.

- **Label:** "Back to top", with an up-arrow glyph. A text label, per NN/g. The arrow does not mirror in
  right-to-left layouts.
- **Shown when:** the page is more than 4 screens tall, **and** you scrolled down 2 screens or more,
  **and** your last scroll was upward. Hidden while the keyboard is open.
- **Placement:** inside the scroll area, **not** in the action bar. It sits on the **start** side,
  16 px above the action bar, away from Publish (Fitts). That departs from NN/g's lower right for the
  stated collision. Desktop: the foot of the section rail instead, where it never overlaps the form.
- **Size:** `Button size="sm"`, secondary, 36 px visual with a 44 px hit area (48 dp on Android).
- **Action:** the same as activating "Details" in the index: scroll to the top (instant under reduced
  motion), then focus the first heading.
- **Focus:** it is the last tab stop before the action bar in DOM order. It never covers a focused field,
  because `scroll-padding-bottom` counts its height too (SC 2.4.11).

## §4. What changes in the plan

- `SectionIndex` (new, `@commise/ui`, web and native) is one component in three forms: rail, strip, and
  section button with a sheet. It replaces both proposal A's section index and the editor's JumpBar.
  The recipe detail page keeps its own JumpBar, because it shows no states.
- Its states come from the publish validator, not from a second rule set.
- **No `BackToTop` primitive in the editor slice.** A desktop-only `BackToTop` joins the Discover and
  library slice, with the tab re-tap and iOS status-bar behaviour.
- **Tests to write first:**
    - Playwright: at 320, 390, 768, 1280 and 1920, activating each index item puts that H2 below the
      sticky chrome and gives it focus.
    - Playwright: with reduced motion on, the jump is instant.
    - Vitest (component tests): every state and its accessible name.
    - Maestro: the phone sheet jump, and tab re-tap to the top.

## §5. Sources (read 2026-10-08) and labels

- **NN/g, Hoa Loranger, "Back-to-Top Button Design Guidelines"** (2017): the 4-screen threshold, lower
  right, a text label, one stationary button, delayed appearance, no auto-scroll.
- **NN/g, "Breadcrumbs: 11 Design Guidelines for Desktop and Mobile"** (2018, reviewed 2026): breadcrumbs
  show site hierarchy and ancestors, not history.
- **W3C, Understanding SC 2.4.11 Focus Not Obscured (Minimum)** (AA): scroll-padding (C43) as a
  sufficient technique for sticky headers and footers.
- **W3C, Understanding SC 2.3.3 Animation from Interactions** (AAA): scrolling the user started counts
  as essential motion.
- **W3C, WCAG 2.1.4, 2.4.1, 2.4.3 and 2.5.3** as cited inline.
- **WAI-ARIA 1.2, `aria-current`:** the `location` and `step` values. Only a summary was retrieved, so
  `fe-1` checks the spec text before building.
- **In-page navigation guidance** (Queensland Government and Visa design systems, via search): use it as
  a table of contents on long pages, with link text matching the headings.
- **Judgement, not looked up today:**
    - iOS status-bar scroll-to-top, and tab re-tap to the top
    - the sheet in place of a strip on phones
    - the "reading line" offset
    - the 300 ms smooth-scroll length
