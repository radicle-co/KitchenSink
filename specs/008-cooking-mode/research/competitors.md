# Competitor Analysis: Cooking Mode Experiences

**Branch**: `008-cooking-mode` | **Date**: 2026-05-09
**Status**: Complete | **Source**: [research.md](../research.md), user-specified competitor set

---

## Competitive Landscape Overview

Cooking-mode competitors cluster into two groups:

1. **Recipe-management incumbents** (Paprika, Yummly, Kitchen Stories) with polished reading and timer UX.
2. **Assistant-led experiences** (SideChef and similar) emphasizing guided flow and voice-adjacent interaction.

The core opportunity for Commise is not just “having cook mode,” but delivering a reliable **hands-busy** workflow with robust timer handling, wake lock behavior, and accessible controls that survive real kitchen conditions.

---

## Competitor Profiles

### 1. Paprika (Cook Mode)

| Attribute                          | Detail                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| **Platforms**                      | iOS, Android, macOS, Windows                                                               |
| **Core Strengths**                 | Mature step-by-step cook mode, reliable timer integration, strong offline behavior         |
| **Core Weaknesses**                | Limited collaborative guidance features, conservative UI modernization                     |
| **Timers**                         | Inline + manual timers, trusted by power users                                             |
| **Voice**                          | Limited/native-assistant dependent                                                         |
| **Key gap vs Commise opportunity** | Opportunity to exceed with richer accessibility telemetry and modern cross-platform parity |

---

### 2. SideChef

| Attribute                          | Detail                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Platforms**                      | iOS, Android, Web                                                                                    |
| **Core Strengths**                 | Guided step flow, ecosystem integrations, onboarding for novice cooks                                |
| **Core Weaknesses**                | Heavier “guided recipe” opinionation can feel rigid for experienced users                            |
| **Timers**                         | Step-attached timers and progress guidance                                                           |
| **Voice**                          | Some voice-friendly interaction patterns                                                             |
| **Key gap vs Commise opportunity** | Deliver equivalent guidance with clearer local-first resilience and stronger screen-reader semantics |

---

### 3. Yummly

| Attribute                          | Detail                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| **Platforms**                      | iOS, Android, Web                                                                    |
| **Core Strengths**                 | Discovery/search depth and appliance integrations                                    |
| **Core Weaknesses**                | Cooking mode is strong but ecosystem-driven priorities can dilute pure in-kitchen UX |
| **Timers**                         | Present, with contextual prompts                                                     |
| **Voice**                          | Limited first-party voice control                                                    |
| **Key gap vs Commise opportunity** | Compete on focused, uncluttered cooking flow rather than discovery-heavy experience  |

---

### 4. Kitchen Stories

| Attribute                          | Detail                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| **Platforms**                      | iOS, Android, Web                                                                        |
| **Core Strengths**                 | High production value UX, strong visual step content                                     |
| **Core Weaknesses**                | Visual richness can increase interaction overhead in messy kitchen contexts              |
| **Timers**                         | Built-in timer support                                                                   |
| **Voice**                          | Not a primary differentiator                                                             |
| **Key gap vs Commise opportunity** | Outperform on utilitarian, large-target, accessibility-first controls for active cooking |

---

## Feature Parity Matrix (Cooking Mode Focus)

| Capability                       | Paprika | SideChef | Yummly | Kitchen Stories |         Commise target (008)          |
| -------------------------------- | :-----: | :------: | :----: | :-------------: | :-----------------------------------: |
| One-step-at-a-time view          |   ✅    |    ✅    |   ✅   |       ✅        |              ✅ (FR-032)              |
| Large readable typography        |   ✅    |    ✅    |   ✅   |       ✅        |          ✅ (FR-032, SC-007)          |
| Forward/back step navigation     |   ✅    |    ✅    |   ✅   |       ✅        |              ✅ (FR-033)              |
| Integrated step timer            |   ✅    |    ✅    |   ✅   |       ✅        |              ✅ (FR-034)              |
| Multi-timer concurrency          |   ✅    |    ⚠️    |   ⚠️   |       ⚠️        |            ✅ (plan/tasks)            |
| Keep screen awake                |   ✅    |    ✅    |   ✅   |       ✅        |              ✅ (FR-035)              |
| Voice command controls           |   ⚠️    |    ✅    |   ⚠️   |       ⚠️        |      ⚠️ Phase 2 (research/tasks)      |
| Ingredient checkoff in cook flow |   ⚠️    |    ⚠️    |   ⚠️   |       ⚠️        | ⚠️ Candidate (warning until FR added) |
| Cook-time scaling in mode        |   ⚠️    |    ⚠️    |   ⚠️   |       ⚠️        | ⚠️ Candidate (warning until FR added) |

Legend: ✅ native support, ⚠️ partial/optional/unclear from available sources.

---

## Positioning Implications for 008

1. **Must-win basics**: Step readability, navigation reliability, timer trust, and wake-lock stability are table stakes.
2. **Execution quality differentiator**: Accessibility-first design (touch target sizing, non-color state cues, accessible labels) can be a durable advantage.
3. **Phased expansion**: Voice control, ingredient checkoff, and cook-time scaling can be introduced in controlled increments once canonical FRs are expanded.

---

## Risks to Track

- Under-delivering timer reliability instantly erodes trust in cook mode.
- Inconsistent wake-lock behavior across web/mobile would create parity failures.
- Overloading v1 with non-canonical scope (without FR updates) can break traceability discipline.
