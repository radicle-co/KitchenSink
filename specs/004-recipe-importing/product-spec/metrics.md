# Metrics: Recipe Importing (004)

**Source**: [product-spec.md](./product-spec.md), [../spec.md](../spec.md)

Each target cites its source. A metric marked "(observe)" has no target yet: it is recorded from the day its flow
ships, and a target is set from what is observed. A metric whose flow has not shipped says so.

## North star

**Recipes saved from an import per active cook per month.** It counts saved recipes, not started imports. An import
that is refused, abandoned or held forever delivers nothing to the cook. Target: (observe).

## Extraction quality

| ID  | Metric                    | Definition                                                                      | Target                                                                          | Source             |
| --- | ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------ |
| Q-1 | Wrong-yes rate, per tier  | Yes answers whose extracted recipe differs from the page's recipe ÷ yes answers | 0 observed, and a 95% upper bound under 5%, before a device tier is switched on | `SC-002`, `D-009`  |
| Q-2 | Coverage, per tier        | Pages a tier answers yes for ÷ pages it reads                                   | Reported next to Q-1. No floor.                                                 | `SC-003`           |
| Q-3 | Not-extractable rate      | Imports where every tier says no and the fallback finds no recipe ÷ imports     | (observe)                                                                       | `FR-064`, `FR-056` |
| Q-4 | Unparsed ingredient lines | Lines kept with an absent quantity ÷ ingredient lines                           | (observe)                                                                       | `FR-020`           |

Q-1 is a switch-on gate, not a dashboard. A tier that misses it stays off (`SC-003`).

## The AI fallback (ships with `FR-056`)

| ID  | Metric               | Definition                                                        | Target                                                         | Source             |
| --- | -------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- | ------------------ |
| F-1 | `budgetSpent` rate   | Fallback jobs ending `budgetSpent` ÷ fallback jobs                | (observe). Any rise is read against the monthly spend ceiling. | `FR-059`, ADR-0024 |
| F-2 | Fallback outcome mix | Share of `extracted`, `noRecipe`, `severalRecipes` and `failed`   | (observe)                                                      | `FR-056`           |
| F-3 | Refused before a job | Pastes refused over the 48,000-byte cap or by an opt-out ÷ pastes | (observe)                                                      | `FR-058`, `FR-063` |

## Cook choices

| ID  | Metric                        | Definition                                                                                 | Target    | Source    |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------ | --------- | --------- |
| C-1 | Private / Public / Both share | Share of saved imports by the cook's choice. Public and Both appear once 003B ships.       | (observe) | `FR-065`  |
| C-2 | Duplicate choices             | Share of Duplicate, Replace, Cancel and "Import as a new copy" when a page is already held | (observe) | `FR-008`  |
| C-3 | Bulk skips kept               | "Already in your library" items left skipped ÷ such items                                  | (observe) | `FR-068`  |
| C-4 | Statement mix                 | Share of each statement the cook chooses                                                   | (observe) | `FR-014a` |
| C-5 | Held items completed          | Held items the cook completes ÷ held items                                                 | (observe) | `FR-015`  |

## Availability and performance

| ID  | Metric                               | Target                                         | Source   |
| --- | ------------------------------------ | ---------------------------------------------- | -------- |
| R-1 | Link import on the server fetch path | p95 15 s or less, p99 30 s or less             | `SC-004` |
| R-2 | Save                                 | p95 400 ms or less                             | `SC-004` |
| R-3 | robots.txt blocks                    | (observe), counted per `IMPORT_SOURCE_BLOCKED` | `FR-023` |

## Invariants

Any non-zero reading is an incident, not a trend.

| ID  | Invariant                                                              | Target | Source             |
| --- | ---------------------------------------------------------------------- | ------ | ------------------ |
| I-1 | A second import of a page not matched to the first                     | 0      | `SC-005`           |
| I-2 | A third-party recipe made public by any door other than the two routes | 0      | `003B-FR-015`      |
| I-3 | A paid-site recipe whose source wording is public                      | 0      | `FR-014`, `FR-065` |
| I-4 | A server fetch of a known paid site                                    | 0      | `FR-014`, `FR-064` |
| I-5 | A value the source did not state, filled in by the import              | 0      | `FR-015`, `FR-021` |
| I-6 | A server download of a video                                           | 0      | `FR-009`           |

## Not measured

- Started imports as a headline. They rise while quality falls.
- Per-site success rates in public.
