# Peer Review — Requirements

**Reviewer**: Adversarial design review (V-Model peer gate)
**Date**: 2026-08-02
**Artefact**: `requirements.md`
**Standard**: INCOSE Guide for Writing Requirements

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 1     |
| Minor              | 2     |
| Observation        | 1     |
| **Total Findings** | **4** |

## Findings

### MAJ-003 — Gated P1 requirements need explicit release semantics — **Resolved**

`REQ-005` / `REQ-IF-001` carry "P1 (gated)". Without stated semantics, "P1" implies release-blocking while
"gated" implies it may not ship — precisely the ambiguity that let the OCR P1-vs-P3 contradiction survive three
months in the prior document set. Resolved by the **Gating** section in `spec.md`.

### MIN-001 — Count table was wrong on first authoring — **Resolved**

Stated Test 40 / Inspection 13; actual 41 / 12. Caught by counting programmatically. The prior revision failed
the same way (24 stated vs 28 present vs 15 in its own peer review). Hand-written count tables are unreliable.

### MIN-008 — Requirement count grew from 28 to 54 — **Resolved (justified)**

Nearly double. Reviewed for invented scope: the growth is (a) requirements that always existed implicitly and
were unstated (ingredient parsing, normalization, draft lifecycle), and (b) non-functionals the hazard analysis
already assumed but no requirement backed (SSRF, sanitization, idempotency, SLOs). No new _user-facing_
capability was added beyond the four owner decisions. Verified story-by-story against `product-spec.md`.

### OBS-002 — FR numbering still collides with shipped 001

Mitigated by the `004-` prefix convention rather than eliminated. A clean renumber is deferred to avoid
breaking existing links and the cross-feature index.

---

_Consolidated cross-artefact findings: [peer-review.md](./peer-review.md)._
