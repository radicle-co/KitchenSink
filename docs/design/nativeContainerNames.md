# Native container names: say each name once

> **What this is.** A design-system rule, from the end-of-plan EVALUATE, by `staff-ux-engineer`, 2026-10-03. It
> binds every React Native `View` in `@commise/ui` and the apps. It is not production code.
>
> **Who holds it.** The guard `packages/infra/global/__tests__/nativeLabelledViews.test.ts` (§N3), and the reviewer.
> `rowEditorOpenDecisions.md` P11 cites this file. Nothing else restates the rule.

## N0. What was measured

- `collapsable={false}` went on 74 named Views so Android keeps their nodes. The names now reach TalkBack. Stop
  counts from the lead's TalkBack pass (not repeated here): filter sheet 19 → 23, recipe detail 33 → 34, editor
  27 → 30.
- All four new filter-sheet stops repeat a name. The facet group says `Prep time`, then its visible label says
  `PREP TIME`. The detail body says the title, then the title heading says it again.
- Cause: these Views carry a name equal to text inside them. While Android flattened them, nobody heard it. Keeping
  the node made it a stop.

## N1. The rule

1. If no text inside a native View says its name, the View can carry that name. Otherwise it carries none.
2. If a heading or label inside the View names it, the View has no `accessibilityLabel`, `aria-label` or
   `aria-labelledby`. That text names it, and it carries `accessibilityRole="header"`. This is P11's "header text on
   native", made general.
3. A name that only repeats a web landmark (`nav`, `region`) is not used on native. Judgement: there it is one more
   swipe stop with no new fact, and the controls inside already name themselves.
4. A role stays where it tells the cook something about the members: `radiogroup`, `list`, `alert`, `status`,
   `summary`. Then the guard keeps the node. A `group` role that only carried a dropped name goes with it.
5. A name stays where it adds a fact nobody can see. `Ingredient {number} name` stays: the number is not shown.
   `Food suggestions for ingredient {number}` stays: it marks where that row's list starts.
6. A View left with no name and no role drops `collapsable={false}` too. It has nothing left to keep.
7. Web does not change. A web group keeps `role="group"` and its name (P11).

## N2. The measured surfaces

| Surface        | View                                                                                                 | Ruling                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Filter sheet   | each facet group, `FR/filters/RecipeFilterBar.native.tsx:93`                                         | Drop `role="group"` and `aria-label`. The label `Text` at `:94` gets `accessibilityRole="header"`. 23 → 19 stops expected                      |
| Recipe detail  | the body, `FR/detail/RecipeDetailBody.native.tsx:125`                                                | Drop `accessibilityLabel={recipe.title}`. The title header at `:133` names the screen. 34 → 33 expected                                        |
| Recipe detail  | the hero photo, `FR/detail/RecipeHero.native.tsx:106`, named by the title                            | With a cover, this can be a third reading of the title. Check it on a device. If it is, the photo takes no name on native, like the card cover |
| Editor         | `Ingredient {number} name`, `FR/form/RecipeIngredientsFields.native.tsx:187-192`                     | **Stays** (rule 5). The contract needs it, and Maestro selects it                                                                              |
| Editor         | the rail, `FR/wizard/Wizard.native.tsx:159` (`Recipe wizard steps`)                                  | Drop (rule 3). `Step 2 of 4` and each step's own name say it                                                                                   |
| Editor         | the controls row, `Wizard.native.tsx:283` (`Wizard step navigation`)                                 | Drop (rule 3). Each button names itself                                                                                                        |
| Editor         | the header `Wizard.native.tsx:221` and the Ingredients card `RecipeIngredientsFields.native.tsx:361` | Drop. Same class: the card repeats its own heading, and the header repeats a landmark                                                          |
| The rest of 74 | the list §N3's new check prints                                                                      | Apply N1 to each                                                                                                                               |

The message keys (`railLabel`, `headerLabel`, `controlsLabel`) stay. Web uses them.

## N3. The guard

- **Its predicate stays.** A View with a name or a role keeps its node. It never asks for a name, so a group named
  by its own heading passes with neither.
- **Its fix text changes order.** Today it says "give the View `collapsable={false}`", and that is how the repeats
  were kept. Its first fix becomes: if text inside the View says the same, drop the name (this file, N1). Only then:
  keep the node.
- **One new check: named twice.** A View whose name is the same expression as the text of any `Text` inside it, at
  any depth in the same JSX tree (`aria-label={label}` … `<Text>{label}</Text>`). The detail title sits inside
  `GradientSurface`, so a direct-child check misses the case that was measured. It reads syntax only. So it finds the
  facets, the detail body, the Ingredients card and the collections headings. It cannot find a name in other words
  (the rail, the controls). Review finds those.
- **Fixture rows, both ways:** named twice, direct child (offends). Named twice, the `Text` nested in another
  element (offends). Named by its heading only (passes). A name the inner text does not say (passes). An inner
  `Text` with another expression (passes).
- Run on today's tree, the new check must fail. Its list is the sweep.
- **As built (2026-10-03):** the check skips a View with `accessible`, because that View is one stop, so its name is not
  a repeat. It found 34 sites before the sweep and none after.
- **Open (2026-10-03, device count):** a container with a role but no name (rule 4) takes its children's text as its
  announcement, so TalkBack can read that text twice. Field label then control (9 sites) and ingredient check box then
  its text (5 sites) also read twice. Rule 4 does not yet say which of these are acceptable.

## N4. Tests owed

- **Component, native, through react-native-web.** Every test that finds a native group by name, where the group
  loses its name, finds the heading instead (`getByRole('heading', { name })`). Known: `RecipeFilterBar.native.test`,
  `RecipeIngredientsFields.native.test`, `RecipeIngredientsFields.rowEditor.native.test`, `RecipeForm.native.test`.
  Rewrite them, and say why in the doc comment. Do not loosen them.
- `Wizard.native.test.tsx` and `mobile/tests/screens/RecipeEditor.native.test.tsx` find the rail and the bar by
  name. Find the rail by its progress text, and the bar by its buttons.
- Each fixed surface gets one test that the name is said once: one node carries it, and it is the heading.
- **Device, owed.** A TalkBack walk on API 34 and Android 15. Filter sheet and detail as N2 expects. Editor: no stop
  that repeats a heading or only names a landmark. Report the counts. They are not claimed here.
