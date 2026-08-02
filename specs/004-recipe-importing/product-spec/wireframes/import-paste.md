# Screen: Paste a Recipe

**Journey**: J3 · **Story**: US-410, US-411 · **Requirements**: REQ-021, REQ-022, REQ-023
**Platforms**: web + mobile

> **Revision note.** The previous version was web-only and carried the note "FR-014a legal policy enforcement
> is pending final review". That policy is now resolved (owner decision D-003): the user attests to the source
> and must cite it; a non-public source forces a private recipe. This screen implements that rule.

## Purpose

Let a user bring in a recipe they have as text, and capture where it came from — because provenance determines
whether it may ever be public.

## Layout

```
┌────────────────────────────────────────────────────────┐
│  Paste a recipe                                        │
├────────────────────────────────────────────────────────┤
│  Paste the recipe text                                 │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Chicken Teriyaki                                 │  │
│  │ 2 cups flour                                     │  │
│  │ 1. Combine…                                      │  │
│  └──────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────┤
│  Where is this recipe from?              (required)    │
│   ( ) It's my own                                      │
│   ( ) A public web page                                │
│       └ Link  [ https://…                           ]  │
│   (•) A book or a subscription site                    │
│       └ Where  [ Ottolenghi, "Simple", p.112        ]  │
│                                                        │
│   ⓘ Recipes from books and subscription sites stay     │
│     private and can't be shared publicly.              │
├────────────────────────────────────────────────────────┤
│                                    [ Continue ]        │
└────────────────────────────────────────────────────────┘
```

## Tier gate (D-014)

Choosing "a book or a subscription site" produces a recipe that can never be public, so that option is
**premium-only**. A free-tier user sees the option with the upgrade path attached, so the constraint is
understandable rather than arbitrary — they learn _why_ before choosing. "It's my own" and "a public web page"
remain available to everyone.

## Behaviour

| Aspect             | Specification                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Attestation        | **Required** before continuing — there is no "skip" or default option                           |
| Citation           | Required for both external options: a URL where one exists, otherwise free text                 |
| Consequence stated | The visibility outcome is shown **before** saving, not after (Robin's stated pain point)        |
| Classification     | Own → `user_created` · public page → `imported_public` · book/paid → `imported_paid`            |
| Heuristics         | May **flag for review** only; they never override the declaration and never block the save      |
| Outcome            | Continues to `import-draft-review`, where parsed fields are completed as with any other channel |

## States (component test each, both platforms)

`empty` · `text-entered` · `attestation-missing` · `citation-missing` · `paid-source-selected`
(consequence shown) · `submitting` · `parse-failed`

## Why the user is asked rather than detected

Automated detection of paid-source content is unreliable in both directions: a false positive wrongly accuses
the user and blocks a legitimate recipe; a false negative provides no protection anyway. Asking is honest about
what the system can know, and it puts the compliance decision with the person who actually knows the answer.
Heuristics still run — as a review signal, not a verdict (REQ-023).
