# User Journey: Recipe Importing

**Branch**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Source**: [product-spec.md](./product-spec.md), [../spec.md](../spec.md)

> **Regeneration note.** The previous journey ended at "recipe saved" directly from import. Every journey now
> passes through a **draft review** step, because the shipped recipe schema cannot represent an incomplete
> import (see `../spec.md` → _The draft-and-confirm model_). This is the single largest change to the
> experience, and it is forced by the data model rather than chosen for UX reasons.

---

## J1 — Import from a URL (the primary journey)

**Persona**: P5 Morgan · **Story**: US-401, US-408 · **Platforms**: web + mobile

| #   | User does                                    | System does                                                               | User sees                                                       |
| --- | -------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Opens Import, picks "From a link"            | Lists only channels currently enabled                                     | Channel choices; no disabled or dead options                    |
| 2   | Pastes a URL, submits                        | Validates, canonicalizes, checks the blocklist, accepts the job           | "Importing…" with progress; the screen is not blocked           |
| 3   | Waits (typically a few seconds)              | Fetches within budget, extracts, normalizes, classifies, de-duplicates    | Progress                                                        |
| 4   | Reviews the draft                            | Presents extracted fields with per-field confidence and missing markers   | Title, ingredients, steps filled in; **servings flagged empty** |
| 5   | Fills in servings; fixes one ingredient line | Revalidates; recomputes what is still missing                             | Save becomes enabled once nothing required is missing           |
| 6   | Saves                                        | Creates the recipe via the shipped write path; resolves ingredients async | The finished recipe, public, with source attribution            |

**Where it can go otherwise**

- **Already imported** → step 3 short-circuits: "This recipe is already in Commise", with the existing recipe
  and a Clone option. No duplicate. (J4)
- **Paywalled domain** → rejected at step 2, _before any request to the source_, with the reason stated. (J5)
- **Unreachable / no recipe found** → distinct messages and distinct next steps: retry, try a different link,
  or paste the text manually. Never a generic "import failed".
- **Everything extracted cleanly** → step 4 still happens, but nothing is flagged and Save is enabled
  immediately. The review step costs one tap in the good case and saves the recipe in the bad case.

---

## J2 — Import from a photo of a physical recipe

**Persona**: P3 Riley · **Story**: US-405 · **Platform**: mobile-primary, web upload supported

| #   | User does                                  | System does                                                     | User sees                                                |
| --- | ------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Picks "From a photo", takes or selects one | Validates type and size by content, uploads, queues OCR         | Capture preview, then "Reading your recipe…"             |
| 2   | Waits                                      | Runs OCR, then the **same** normalize → classify → draft path   | Progress                                                 |
| 3   | Reviews the draft                          | Presents extracted text with confidence; OCR is typically lower | More fields flagged than a URL import — honestly so      |
| 4   | Corrects and completes                     | Revalidates                                                     | Save enables when complete                               |
| 5   | Saves                                      | Creates the recipe; **deletes the source photo**                | A **private** recipe, no attribution — nothing to credit |

**Key differences from J1**: no attribution (there is no public source), private by default, more correction
expected, and the photo is deleted once the draft resolves. If the user abandons the draft, the photo is still
deleted at expiry — it is never retained beyond the draft's life.

---

## J3 — Paste from a cookbook (the attestation guardrail)

**Persona**: P11 Robin · **Story**: US-410 · **Platforms**: web + mobile

| #   | User does                               | System does                                            | User sees                                                                |
| --- | --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | Picks "Paste text", pastes a recipe     | Parses the pasted text into a draft                    | The parsed draft                                                         |
| 2   | Is asked where it came from             | Requires an attestation before saving                  | "Where is this from?" — my own · a public web page · a book or paid site |
| 3   | Chooses "a book or paid site", cites it | Requires a citation; classifies as `imported_paid`     | **"This recipe will stay private."** Stated _before_ saving              |
| 4   | Saves                                   | Creates a private recipe that can never be made public | A private recipe with the citation recorded                              |

**Why the consequence is shown at step 3, not after saving**: Robin's stated pain point is exactly this — tools
that reveal the restriction only after publication. The system also runs heuristics here, but they only **flag
for review**; they never override what the user declared or block the save. Guessing wrong in either direction
is worse than trusting the declaration.

---

## J4 — Someone already imported this

**Story**: US-407 · Reached from J1 step 3.

The user sees the existing recipe rather than a second copy, with one clear action: **Clone it** — which uses
001's shipped clone endpoint and keeps the original attribution. The mental model is "this recipe is already
here, do you want your own copy?", not "your import failed".

---

## J5 — Blocked source

**Story**: US-406 · Reached from J1 step 2.

The rejection is specific — the source requires a subscription and cannot be imported — and it is distinct from
"the site is down" and from "we couldn't find a recipe". Offered next steps: import a different link, or type
the recipe in manually (which routes to J3, where the paid-source attestation applies).

Critically, **no request is ever made to a blocked source.** The user is not waiting on a fetch that was never
going to be allowed.

---

## J6 — Instagram _(gated — D-002)_

**Story**: US-402. Identical to J1 with a caption as the source. **Until the Meta credential exists the channel
does not appear at all** — it is absent from the channel list, not shown-and-broken. A user never encounters an
affordance that fails.

---

## Cross-journey guarantees

| Guarantee                    | Where it holds                                                    |
| ---------------------------- | ----------------------------------------------------------------- |
| Nothing is fabricated        | Every journey — missing values are flagged, never defaulted       |
| Nothing saves incomplete     | Draft confirmation validates against the shipped recipe contract  |
| Failures are distinguishable | Each failure kind has its own message and next step               |
| Attribution survives         | Imported-public recipes and their clones retain the source        |
| Identical on web and mobile  | Same components, same shared copy, same states (`§14.1`)          |
| Accessible                   | Every control has an accessible name; state is never colour alone |
| Localized                    | All copy from the shared message catalogue                        |

## Journey → wireframe map

| Journey | Wireframes                                                               |
| ------- | ------------------------------------------------------------------------ |
| J1      | `import-url` → `import-progress` → `import-draft-review` → recipe detail |
| J2      | `import-photo` → `import-progress` → `import-draft-review`               |
| J3      | `import-paste` (with attestation) → `import-draft-review`                |
| J4      | `import-conflict`                                                        |
| J5      | `import-error`                                                           |
| J6      | `import-url` variant (hidden while gated)                                |
