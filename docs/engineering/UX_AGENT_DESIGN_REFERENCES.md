# UX agent design — KitchenSink-specific decisions

Decisions about `staff-ux-engineer` that depend on **this** repository — its standards, its defect
history, its implementer agent and its design system. Cited from `CLAUDE.md`.

> **The portable rationale travels with the agent**, at
> `~/.claude/agents/staff-ux-engineer.rationale.md`: the normative sources, the ISO correction, the
> agent/skill split, the write-access deviation, the design-technologist naming, and the depth,
> per-hat and senior-layer passes. Read that first for _why the agent is shaped this way at all_;
> read this for _why it is configured the way it is here_.
>
> ⚠️ The agent itself is **user-scoped** (`~/.claude/agents/`), so it is not reviewed in this repo's
> PRs and has no version history here. That is a deliberate owner ruling, and this file plus the
> portable sibling are the only durable record of the reasoning.

## 1. The gap it fills here

`docs/engineering/ENGINEERING_EXCELLENCE.md` → _Frontend Engineering Excellence_ is strong on frontend
**engineering** and does not cover design. Verified by `grep -ci` on 2026-09-06: information
architecture 0 · Fitts 0 · Hick 0 · Miller 0 · Gestalt 0 · colour theory 0 · typography 0 · visual
hierarchy 0 · research method 0 · usability test 0 · deceptive/dark pattern 0 · thumb zone 0.

**Not a gap, and deliberately not restated:** the four-state async model is already covered at
`ENGINEERING_EXCELLENCE.md:230`. The corpus **extends** it (first-run, partial, offline,
permission-denied, disabled, overflow) rather than duplicating it.

The eight generic role agents this replaced (`ux-eng-1`, `uxd-1`, `uxr-1`, `dir-ux-1`, `iad-1`,
`dsl-1`, `des-1` — seven, plus `fe-1` which survives as the implementer) were ~6–7 KB of untailored
scaffolding from one template batch sharing an identical `tools:` line: the tell
`AGENT_DESIGN_REFERENCES.md` §2 names for template-generated breadth. Backups were taken to the
session scratchpad before deletion.

## 2. SPECIFY is justified by this repo's own drift history

The portable rationale records that the ISO derivation was overstated and that SPECIFY is argued from
evidence instead. **This is the evidence:** feature 001 shipped with **50 audited drifts** from its
seven wireframes (`docs/superpowers/plans/2026-07-18-001-mockup-parity-reconciliation.md:42`,
`docs/mockups`, `specs/001-commise-recipe-app/product-spec/wireframes/`, and
`CR-001-mockup-parity.md`). The design existed; the committed spec and the parity audit did not.

## 3. Cross-platform translation is a hard gate (§3.6)

The owner reported a recurring defect: features designed for one platform ported element-for-element
to the other — wrapped button labels, desktop action positions on mobile, horizontal overflow,
excessive scrolling. The diagnosis that made it tractable is that **`CODING_STANDARDS.md §14`
enforces parity of EXISTENCE, not quality**: a `.native.tsx` that is a 1:1 port passes all five
§14.5 review checks. Nothing else in the repo checks the second, so the agent is the only control.

§3.6 is therefore a gate rather than a §4 dimension, `cross-platform-translation.md` carries the
element-by-element translation table, SPECIFY requires a platform-translation table, and EVALUATE
runs the ten-point pass. The standing instruction is to ask whether each fix belongs in the shared
primitive — these are defect classes, not incidents.

## 4. Relationships with this repo's other agents

- **`fe-1` is the feature implementer** and builds from SPECIFY output. It is **user-scoped**, not in
  this repo — the agent must name it from the roster available at runtime rather than assuming it.
- **`fe-1`'s accessibility floor was WCAG 2.1 AA**, below both this agent's 2.2 contract and
  `ENGINEERING_EXCELLENCE.md:237`. A 2.2 spec handed to a 2.1 implementer fails silently _and
  truthfully_. Raised to 2.2 on 2026-09-06.
- **`staff-architect`** owns system shape; this agent owns experience shape. A change needing both
  gets both.
- The agent **owns `packages/apps/commise/ui`** — tokens, primitives, style guide — under the
  Etsy/Netflix split (design system vs feature code). Feature code stays with `fe-1`.

## 5. Residual risks (this repo)

- ⚠️ **One dangling reference was left deliberately.**
  `docs/reviews/2026-08-14-pr91-findings/10-import-ux.md` still names `iad-1`, `dsl-1`, `ux-eng-1` and
  `uxr-1`. It is a dated findings record; rewriting it would falsify what was recommended at the time.
- ⚠️ **Pre-existing roster rot, not introduced here:** `api-pm-1.md` recommends `backend-engineer`,
  `docs-writer` and `security-reviewer`, none of which exist as agents.
- ⚠️ **The `CLAUDE.md` mandate is proportionate, not exhaustive**, and nothing enforces it — a
  user-facing change can still be built without invoking the agent at all.
