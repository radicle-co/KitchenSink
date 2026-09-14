# Peer Review — hazard-analysis.md

> **Scope warning.** The review below was performed on **2026-05-10 against 31 hazards** and reported zero
> findings. `hazard-analysis.md` now carries **41**, including HAZ-035 — the register's only
> Catastrophic-severity hazard. HAZ-032…HAZ-041 were **not examined** by that review, and no hazard for the
> EventBridge path, envelope spoofing, `source` allowlisting or bus resource policies existed when it ran.
> See the dated supplement at the end of this file.

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-10
**Artifact**: hazard-analysis.md (31 hazards)
**Standard**: General-Purpose FMEA

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 0     |
| Observation        | 0     |
| **Total Findings** | **0** |

## Findings

No findings.

---

## Supplement — 2026-08-10 (dual-ingress amendment)

**Scope of this supplement**: HAZ-032…HAZ-041, covering SYS-032…SYS-041.
**Review status**: **NOT peer-reviewed.** The 2026-05-10 FMEA pass predates this material. The ten new
hazards were authored during propagation of the amendment, and their severity and likelihood ratings have
**not** been independently challenged. For a register whose top entry is Catastrophic, that is the most
significant open review item in this feature.

### What the amendment means for this artifact

The 2026-05-13 register analysed a design with one authenticated door. FR-024 adds a second door with **no
credential**, which moves the feature's largest security hazard from "cross-tenant leak through a routing
bug" (HAZ-006, Critical) to "arbitrary recipient addressing through an unauthenticated publish channel"
(HAZ-035, Catastrophic). Different mechanism, different control, so it is registered separately rather than
folded into HAZ-006.

Seven of the ten new hazards are Undesirable before mitigation — 70%, against 35% (11 of 31) for the original
register. Two are **silence hazards**: HAZ-036 (a dropped rejection is indistinguishable from a delivery) and
HAZ-037 (per-recipient FIFO becomes untrue while every health signal stays green). Both are alarmed rather
than merely counted, for that reason.

### Findings observed during propagation

| ID          | Severity    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-HAZ-001 | Critical    | **HAZ-035's residual risk is conditional, which this FMEA's template cannot express.** It is Tolerable only with **both** FR-027 controls present; with either one alone it is Intolerable. The row states both values rather than a single figure, because one "Tolerable" would let an implementer drop a control without contradicting the register. A reviewer must confirm the two-control reading survives any future regeneration. |
| PRF-HAZ-002 | Major       | **HAZ-032's mitigation is a test, not a mechanism.** "One core, two adapters" is a discipline; nothing in the type system prevents a maintainer adding a rule to the HTTP controller alone, and the event path has no caller to complain. Its residual risk is Tolerable only while the SC-008 paired tests exist. If those tests are ever descoped, this hazard returns to Undesirable and nothing will announce that.                   |
| PRF-HAZ-003 | Minor       | **HAZ-037's likelihood is Probable, not Occasional, and that is deliberate.** EventBridge not preserving order is a documented property of the transport, not a defect that might not occur — so the hazard is realised by default and prevented only by the FR-029 control.                                                                                                                                                              |
| PRF-HAZ-004 | Minor       | **The 2026-05-13 register contains four hazards for capabilities this release does not build** — HAZ-002 (opt-out bypass), HAZ-004 (quiet hours), HAZ-009 (locale fallback), HAZ-010 (time-zone scheduling). All four describe a preference/scheduling engine that `spec.md` lists under Won't Have. They inflate the "31 / 31 hazards mitigated" figure with hazards that cannot occur. Not removed here; flagged for regeneration.      |
| PRF-HAZ-005 | Observation | **HAZ-039's control lives outside this system.** Publisher-side correlation cannot be enforced by this service, only detected. The quota (REQ-041) bounds the blast radius without fixing the cause: a throttled storm is a storm minus its tail.                                                                                                                                                                                         |
| PRF-HAZ-006 | Observation | **Three new deepening targets were added** — bus resource-policy drift, cross-path ordering under clock skew, and per-publisher fan-in correctness. The second is the one with no owner yet: `occurredAt` is producer-assigned and producers do not share a clock.                                                                                                                                                                        |

### Supplement summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 1     |
| Major              | 1     |
| Minor              | 2     |
| Observation        | 2     |
| **Total Findings** | **6** |

PRF-HAZ-001 is rated Critical as a **review** finding, not as a hazard: if a regeneration flattens HAZ-035's
conditional residual risk to a single "Tolerable", the register will assert that one control is enough.
