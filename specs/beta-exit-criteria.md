# KitchenSink Beta & 1.0 Exit Criteria

**Version**: 1.0.1
**Ratified**: 2026-05-12
**Authority**: Director of Product (Sisyphus, acting)
**Status**: Provisional thresholds set — owner sign-off required before `M4` exit
**Related**: [`v1-launch-plan.md`](./v1-launch-plan.md), [`governance-rules.md`](./governance-rules.md)

---

## 1. Purpose

Three gates governed by this document:

1. **Beta Launch Readiness** — what must be true to flip the limited-launch waitlist on at end of `M4`.
2. **Beta Exit Criteria for 1.0 Promotion** — what telemetry the Beta cohort must produce before `M5` starts and `M6` `1.0` ships.
3. **1.0 Promotion Readiness** — what must be true to flip from limited-launch Beta to public 1.0 at end of `M6`.

Numerical thresholds in this document are provisional defaults until the named owners sign off in §6. **Owner sign-off or an approved threshold change is itself part of the `M4` Exit gate.**

---

## 2. Beta Launch Readiness (end of `M4`)

All criteria below MUST be satisfied with linkable evidence before the Beta waitlist is opened.

### 2.1 Spec & Verification Gates

- [ ] `verify-report.md` shows `0 CRITICAL, 0 WARNING` for all Beta-scope features: `001`, `002`, `003`, `004`, `006`, `007`, `008`, `011`.
- [ ] `v-model/release-audit-report.md` is unblocked (per [GR-001](./governance-rules.md#gr-001-release-readiness-gate)) for every Beta-scope feature.
- [ ] All `traceability-matrix.md` rows for Beta-scope features show a mapped Test Case ID and a non-`Untested` executed result.
- [ ] All cross-cutting governance rules in [`governance-rules.md`](./governance-rules.md) referenced by Beta-scope features are satisfied (notably GR-002 API prefix, GR-005 offline/sync, GR-007 shared types).

### 2.2 Engineering Readiness

- [ ] Clerk (`002`) production instance configured; emergency-revoke procedure documented and rehearsed once.
- [ ] Sentry or equivalent error tracking live for every Beta-scope service (web, mobile, backend).
- [ ] Structured logging in place for every Beta-scope service with a documented retention window.
- [ ] Basic product analytics live (event names enumerated in a tracking-plan doc) for every Beta-scope feature.
- [ ] On-call rotation defined for the duration of Beta; pager alerting wired to Sentry / log-based alerts.
- [ ] Documented incident-response runbook exists (severities, escalation, rollback steps).

### 2.3 Limited-Launch Mechanics

- [ ] Beta invite / waitlist mechanism live (Clerk instance/allowlist segmentation **or** feature-flag — decision recorded in [`v1-launch-plan.md`](./v1-launch-plan.md) §8 Open Items).
- [ ] Hard cap on Beta seats configured. Initial cap: `1,000 seats provisional; Product sign-off due M4 entry`.
- [ ] Mechanism to revoke a Beta seat without account deletion exists and is tested.
- [ ] Feature-flag kill-switch exists for AI surfaces (even though `005` is not in Beta, any accidental exposure must be revocable).

### 2.4 Legal & Communications

- [ ] Privacy policy published and reviewed.
- [ ] Beta Terms of Service published, distinct from 1.0 ToS, explicitly disclosing Beta status, data-retention posture, and the fact that Beta data may be wiped before 1.0 promotion (or, if not, a binding statement that it will not be).
- [ ] In-app feedback channel live (intercom, in-app form, or equivalent).
- [ ] Support inbox live and monitored during business hours minimum.
- [ ] Beta-launch comms (email, blog, social) drafted and approved.

### 2.5 Data & Observability Baselines

Before opening Beta, baseline the following metrics on the synthetic / staging cohort so Beta deltas are interpretable:

- [ ] p50 / p95 / p99 latency baselined for: recipe create, recipe load, recipe import (`004`), photo digitization (`011`), grocery-list generation (`007`), cooking-mode session start (`008`), meal-plan generation (`006`).
- [ ] Crash-free session rate baselined per platform (web, iOS, Android).
- [ ] Cold-start time baselined for mobile.

---

## 3. Beta Exit Criteria for 1.0 Promotion (during `M5`–`M6`)

These are the metrics the Beta cohort must produce before `M6` Exit can be claimed. Targets here drive the `M5` AI sizing decisions.

### 3.1 Engagement

| Metric                                                   | Target                          | Owner   | Why                                          |
| -------------------------------------------------------- | ------------------------------- | ------- | -------------------------------------------- |
| DAU / WAU floor                                          | `≥ 25% provisional`             | Product | Confirms product-market fit before paid tier |
| 28-day retention curve (Day 1 / 7 / 28)                  | `≥ 35% / 18% / 10% provisional` | Product | Detects retention cliff before scaling       |
| Sessions per active user per week                        | `≥ 3 sessions/week provisional` | Product | Validates "weekly meal planning" core loop   |
| Median time-to-first-value (signup → first saved recipe) | `≤ 3 minutes provisional`       | Product | Onboarding health                            |

### 3.2 Quality & Reliability

| Metric                                            | Target                                           | Owner       | Why                       |
| ------------------------------------------------- | ------------------------------------------------ | ----------- | ------------------------- |
| Crash-free session rate (mobile)                  | `≥ 99.5% provisional`                            | Engineering | App-store viability       |
| Crash-free session rate (web)                     | `≥ 99.7% provisional`                            | Engineering | Browser stability         |
| P0 open bugs at promotion                         | `0`                                              | Engineering | Hard gate                 |
| P1 open bugs at promotion                         | `≤ 5 provisional`                                | Engineering | Soft gate                 |
| API error rate (5xx) p95 over 7 days              | `≤ 0.5% provisional`                             | Engineering | Backend health            |
| Photo-digitization OCR accuracy on labeled corpus | `≥ 90% provisional; Engineering sign-off due M2` | Engineering | Anti-regression for `011` |

### 3.3 Sentiment

| Metric                                       | Target                         | Owner   | Why             |
| -------------------------------------------- | ------------------------------ | ------- | --------------- |
| In-app NPS (n ≥ `100 provisional`)           | `≥ 30 provisional`             | Product | Sentiment floor |
| Support ticket rate per active user per week | `≤ 5% of WAU/week provisional` | Support | Friction floor  |

### 3.4 AI Sizing Inputs (consumed by `M5`)

These are not pass/fail gates; they are inputs `M5` requires before AI features ship.

- [ ] Projected AI cost per active user per month (low / median / high band).
- [ ] Distribution of recipe count per active user (drives prompt-context sizing).
- [ ] Distribution of dietary-restriction tags per active user (drives prompt complexity).
- [ ] Distribution of meal-plan generation frequency (drives rate-limit defaults).

### 3.5 Compliance Inputs (consumed by `M6`)

- [ ] Confirmed list of jurisdictions Beta users are in (drives tax + dunning configuration).
- [ ] Confirmed presence/absence of EU users (gates [GR-010 EU AI Act compliance](./governance-rules.md#gr-010-eu-ai-act-compliance-propagation) hardening before `M5` ships).

---

## 4. 1.0 Promotion Readiness (end of `M6`)

All criteria below MUST be satisfied with linkable evidence before flipping from limited-launch Beta to public 1.0.

### 4.1 Spec & Verification Gates

- [ ] `verify-report.md` shows `0 CRITICAL, 0 WARNING` for all 1.0-scope features added since Beta: `005`, `009`, `010`.
- [ ] `v-model/release-audit-report.md` unblocked for `005`, `009`, `010`.
- [ ] All cross-cutting governance rules referenced by 1.0-scope features are satisfied (notably GR-010 EU AI Act, GR-012 Subscription Gating).

### 4.2 Beta Exit Criteria Met

- [ ] Every metric in §3.1, §3.2, §3.3 is at-or-above target with at least 14 calendar days of Beta data.
- [ ] AI sizing inputs (§3.4) and compliance inputs (§3.5) are signed off by their owners.

### 4.3 Subscription / Payments Readiness (`010`)

- [ ] Subscription purchase, renewal, cancel, refund, and dunning flows tested end-to-end on web and mobile in sandbox.
- [ ] If applicable: App Store and Play Store IAP tested with real sandbox accounts.
- [ ] PCI scope assessment completed and documented.
- [ ] SCA (Strong Customer Authentication) supported for EU cards.
- [ ] Tax configuration verified for every jurisdiction surfaced in §3.5.
- [ ] Billing reconciliation job runs daily and is monitored.
- [ ] Subscription gating mechanism per [GR-012](./governance-rules.md#gr-012-subscription-gating-mechanism) is enforced server-side, not just client-side.

### 4.4 Migration & Comms

- [ ] Beta-to-1.0 user migration plan executed: every Beta user either auto-promoted, given a grace window, or explicitly off-boarded with notice.
- [ ] 1.0 ToS published, distinct from Beta ToS.
- [ ] Marketing site updated for paid product.
- [ ] Pricing page live and consistent with `010` plan tiers.
- [ ] Support team trained on subscription, refund, dunning, and account-tier issues.
- [ ] Public launch comms (email, blog, social, app-store update notes) drafted and approved.

### 4.5 Operational Readiness

- [ ] On-call rotation extended to cover 24/7 for the launch week minimum.
- [ ] Incident-response runbook updated with billing-specific scenarios (failed renewals at scale, refund storm, IAP outage).
- [ ] Capacity headroom verified for projected 1.0 launch traffic (`3× projected peak RPS provisional; Engineering sign-off due M6 entry`).

---

## 5. Anti-Goals (explicit non-criteria)

To prevent scope creep into the gates, these are **NOT** gating criteria for Beta or 1.0:

- Feature parity with any specific competitor.
- A specific number of recipes in the public corpus.
- A specific number of creators onboarded (creators = `M7`, post-1.0).
- Notification feature completeness (notifications = `M8`, post-1.0).
- Cooking School course count (school = `M7`, post-1.0).
- Localization to languages beyond the launch locale (`en-US only at 1.0 provisional; Product sign-off due M4 entry`).

---

## 6. Threshold Sign-Off

| Section                 | Owner                 | Status                                                         | Date |
| ----------------------- | --------------------- | -------------------------------------------------------------- | ---- |
| §3.1 Engagement targets | Product               | `pending owner sign-off — provisional defaults set 2026-05-13` | —    |
| §3.2 Quality targets    | Engineering           | `pending owner sign-off — provisional defaults set 2026-05-13` | —    |
| §3.3 Sentiment targets  | Product + Support     | `pending owner sign-off — provisional defaults set 2026-05-13` | —    |
| §3.4 AI sizing inputs   | Engineering + Product | `pending owner sign-off`                                       | —    |
| §3.5 Compliance inputs  | Legal + Product       | `pending owner sign-off`                                       | —    |
| §4.5 Capacity headroom  | Engineering           | `pending owner sign-off — provisional defaults set 2026-05-13` | —    |

This table is the deliverable for the `M4`-Exit Open Item in [`v1-launch-plan.md`](./v1-launch-plan.md) §8.
