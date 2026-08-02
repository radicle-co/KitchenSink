# Product Specification: Commise — Recipe Importing

**Branch**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Status**: Approved (owner decisions D-001..D-004 recorded)
**Source**: [spec.md](../spec.md)

---

## Vision

Bring a recipe from anywhere into Commise in under a minute — correctly attributed, never duplicated, and
**never fabricated**.

**Tagline**: "Import fast. Attribute correctly. Never invent."

**Core principles**

- Imported-public recipes carry durable source attribution.
- One source URL converges to one canonical recipe.
- Parse quality is transparent and correctable **before** anything is saved.
- Policy constraints are explained to users, not delivered as opaque backend rejections.
- **The system never fills in a value the source did not state.** A missing servings count is shown as missing,
  not guessed. This is the principle that shapes the entire flow.

---

## The product decision that shapes everything: review before save

Extraction from the open web is unreliable in a specific, predictable way — structured markup usually gives you
a title, ingredients, and steps, but frequently omits servings and times, and always gives ingredients as free
text ("2 cups flour") where the product needs structure.

There were two options:

| Option                      | What the user gets                                                  | Why rejected / chosen                                                                                  |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Save immediately, fix later | One click, then a recipe that quietly claims "1 serving, 0 minutes" | **Rejected.** The fabricated values are indistinguishable from real ones. Users would cook from them.  |
| **Review, then save**       | One extra step, then a recipe that is actually correct              | **Chosen.** The gaps are visible exactly where the user can fix them, and only complete recipes exist. |

Every channel — URL, Instagram, file, photo — produces a **draft**. Confirming the draft creates the recipe.
This also collapses what would otherwise be two different flows (photo import needed a review step regardless)
into one the user learns once.

---

## Personas

### Primary — P5 Morgan (Discovery Seeker)

Browses food blogs and newsletters constantly; the window to act is short. Wants to capture a recipe from any
URL and trust the result is complete enough to cook from.

**Goals**: one-paste import from any food blog · accurate ingredient and step capture · attribution preserved
so the original is one tap away · a clear signal when a parse is partial · no duplicate pile-up.
**Pain points**: scrapers silently dropping half an ingredient list · staring at a spinner with no signal that
a site blocked the request · attribution vanishing after the first edit.
**How this feature answers**: the draft shows exactly which fields came through and which did not, so "partial
parse" is a visible, fixable state rather than a silent data loss.

### Secondary — P3 Riley (Family Meal Planner)

Finds recipes through links shared in group chats. The workflow is paste-link-and-go; friction kills the habit.

**Goals**: paste a link and get a usable draft in seconds · import from an Instagram caption · never accumulate
duplicates · fix one missed ingredient without losing the rest.
**Pain points**: social links failing silently · duplicate copies with no merge path · "import failed" with no
next step.
**How this feature answers**: distinct, actionable errors per failure kind; duplicates resolve to the existing
recipe with a clone offer rather than creating a second copy.

### Tertiary — P11 Robin (Recipe Creator)

Runs a food blog; imports published recipes to study and adapt. Attribution and policy clarity are
professional necessities, not preferences.

**Goals**: import a published recipe with attribution locked in · understand immediately when a source is
policy-blocked rather than merely broken · clone into a personal variant with the original credited · paste
from a cookbook and be told the visibility consequence **before** saving.
**Pain points**: tools stripping attribution after the first edit, creating accidental plagiarism risk · no
distinction between "blocked" and "failed" · paid-source rules surfacing only after publishing.
**How this feature answers**: provenance is decided at import and enforced by the shipped visibility policy;
the attestation flow states the consequence at the point of entry.

---

## Tier availability (D-014)

Creating a recipe that is not public requires a subscription — applied consistently, including where the
privacy is imposed by policy rather than chosen by the user.

| Channel                      | Result                     | Free | Premium |
| ---------------------------- | -------------------------- | ---- | ------- |
| URL import                   | public, attributed         | ✅   | ✅      |
| Instagram import _(gated)_   | public, attributed         | ✅   | ✅      |
| File / migration import      | `user_created`             | ✅   | ✅      |
| Photo (OCR) import           | **private** by policy      | ❌   | ✅      |
| Cookbook / paid-source paste | **never public** by policy | ❌   | ✅      |
| Setting any recipe private   | private                    | ❌   | ✅      |

Free-tier users see the upgrade path rather than a failure, and the gated channels are not offered to them at
all — no affordance that cannot succeed. Two consequences worth stating: OCR spend is confined to paying users
(retiring the cost concern D-001 opened), and **migration stays free**, because a user's own export file is
their own content, not third-party material.

## Epics

1. **Ingestion** — URL, Instagram, file, and photo channels.
2. **Draft review** — completion, correction, confidence, and the attestation guardrail.
3. **Attribution & policy** — source display, provenance classification, paywall enforcement.
4. **Recovery & accessibility** — typed errors with next steps, full keyboard and screen-reader support,
   never colour-only state.

---

## MoSCoW Story Map

### Must Have

| ID     | Story                                                                                                                                   | Requirements                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| US-401 | As a signed-in user, I can submit a public recipe URL and receive a parsed draft, so I don't retype a recipe.                           | `004-FR-008` · REQ-001..004                             |
| US-403 | As a user, I always see source URL, author, and platform on imported public recipes — on web and on mobile.                             | `004-FR-010` · REQ-016                                  |
| US-404 | As a user, imported-public recipes are public by default and can only become private through the clone + substantive-edit premium flow. | `004-FR-011` · REQ-014, REQ-015                         |
| US-405 | As a user, I can photograph a physical recipe and save it as a private recipe.                                                          | `004-FR-012`, `004-FR-013` · REQ-007                    |
| US-406 | As a user, I get a clear, specific rejection when a source is paywalled.                                                                | `004-FR-014` · REQ-017..020                             |
| US-407 | As a user, when a source was already imported, I'm taken to the existing recipe with a clone option, not a duplicate.                   | `004-FR-008` · REQ-003, REQ-004                         |
| US-408 | As a user, I review and complete the parsed recipe before it is saved, so nothing is guessed on my behalf.                              | `004-FR-015`, `004-FR-020`, `004-FR-021` · REQ-008..013 |
| US-409 | As a user, an import failure tells me what went wrong and what to try next.                                                             | `004-FR-016` · REQ-024                                  |
| US-410 | As a user pasting from a cookbook, I declare the source, cite it, and am told the visibility consequence before saving.                 | `004-FR-014a` · REQ-021..023                            |
| US-411 | As a user, I can import a recipe from a JSON, YAML, or Markdown file.                                                                   | `004-FR-019` · REQ-006                                  |

**US-408 moved from Should Have to Must Have.** It was previously optional; the shipped schema makes it
load-bearing — without it, imports either fail on good sources or fabricate values.

**US-405 is Must Have at launch** per owner decision D-001 (previously contradictory: Must Have in the product
spec, P3 in the plan, unresolved for three months).

### Must Have — gated

| ID     | Story                                                                           | Requirements           | Gate                                                                                             |
| ------ | ------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| US-402 | As a user, I can import from an Instagram post whose caption contains a recipe. | `004-FR-009` · REQ-005 | Requires an approved Meta application (D-002). Ships **disabled**; release is not blocked on it. |

### Should Have

| ID     | Story                                                                                             | Requirements           |
| ------ | ------------------------------------------------------------------------------------------------- | ---------------------- |
| US-412 | As a user, my unconfirmed drafts are kept for a while and then cleaned up, so my list stays tidy. | `004-FR-018` · REQ-026 |
| US-413 | As a user, an imported recipe survives its source being deleted, and tells me the source is gone. | `004-FR-017` · REQ-025 |

### Could Have

| ID     | Story                                                                   | Requirements    |
| ------ | ----------------------------------------------------------------------- | --------------- |
| US-414 | As an admin, I can add a paywalled domain without waiting for a deploy. | REQ-019 (D-004) |

_US-414 is Could Have from a **user**'s perspective and P1 from an **operational** one — it is the difference
between a same-day and a same-release response to a publisher complaint. Built in T-017._

---

## Out of scope

- Headless-browser rendering for JavaScript-only recipe sites (reported as "no recipe found", not silently empty).
- Automatic legal classification of paid-source content — the user attests, heuristics only flag (D-003).
- RDFa extraction (C-007 — negligible recipe usage, no maintained parser).
- Re-hosting source imagery or full article prose.

---

## Cross-platform commitment

Every story above ships to **web and mobile in the same release** (`CODING_STANDARDS §14.1`). No
single-platform waiver is claimed. Photo import is mobile-primary but its draft review, attribution, and error
handling are identical on both.

## Traceability guardrail

Every story maps to a requirement in [spec.md](../spec.md) and `v-model/requirements.md`. Stories US-411..US-414
are **new in this revision** and correspond to requirements that were always implied but never written down
(file import, draft expiry, source-deleted handling, blocklist administration).
