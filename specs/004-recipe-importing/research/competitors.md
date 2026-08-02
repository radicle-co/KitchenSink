# Competitor Analysis: Recipe Importing Workflows

> **Comparator-set normalization (W-003, resolved 2026-08-02).** `research/research.md` RQ-9 discusses a
> different comparator set (Paprika / Mealime / Whisk / Saffron). **This document carries the canonical set**,
> because these products have a genuinely comparable _import_ feature — which is what 004 needed to learn from.
> RQ-9 is superseded for import-comparison purposes, not retracted. The divergence was an open warning from
> 2026-05-12 to 2026-08-02.

**Branch**: `004-recipe-importing` | **Date**: 2026-05-09
**Status**: Complete | **Source**: [research.md](./research.md), domain request (Paprika vs Mealie vs Tandoor vs Plan To Eat)

---

## Competitive Landscape Overview

For recipe importing, users care less about social discovery and more about **speed-to-success**: can they move a recipe from somewhere else into their own library with minimal cleanup, clear attribution, and no data loss. The four requested comparators cluster into two groups:

- **Power import managers**: Paprika, Mealie, Tandoor
- **Planner-led manager with manual emphasis**: Plan To Eat

---

## Competitor Profiles

### 1. Paprika

| Attribute                      | Detail                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- |
| **Import strength**            | Mature URL import with broad site compatibility and in-app browser clipping |
| **Manual paste support**       | Present but not optimized for strict source policy controls                 |
| **Duplicate handling**         | User-mediated; limited canonical source de-dup guidance                     |
| **Attribution visibility**     | Source retained, but UI emphasis varies by platform                         |
| **Error recovery UX**          | Good parser fallback, limited structured remediation guidance               |
| **Gap opportunity vs Commise** | Better legal-state communication and deterministic duplicate-to-clone flow  |

---

### 2. Mealie

| Attribute                      | Detail                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| **Import strength**            | URL scraping for self-hosted users; community plugins improve coverage   |
| **Manual paste support**       | Typically markdown/text driven; quality depends on user formatting       |
| **Duplicate handling**         | Inconsistent across deployments; mostly user-managed                     |
| **Attribution visibility**     | Available, but not always prominent in default UI                        |
| **Error recovery UX**          | Technical; expects advanced user troubleshooting                         |
| **Gap opportunity vs Commise** | Consumer-grade parse-and-confirm and explicit paywall/legal error states |

---

### 3. Tandoor

| Attribute                      | Detail                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------- |
| **Import strength**            | Strong recipe scraping and hosted/self-host options                              |
| **Manual paste support**       | Supported; parser quality improves with templates                                |
| **Duplicate handling**         | Usually append-or-create behavior without canonical clone-first UX               |
| **Attribution visibility**     | Source field exists; variable prominence in recipe detail                        |
| **Error recovery UX**          | Better than many OSS peers, still form-heavy for non-technical users             |
| **Gap opportunity vs Commise** | Guided duplicate resolution tied directly to clone workflow (`FR-008`, `FR-011`) |

---

### 4. Plan To Eat

| Attribute                      | Detail                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------- |
| **Import strength**            | Reliable browser capture and planning integration                            |
| **Manual paste support**       | Strong manual entry/paste for planner-centric users                          |
| **Duplicate handling**         | Primarily user sorting/curation after capture                                |
| **Attribution visibility**     | Source retained but secondary to planning workflow                           |
| **Error recovery UX**          | Practical but not deeply diagnostic                                          |
| **Gap opportunity vs Commise** | Better parser transparency and explicit legal/attribution policy enforcement |

---

## Feature Parity Matrix (Import Domain)

| Capability                                        | Paprika     | Mealie        | Tandoor      | Plan To Eat | Commise 004 Target             |
| ------------------------------------------------- | ----------- | ------------- | ------------ | ----------- | ------------------------------ |
| URL import from recipe websites                   | ✅          | ✅            | ✅           | ✅          | ✅ (`FR-008`)                  |
| Instagram caption import path                     | ⚠️ Limited  | ⚠️ Plugin/DIY | ⚠️ Variable  | ❌          | ✅ (`FR-009`)                  |
| Parse-and-confirm review screen                   | ⚠️ Basic    | ⚠️ Technical  | ⚠️ Technical | ⚠️ Basic    | ✅ explicit (`import-preview`) |
| Duplicate detection by canonical source URL       | ⚠️          | ⚠️            | ⚠️           | ⚠️          | ✅ deterministic (`FR-008`)    |
| Clone existing import instead of duplicate create | ❌          | ⚠️            | ⚠️           | ❌          | ✅ (`FR-008`, `FR-011`)        |
| Prominent attribution lock/display                | ⚠️          | ⚠️            | ⚠️           | ⚠️          | ✅ (`FR-010`, `FR-011`)        |
| Paywalled-source import rejection UX              | ⚠️          | ⚠️            | ⚠️           | ⚠️          | ✅ (`FR-014`)                  |
| OCR physical import                               | ⚠️/external | ⚠️/plugin     | ⚠️/plugin    | ❌          | ✅ phased (`FR-012`)           |
| Import error recovery with actionable states      | ⚠️          | ⚠️            | ⚠️           | ⚠️          | ✅ (`import-error` flow)       |

Legend: ✅ strong support, ⚠️ partial/indirect, ❌ not first-class.

---

## Strategic Differentiation for 004

1. **Duplicate-to-clone first UX**: canonical source detection routes users to clone instead of producing fragmented duplicates.
2. **Attribution as product invariant**: attribution is visible and locked, not an optional metadata field.
3. **Policy-aware error handling**: paywall/legal constraints are user-visible and structured.
4. **Recovery-first parsing**: parse-and-confirm plus explicit corrective paths for malformed sources.

---

## Risks to Monitor

- Instagram API policy changes may narrow extraction fidelity.
- Competitors with browser extension ecosystems can close parsing-coverage gaps quickly.
- If legal policy is unresolved (`FR-014a`), differentiation claims around compliance are weakened.
