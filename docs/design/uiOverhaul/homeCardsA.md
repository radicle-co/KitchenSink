# Home's recent-recipe cards at tablet and wide widths (designer A)

⛔ **DESIGN DECISION. NOT PRODUCTION CODE.** It answers one question: should Home use the compact card at every
width (as `buildSpec.md` "Settled here" item 19 and §4.2 say), or the full CR-002 card where there is room?

- **Date:** 2026-10-08. **Agent:** `staff-ux-engineer`, designer A. I did not read the other designer's answer.
- **Not user evidence.** Nothing here was tested with users. Facts are cited; judgement is labelled.

## Recommendation

**Compact cards below a 960 px container, full CR-002 grid cards from 960. Four recipes in one row from 600 up.**

| Width                                             | `<main>` container | Card                                          | Columns                                           | Card width          |
| ------------------------------------------------- | ------------------ | --------------------------------------------- | ------------------------------------------------- | ------------------- |
| Web 320 / 390, native phone                       | 288–398            | compact (owner ruling)                        | 2 × 2                                             | about 136–191 px    |
| Web 768, native tablet portrait, phone landscape  | 600–959            | **compact** ⚠️ needs the owner's confirmation | 4 in one row                                      | about 162 px at 720 |
| Web 1280, native tablet ≥ 960 dp wide (landscape) | 960–1439           | **full CR-002 grid card**                     | 4 in one row                                      | 222 px at 960       |
| Web 1920                                          | 1440 (cap)         | full CR-002 grid card                         | 4 in one row, each capped at 320 px, left-aligned | 320 px              |

This is the build spec's own stated fallback ("full grid cards from a 960 container"), recommended as the primary
answer, plus one change to the compact card (§4).

## 1. The governing facts

1. **CR-002 names the Home card explicitly.** `recipe-list.md:70`: CR-002 unifies the fields "into one card so the
   shared `RecipeCard` (also the Home 'recent recipes' widget card) never diverges". So the Home card is not outside
   CR-002. Any compact card on Home is an exception to a ruling, not a free design choice.
2. **The owner's exception is for phones only.** The reason a phone needs it is space: a full card needs about
   240 px, and a 2-up phone grid gives 136–191 px.
3. **The build spec's own rule:** "The space the card gets picks the variant, never the device" (`buildSpec.md`
   §4.1). So the exception should follow space, not the word "phone".
4. **The captures show what full cards in four narrow columns look like** (`.local-sandbox/uiAudit2026-10-08/home/`,
   viewed today):
    - At 768, four full cards sit in one row at about 162 px each. Heights run from about 230 px (Pasta) to about
      490 px (the lamb card, with tags stacked one per line).
    - At 1280 the same row is ragged in the same way. The first audit measured 270–520 px in one row (E6).
    - At 1920 the four cards sit in a narrow centred column of about 600 px, about 140 px each.
    - So full cards fail below about 220 px. That is a space fact, not a device fact.
5. **The mockup's desktop Home** (`docs/mockups/screens/screenHome.html`, rendered at 1280 earlier today) shows four
   recent recipes in one row, each with a photo, a title, time, servings, a difficulty pill and stars. That is
   closer to the full card than to the compact one. The mockups are the floor.

## 2. Home's job against the library's

- **Home** answers "what was I just cooking or editing?" (FR-046: "up to 4 most recently viewed or edited
  recipes"). The cook already knows these recipes, so the job is **recognition**, and a photo and a title carry it
  (recognition rather than recall, Nielsen #6).
- **The library** answers "which recipe, among all of mine?" It needs the management fields: version, visibility,
  tags, edited time. That is where the full card earns its rows.
- So on Home the extra CR-002 rows are not needed for the task. That is the case for compact everywhere (judgement).
- But when the screen has room for four full cards **in one row**, the extra rows cost no extra scrolling. The row
  is about 340 px tall at 960, against about 220 px for compact. Then CR-002 applies at no cost to Home's job, and
  rating, time and calories do help the cook choose which recent recipe to open (judgement).

## 3. Why the line is at 960, not 600

| Option at 600–959 (web 768, native tablet portrait) | Result                                                                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full cards, 4 in one row                            | about 162 px each, below the 240 px a full card needs. This is exactly today's broken 768 capture. Rejected.                                                                                                                          |
| Full cards, 2 × 2                                   | 348 px each, about 470 px tall. At 768 × 1024 the second row falls below the first screen, and the placeholders move two screens down. That breaks the counter test both proposals share: real content on the first screen. Rejected. |
| **Compact cards, 4 in one row**                     | about 162 × 220 px. All four recipes and the start of "Coming soon" are on the first screen. Chosen.                                                                                                                                  |

At 960 and above, four full cards fit in one row at 222 px or more. The 240 px minimum in the build spec exists so a
full card's rows do not overflow. At 222 px, one rule inside the card keeps it whole (judgement): below a 240 px card
width, the five-star row collapses to "★ 4.8 (12)", one star and the number. Nothing else drops, because the
existing "items drop from the end" rule on the cuisine · calories · serves line already covers it.

**At 1920:** four cards capped at 320 px each (`repeat(4, minmax(0, 20rem))`), left-aligned. The space to the right
stays empty on purpose. Empty space beside content is correct, not wasted (`device-ergonomics.md`). Cards are not
stretched to 342 px, and there is no fifth column, because Home never shows more than four.

**Consistency across widths:** the variant change at 960 is the same component with more rows, picked by space. It
matches the library grid, which also changes with space. A native tablet rotated from portrait (compact) to
landscape (full) changes variant. That is the same thing the library does, so it is consistent, not a surprise
(judgement).

## 4. One change to the compact card on Home

Home is "pick up where you left off", and recently edited **drafts** are the most likely thing to resume. The build
spec's compact card shows only the time chip and the PRO chip on its cover. So a draft on a phone or tablet Home
looks the same as a published recipe.

**Add the status chip to the compact card's cover**, top-start, the same as the grid card: "✎ Draft" or "🔒 Private",
own recipes only. PRO moves to top-end, as on the grid card. This keeps the CR-002 visibility and draft badges (the
draft-status ruling in `recipe-list.md:72`) on Home at every width, at no height cost.

## 5. What needs the owner

- **600–959 compact** extends the owner's phone-only ruling to tablets and phone landscape. The reason is the same
  as the phone's: four full cards do not fit in one row. Ask for a yes.
- **If the owner says no:** use full cards in a 2 × 2 grid at 600–959, and accept that the second row and "Coming
  soon" fall below the first screen on a 768 × 1024 tablet.
- **Everything else here follows existing rulings** (CR-002 at ≥ 960, the phone compact grid) and needs no new
  decision. It corrects `buildSpec.md` "Settled here" item 19 and its §4.2 Home table, which use compact cards at
  every width.

## 6. Build notes

- **Home grid:** `grid-template-columns: repeat(2, 1fr)` below a 600 container, and `repeat(4, minmax(0, 20rem))`
  from 600. The variant prop is picked from the container width: compact below 960, grid from 960. Native picks it
  from the window width.
- **Subgrid rows** on the full cards from 960, so the four cards align row by row (`buildSpec.md` §4.1).
- **Skeletons** follow the variant at each width, so nothing shifts on load.
- **Tests owed:**
    - Playwright at 390, 768, 1280 and 1920: the variant shown, all four cards in the first viewport, and equal card
      heights in the row.
    - A component test for the status chip on the compact card, and for the star-collapse rule below a 240 px card.
    - A Maestro screenshot on a tablet in both orientations.

## References

- `specs/001-commise-recipe-app/product-spec/wireframes/recipe-list.md:70` and `:72` (CR-002, draft ruling)
- `specs/001-commise-recipe-app/spec.md:179` (FR-046)
- `docs/design/uiOverhaul/buildSpec.md` §4.1, §4.2, "Settled here" item 19
- `.local-sandbox/uiAudit2026-10-08/home/{768,1280,1920}.png` (viewed today), first audit E6
- `docs/mockups/screens/screenHome.html` (rendered at 1280 today)
- Corpus: `human-factors.md` (Nielsen #6), `device-ergonomics.md` (whitespace on desktop)

## Artefacts written

- `docs/design/uiOverhaul/homeCardsA.md` (design decision). Nothing else.
