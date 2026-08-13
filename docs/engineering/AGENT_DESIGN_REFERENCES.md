# Agent design — references and rationale

Why `.claude/agents/staff-architect.md` looks the way it does, and where the evidence came from.
Researched 2026-08-13 against live sources.

> Scope: this is about the **tooling** we use to build the product, not the product itself. It sits
> beside `ENGINEERING_EXCELLENCE.md` because the same quality bar applies to the agents that review
> our code as to the code.

---

## 1. Normative guidance

| Source                                                                                                                                       | What it settles                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Claude Code — Create custom subagents](https://code.claude.com/docs/en/sub-agents)                                                          | Frontmatter contract, delegation mechanics, scope precedence, best-practice list |
| [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Prompt altitude, length, structure, examples-over-rules, tool minimalism         |

The three best practices the docs state outright:

> - **Design focused subagents:** each subagent should excel at one specific task
> - **Write detailed descriptions:** Claude uses the description to decide when to delegate
> - **Limit tool access:** grant only necessary permissions for security and focus

And on the `description` field specifically — it is _required_, and it means **"When Claude should
delegate to this subagent"**:

> Claude automatically delegates tasks based on the task description in your request, the
> `description` field in subagent configurations, and current context. To encourage proactive
> delegation, include phrases like "use proactively" in your subagent's description field.

Two facts that are easy to get wrong:

- **Custom subagents DO load `CLAUDE.md`.** Only the built-in `Explore` and `Plan` skip it. So a
  project agent inherits the PRIME DIRECTIVE and the deliberate-decisions list — but _not_
  conversation history, files already read, or the full Claude Code system prompt.
- **Nested delegation is ON by default**, up to three layers below the main conversation
  (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). Agent definitions claiming the platform blocks it are
  out of date. The `Task` tool was renamed `Agent` in v2.1.63; `Task` still works as an alias.

**Scope precedence** (higher wins): managed settings → `--agents` CLI → `.claude/agents/` (project)
→ `~/.claude/agents/` (user) → plugin. This is why our `staff-architect` lives in the repo: it
overrides the generic user-level one, and it gets reviewed in PRs like any other file.

---

## 2. Reference implementations, ranked

### Tier 1 — authoritative

**[anthropics/claude-plugins-public → `feature-dev/code-architect.md`](https://github.com/anthropics/claude-plugins-public/tree/main/plugins/feature-dev)**
Anthropic-authored, in the official marketplace. The best single comparison point. ~2.2 KB.

```yaml
tools: Glob, Grep, LS, Read, NotebookRead, WebFetch, TodoWrite, WebSearch, KillShell, BashOutput
model: sonnet
```

No `Write`, no `Edit`, no `Bash`, no `Agent` — an architect that structurally cannot modify code.
Requires _"existing patterns with **file:line** references"_ and reads _"CLAUDE.md guidelines"_ as
step 1. Part of an explore → architect → review pipeline.

### Tier 2 — large, actively maintained

| Repo                                                                                                  | ★     | Architect agents                                                                                                                | Technique worth taking                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [wshobson/agents](https://github.com/wshobson/agents)                                                 | 38.8k | `ship-mate/architect`, `backend-architect`, `cloud-architect`, `docs-architect`, `design-system-architect`, `graphql-architect` | **Escalation gates that HALT** (external APIs, schema changes, auth, scope creep, information gaps); precision anchoring to exact file + function; declares required input documents; pauses for human approval |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | 24.3k | `architect-reviewer`, `microservices-architect`, `cloud-architect`, `llm-architect`, `java-architect`                           | ~2,800-word reviewer with an 8-item checklist, technical-debt assessment, named handoffs to six specific agents                                                                                                 |
| [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)     | 12.3k | — (reference)                                                                                                                   | Anthropic's own built-in Plan/Explore/Task prompts, versioned per release. The best available model of house style                                                                                              |

### Tier 3 — useful, lower signal

[hesreallyhim/a-list-of-claude-code-agents](https://github.com/hesreallyhim/a-list-of-claude-code-agents)
(community index) · [lst97/claude-code-sub-agents](https://github.com/lst97/claude-code-sub-agents)
· [0xfurai/claude-code-subagents](https://github.com/0xfurai/claude-code-subagents) ·
[awslabs/startups → aws-startup-advisor](https://github.com/awslabs/startups) (AWS-authored, in the
official marketplace)

**Deliberately excluded:** collections with 100+ agents at double-digit stars. Template-generated
breadth, not earned depth — the same tell as a roster of role files sharing one identical `tools:`
line.

---

## 3. The decisive-vs-options split

Anthropic's architect says _"Make decisive choices — pick one approach and commit… rather than
presenting multiple options."_ Most staff-architect prompts say the opposite: _"build a trade-off
comparison, not a single anointed answer."_

**Neither is wrong.** They serve different moments. An implementation blueprint that hedges is a
defect; a technology selection that skips the alternatives is an opinion, not a decision record.

Our agent therefore branches on mode: **PLAN** gives options and flip-conditions, **BLUEPRINT**
decides and commits, **REVIEW** reports findings. Collapsing these into one voice is why a generic
architect prompt feels vague in both directions.

---

## 4. What our agent adds, and why

| Choice                                                | Reason                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No `Write`/`Edit`**                                 | Matches Anthropic's. Makes "you don't implement" structural instead of aspirational. It returns ADR text; the main session writes the file               |
| **`Bash` kept, read-only by instruction**             | A REVIEW agent that cannot run `git diff` is useless. A deliberate deviation from strict least privilege — the honest trade, recorded rather than hidden |
| **HALT gates on governing decisions**                 | Adapted from wshobson. This repo is dense with "looks wrong, isn't" decisions; recommending against one unknowingly is the likeliest way to do harm      |
| **`file:line` anchoring + verified-vs-assumed**       | From Anthropic and wshobson. Unanchored claims about a codebase are where confident wrongness lives                                                      |
| **Pattern register incl. "intent already satisfied"** | Straight from `CLAUDE.md`. Prevents the agent adding machinery where a discriminated union already IS Visitor                                            |
| **Confidence calibration criteria**                   | A bare High/Medium/Low inflates. Tied to whether governing decisions and code were actually read                                                         |
| **Composition doctrine ("compose, don't collect")**   | The gap this repo's own docs left: `ENGINEERING_EXCELLENCE.md` catalogues patterns individually and mentions composition **zero** times                  |
| **Nine accountability dimensions**                    | A staff architect is not a pattern-matcher. Forces coverage of data, contracts, failure, concurrency, operability, evolution, cost of change, and people |
| **One-way vs two-way doors**                          | Spends rigour asymmetrically. Also absent from the excellence doc (0 mentions of reversibility)                                                          |
| **"Where you beat a human / where you don't"**        | Turns "be better than a staff engineer" into behaviour instead of flattery — see below                                                                   |

### Progressive disclosure, not duplication

The agent does **not** inline the pattern catalogue, SOLID, or the smell list. Those already live in
`ENGINEERING_EXCELLENCE.md`, and copying them into an agent prompt would violate the repo's own DRY
rule and guarantee drift the first time either changed. §2 of the agent instead makes reading the
relevant section **mandatory before forming an opinion**, and the agent carries only what that
document lacks: composition, evolution/migration, reversibility, Conway, and the judgement layer.

Verified gaps at the time of writing (`grep -ci` over `ENGINEERING_EXCELLENCE.md`): composition 0,
expand-contract/strangler/migration 0, Conway 0, reversibility/one-way door 0. Idempotency (8) and
consistency (3) are covered there, so the agent references rather than restates them.

### "Better than a human staff engineer", honestly

The owner's requirement was that this agent exceed a human at the role. That is achievable, but only
on specific axes, and stating it as a compliment would produce nothing. §7 of the agent names both
halves:

- **Genuinely better at** — reading every call site rather than a sample; never skipping the boring
  check; holding no ego about its own prior recommendation; no politics; consistency across the 50th
  review as the 1st.
- **Genuinely worse at, and must compensate** — no production scars, no tacit org context, no
  long-running experiment, a fresh context every session, and **fluent overconfidence**, which is its
  characteristic failure: it can produce a well-cited, well-structured, entirely wrong
  recommendation that reads better than a human's correct one.

The anchoring rules, HALT gates and confidence calibration exist to convert the second list into
process rather than hope.

### Owner ruling: MAXIMALIST (2026-08-13)

The agent applies a pattern **everywhere one genuinely fits**, individually and composed. It must not
argue for fewer patterns, must not treat a small ad-hoc shape as exempt, and must not invoke
YAGNI/KISS against a pattern that fits — those govern speculative _features_, not the expression of a
shape that already exists.

This matches `CLAUDE.md`, which is already maximalist: _"**Always** use design patterns, unless
applying one would break the pattern or the code"_ and _"The only misuse is **forcing** a pattern onto
a shape it doesn't match, or applying it in a way that violates the pattern's own contract."_

**A first draft hedged this** with "density is not the goal" and a rule-of-three before reaching for a
pattern. That was generic industry caution imported over the repo's own stated standard, and it was
wrong on the merits too: rule-of-three governs **extracting a shared abstraction** from duplication,
which is a different question from whether to express a shape as Strategy rather than a flag argument.
Corrected on owner instruction.

The two failure modes — the only two — are now stated explicitly in §1 and are about **correctness,
not count**:

1. **Wrong pattern, or wrong combination.** Forced onto a shape it doesn't match, or two patterns
   stacked with overlapping responsibilities.
2. **Right pattern, implemented wrong.** A pattern has a contract; breaching it forfeits the benefit,
   keeps the cost, and actively misleads, because the name now lies.

§1a exists for the second one — a named list of contract breaches to check rather than trusting the
label: Strategy reaching back into its context, Observer without unsubscribe, Repository leaking ORM
types, Facade grown into a layer, Adapter that adds behaviour, Decorator that isn't substitutable,
transitions performed outside the statechart, Factory that is `new` with extra steps, Registry with no
single registration point, Singleton as ambient mutable state, mutable value objects, ports pointing
outward. **A breached pattern is a finding of the same severity as a missing one.**

The one place the agent adds nothing is when the intent is **already satisfied** — a discriminated
union with an exhaustive switch IS Visitor. That is not an exception to maximalism; the pattern is
present and simply needed no ceremony. It gets credited in the register.

### The failure this was built around

During PR 91 a Postgres equivalence proof was "fixed" with `enable_seqscan = off` — a change that
same file's header recorded as **measured and rejected**, because the header was never read, only
the lines around the failing assertion. Full context (`CLAUDE.md`, the ADR index, a long session)
did not prevent it.

A fresh subagent has _less_ context, so it is more exposed, not less. That is why §2 of the agent is
a HALT gate rather than a polite suggestion to read the ADRs.

---

## 5. Reviewing an agent definition

A short checklist for the next one:

- [ ] `description` states **when to delegate**, with triggers — not a job title
- [ ] `tools` are the minimum the job needs; write access justified in the file
- [ ] `model` set deliberately (`inherit` is a choice, not a default)
- [ ] No claims about the platform that have gone stale (nesting, tool names)
- [ ] No hardcoded roster that duplicates across files and rots silently
- [ ] Output format specified; confidence calibrated
- [ ] Evidence rules: anchors required, verified separated from assumed
- [ ] A HALT gate for the decisions this repo has already made
