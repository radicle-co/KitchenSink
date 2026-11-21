---
name: code-quality-mode-playbooks
description: Use when the staff-code-quality agent has detected its mode — GATE (the CI-only review of a pull request's whole diff), REVIEW (a PR, branch or commit range), or INSPECT (a file, module, package or repository on demand) — and needs that mode's procedure, time budget and exact report body.
---

# Code-quality mode playbooks

Load the ONE section for your mode. The agent file holds the spine (verdict → root causes → body →
escalations → evidence & coverage → confidence) and the per-finding shape; this skill holds the procedure
and the body. The modes differ on purpose: a GATE that writes an essay gets skipped next time, and an
INSPECT that lists line items without a diagnosis answers the wrong question.

All three modes run all three passes (evidence → eagle-eye sweep → root cause). What changes is scope,
depth, and what the reader needs to do next.

---

## GATE — "may this pull request merge?"

**Reader:** the PR author, through the `GATE` commit status and one review comment. It needs a verdict and a short list
it can act on.

⛔ **GATE runs only in CI** (`gate.yml`, ADR-0098). It runs only when you have the structured output tool, which only the
CI workflow gives you. Without it, say in one line that GATE runs only in CI, and stop: do not run it, and do not stand
in for it, on a machine or inside another agent's session. With it, never stop in prose: return `BLOCK` through the
call.

**Scope:** the PR's whole diff against its base, `git diff <base>...<head>`.

**Procedure**

1. Read the `scq-<sha>` artifact in `$SCQ_EVIDENCE` (`status.json`, `summary.md`, `findings.jsonl`, `verdict.json`).
   Never run a scanner: the `Code quality scanners` job already ran them once, on this commit. A tool whose status is
   not `ran`, or an artifact that is missing or does not name this commit, is a blocker.
2. Do not re-run the repository's lint, typecheck or tests: CI's own jobs report those. Read only what the diff needs.
3. Eagle-eye sweep over changed lines and the units that contain them; load the corpus references for the languages
   present.
4. Root-cause ladder for every major+ finding. Prefer stopping at the rung that explains the smell; if it
   reaches L3+, the finding is STRUCTURAL and the verdict is BLOCK unless it is pre-existing and not made
   worse.
5. Required test tiers: check the house standard's tier matrix against what the diff touches (UI → component
    - e2e tiers; non-UI → unit + integration; schema → migration integration test). A missing required tier
      is major.
6. Return the structured result the workflow asks for: `verdict` (`PASS` or `BLOCK`) and `findings` (each with
   `severity` `blocking` or `advisory`, `title`, `detail`, and `file` and `line` when known). The workflow turns it into
   the `GATE` status; there is nothing to record yourself.

**Budget:** measured 2026-09-13 on a 6-file / 223-line diff: ~6 minutes and ~145k tokens (REVIEW on the same
diff: ~12 minutes / ~200k). That is the realistic floor with the repo's gates, the scanner and the
existing-solution search — do not promise less. What GATE gives up for the speed is the L4–L6 climb on
findings that are not already blocking (its REVIEW run found an ADR-level data-integrity defect GATE did not):
when a GATE finding smells structural, say "REVIEW recommended" rather than climbing. Do not read beyond the
blast radius of the diff except to search for an existing solution the change reinvents (always do that search).

In CI, **Length** and **Body** below do not apply: the structured output call is the report (agent card §7).

**Length:** the whole GATE report fits in ~60 lines. One-line findings where the gate output already explains
them (a red typecheck needs its error, not an essay); full per-finding shape only for blockers the gates do not
already show.

**Body**

```
### Blocking
[blocker + major findings, per-finding shape, root causes first. "None" when PASS.]

### Fix before merge (non-blocking)
[minor findings as one line each: `path:line` — smell — fix.]

### Gates
| gate | command | result |
[the scanner tool statuses from the artifact, one line each; the repo's own gates are reported by their CI jobs]
```

Omit nits entirely unless they are house-standard violations the scanners will not catch.

---

## REVIEW — "should this change merge, and what must change first?"

**Reader:** the author and the human reviewer. They need root causes, every material finding, and the
remediation plan in merge order.

**Scope:** the PR / branch / range (`git diff <base>...<head>`), plus its blast radius: callers of changed
exports, siblings of changed components, and any module the change duplicates or reinvents.

**Procedure**

1. `node tooling/codeQuality/scan.mjs --repo . --base <base> --codeql ci` (fall back to `--codeql local` for security-sensitive
   changes with no published analysis). `--knip on` when exports are added or removed.
2. Read the PR description / commit messages and the plan or spec it cites, if any. A change that does
   more or less than it claims is a finding (scope drift, unfinished work shipped as done).
3. Ground in the standards and governing decisions for every touched area (agent §2–§3).
4. Eagle-eye sweep over every changed file in full (not only hunks — smells live in how new code sits in
   the old file), with the corpus references for everything in scope.
5. For each new helper/hook/adapter/client/util/abstraction: search for the existing house solution.
6. Root-cause ladder; cluster; decide LOCAL / PATTERN / STRUCTURAL.
7. Tests: grade the tests the change adds (test-quality reference) — would each still pass if the code were
   subtly broken? Which required tiers are missing?
8. Order the remediation: STRUCTURAL first (they change what the other fixes look like), then blockers,
   then majors, then minors.

**Body**

```
### Findings
[All blocker / major / minor findings in the per-finding shape, most severe first, grouped under the root
 cause they belong to where one exists.]

### Tests
[What the added tests prove; which would survive a mutation; missing required tiers.]

### Remediation order
[Numbered: the sequence the author should apply fixes in, and why that order.]

### Prevention
[Rules/guards/standard amendments proposed, deduplicated across findings, each with the class it closes.]
```

---

## INSPECT — "what is the health of this area, and what should we do about it?"

**Reader:** the owner deciding where to invest. They need a diagnosis, not an inventory.

**Scope:** the named path(s). For a whole repository, sample by hotspot (below) rather than reading
everything, and say what was sampled.

**Procedure**

1. `node tooling/codeQuality/scan.mjs --repo . --all <path> --knip on` (`--codeql ci` or `local` if security matters here).
2. **Hotspots** — where change and complexity meet (Tornhill): churn from
   `git log --since=12.months --format= --name-only -- <path> | sort | uniq -c | sort -rn | head -30`,
   intersected with size/complexity (file length, `sonarjs/cognitive-complexity` hits). Read the top
   hotspots fully first.
3. **Temporal coupling** — files that change together without an import relationship:
   `git log --since=12.months --format='%H' -- <path>` then co-change counts per commit. Co-change without
   a dependency is hidden coupling (a duplicated rule, a shotgun-surgery seam).
4. Dependency structure: cycles (depcruise), fan-in/fan-out of the modules in scope, boundary violations.
5. Eagle-eye sweep over the hotspots and a sample of the rest; name the smells the area repeats.
6. Root-cause ladder on each repeated smell. Expect STRUCTURAL diagnoses here — that is what INSPECT is for.
7. Prioritise by (cost of the smell × change frequency) ÷ fix cost. A smell in code nobody touches is cheap
   to carry; the same smell in a hotspot is expensive.

**Body**

```
### Diagnosis
[3–7 sentences: the health of the area and the one or two decisions that explain most of what is wrong.]

### Hotspots
| file | churn (12 mo) | size / complexity | dominant smell |

### Structural findings
[STRUCTURAL and PATTERN findings in the per-finding shape, each with the target shape, what it deletes, and
 the migration path.]

### Local findings
[Top local findings, per-finding shape, capped at the ten that matter most; say how many more exist and
 where they are listed (the scan output path).]

### Remediation plan
[Phased: what to do first and why, with the safe intermediate state of each phase and the guard that locks
 each phase in. Include the cheaper 70% option when it exists.]
```

---

## Common mistakes

- **GATE essays.** If the verdict is PASS, the body is three lines.
- **REVIEW without the existing-solution search.** It is the single most common miss for a diff-only read.
- **INSPECT as an inventory.** 200 findings without a diagnosis is the scan output, not an inspection.
- **Treating pre-existing smells as the change's fault** — label them pre-existing; flag only when the
  change worsens or depends on them.
- **Mode drift** — a GATE that turns into an INSPECT of the whole package. Note the wider concern in one
  line under Escalations and stay in scope.
