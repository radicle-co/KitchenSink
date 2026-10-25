# Cooking mode workshop: brief for the three designers

The owner rejected the first cooking mode (`spec.md`, the "Cooking mode" row on the redesign canvas) as amateurish. It
was one step at a time in big text with Back and Next. Do better. This workshop runs three rounds. In each round, each
designer mocks a direction, then reviews the other two. The next round builds on the reviews.

## The problem

Assume that some cooks need help to reduce the mental load of holding the current step, the next step and the amounts
while they cook. The app grows with the cook (brief §3b): that help is always there and never in the way of a cook who
does not need it.

## Read first

1. `docs/design/uiRefreshWorkshop5/cookingMode/research.md`, and the records it cites in
   `docs/research/userNeeds/cooking.md`, CK-030 to CK-036 above all.
2. `docs/design/uiRefreshWorkshop5/brief.md` (§3a design from the digital need, §3b the app grows with the cook, the
   pass test).
3. `docs/design/uiRefreshWorkshop5/ownerFeedback.md`. Every decision binds: R1, R4, P1 to P5, H1.
4. `specs/008-cooking-mode/spec.md` (FR-032 to FR-035, SC-007) and the first attempt, `cookingMode/spec.md`, to see
   what to beat.
5. The redesign system: `redesignCanvas/redesignSpec.md`, `tokens.css`, and the round 9 recipe screens.

## What each round delivers

Write to `docs/design/uiRefreshWorkshop5/cookingMode/workshop/round<N>/designer<X>/`:

- `mockup.html`: one file, self-contained, using the redesign tokens. Each screen is an element with
  `data-screen="<name>"` at its real width. Draw at least: phone 390 (the core screens), tablet 1194 held sideways (a
  tablet in a stand), and web 1280. Draw light and dark for the core step screen.
- `rationale.md`: at most 60 lines. The idea in two sentences, each decision with the need IDs behind it, what you
  rejected and why, and how it serves both the struggling cook and the experienced cook.

Every direction must show these core screens:

1. the step in progress
2. the next step, and how the cook sees it coming
3. a wait (for example the 1 h 30 roast), and what the cook can do during it
4. two timers at once
5. a finished timer that reaches a cook who is not looking
6. the ingredients, from any step

After all three mock, each designer writes `review<Y>.md` in their own folder for each other designer Y: at most 30
lines, what to steal, what fails and for which need ID, and one question. Be specific and blunt.

## Rules

- Use only the colours and type sizes of the redesign system. If the research supports it, you can add one cooking
  reading size. Steel is an accent, never a large fill (P4).
- Every state is a deliverable, and colour is never the only signal (NFR-004).
- Wet hands: no gesture that a stray swipe or splash can trigger by accident without a way back.
- Never cite or imitate Crouton.
- File names use camelCase, with no hyphens and no low lines.
- Do not edit the redesign canvas, the boards or anything outside your own round folder. Do not commit.
