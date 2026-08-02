# Peer Review — Hazard Analysis (FMEA)

**Reviewer**: Adversarial design review (V-Model peer gate)
**Date**: 2026-08-02
**Artefact**: `hazard-analysis.md`
**Standard**: General-purpose FMEA, non-regulated software profile

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 1     |
| Minor              | 1     |
| Observation        | 1     |
| **Total Findings** | **3** |

## Findings

### MAJ-002 — OCR at P1 concentrates the release's privacy risk — **Resolved**

HAZ-035 (image retention) and HAZ-036 (OCR text in logs) are Critical and exist solely because of owner
decision D-001. User photographs of physical recipes can capture faces, handwriting, and surroundings. Neither
hazard appeared anywhere in the prior document set. Controls now bound to T-018/T-012.

### MIN-012 — Prior mitigations cited the wrong requirements — **Resolved**

HAZ-003 (SSRF, Catastrophic) cited `REQ-014`, which governed 404 handling. The single most severe hazard in the
feature had no real requirement behind it, and no task implemented it. Every mitigation now names a real
requirement **and** its implementing task.

### OBS-006 — Honouring `robots.txt` may block imports users are entitled to make

A user importing a page they can personally read is arguably not crawling. Conservative choice is right for
launch; revisit with data if friction appears.

---

_Consolidated cross-artefact findings: [peer-review.md](./peer-review.md)._
