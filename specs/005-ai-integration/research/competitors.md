# Competitor Analysis: AI Recipe Assistants

**Branch**: `005-ai-integration` | **Date**: 2026-05-09
**Status**: Complete | **Source**: [research.md](../research.md), domain target set from bootstrap request

---

## Competitive Landscape Overview

AI recipe experiences now split into two models:

1. **Platform-provided AI** (opaque prompts, centralized model billing, tight product lock-in).
2. **BYOK-style AI tooling** (user-controlled provider and spend), still uncommon in consumer cooking products.

Feature 005 targets the gap between those models: in-app BYOK generation plus OAuth-authorized external-agent access.

---

## Competitor Profiles

### 1. ChefGPT

| Attribute                      | Detail                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| **Positioning**                | AI-first recipe assistant with custom recipe generation and meal ideas |
| **Strengths**                  | Fast ideation for prompts and dietary constraints                      |
| **Weaknesses**                 | Limited trust signals on provenance and confidence scoring             |
| **BYOK support**               | No clear user-managed key model                                        |
| **External agent OAuth model** | Not a differentiated capability in baseline offering                   |

### 2. SideChef AI

| Attribute                      | Detail                                                      |
| ------------------------------ | ----------------------------------------------------------- |
| **Positioning**                | Guided cooking + meal planning with AI recommendations      |
| **Strengths**                  | Strong guided UX and recipe workflow integration            |
| **Weaknesses**                 | AI features tied to platform product path and account model |
| **BYOK support**               | Not the default model                                       |
| **External agent OAuth model** | Limited emphasis on third-party agent tool ecosystem        |

### 3. DishGen

| Attribute                      | Detail                                                               |
| ------------------------------ | -------------------------------------------------------------------- |
| **Positioning**                | Prompt-driven generated recipes at speed                             |
| **Strengths**                  | Low-friction generation experience                                   |
| **Weaknesses**                 | Output consistency and guardrail transparency vary by prompt quality |
| **BYOK support**               | Typically platform-managed model calls                               |
| **External agent OAuth model** | Not core differentiation                                             |

### 4. Whisk AI (Samsung Food)

| Attribute                      | Detail                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| **Positioning**                | AI-enhanced food platform integrated into Samsung ecosystem              |
| **Strengths**                  | Personalization depth and broad consumer surface area                    |
| **Weaknesses**                 | Ecosystem lock-in and opaque AI behavior to end users                    |
| **BYOK support**               | No user BYOK posture documented in feature baseline                      |
| **External agent OAuth model** | Platform APIs exist, but end-user OAuth-to-agent model is not primary UX |

---

## Feature Parity Matrix

| Capability                                              | ChefGPT    | SideChef AI | DishGen   | Whisk AI              | Commise 005 Target                      |
| ------------------------------------------------------- | ---------- | ----------- | --------- | --------------------- | --------------------------------------- |
| In-app AI recipe generation                             | ✅         | ✅          | ✅        | ✅                    | ✅ (FR-016)                             |
| Save generated recipe after preview                     | ✅         | ✅          | ✅        | ✅                    | ✅ (FR-017, FR-020)                     |
| User-controlled BYOK provider keys                      | ⚠️ unclear | ❌          | ❌        | ❌                    | ✅ (FR-015)                             |
| OAuth-authorized external agents can read/write recipes | ❌         | ⚠️ limited  | ❌        | ⚠️ ecosystem-specific | ✅ (FR-018, FR-021)                     |
| Premium-gated instruction optimization                  | ⚠️ varied  | ⚠️ varied   | ⚠️ varied | ⚠️ varied             | ✅ (FR-019)                             |
| Explicit confidence + hallucination guard UX            | ⚠️ partial | ⚠️ partial  | ❌        | ⚠️ partial            | ✅ design target (see `ux-patterns.md`) |

---

## Pricing / Cost Posture Comparison

| Model                  | Typical Competitor Posture                      | Commise 005 Strategy                                                    |
| ---------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| AI call cost bearer    | Platform pays, recovers via subscription/upsell | User pays their provider directly (BYOK)                                |
| Marginal cost exposure | Scales with user generation volume              | Near-zero inference pass-through cost                                   |
| Price complexity       | Requires per-tier token quota policies          | Reduced platform complexity; keys and usage under user provider account |

---

## Market Gaps Commise Targets

1. **Control gap**: Let users choose provider/model path (`FR-015`) instead of forcing a single black-box AI tier.
2. **Interoperability gap**: First-class OAuth external-agent access (`FR-018`, `FR-021`) while preserving account consent boundaries.
3. **Trust gap**: Confidence indicators + explicit fallback UX for low-confidence or failed generation surfaces.
4. **Ownership gap**: Persist generated outputs as private, user-owned artifacts (`FR-020`) with explicit save intent (`FR-017`).

---

## Differentiation Thesis

Feature 005 differentiates by combining:

- **BYOK economics** (user cost control),
- **Provider agnosticism** (reduced lock-in),
- **OAuth external-agent platform reach**, and
- **guardrailed UX** tuned for reliability over novelty.

This combination is stronger than a generic “AI recipe generator” claim and directly supports long-term platform defensibility.
