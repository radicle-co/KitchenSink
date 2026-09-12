---
date: 2026-08-02
topic: agent-environment-hardening
---

# Agent Environment Hardening

## Summary

Convert the standing rules in this repo from prose an agent is asked to follow into gates it cannot pass, and register the MCP servers that already-installed skills reference but cannot reach. CLAUDE.md is repaired and de-duplicated rather than shortened for its own sake.

## Problem Frame

The environment is saturated on probabilistic layers and thin on deterministic ones inside the agent loop. Measured on 2026-08-02: 52 user subagents, ~40 more from the compound-engineering plugin, 126 user skills, and a 259-line / 45,048-byte CLAUDE.md — roughly 11k tokens of instruction on every request. Against that: zero MCP servers, zero hooks, zero architecture enforcement.

Enforcement does exist, but only at commit and CI time — husky, commitlint, Prettier, ESLint with real cross-package rules, `strict: true` plus twenty flags, and several CI test tiers. Nothing runs inside the agent loop, so every violation is caught after the work is done rather than before it lands. That is the second, larger defect this document addresses, and it is what R7–R23 trace to.

Three concrete defects follow from the first imbalance.

Five installed skills reference MCP tools that are absent. `figma`, `figma-use`, `figma-implement-design`, `figma-generate-design`, and `chrome-devtools-launcher` call `get_design_context`, `get_screenshot`, and `chrome-devtools_take_snapshot`. Two compound-engineering research agents declare `mcp__context7__*` and one declares `mcp__github__*`. A prior configuration existed — `~/.local/bin/chrome-devtools-mcp-bridge` and `win-chrome-debug` remain on disk — and its registration was lost. No session has been observed attempting one of these tools, so the harm is latent capability loss rather than a measured failure.

Mutation testing is configured and never runs. `packages/services/recipe-service/stryker.conf.json` exists in the main tree and six worktrees. `grep -rn "stryker" .github/workflows/` returns nothing. Dead config reads as a satisfied control during review.

CLAUDE.md contains statements that are false about the current repository. Its workspace table lists 7 packages and omits `food-service`, `food`, `recipe-service`, every entry under `packages/clients/`, `i18n`, `features/*`, `shared/*`, and `utils/*` — while the same file instructs about `deploy-recipe`, `RECIPE_FOOD_SERVICE_URL`, and `@commise/features-account/src/session`. The webhook lambda inventory appears three times with three different counts. One line asserts a live outage as permanent fact. One carries an open TODO. `AGENTS.md` is worse: it asserts the _inverted_ sandbox-addressing decision.

The cost is stated by Anthropic directly: a long CLAUDE.md "consumes tokens **and** dilutes adherence to the instructions that actually matter," and "if two rules contradict each other, Claude may pick one arbitrarily."

## Key Decisions

**Preserve by wrapping, not by deleting.** Block-level HTML comments in CLAUDE.md are stripped before the content reaches the model's context. ADR provenance and the reversed-U8 history stay in the file verbatim, wrapped in `<!-- -->`, at zero token cost. This resolves the tension between "the file is too long" and "do not cut what I deliberately wrote." The Prime Directive preamble is **excluded** from wrapping — it is addressed to the agent, not to a maintainer, so wrapping it would delete the repo's highest-priority behavioral instruction from every session.

**Cut only demonstrable harm.** Line count is not a justification. Every removal cites a named redundancy, a demonstrated staleness, a drift risk, or an existing lint rule that already guarantees the behavior. "Under 200 lines" is labelled a rule of thumb in Anthropic's own docs and nothing enforces it; the resulting file size is a consequence, not a target. Repetition of a consistent rule is not on its own a reason to cut — Anthropic endorses emphasis for adherence, and the TDD restatements each carry a distinct angle.

**Keep `bypassPermissions`, which raises the priority of guard hooks rather than lowering it.** `PreToolUse` hooks fire before any permission-mode check, and a `deny` blocks the call even under bypass. With the permission layer off by choice, the guard hooks carry the enforcement load — within a stated coverage boundary, since a deny-list matches command text the agent composes and cannot be assumed complete.

**Fix the workspace table rather than delete it — a deliberate dissent.** `/doctor` cuts "content Claude can derive from the codebase, such as directory layouts." Deriving the package-to-path map costs a glob plus ~30 `package.json` reads every session, which exceeds the table's cost. The harm is that the table is wrong, not that it exists — and R26 makes it verifiable rather than merely cheap. The per-module bullet lists are deleted, because those are near-free to derive and internally contradictory.

**Keep the `pr-{N}` teardown guard always-on — a second deliberate dissent.** Anthropic recommends moving file-specific constraints to `.claude/rules/` with `paths:` frontmatter. Path-scoped rules trigger when the agent reads a matching file. An agent can create a new CDK stack or invoke the teardown script without first reading anything under `infra/`, so the guard might never load. Its failure mode is deleting shared production infrastructure. It stays in CLAUDE.md and additionally becomes a hook.

**Establish one precedence order.** The Prime Directive claims it "outranks any impulse toward speed, convenience, or the merely-obvious solution." The Testing policy claims it "outranks every other instruction about pace, scope, or convenience." Two sections cannot both be supreme. This is a correctness fix, not a tone edit.

**Add no new subagent collections, and reduce the existing set.** The marginal value of another persona agent is negative at 92. Superpowers 5.x removed its own subagent review loops in favor of inline self-review. The gap is verification capability, not agent count — which is why R5 deletes before it describes.

## Requirements

**Environment registration**

R1. The MCP servers that installed skills already reference are registered at user scope: Figma (remote), Context7, Playwright CLI with skills, Maestro, Expo, and Chrome DevTools. Chrome DevTools binds the existing `~/.local/bin/chrome-devtools-mcp-bridge` wrapper rather than the bare package, so the `chrome-devtools-launcher` skill's assumptions hold.

R2. Each registered server's per-session tool-schema cost is measured after registration against a stated ceiling. Any server exceeding it moves to on-demand or CLI/skill form.

R3. Context7 is installed as a CLI plus skill, not as a resident MCP server, so it carries no persistent tool schemas.

R4. The two compound-engineering research agents' `mcp__context7__*` declarations are rewritten to invoke the Context7 CLI/skill, since R3 leaves no server of that name.

R5. The `mcp__github__*` declaration is removed from `ce-issue-intelligence-analyst`, since registering a GitHub MCP server is out of scope.

R6. Three plugins are installed: `typescript-lsp`, `security-guidance`, and `mattpocock-skills`. Each is audited before install for an `agent` key in its `settings.json` — which replaces the main-thread system prompt — and for its declared component inventory. The duplicate `tdd` and `code-review` skills from `mattpocock-skills` are disabled, since superpowers already covers both.

R7. Superpowers is reinstalled at user scope. It is currently scoped to `.worktrees/003-usda-food-data`, a stale worktree path.

R8. The 52 user subagents are triaged against the 12 that are actually invoked. Agents with no demonstrated use are deleted; only survivors receive a description stating a trigger condition. The expected post-audit count is stated so this requirement and the no-new-agents decision point the same direction.

R9. Skills that are only ever invoked by slash command carry `disable-model-invocation: true`. Skill descriptions currently cost ~10,400 tokens per session, roughly 16× the cost of the agent descriptions.

**Enforcement: hooks**

R10. A `PreToolUse` hook on `Bash` denies: `git commit`/`push` with `--no-verify`, force-push, direct push to `main`, `rm -rf`, `git reset --hard`, and manual production `cdk deploy`.

R11. The same hook denies `cdk destroy` against any stack matching `kitchensink-{network,data,global,alb}-*`, and denies any Route 53 or Vercel domain operation whose first label is not `pr-{N}`. Both matches delegate to `.github/scripts/pr-scope.sh`'s existing delimiter-aware matcher rather than reimplementing it, so `pr-1` cannot match `pr-15`.

R12. R10 and R11 are validated by an adversarial evasion suite expressing the same destructive intent through a script file, an npm script, and a wrapper command. Any evasion found either extends the matcher or is accepted in writing.

R13. A `PreToolUse` hook denies writes to `.env` files, `.git/`, `package-lock.json`, and existing files under `docs/architecture/decisions/`. Creating a new numbered ADR is permitted. The denylist is enforced on resolved write targets in `Bash` commands — redirections, `tee`, `sed -i`, `cp`, `mv` — not only on the `Edit|Write` tool name.

R14. A `PostToolUse` hook on `Edit|Write` formats with Prettier and then blocks on ESLint failure, feeding the report back to the agent. Prettier is invoked with `--ignore-unknown` and guarded on file existence.

R15. A `PostToolUse` hook typechecks the workspace owning the edited file, running asynchronously with rewake so it does not sit on the critical path.

R16. A `Stop` hook refuses to end a turn while tests fail, and short-circuits on `stop_hook_active` to avoid the block loop.

R17. R14, R15, and R16 land with a recorded baseline, as R22 and R23 do. Pre-existing lint, type, and test failures do not block; only newly-introduced ones do. Without this the hooks obstruct the R19 remediation they share a branch with.

**Enforcement: compiler and lint**

R18. `packages/apps/commise/web/tsconfig.json` and `web/tsconfig.test.json` are refactored to extend the shared base. Web's is currently the only package tsconfig with no `extends`, so a change to the shared base would silently no-op for the largest app.

R19. `packages/tools/typescript/base.json` enables four flags, one per change, in ascending cost order: `verbatimModuleSyntax` (12 errors), `noUncheckedIndexedAccess` (117), `noPropertyAccessFromIndexSignature` (139), `exactOptionalPropertyTypes` (315). Each lands enabled-and-clean. `noPropertyAccessFromIndexSignature` is overridden to `false` in the mobile and web tsconfigs, the two packages with build-time env inlining.

R20. All resulting type errors are fixed — approximately 583 monorepo-wide, measured across all workspaces rather than extrapolated.

R21. `packages/tools/eslint/index.js` gains rules for: named-exports-only, `process.env['KEY']` bracket access, `@typescript-eslint/ban-ts-comment`, the Playwright `data-testid` and `waitForTimeout` bans, and a `helpers/` folder-name ban. The `process.env` rule states whether its existing violations convert in the same PR or the rule lands warn-only against a recorded baseline.

R22. The `process.env` rule exempts the paths where Expo requires static dot access for build-time inlining, including `packages/apps/commise/mobile/src/config/env.ts` and `*.config.ts`. The exemption is compiler-level as well as lint-level.

R23. The named-exports rule exempts the widget load boundary under `packages/apps/commise/features/*/src/widget/`. `React.lazy` requires a module with a `default` export, so those exports fall under the existing framework-required carve-out.

R24. The commit-format and Prettier-formatting bullets are removed from CLAUDE.md, since commitlint and Prettier already guarantee them.

**Verification tooling**

R25. Stryker runs in `_ci.yml` — the per-PR tier — with `--incremental` and a `thresholds.break` value, so a surviving mutant fails the build. `_ci-heavy.yml` cannot serve this purpose: it is called only by `heavy-e2e.yml`, `recipe-loadtest.yml`, and `ci-full.yml`, never by `ci-pr.yml` or `ci-main.yml`.

R26. Each target workspace gets its own `stryker.conf.json` bound to that workspace's `vitest.config.ts`. There is no root vitest config, so `mutate:` globs cannot span workspaces. The initial target set is named rather than described as extended globs.

R27. dependency-cruiser enforces the cross-workspace import boundary that CLAUDE.md currently only states. It uses a reporter whose exit code carries the violation count.

R28. Knip reports unused files, exports, types, and dependencies, and unlisted dependencies.

R29. The R27 and R28 baselines are monotonic ratchets: CI fails if the violation count rises above the recorded baseline, and the baseline file regenerates downward on any change that reduces it. Initial counts are stated so the size of the debt is visible before adoption. A baseline with no burn-down is the permanently-green control this document indicts Stryker for being.

R30. `@axe-core/playwright` asserts WCAG 2.1 A/AA compliance inside the existing `tests/e2e/*.spec.ts` tier, landing with the same baseline provision R27–R29 carry. The current violation count is unknown and `e2e-web` runs on every PR, so an unbaselined gate turns `main` red on merge.

R31. `eslint-plugin-i18next` enforces the localization gate that CLAUDE.md states as a pre-write rule, running `no-literal-string` in `jsx-text-only` mode scoped to `packages/apps/commise/**`, with a recorded baseline.

**CLAUDE.md repair**

R32. The workspace table lists every workspace resolved by the `workspaces` field in the root `package.json`.

R33. A CI check diffs the CLAUDE.md workspace table against the resolved workspaces and fails on mismatch, so the table cannot silently go stale again.

R34. The webhook lambda inventory appears once, with one count.

R35. The dated status claim that previews are unreachable, and the open TODO about draining to `strict`, are removed. Both are current-state operational facts, not conventions.

R36. The purity and `@sideEffect` rule appears once. The two bullets in Key conventions are adjacent and state the same rule.

R37. Maintainer-facing narrative — ADR provenance, reversed-decision history — is wrapped in block-level HTML comments rather than deleted. Wrapping applies only to content carrying no imperative addressed to the agent, and never to a restatement of a live rule.

R38. CLAUDE.md states an explicit precedence order, so no two sections claim to outrank each other.

R39. Infrastructure ADR summaries move to `.claude/rules/` files with `paths:` frontmatter scoping them to the packages where they bind. The `pr-{N}` teardown guard is excluded from this move per the Key Decision above.

R40. The prohibitions in the "Deliberate decisions" section survive verbatim. The reasoning around them may move to the linked ADR; the imperatives do not.

R41. `AGENTS.md` is corrected. Line 39 currently asserts that sandbox front-ends use path routing "NOT per-PR subdomains," with the exact `azp`-is-exact-string reasoning CLAUDE.md records as disproven and reversed on 2026-07-13.

R42. The deliberate-decision imperatives have one authoritative source that both `CLAUDE.md` and `AGENTS.md` reference, so R39's move to the Claude-Code-only `.claude/rules/` does not orphan the opencode and copilot toolchains.

**Delivery**

R43. All repo changes land on one branch as one PR, cut from a clean tree. Uncommitted files on `main` are resolved or stashed first.

R44. The four flags and the new lint rules are measured against each active feature branch before merge, and the rollout states whether those branches rebase immediately or the flags sit behind per-workspace overrides until each branch merges.

R45. Machine-local changes (R1–R9) are applied outside the PR, since they are not committable.

## Acceptance Examples

AE1. **Covers R10.** Given the agent runs `git commit --no-verify -m "wip"`, the call is blocked and the agent receives a message explaining that husky and commitlint are the enforcement layer.

AE2. **Covers R10, R11.** Given the agent runs `cdk destroy kitchensink-data-prod`, the call is blocked. Given it runs `cdk destroy kitchensink-food-pr-73`, the call proceeds. Given a Route 53 operation on `pr-1.sandbox.commise.app` while `pr-15` is the current PR, the call is blocked.

AE3. **Covers R13.** Given the agent edits `docs/architecture/decisions/0003-shared-alb-per-stage.md`, the call is blocked. Given it creates `docs/architecture/decisions/0012-agent-environment-hardening.md`, the call proceeds.

AE4. **Covers R13.** Given the agent runs `echo "X=1" >> .env` through `Bash`, the call is blocked on the resolved write target, not on the tool name.

AE5. **Covers R14.** Given the agent writes a `.ts` file containing a relative import ending in `.ts`, ESLint fails and the hook returns the report as blocking feedback. Given the agent writes a `.png`, the hook exits cleanly and does not block.

AE6. **Covers R16.** Given the agent attempts to end a turn with a failing test suite, the turn is blocked once with the failure output. Given the hook has already blocked and `stop_hook_active` is true, the turn ends.

AE7. **Covers R20.** Given an `exactOptionalPropertyTypes` error, remediation narrows or corrects the type. Adding `| undefined` to silence it is a rejected fix unless the wire or persisted contract genuinely permits the absent value. At least one `verbatimModuleSyntax`-affected build artifact is smoke-tested at runtime.

AE8. **Covers R22.** Given a file under `packages/apps/commise/mobile/src/config/`, `process.env.EXPO_PUBLIC_X` passes both lint and typecheck. Given a file in the identity service, the same expression fails.

AE9. **Covers R37.** Before any other wrapping lands, a unique sentinel string is wrapped in block comments in CLAUDE.md and a fresh session is asked to reproduce it. Absence confirms stripping and R37 proceeds. Presence falsifies the premise, and the maintainer-facing content moves to a companion doc under `docs/` with a one-line pointer instead.

## Scope Boundaries

- Dropping `bypassPermissions` for a permission allowlist. Ruled out; the guard hooks carry the load instead.
- Splitting delivery into staged PRs. Ruled out; one branch, one PR, despite the remediation volume.
- Deduplicating the TDD mandate. The five statements each carry a distinct angle — mutation lens, red-green ordering, coverage theater, YAGNI misuse — and Anthropic endorses emphasis for adherence.
- Write-protecting `.claude/hooks/` and `.github/workflows/` against the agent. Several requirements need workflow edits to land.
- New subagent collections — `wshobson/agents`, `VoltAgent`, `contains-studio`, `dl-ezo`. All duplicate existing coverage or are unmaintained.
- GitHub, Sentry, Vercel, and Serena MCP servers. The first costs ~17× `gh` for equivalent work; the next two are superseded by installed skills that say so in their own frontmatter; Serena's docs report collapsed instruction adherence under current Claude Code and Opus.
- A visual-regression vendor (Argos, Chromatic, Percy). Real value, but a separate decision with a recurring cost.
- Figma Code Connect and a Style Dictionary token pipeline. Both are engineering projects, not configuration changes.
- Anthropic's `frontend-design` plugin. Calibrated for greenfield work with no design system; it would invent typography that `@commise/ui` does not have.

## Dependencies / Assumptions

- Figma's remote MCP server is free on all seats and plans during beta, and will later become usage-based paid. The desktop server, which does require a paid seat, is not used.
- Anthropic's native browser integration is unsupported on WSL, so Playwright CLI is the visual-verification path rather than `claude --chrome`.
- Playwright and Chrome DevTools drive real browsers over untrusted web content, and Figma and Expo hold OAuth grants. The guard hooks cover `Bash` and `Edit|Write` only, so MCP tool calls are outside their reach. This prompt-injection and credential-blast-radius surface is accepted, not mitigated.
- The tsconfig remediation is ~583 errors monorepo-wide against a current baseline of zero. The unsampled workspaces are the worst: features/recipes 81 `exactOptionalPropertyTypes`, mobile 54, identity-webhooks 49 `noPropertyAccessFromIndexSignature`, recipe-workers 27 `noUncheckedIndexedAccess`.
- Most of R21's rules are ratchets against near-zero existing violations. Verified: `@ts-ignore` 0 in source (18 hits are all in generated `.next/types/`), `data-testid` 0 (13 hits are JSDoc comments asserting compliance), `waitForTimeout` 0 (same), `helpers/` directories 0, non-framework default exports ~2. The `process.env` rule is the exception — 71 violations outside R22's carve-out, 59 of them in `identity-webhooks`.
- 11 worktrees do not inherit the shared configs; each checks out its own branch copy, so the change arrives at rebase, when each branch's unmerged source produces a fresh unmeasured error set. Four carry active feature branches (001, 004, 005, 006).

## Outstanding Questions

**Deferred to planning**

- Whether the `Stop` hook in R16 runs the full suite, a scoped subset, or the cheaper model-judged `prompt` hook variant.
- Which `thresholds.break` value R25 starts at, measured from a baseline rather than set from an aspiration.
- Whether DBHub is registered for local Postgres introspection. Useful for Drizzle schema-drift checks against the open prod-migration item, but it executes SQL and needs a read-only role scoped to non-production.
- Which workspaces form R26's initial Stryker target set beyond `recipe-service`.

## Sources / Research

- [Claude Code — Memory](https://code.claude.com/docs/en/memory) — the 200-line figure, HTML-comment stripping, `.claude/rules/` `paths:` semantics, compaction behavior, and the contradiction warning.
- [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) — "Bloated CLAUDE.md files cause Claude to ignore your actual instructions"; the delete-or-convert-to-a-hook rule; emphasis improves adherence.
- [Claude Code — Extend Claude Code](https://code.claude.com/docs/en/features-overview) — "Rule of thumb: keep CLAUDE.md under 200 lines"; "If a rule must hold every time, make it a hook rather than a prompt instruction."
- [Claude Code — Hooks](https://code.claude.com/docs/en/hooks) — `PreToolUse` fires before permission-mode checks; `Edit|Write` matchers miss files written via `Bash`; exit-code and matcher semantics; `stop_hook_active`.
- [Steering Claude Code](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more) — "consumes tokens and dilutes adherence to the instructions that actually matter."
- `claude-md-management` plugin, read at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/claude-md-management/` — the 100-point audit rubric; Architecture Clarity weighted 20/100, which is the basis for the R32 dissent from `/doctor`.
- [Veracode 2026 GenAI Code Security Report](https://www.veracode.com/blog/2026-genai-code-security-report-ai-risk/) — syntax correctness above 95% against a security pass rate of 56%.
- [GitClear — The Maintainability Gap](https://www.gitclear.com/the_ai_code_quality_maintainability_gap) — block duplication up 81%; refactoring line-moves down from 21% to 3.8%.
- [Cognition — Multi-Agents: What's Actually Working](https://cognition.com/blog/multi-agents-working) — a dedicated review agent finds ~2 bugs per PR, ~58% severe, and performs better with clean context than shared context.
- `packages/tools/typescript/base.json` — `strict: true` plus 20 individual flags; the four in R19 are absent.
- `packages/tools/eslint/index.js` — already enforces the `.ts` relative-import ban and the cross-package import restriction; `no-explicit-any` is disabled under `__tests__/` and `*.test.ts`.
- `.github/workflows/_ci-heavy.yml` — its header states it is called only by `heavy-e2e.yml`, `recipe-loadtest.yml`, and `ci-full.yml`, which is why R25 targets `_ci.yml` instead.
- `.github/scripts/pr-scope.sh` — the single authoritative `pr-{N}` matcher R11 delegates to, regression-tested by `packages/infra/global/__tests__/pr-scope.test.ts`.
