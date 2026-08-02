# Screen: Import Draft Review

**Journey**: J1, J2, J3, J6 (every channel) · **Story**: US-408 · **Requirements**: REQ-008..013, REQ-021
**Platforms**: web + mobile

> This is the pivot of the feature. Extraction cannot guarantee the fields the recipe schema requires, so this
> screen is where the user completes what the source did not state. **It can block saving** — that is its job.

## Purpose

Show exactly what was extracted, how confident the system is in each field, and what is still missing — then
let the user fix all of it in one place before anything is saved.

## Layout

```
┌────────────────────────────────────────────────────────┐
│  Review your recipe                          [Discard] │
│  From: allrecipes.com/…/chicken-teriyaki               │
├────────────────────────────────────────────────────────┤
│  ⚠ 1 thing needs your attention before saving          │
├────────────────────────────────────────────────────────┤
│  Title      [ Chicken Teriyaki                      ]  │
│  Servings   [                                       ]  │
│             ⚠ Not stated by the source — please add    │
│  Prep       [ 15 ] min      Cook  [ 20 ] min           │
├────────────────────────────────────────────────────────┤
│  Ingredients                                           │
│   ✓ 2      cup   flour                                 │
│   ✓ 1.5    tsp   salt                                  │
│   ⚠ —      —     "salt to taste"                       │
│             We couldn't read a quantity. Original kept.│
├────────────────────────────────────────────────────────┤
│  Steps                                                 │
│   1 [ Combine the marinade ingredients…             ]  │
│   2 [ Marinate for 20 minutes…                      ]  │
├────────────────────────────────────────────────────────┤
│                            [ Save recipe ]  (disabled) │
└────────────────────────────────────────────────────────┘
```

## Behaviour

| Aspect              | Specification                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Missing required    | Flagged inline with icon **and** text. Save stays disabled until every one is resolved.          |
| Save button         | Disabled while anything required is missing, with the reason stated — never disabled-and-silent. |
| Confidence          | Low-confidence fields marked with an icon and label, **never colour alone** (REQ-NF-005).        |
| Unparsed ingredient | Raw line shown **verbatim**; quantity/unit editable. Never discarded (HAZ-041).                  |
| No fabrication      | Empty fields render empty. The screen never pre-fills a guess (HAZ-040).                         |
| Attestation (J3)    | Source declaration + citation; the visibility consequence is stated **before** saving.           |
| Expiry              | An expired draft shows a clear terminal message and a path to re-import.                         |
| Discard             | Confirms, deletes the draft, and deletes any OCR source image.                                   |

## States (each requires a component test, both platforms)

`complete` · `missing-required` (one per required field) · `unparsed-ingredient` · `low-confidence` ·
`saving` · `save-rejected` · `expired` · `attestation-required` (J3 only)

## Platform notes

- **Web**: full keyboard operation; the missing-field summary is a skip-target to the first offending field.
- **Mobile**: the same fields in a scrolling form; the summary banner is sticky so the blocking reason stays
  visible while scrolling.

## Copy

All strings from `@commise/features-recipes/messages` — shared across platforms, localized, no literals.
