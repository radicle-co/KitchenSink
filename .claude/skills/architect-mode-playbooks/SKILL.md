---
name: 'architect-mode-playbooks'
description: 'Per-mode playbooks and output templates for architecture work — PLAN (options and flip-conditions), BLUEPRINT (decide and specify what to build), REVIEW (audit a diff for findings). Load the ONE mode you are in, after detecting it, to get that mode’s procedure and its exact report format.'
---

# Architecture mode playbooks

Load **one** section — the mode you are in. Each carries that mode's procedure and its output
template. The templates differ on purpose: a blueprint that hedges is a defect, and a technology
selection that skips alternatives is an opinion rather than a decision record.

Every mode shares the same spine, which the agent already holds: governing decisions checked →
current state → mode-specific body → pattern register → verified vs assumed → questions blocking →
confidence. What changes below is the **body** and the mode-specific sections around it.

---

## PLAN — no code exists yet

**Procedure**

1. Map the system as it is: components, boundaries, dependencies, and the patterns already in play.
2. Establish constraints: scale target, latency, security/compliance, team, timeline, budget. If a
   material one is missing, it becomes a blocking question — do not invent it.
3. Produce **2–3 genuinely viable options**. An option you would never pick is padding; remove it.
4. Recommend one, and state the conditions under which the recommendation **flips**.
5. Build the pattern register, including the compositions and what each part owns.

**Output body**

```
### Options
[2–3 viable approaches. A comparison table across the constraints that actually drive the choice.
 For each: what it optimises for, what it gives up, and its failure mode.]

### Recommendation
[The choice, the reasoning, and the explicit conditions under which it FLIPS. A recommendation with
 no flip-condition is an opinion — state the trigger that would change it.]

### Risk, scale & security
[Trust boundaries, failure modes, blast radius, rollback, what breaks at 10x, known limits.]

### One-way doors
[Decisions expensive to reverse, called out explicitly. "None" is a valid answer.]

### ADR
[Context → Decision → Alternatives → Consequences, ready to paste into
 docs/architecture/decisions/, or "none needed" with the reason.]
```

---

## BLUEPRINT — the design is settled, make it buildable

**Procedure**

1. Confirm the design is actually settled. If the approach is still open, you are in PLAN — say so.
2. **Decide and commit.** Options here are a defect; the reader is about to build this.
3. Specify every file to create or modify, by path.
4. For each unit: its responsibility, its interface, the pattern it implements (that becomes its
   JSDoc), and what it must NOT know about.
5. Sequence the build so each phase leaves the tree green.

**Output body**

```
### Decision
[One approach, committed to, in two or three sentences. No alternatives.]

### Components
[Per unit: path · responsibility · interface · pattern implemented · dependencies · what it must not know.]

### Data flow
[End to end, from entry point through transformation to persistence/response. Name the boundaries
 where parsing happens.]

### Build sequence
[Phased checklist. Each phase must leave the tree green and be independently reviewable.]

### Tests owed
[Tiers required by CODING_STANDARDS §7.1 for every category touched — not a summary, the actual list.]

### One-way doors
[Anything in this blueprint that is expensive to reverse once merged.]
```

---

## REVIEW — a diff or module exists

**Procedure**

1. Read the actual change: `git diff`, `git show`, `git log` for the surrounding history.
2. Read the governing decisions for every area it touches BEFORE judging it (the HALT gates).
3. Grade named patterns against their contracts — load `design-pattern-contracts`.
4. Order findings by severity, not by file order.
5. **Say when a shape is fine.** A review that manufactures findings to look thorough is worse than
   no review, because it trains the reader to discount you.

**Severity order**

1. ADR / governing-decision contradiction
2. Contract drift (wire, persisted, cross-package)
3. Failure, concurrency or security hole
4. Pattern contract breached (the name now lies)
5. Ad-hoc shape where a named pattern fits
6. Wrong-layer logic, leaked abstraction, impurity
7. Naming, cohesion, readability

**Output body**

```
### Findings
[Most severe first. For each:
 - `file:line`
 - What rule, contract or pattern promise is at stake
 - The concrete failure it causes — inputs/state → wrong behaviour, not a vague concern
 - The smallest correct fix
 - Severity, and whether it blocks merge]

### What is correct here
[Shapes you checked and found sound, named explicitly. This is not filler — it tells the reader
 what was actually covered, and it is what makes the findings above trustworthy.]

### Not examined
[Anything in the diff you did not review, and why. Silence here reads as coverage you did not do.]
```
