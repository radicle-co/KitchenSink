# Designer answers for the Tamagui port

Each answer is the design ruling a port builds to. Newest first.

## 2026-11-01: label and value rows at large text (asked by kitchensink-87)

- **When a row stacks:** decide by room, not by scale alone, as the recipe detail page does. A label and value row
  stacks when its content width divided by the capped font scale is below 280 pt. On a 390 pt phone with 16 pt sides
  that happens a little above 1.25x. On a tablet it does not happen at the cap. A scale-only rule would stack rows
  on a wide tablet that has room.
- **Gap when stacked:** 4 pt (`$1`). A label and its value are one group, so they sit closer than the 12 pt between
  rows (spec §1.6).
- **Web:** the same rule, with a container query at 17.5 rem (280 px at the default size), so it follows browser
  text size.
- **Applies to:** `ProfileFactRow` and `ProfileRow` ("Display name"), and any later row with a label beside a value.
  The label never breaks inside a word, and the value wraps, never truncates.
- **Page-end padding:** every page-end `pb-10` (40) becomes `pb-12` (48): `RecipeVersionList`, its error and
  skeleton, and `DataSourcesPage`. One end padding for every page.
- **Native detail `paddingBottom: 120` (corrected):** recipe detail has no pinned bottom bar, and the tab bar sits
  below the scroll view and owns the bottom safe area. So the page end is the same 48 pt (`$7`) as the web, on recipe
  detail and on `CollectionDetailScreen`. A screen whose content a floating control covers (for example the "New
  recipe" button) instead ends with that control's height, its margin and 16 pt, computed, not a fixed number.
- **Content width** in the stacking rule means the page column: the window less the page gutter.

## 2026-11-01: Home and Profile text, and two off-scale steps (asked by kitchensink-87)

- **Recipe detail bottom padding:** `DETAIL_ARTICLE`'s `pb-10` (40) becomes `pb-12` (48). The end of the page gets
  more room than the 32 between sections, so the page reads as finished.
- **Timer chip padding:** the 2 pt vertical padding stays on web and native. A compact control's inner padding comes
  from its height, like the badge box, not from the spacing scale.
- **ProfileHeader failed-read line:** use `body` on native, like the web. `sectionTitle` makes an error line look
  like a heading.
- **HomeWidgetErrorNotice:** no change. `meta` and `text-body-sm` are both 14 px at weight 400.
- **SubscriptionNudge:** the copy is `meta` on both platforms, so the web replaces the raw `text-sm` with the
  `meta` role. The web title moves onto the `cardTitle` role, which is the same role as the native title.
- **ProfileFactRow:** the value sits at the END of the line, as the web's `text-end` does. In a right-to-left
  language the end is the left. Make sure that native right alignment flips in a right-to-left layout. If it does
  not, align the value to the end in a way that flips. At large text, the value stacks under its label (see
  `reviews/androidShots1.md`).
- **ProfileHeader name:** no change. The web's `overflow-wrap: anywhere` breaks only a word too long for the line,
  and native text already does the same.

## 2026-11-01: recipe detail section gap (asked by kitchensink-87)

- The gap between the detail page's sections is 32 pt (`$6`) on both web and native, in one column and in two.
  It replaces the 40 pt and 64 pt I named in `reviews/detailLeaves1.md`.
- 40 is not on the design spacing scale (0, 4, 8, 12, 16, 24, 32, 48, 64, 96). The web's `gap-10` came from
  Tailwind's default scale, so the web changes to `gap-8` (32 px). Do not add a 40 step.
- The redesign board for recipe detail stacks its sections 32 apart, so 32 is the design value.
- State it as one gap in one place, not as a smaller gap plus a margin.

## 2026-11-01: how far each type role grows with the system text size (asked by Thing 1)

The shared `Text` now scales text itself. Growth is not the same for every role:

- Display and chrome roles grow to 1.5x at most: `largeTitle`, `sectionTitle` and `barTitle`. At the cap a
  `largeTitle` is 42 pt, not 56.
- Every other role grows linearly to the 2x cap: `body`, `readingBody`, `cardTitle`, `meta`, `list`, `label`,
  `caption` and `figureStat`.
- The reason: large text needs less help, and Android 14 and iOS both grow large styles less than small ones. A
  56 pt title fills a phone screen and pushes the content down, which goes against the owner's rule against
  oversized UI. Reading text keeps the full 2x, because that is the text people enlarge to read.
- Residual risk: WCAG 1.4.4 asks for text that can grow to 200 %. A title that stops at 1.5x is already large text,
  and the platforms make the same trade. If an audit reads 1.4.4 strictly, this ruling is the one to revisit.

## 2026-11-01: tab bar and segmented control labels (asked by Thing 1)

- Navigation chrome (the bottom tab bar and segmented tabs that switch views) caps its labels at 1.5x. The rest of
  the screen keeps the 2x cap.
- A label never breaks inside a word and never truncates.
- A test proves it: for every locale, the longest label fits on one line in its slot on a 360 pt wide screen at the
  chrome cap. If a label does not fit at 1.5x, lower the cap to the largest scale that fits, but not below 1.3x.
  Below that, shorten the copy.
- Keep each accessible name. Do not hide the labels and show icons only.

## 2026-11-01: native recipe detail (asked by kitchensink-87)

1. **Hairline.** Use two tokens, not one.
    - A divider or rule between sections (the stat strip, `SectionSwitch`) is a true hairline. Add a design-system
      token for it with the value of `StyleSheet.hairlineWidth`. This keeps today's look.
    - The outline of a control (badge, field, chip) stays 1 pt, as `BADGE_BOX` already uses.
2. **Caveat lines.** Do not add a role. The web caveat is `text-meta font-medium text-ink`, which is 14 px at weight 500. That is the `caption` role. Use `caption` with `$ink`. Native weight 600 was a drift from the web.
3. **Rating figure.** Keep it at regular weight, like the web's `meta` with tabular figures. I agree with a `figures`
   variant on `Text` that sets tabular, lining figures and keeps the role's own weight. `figureInline` stays for
   figures that the copy stresses, such as ingredient amounts.
