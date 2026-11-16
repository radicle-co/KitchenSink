# Metrics and ROI: AI Integration

**Branch**: `005-ai-integration` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [plan.md](../plan.md)

---

## Overview

This document captures success metrics and ROI hypothesis for feature 005 across three categories:

1. Operational SLOs (spec/plan anchored),
2. Product adoption/quality metrics,
3. Cost and margin controls under BYOK.

---

## 1. Operational SLOs (Spec-Anchored)

### SC-003: Generation Latency

| Metric                          | Target        | Measurement                                           |
| ------------------------------- | ------------- | ----------------------------------------------------- |
| AI-generated recipe return time | <= 15 seconds | p95 end-to-end from request accepted to preview-ready |

Source: `SC-003` in [spec.md](../spec.md).

### NFR Compliance

| NFR     | Operational interpretation                             |
| ------- | ------------------------------------------------------ |
| NFR-001 | Strict TypeScript + lint/type checks enforced in CI    |
| NFR-002 | Public API surfaces and contracts carry JSDoc          |
| NFR-003 | AI UI controls expose accessible names for testability |
| NFR-004 | Confidence/error states use text/icon + color          |

---

## 2. Product Metrics (Story-Level Rollup Inputs)

| Area                          | Metric                                                          | Initial Target                    |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------- |
| BYOK setup                    | Users who complete provider configuration after first AI intent | >= 70%                            |
| Generation usefulness         | Generated previews that lead to save                            | >= 35%                            |
| External agent adoption       | Users granting at least one OAuth agent consent                 | >= 15% of AI-active users         |
| Revocation usability          | Consent revoke completion success                               | >= 99%                            |
| Optimization feature adoption | Premium users invoking instruction optimization (FR-019)        | >= 20% of premium AI-active users |

These are product targets for rollout telemetry, not new spec requirements.

---

## 3. Quality / Trust Metrics

| Metric                           | Target                                                       | Signal                        |
| -------------------------------- | ------------------------------------------------------------ | ----------------------------- |
| Low-confidence generation rate   | Track and trend down over time                               | confidence state distribution |
| Hallucination guard trigger rate | <= 10% after prompt tuning baseline                          | guardrail event counts        |
| Fallback recovery success        | >= 80% of failed generations recover via retry/switch/manual | fallback pathway completion   |

---

## 4. Cost Controls and ROI Hypothesis

### Cost Model

Feature 005 is BYOK-first: model inference cost is user-borne under their provider accounts.

Platform cost centers remain:

- orchestration compute,
- metadata persistence,
- secrets operations,
- telemetry/monitoring.

### ROI Hypothesis

1. AI assistance increases recipe creation and retention without proportional token-spend burden on platform.
2. External-agent integrations increase acquisition and re-engagement via channels users already inhabit.
3. Premium optimization (`FR-019`) improves subscription conversion for active AI users.

---

## 5. Defined vs. Gap Flags

### Defined in source artifacts

- SC-003 latency target,
- FR-scoped behavior for setup/generate/preview/save/oauth/revoke,
- NFR accessibility and quality baseline.

### Gaps (WARNING-class; no invented requirements)

- No explicit spec SC for confidence display adoption rate.
- No explicit spec SC for hallucination-guard efficacy thresholds.
- No explicit spec SC for OAuth consent funnel conversion.

These are tracked as optimization metrics, not mandatory acceptance criteria.
