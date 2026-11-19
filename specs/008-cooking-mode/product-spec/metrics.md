# Metrics: Cooking Mode — Story-Level

**Branch**: `008-cooking-mode`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)
**Distinction from research/metrics-roi.md**: That file covers feature-level ROI and broader adoption framing. This file is story-level with per-story measurable outcomes.

---

## Metric Notation

Each metric is tied to a Must Have story. Signals should be queryable via telemetry, test assertions, or deterministic QA checks.

---

## Story-Level Metrics

### US-001: Enter and Read Step

**Story**: As a cook, I can enter Cooking Mode and see one instruction step at a time in large readable text.

**FRs**: [FR-032](../spec.md#fr-032)

| Metric ID       | Metric                           | Target             | Source                    | Signal                                                      |
| --------------- | -------------------------------- | ------------------ | ------------------------- | ----------------------------------------------------------- |
| MET-CM-US001-01 | Cooking mode entry success rate  | >= 99%             | App telemetry             | `enter_cooking_mode_success` / `enter_cooking_mode_attempt` |
| MET-CM-US001-02 | First-step render latency        | <= 1.0s p95        | Client performance events | time from tap to first step render                          |
| MET-CM-US001-03 | Readability validation pass rate | 100% in release QA | Device-lab QA             | SC-007 checklist pass                                       |

---

### US-002: Step Navigation

**Story**: As a cook, I can navigate forward and backward through steps.

**FRs**: [FR-033](../spec.md#fr-033)

| Metric ID       | Metric                              | Target               | Source                   | Signal                                     |
| --------------- | ----------------------------------- | -------------------- | ------------------------ | ------------------------------------------ |
| MET-CM-US002-01 | Next/previous action success rate   | >= 99.5%             | App telemetry            | navigation action -> valid step transition |
| MET-CM-US002-02 | Boundary error rate (invalid index) | 0 defects in CI + QA | E2E tests                | first/last-step boundary assertions        |
| MET-CM-US002-03 | Step-position consistency           | 100% deterministic   | Unit + integration tests | state index equals rendered step label     |

---

### US-003: Start and Observe Timers

**Story**: As a cook, I can start timers directly from timed steps.

**FRs**: [FR-034](../spec.md#fr-034)

| Metric ID       | Metric                           | Target                   | Source            | Signal                                        |
| --------------- | -------------------------------- | ------------------------ | ----------------- | --------------------------------------------- |
| MET-CM-US003-01 | Timer start success rate         | >= 99%                   | App telemetry     | `timer_start_success` / `timer_start_attempt` |
| MET-CM-US003-02 | Countdown visibility correctness | 100% in regression suite | UI tests          | active timer always visible in UI             |
| MET-CM-US003-03 | Concurrent timer support pass    | 100% scenario pass       | Integration tests | two active timers tracked independently       |

---

### US-004: Timer Completion Alerts

**Story**: As a cook, I receive clear alert when a timer completes.

**FRs**: [FR-034](../spec.md#fr-034)

| Metric ID       | Metric                           | Target                      | Source                      | Signal                                       |
| --------------- | -------------------------------- | --------------------------- | --------------------------- | -------------------------------------------- |
| MET-CM-US004-01 | Alert trigger reliability        | >= 99%                      | Timer telemetry             | completed timers that produce alert          |
| MET-CM-US004-02 | Audible alert availability       | 100% on supported devices   | QA matrix                   | sound check assertions                       |
| MET-CM-US004-03 | Accessible announcement coverage | 100% in accessibility tests | Playwright/Detox a11y tests | live-region/screen-reader notification check |

---

### US-005: Screen Awake Continuity

**Story**: As a cook, Cooking Mode keeps the screen awake while active.

**FRs**: [FR-035](../spec.md#fr-035)

| Metric ID       | Metric                        | Target                      | Source            | Signal                           |
| --------------- | ----------------------------- | --------------------------- | ----------------- | -------------------------------- |
| MET-CM-US005-01 | Wake-lock activation success  | >= 98% on supported runtime | Runtime telemetry | activation success/fail events   |
| MET-CM-US005-02 | Mid-session sleep incidents   | <= 2% of active sessions    | Session telemetry | sleep/interruption while in mode |
| MET-CM-US005-03 | Wake-lock release correctness | 100% on mode exit           | Integration tests | no leaked wake locks after exit  |

---

## Summary Coverage Table

| Story                       | FRs    | Metric count | Primary metric                   |
| --------------------------- | ------ | ------------ | -------------------------------- |
| US-001: Enter and read step | FR-032 | 3            | Entry success rate >= 99%        |
| US-002: Step navigation     | FR-033 | 3            | Navigation success >= 99.5%      |
| US-003: Start timers        | FR-034 | 3            | Timer start success >= 99%       |
| US-004: Timer alerts        | FR-034 | 3            | Alert trigger reliability >= 99% |
| US-005: Screen awake        | FR-035 | 3            | Wake-lock activation >= 98%      |

**Total**: 5 Must Have stories, 15 story-level metrics, 100% Must-Have story-to-FR traceability.

---

## Signalfreeze

Story-level metrics are measured via:

- **App telemetry** for interaction and runtime state transitions.
- **E2E tests** for deterministic boundary and accessibility assertions.
- **Device-lab QA** for readability and wake-lock behavior in real hardware conditions.
