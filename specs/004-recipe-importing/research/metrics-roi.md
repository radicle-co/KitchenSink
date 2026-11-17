# Metrics and ROI: Recipe Importing

**Branch**: `004-recipe-importing` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [plan.md](../plan.md), [tasks.md](../tasks.md)

---

## Overview

This document captures portfolio-level success metrics for import capabilities and the expected ROI impact on activation and recipe-library growth.

---

## 1. Import Funnel Metrics

| Metric                                             | Target | Notes                                               |
| -------------------------------------------------- | ------ | --------------------------------------------------- |
| URL import submission → successful save conversion | >= 70% | Covers `FR-008` extraction + validation + save path |
| Instagram import success rate on supported posts   | >= 60% | Scoped to caption-containing posts (`FR-009`)       |
| Manual paste completion rate after URL failure     | >= 40% | Measures recovery effectiveness                     |
| Median time from import start to saved recipe      | <= 45s | Includes parse-and-confirm interaction              |

---

## 2. Quality and Correctness Metrics

| Metric                                                                                | Target | Source                                                   |
| ------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| Structured field extraction completeness (title + ingredients + instructions present) | >= 85% | Parser fixture test corpus (`SC-002` in tasks)           |
| Duplicate prevention precision (same canonical URL)                                   | >= 99% | dedupe path + DB uniqueness checks                       |
| False duplicate rate                                                                  | <= 1%  | dedupe conflict telemetry + manual reviews               |
| Attribution rendering presence on imported public recipes                             | 100%   | UI telemetry/query against `sourceUrl` populated records |

---

## 3. Compliance and Policy Metrics

| Metric                                                         | Target                 | FR                      |
| -------------------------------------------------------------- | ---------------------- | ----------------------- |
| Paywalled source rejection correctness                         | >= 95%                 | `FR-014`                |
| Imported public recipes incorrectly set private pre-clone-edit | 0                      | `FR-011`                |
| `FR-014a` policy decision status                               | Pending legal sign-off | `FR-014a` warning track |

---

## 4. Reliability Metrics

| Metric                                              | Target                | Basis                                  |
| --------------------------------------------------- | --------------------- | -------------------------------------- |
| Import endpoint p95 latency                         | <= 2s (excluding OCR) | plan resilience constraints            |
| OCR import completion p95 (if enabled)              | <= 15s                | phased target; depends on OCR provider |
| External fetch timeout error rate                   | <= 5%                 | 10s timeout + retry policy             |
| Import job failure with no user-actionable recovery | 0                     | import-error UX requirement            |

---

## 5. ROI Hypothesis

### Primary hypothesis

Reducing recipe creation friction through import will increase early retention and weekly active usage by accelerating “first value” for users with pre-existing recipe collections.

### Expected business effects

1. Higher week-1 retained users due to faster library bootstrap.
2. Increased clone/edit activity from imported public recipes.
3. Better premium conversion if import+clone workflows naturally expose privacy/substantive-edit gates.

### Cost/risk considerations

- Parser maintenance cost rises with host diversity.
- OCR has potentially material marginal cost and quality variance.
- Legal uncertainty around paid-source paste (`FR-014a`) is the key non-technical risk.
