# Metrics and ROI: Nutrition Planning

**Branch**: `009-nutrition-planning` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [research.md](../research.md), [v-model/requirements.md](../v-model/requirements.md)

---

## Overview

This document captures portfolio-level metrics and ROI hypotheses for feature 009. It complements `product-spec/metrics.md` (story-level product metrics) by focusing on operational quality, adoption, adherence outcomes, and premium leverage.

---

## 1. Operational Quality Metrics

### OQ-001: Nutrition Calculation Accuracy

- **Source**: `SC-010`
- **Target**: Meal-plan nutritional calculations remain within 5% of source nutrient values.
- **Measurement**: Automated validation suite comparing expected rollup totals vs computed compliance totals.

### OQ-002: Compliance Report Latency

- **Source**: `FR-037`, API design in `plan.md`
- **Target**: p95 compliance endpoint response under 500ms for single-plan daily/weekly queries.
- **Measurement**: API telemetry on `/api/v1/nutrition-plans/{id}/compliance`.

### OQ-003: Accessibility Conformance

- **Source**: `NFR-003`, `NFR-004`
- **Target**: 100% of nutrition UI components pass accessibility selector and non-color-state checks in CI.

---

## 2. Adoption and Engagement Metrics

### AD-001: Plan Creation Activation

- **Definition**: Percent of users who create at least one nutrition plan after visiting setup.
- **Target**: >= 60% completion from setup start.

### AD-002: Linked Plan Utilization

- **Definition**: Percent of created nutrition plans linked to at least one meal plan.
- **Target**: >= 70%.

### AD-003: Weekly Return Rate (Nutrition Users)

- **Definition**: 7-day return among users with at least one active nutrition plan.
- **Target**: +10 percentage points over baseline non-nutrition meal planners.

---

## 3. Outcome Metrics

### OC-001: Target Adherence Days

- **Definition**: Share of tracked days classified “on target” across active plans.
- **Target**: >= 45% within first 30 days, improving over time.

### OC-002: Deviation Reduction

- **Definition**: Mean absolute macro deviation decline from week 1 to week 4.
- **Target**: >= 20% reduction.

### OC-003: Swap Suggestion Effectiveness (Premium)

- **Definition**: Percent of accepted swap suggestions that reduce same-day deviation.
- **Target**: >= 65% effective swaps.

---

## 4. Premium and Coaching ROI Signals

### PR-001: Trainer Feature Adoption

- **Definition**: Premium trainers with at least one assigned client nutrition plan.
- **Target**: >= 35% of active premium trainers.

### PR-002: Client Compliance Lift with Trainer Involvement

- **Definition**: Difference in adherence between trainer-managed vs self-managed plans.
- **Target**: Positive lift >= 10 percentage points.

### PR-003: Premium Conversion Attribution

- **Definition**: Conversions where nutrition premium surfaces (`FR-038`, `FR-039`) were touched pre-upgrade.
- **Target**: Nutrition surfaces contribute to >= 20% of premium upgrades.

---

## 5. Warning-Level Extension Metrics (If Scope Is Expanded)

These are tracked only if dietary constraints/deficiency alerts are promoted to explicit FR scope.

- **WX-001**: Deficiency alert precision proxy (alerts that persist across >=3 days and correlate with measured low intake patterns)
- **WX-002**: Dietary-profile filter utility (sessions using keto/vegan/allergy filters that result in reduced macro deviation)

---

## ROI Hypothesis

If nutrition planning becomes a habitual weekly workflow with measurable adherence improvement, it increases retention for diet-goal users and creates premium monetization leverage through coaching and guidance features. The strongest early ROI indicator is trainer-client adherence lift plus nutrition-attributed premium conversion.
