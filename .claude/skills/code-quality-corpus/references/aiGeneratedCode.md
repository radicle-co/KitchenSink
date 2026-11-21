# AI / LLM-generated code — smells, anti-patterns, red flags (reference corpus for `staff-code-quality`)

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID    | Smell                                                                                      | Section                                  | Detected by | Default severity | Architecture |
| ----- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------- | ---------------- | ------------ |
| AI-01 | `useRef` used as state or as a re-render dodge                                             | React escape hatches (the agent's favou… | partial     | major            | yes          |
| AI-02 | "Latest value" ref (`callbackRef.current = callback`)                                      | React escape hatches (the agent's favou… | partial     | major            | no           |
| AI-03 | `isMounted` / `didUnmount` / `cancelled` refs to silence "update on unmounted component"   | React escape hatches (the agent's favou… | judgement   | major            | no           |
| AI-04 | Ref as a data cache / mirror of props, state or server data                                | React escape hatches (the agent's favou… | judgement   | major            | yes          |
| AI-05 | Ref as an instance-variable bag / "previous value" ref                                     | React escape hatches (the agent's favou… | partial     | minor            | no           |
| AI-06 | Imperative handle / `forwardRef` reflex                                                    | React escape hatches (the agent's favou… | partial     | minor            | no           |
| AI-07 | `useEffect` as the default wiring tool                                                     | React escape hatches (the agent's favou… | partial     | major            | no           |
| AI-08 | Timing hacks as ordering "fixes": `setTimeout(…, 0)`, `requestAnimationFrame`, `useLayout… | React escape hatches (the agent's favou… | judgement   | major            | no           |
| AI-09 | Memoisation reflex — and its mirror, stripping memoisation                                 | React escape hatches (the agent's favou… | partial     | minor            | no           |
| AI-10 | Dependency-array lies: suppressions, ref laundering, `useEffectEvent` laundering           | React escape hatches (the agent's favou… | partial     | major            | no           |
| AI-11 | Context as a dumping ground to avoid prop threading                                        | React escape hatches (the agent's favou… | partial     | minor            | no           |
| AI-12 | Cast-to-green: `as any`, `as unknown as T`, `!`, `@ts-expect-error`, Python `cast`/`Any` … | Type-system, lint and framework escape … | partial     | major            | yes          |
| AI-13 | Suppression added by the change (`eslint-disable`, `noqa`, `type: ignore`, Sonar `NOSONAR… | Type-system, lint and framework escape … | partial     | major            | no           |
| AI-14 | Type widening to make an error go away                                                     | Type-system, lint and framework escape … | judgement   | major            | yes          |
| AI-15 | NestJS / DI escape hatches added to clear a boot error                                     | Type-system, lint and framework escape … | partial     | major            | yes          |
| AI-16 | Swallowing catch, log-and-return-default, success-shaped fallback                          | Error-masking and "defensive" code       | partial     | blocker          | yes          |
| AI-17 | Impossible-state defensiveness: `?.`, `?? []`, `// {}`, redundant guards on values the ty… | Error-masking and "defensive" code       | partial     | minor            | no           |
| AI-18 | Silent fallbacks at parse and config boundaries                                            | Error-masking and "defensive" code       | judgement   | blocker          | yes          |
| AI-19 | Sleeps, retries and timeout bumps as "fixes" for races and flaky tests                     | Error-masking and "defensive" code       | partial     | major            | no           |
| AI-20 | Reinventing an existing in-repo helper                                                     | Structural agent smells                  | partial     | major            | yes          |
| AI-21 | Copy-paste variants inside one change                                                      | Structural agent smells                  | tool        | minor            | no           |
| AI-22 | Speculative generality: options bags, factories, registries, strategies and config knobs … | Structural agent smells                  | partial     | minor            | yes          |
| AI-23 | Pass-through layering ("enterprise" wrappers with no behaviour)                            | Structural agent smells                  | judgement   | minor            | no           |
| AI-24 | Comments that restate the code or narrate the change                                       | Structural agent smells                  | judgement   | minor            | no           |
| AI-25 | Dead code and leftover scaffolding: unused symbols, debug logging, temp scripts, commente… | Structural agent smells                  | tool        | minor            | no           |
| AI-26 | Placeholder or stub shipped as done                                                        | Structural agent smells                  | partial     | blocker          | no           |
| AI-27 | Special-casing test inputs / hard-coding outputs so tests pass                             | Structural agent smells                  | judgement   | blocker          | no           |
| AI-28 | Hallucinated or unvetted packages (slopsquatting surface)                                  | Structural agent smells                  | partial     | blocker          | yes          |
| AI-29 | Hallucinated or mis-versioned APIs, options and config keys                                | Structural agent smells                  | partial     | major            | no           |
| AI-30 | Outdated API usage from training-data vintage                                              | Structural agent smells                  | partial     | major            | no           |
| AI-31 | Inconsistent conventions within one change                                                 | Structural agent smells                  | partial     | minor            | no           |
| AI-32 | Large unfocused diffs, shotgun edits and drive-by "improvements"                           | Structural agent smells                  | judgement   | major            | no           |
| AI-33 | Security omissions: missing authorisation, validation and taint handling                   | Structural agent smells                  | partial     | blocker          | yes          |
| AI-34 | Naive loops: N+1 queries, per-item I/O, sequential awaits, re-reading the world            | Structural agent smells                  | partial     | major            | no           |
| AI-35 | Magic numbers and strings (in code and especially in generated tests)                      | Structural agent smells                  | partial     | minor            | no           |
| AI-36 | Resource leaks and ignored return values / API contracts                                   | Structural agent smells                  | partial     | major            | no           |
| AI-37 | Tests derived from the implementation (the misguidance effect)                             | Test-quality theatre and test tampering  | partial     | major            | no           |
| AI-38 | Tests that assert the mock (over-mocking, interaction-only tests)                          | Test-quality theatre and test tampering  | partial     | major            | no           |
| AI-39 | Tautological, assertion-free and weak-matcher tests                                        | Test-quality theatre and test tampering  | tool        | major            | no           |
| AI-40 | Weakening or editing tests to make them pass                                               | Test-quality theatre and test tampering  | partial     | blocker          | no           |
| AI-41 | Snapshot spam                                                                              | Test-quality theatre and test tampering  | partial     | minor            | no           |
| AI-42 | Classic test smells at generated volume (Assertion Roulette, Lazy/Eager tests, conditiona… | Test-quality theatre and test tampering  | partial     | minor            | no           |
| AI-43 | Completion claims not backed by evidence in the diff                                       | Process-shaped red flags                 | judgement   | major            | no           |

<!-- END GENERATED INDEX -->

Domain prefix: `AI-`. Second-iteration file: it deliberately does NOT restate the framework mechanics already
owned by `react.md` (REACT-_), `typescript.md` (TS-_), `nodejs.md` (NODE-_), `nestjs.md` (NEST-_),
`nextjs.md` (NEXT-_), `reactNative.md` (RN-_) and `python.md` (PY-*). Each entry here is about the
**agent idiom** — the specific, recognisable shape a coding agent produces, why it produces it, and the exact
**legitimate-use allow-list** that separates a real finding from a manufactured one. Where a sibling entry
owns the mechanism it is cross-referenced by ID.

All sources opened 2026-09-13 unless stated. Numbers were taken from raw page / PDF text (curl + text
extraction or `pypdf`), not from summaries, except where marked `UNVERIFIED`. One methodological warning the
agent should inherit: a summarising fetch of arXiv 2601.17581 produced findings ("lower rates of test file
modifications", "reduced comment updates") that the paper's own abstract does not contain. **Never cite an
AI-generated summary of a study as the study.**

## Scope & sources consulted

| Source                                                                                                                                                                                                                                                                                              | Version / date                                                                                     | URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitClear — _The Maintainability Gap: 2026 AI Code Quality Research_ (623M changes, 2023–2026)                                                                                                                                                                                                       | page opened 2026-09-13 (page labels itself "January 2026 research"; covered by LeadDev 2026-07-07) | https://www.gitclear.com/the_ai_code_quality_maintainability_gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| LeadDev — "Code maintainability plummets in the AI coding era" (source of GitClear's _definition_ of error-masking, quoting Bill Harding)                                                                                                                                                           | 2026-07-07                                                                                         | https://leaddev.com/ai/code-maintainability-plummets-in-the-ai-coding-era                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GitClear — _AI Copilot Code Quality: 2025_ (211M changed lines, 2020–2024)                                                                                                                                                                                                                          | 2025 (devclass coverage 2025-02-20)                                                                | https://www.gitclear.com/ai_assistant_code_quality_2025_research · https://gitclear-public.s3.us-west-2.amazonaws.com/GitClear-AI-Copilot-Code-Quality-2025.pdf                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Sonar — _The Coding Personalities of Leading LLMs_ (expanded edition incl. GPT-5), PDF tables 2–6                                                                                                                                                                                                   | October 2025 PDF; GPT-5 blog 2025-08-27                                                            | https://www.sonarsource.com/the-coding-personalities-of-leading-llms.pdf · https://www.sonarsource.com/blog/the-coding-personalities-of-leading-llms-gpt-5-update/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Veracode — 2025 GenAI Code Security Report (blog + Help Net Security coverage quoting the report)                                                                                                                                                                                                   | 2025-07-30                                                                                         | https://www.veracode.com/blog/genai-code-security-report/ · https://www.helpnetsecurity.com/2025/08/07/create-ai-code-security-risks/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CodeRabbit — _State of AI vs Human Code Generation_ (470 PRs)                                                                                                                                                                                                                                       | 2025-12-17                                                                                         | https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Spracklen et al. — _We Have a Package for You!_ (package hallucination), USENIX Security 2025                                                                                                                                                                                                       | arXiv 2406.10279 v3, 2025-03-02                                                                    | https://arxiv.org/abs/2406.10279 · https://arxiv.org/html/2406.10279v3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Fu et al. — _Security Weaknesses of Copilot-Generated Code in GitHub Projects_ (TOSEM)                                                                                                                                                                                                              | arXiv 2310.02059 v3                                                                                | https://arxiv.org/html/2310.02059v3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Perry et al. — _Do Users Write More Insecure Code with AI Assistants?_ (CCS '23)                                                                                                                                                                                                                    | arXiv 2211.03622                                                                                   | https://arxiv.org/abs/2211.03622                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _Human-Written vs. AI-Generated Code: A Large-Scale Study of Defects, Vulnerabilities, and Complexity_ (ISSRE 2025)                                                                                                                                                                                 | arXiv 2508.21634, 2025-08-29                                                                       | https://arxiv.org/abs/2508.21634                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _Investigating The Smells of LLM Generated Code_                                                                                                                                                                                                                                                    | arXiv 2510.03029, 2025-10-03                                                                       | https://arxiv.org/abs/2510.03029                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _On the Diffusion of Test Smells in LLM-Generated Unit Tests_ (TsDetect)                                                                                                                                                                                                                            | arXiv 2410.10628 v1 (TOSEM acceptance later; figures below are v1's)                               | https://arxiv.org/html/2410.10628v1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| _Evaluating and Mitigating the Misguidance Effect of Buggy Code in LLM-Generated Unit Tests_ (ISSTA 2026)                                                                                                                                                                                           | arXiv 2607.22883 v1                                                                                | https://arxiv.org/abs/2607.22883                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _ImpossibleBench: Measuring LLMs' Propensity of Exploiting Test Cases_                                                                                                                                                                                                                              | arXiv 2510.20270 v1, 2025-10-23                                                                    | https://arxiv.org/html/2510.20270v1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| METR — _Recent Frontier Models Are Reward Hacking_                                                                                                                                                                                                                                                  | 2025-06-05                                                                                         | https://metr.org/blog/2025-06-05-recent-reward-hacking/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| _Agentic Refactoring: An Empirical Study of AI Coding Agents_                                                                                                                                                                                                                                       | arXiv 2511.04824, 2025-11-06                                                                       | https://arxiv.org/abs/2511.04824                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _How do Agents Refactor: An Empirical Study_                                                                                                                                                                                                                                                        | arXiv 2601.20160                                                                                   | https://arxiv.org/abs/2601.20160                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _How AI Coding Agents Modify Code: A Large-Scale Study of GitHub Pull Requests_ (MSR '26)                                                                                                                                                                                                           | arXiv 2601.17581 v3                                                                                | https://arxiv.org/pdf/2601.17581                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _AI-Generated Smells: An Analysis of Code and Architecture in LLM- and Agent-Driven Development_                                                                                                                                                                                                    | arXiv 2605.02741 v1, 2026-05-04                                                                    | https://arxiv.org/abs/2605.02741                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _LLMs Meet Library Evolution: Evaluating Deprecated API Usage in LLM-based Code Completion_ (ICSE 2025)                                                                                                                                                                                             | arXiv 2406.09834                                                                                   | https://arxiv.org/abs/2406.09834                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _On Mitigating Code LLM Hallucinations with API Documentation_ (CloudAPIBench)                                                                                                                                                                                                                      | arXiv 2407.09726                                                                                   | https://arxiv.org/abs/2407.09726                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CVE-2025-48757 (Lovable-generated apps, missing Supabase RLS) — discoverer's CVE gist                                                                                                                                                                                                               | 2025                                                                                               | https://gist.github.com/lhchavez/625ee42a6c408a850d35e50f8e649de9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Anthropic — Claude prompting best practices ("Overeagerness", "Avoid focusing on passing tests and hardcoding", "Minimizing hallucinations in agentic coding")                                                                                                                                      | live docs                                                                                          | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| OpenAI — Codex Prompting Guide ("Tight error handling", "Keep type safety", "Reuse: DRY/search first")                                                                                                                                                                                              | cookbook notebook, `main`                                                                          | https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide · https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/gpt-5/codex_prompting_guide.ipynb                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| react.dev — Referencing Values with Refs; useRef; Manipulating the DOM with Refs; useImperativeHandle; forwardRef; useLayoutEffect; flushSync; useEffectEvent; useCallback; memo; useMemo; React Compiler intro; You Might Not Need an Effect; Passing Data Deeply with Context; Activity; useState | live docs (React 19.2/19.3)                                                                        | https://react.dev/learn/referencing-values-with-refs · https://react.dev/reference/react/useRef · https://react.dev/learn/manipulating-the-dom-with-refs · https://react.dev/reference/react/useImperativeHandle · https://react.dev/reference/react/forwardRef · https://react.dev/reference/react/useLayoutEffect · https://react.dev/reference/react-dom/flushSync · https://react.dev/reference/react/useEffectEvent · https://react.dev/reference/react/useCallback · https://react.dev/reference/react/memo · https://react.dev/learn/react-compiler/introduction · https://react.dev/learn/you-might-not-need-an-effect · https://react.dev/learn/passing-data-deeply-with-context · https://react.dev/reference/react/Activity · https://react.dev/reference/react/useState |
| react.dev lint pages — `refs`, `set-state-in-effect`                                                                                                                                                                                                                                                | eslint-plugin-react-hooks 7.1.1 (per react.md)                                                     | https://react.dev/reference/eslint-plugin-react-hooks/lints/refs · https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| React WG — "Update on the removal of the setState-on-unmounted warning" (discussion #82)                                                                                                                                                                                                            | 2021-08-19                                                                                         | https://github.com/reactwg/react-18/discussions/82                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| React (legacy blog) — "isMounted is an Antipattern"                                                                                                                                                                                                                                                 | 2015-12-16                                                                                         | https://legacy.reactjs.org/blog/2015/12/16/ismounted-antipattern.html                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| React 19 Upgrade Guide (removed/deprecated APIs)                                                                                                                                                                                                                                                    | 2024-04-25                                                                                         | https://react.dev/blog/2024/04/25/react-19-upgrade-guide                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| React Native — Animations (`useRef(new Animated.Value(0)).current`)                                                                                                                                                                                                                                 | live                                                                                               | https://reactnative.dev/docs/animations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| typescript-eslint — `no-unnecessary-condition`, `no-unnecessary-type-assertion`                                                                                                                                                                                                                     | v8.70.0 (per typescript.md)                                                                        | https://typescript-eslint.io/rules/no-unnecessary-condition/ · https://typescript-eslint.io/rules/no-unnecessary-type-assertion/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ESLint — `no-useless-catch`, `no-empty`, `no-magic-numbers`, "Configure rules" (`reportUnusedDisableDirectives`, `-- description`)                                                                                                                                                                  | live docs                                                                                          | https://eslint.org/docs/latest/rules/no-useless-catch · https://eslint.org/docs/latest/rules/no-empty · https://eslint.org/docs/latest/rules/no-magic-numbers · https://eslint.org/docs/latest/use/configure/rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `@eslint-community/eslint-plugin-eslint-comments` rule list                                                                                                                                                                                                                                         | live docs                                                                                          | https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| SonarJS rules README (rule key ↔ S-number, `recommended` column)                                                                                                                                                                                                                                    | `master`, opened 2026-09-13 (npm `eslint-plugin-sonarjs@4.2.0`)                                    | https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `@vitest/eslint-plugin` README (packaged)                                                                                                                                                                                                                                                           | 1.6.27                                                                                             | https://github.com/vitest-dev/eslint-plugin-vitest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `eslint-plugin-jest` README (packaged)                                                                                                                                                                                                                                                              | 29.16.6                                                                                            | https://github.com/jest-community/eslint-plugin-jest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Knip — Issue Types                                                                                                                                                                                                                                                                                  | live docs                                                                                          | https://knip.dev/reference/issue-types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| jscpd v5 (Rust engine) README + `docs/rust.md` CLI reference                                                                                                                                                                                                                                        | `master`                                                                                           | https://github.com/kucherenko/jscpd · https://github.com/kucherenko/jscpd/blob/master/docs/rust.md                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Ruff rules registry (codes cross-checked from `python.md`'s scrape)                                                                                                                                                                                                                                 | ruff 0.16.7                                                                                        | https://docs.astral.sh/ruff/rules/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| mypy error codes (`ignore-without-code`, `--warn-unused-ignores`)                                                                                                                                                                                                                                   | mypy 2.3.1 (per python.md)                                                                         | https://mypy.readthedocs.io/en/stable/error_code_list2.html                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Playwright `page.waitForTimeout` ("Discouraged")                                                                                                                                                                                                                                                    | live                                                                                               | https://playwright.dev/docs/api/class-page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Jest — Snapshot Testing, "Best Practices"                                                                                                                                                                                                                                                           | live                                                                                               | https://jestjs.io/docs/snapshot-testing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Zod API — `.catch()`                                                                                                                                                                                                                                                                                | Zod 4 docs                                                                                         | https://zod.dev/api                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Google Engineering Practices — "What to look for" (comments), "Small CLs"                                                                                                                                                                                                                           | live                                                                                               | https://google.github.io/eng-practices/review/reviewer/looking-for.html · https://google.github.io/eng-practices/review/developer/small-cls.html                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| _Software Engineering at Google_, ch. 13 Test Doubles                                                                                                                                                                                                                                               | online edition                                                                                     | https://abseil.io/resources/swe-book/html/ch13.html                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Stryker — What is mutation testing?                                                                                                                                                                                                                                                                 | live                                                                                               | https://stryker-mutator.io/docs/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Fowler — bliki "Yagni"; Refactoring catalog (2nd ed. names)                                                                                                                                                                                                                                         | live                                                                                               | https://martinfowler.com/bliki/Yagni.html · https://refactoring.com/catalog/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Sandi Metz — "The Wrong Abstraction"                                                                                                                                                                                                                                                                | 2016-01-20                                                                                         | https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## The one idea that organises this file

Coding agents optimise for _the observable signal in front of them_: the compiler goes green, the lint error
disappears, the test passes, the warning stops, the reviewer sees plausible code. Every smell below is a
**local compensation that makes that signal go away without resolving the cause** — a ref instead of a
state model, a cast instead of a type, a catch instead of an error contract, a new helper instead of a search,
an edited test instead of a fixed implementation. Two consequences for the reviewing agent:

1. **The diff that silences a signal is the finding, not the signal.** When a change adds `as`, `!`,
   `eslint-disable`, `?? []`, `catch {}`, `useRef`, `setTimeout(…, 0)`, `.skip`, or a loosened matcher, ask
   what error, warning or failure it made disappear, and whether that failure was telling the truth.
2. **Every escape hatch has a documented, narrow allow-list.** Judge against the allow-list, not against
   frequency. An escape hatch inside its allow-list is correct code and must not be flagged — the
   "Not a finding when" field is the most important field in this file.

## Empirical evidence ledger — what is measurably over-represented

Read the caveats. None of these sources proves causation for a specific diff; together they tell the agent
**where to look first**.

| #   | Source (date)                                | Sample                                                               | Finding (exact figures)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Caveat                                                                                                                                                                                                                                                                                                              | Smell classes → entries                         |
| --- | -------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| E1  | GitClear 2026                                | 623M changes, 2023–2026                                              | Block duplication (≥5 repeated meaningful lines) 40.3 → 73.0 per million changed lines (+81%); moved code 21% (2022) → 13% (2023) → 3.8% (2026 YTD); copy/paste 9.4% (2022) → 15.7% (2026 H1), "~5x greater likelihood" to paste than refactor; cross-file method calls 343 → 223 per thousand changed lines (−35%); "long-term update" (code untouched ≥12 months) 1.7% → 0.46% (−74%); vs 2023 baseline: within-commit copy/paste +41%, error-masking +47%, two-week churn +15%.                                                                                                                                                                                                                                                                                                                                                                                   | Industry-wide trend over a period of rising AI adoption, not per-line AI attribution. The page gives no definition of error-masking; LeadDev (2026-07-07) quotes GitClear's definition: "the density of rescue/catch blocks, safe-navigation operators, and stubbed methods that squelch unexpected-input signals." | AI-20, AI-21, AI-16, AI-17, AI-26               |
| E2  | GitClear 2025                                | 211M changed lines, 2020–2024                                        | Copy/paste 8.3% (2021) → 12.3% (2024); refactoring-associated changes 25% (2021) → <10% (2024); 2024 first year copy/paste exceeded moved code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Same attribution caveat.                                                                                                                                                                                                                                                                                            | AI-20, AI-21                                    |
| E3  | Sonar, Oct 2025                              | >4,400 Java tasks, 6 LLMs, SonarQube Enterprise                      | Code smells are 89.90%–94.87% of all issues per model. Among smells, "Dead / unused / redundant code" = 14.7% (GPT-5-minimal) to 42.74% (OpenCoder-8B); "Design / framework best practices" 12.44–22.26%; "Deprecation / obsolete" 0.82–4.01%. Bugs: "Control-flow mistake" 14.83–48.15%; "API contract violation" 8.64–19.35%; "Exception handling" 9.18–16.75%; "Resource management / leak" 7.41–15.07%; "Concurrency / threading" 1.26–20% (GPT-5-minimal highest). Vulnerabilities: "Path-traversal & Injection" 20–34.04%; "Hard-coded credentials" 5–29.85%; "Cryptography misconfiguration" 19.64–24.82%. Comment density 2.10% (GPT-5-minimal) to 16.40% (Claude 3.7 Sonnet). LOC for the same task set 120,288 (OpenCoder-8B) to 490,010 (GPT-5-minimal). Claude 3.7 → Sonnet 4: pass rate +6.3%, "% of Vulnerabilities that are BLOCKER" 56.03% → 59.57%. | Java only; benchmark tasks, not production repos; no human baseline.                                                                                                                                                                                                                                                | AI-25, AI-30, AI-33, AI-36, AI-24, AI-12        |
| E4  | Veracode, 2025-07-30                         | 80 tasks × >100 LLMs; Java, Python, C#, JS                           | 45% of samples introduced OWASP Top-10 vulnerabilities; Java 72%, C# 45%, JS 43%, Python 38%; CWE-80 XSS not defended in 86%; CWE-117 log injection 88%; "Security performance remained flat, regardless of model size".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Prompts offered a secure/insecure choice; synthetic tasks.                                                                                                                                                                                                                                                          | AI-33                                           |
| E5  | CodeRabbit, 2025-12-17                       | 470 OSS PRs (320 AI-co-authored, 150 human)                          | ~1.7× more issues (10.83 vs 6.45/PR); logic/correctness +75%; readability >3×; error handling/exception-path gaps nearly 2×; security up to 2.74×; excessive I/O ~8×; concurrency/dependency ~2×; formatting 2.66×; naming inconsistencies nearly 2×.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Vendor study; AI co-authorship inferred from "signals", which the report itself flags.                                                                                                                                                                                                                              | AI-16, AI-31, AI-34, AI-33                      |
| E6  | Spracklen et al., USENIX Sec 2025            | 576,000 samples, 16 LLMs, Python + JS                                | Hallucinated packages ≥5.2% (commercial) and 21.7% (open-source) on average; 205,474 unique hallucinated names; re-running 500 hallucinating prompts 10×: 43% repeated in all 10, 39% never repeated; 81% of hallucinated packages generated by only one model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Package names only; not whether they were registered/malicious.                                                                                                                                                                                                                                                     | AI-28                                           |
| E7  | Fu et al., TOSEM                             | 733 real GitHub snippets (Copilot 672, CodeWhisperer 38, Codeium 23) | Weaknesses in 29.5% of Python and 24.2% of JS snippets; 43 CWEs; top: CWE-330 insufficient randomness 18.15%, CWE-94 code injection 9.87%, CWE-79 XSS 9.55%, CWE-78 OS command injection 6.21%, CWE-22 4.62%, CWE-772 missing resource release 4.62%, CWE-89 4.30%, CWE-259 hard-coded password 2.55%; Copilot Chat fixed 55.5% with an enhanced prompt carrying analyser warnings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Snippets self-identified as AI-generated.                                                                                                                                                                                                                                                                           | AI-33, AI-36                                    |
| E8  | Perry et al., CCS '23                        | user study                                                           | AI-assisted participants "wrote significantly less secure code" **and** "were more likely to believe they wrote secure code".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | codex-davinci-002 era.                                                                                                                                                                                                                                                                                              | AI-33, AI-43                                    |
| E9  | ISSRE 2025 (2508.21634)                      | >500k Python/Java samples                                            | AI code "more prone to unused constructs and hardcoded debugging", "more high-risk security vulnerabilities", "generally simpler and more repetitive"; human code had more structural complexity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Algorithmic samples.                                                                                                                                                                                                                                                                                                | AI-25, AI-21                                    |
| E10 | 2510.03029                                   | Java, 4 LLMs vs reference solutions (PMD, Checkstyle, DesigniteJava) | Smell increase vs professional solutions: Falcon 42.28%, Gemini Pro 62.07%, ChatGPT 65.05%, Codex 84.97% (avg 63.34%); 73.35% implementation smells, 21.42% design smells; increase larger for complex tasks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Older models.                                                                                                                                                                                                                                                                                                       | AI-22, AI-23                                    |
| E11 | Test smells (2410.10628 v1)                  | 20,500 LLM suites (4 models) vs 780,144 human suites, TsDetect       | Magic Number Test most frequent for every model, 85.42% (Mistral 7B) to 99.85% (GPT-3.5); Assertion Roulette 20.94% (guided ToT) to 54.77% (zero-shot); Unknown Test 47–51% for GPT-3.5/GPT-4; the authors note LLM smell patterns "often mirror those in human-written tests".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Java; figures from v1.                                                                                                                                                                                                                                                                                              | AI-42, AI-39, AI-35                             |
| E12 | Misguidance effect (ISSTA 2026)              | —                                                                    | Prompting with buggy code "significantly increases 'misguided tests' that assert incorrect behavior while simultaneously suppressing the generation of effective, bug-finding tests"; replacing the code with a specification docstring reduces it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                   | AI-37                                           |
| E13 | ImpossibleBench (2510.20270)                 | LiveCodeBench/SWE-bench variants whose tests contradict the spec     | GPT-5 cheats in 76% of Oneoff-SWEbench tasks; four strategies: **Modify Test Cases** ("despite being explicitly instructed not to"), **Overload Comparison Operators**, **Record Extra States** (call counting), **Special Casing**; "OpenAI models perform special-casing most of the time, while Claude models and Qwen3-Coder mostly modify the test cases"; feedback loops raise cheating 33% → 38% on Conflicting-SWEbench; an abort option cut GPT-5 54% → 9% (much weaker for Claude Opus 4.1); prompt wording moved GPT-5/o3 from >85% to 1%.                                                                                                                                                                                                                                                                                                                | Adversarial benchmark by construction.                                                                                                                                                                                                                                                                              | AI-27, AI-40                                    |
| E14 | METR, 2025-06-05                             | RE-Bench / HCAST runs                                                | Reward hacking in 30.4% of RE-Bench runs (39/128) vs 0.7% of HCAST (8/1,087); examples: stub evaluator that "always return[s] a perfect score", overriding `==`, overwriting the timing function, reading the answer off the call stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Research tasks with visible scorers.                                                                                                                                                                                                                                                                                | AI-27, AI-26, AI-40                             |
| E15 | Agentic refactoring (2511.04824; 2601.20160) | 15,451 refactorings / 12,256 PRs; 86 projects per group              | Agents target refactoring in 26.1% of commits, dominated by Change Variable Type 11.8%, Rename Parameter 10.4%, Rename Variable 8.5%; small structural gains (Class LOC median Δ −15.25) but no consistent reduction of known smells; 2601.20160: agent refactorings "dominated by annotation changes", Cursor the only agent with a significant increase in smells.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Java.                                                                                                                                                                                                                                                                                                               | AI-23, AI-32                                    |
| E16 | Deprecated API usage (ICSE 2025)             | 7 LLMs, 145 API mappings, 8 Python libs, 28,125 prompts              | LLMs "struggle to use correct and up-to-date APIs"; proposes REPLACEAPI / INSERTPROMPT mitigations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Exact deprecated-usage rates not read (abstract only).                                                                                                                                                                                                                                                              | AI-30                                           |
| E17 | CloudAPIBench (2407.09726)                   | cloud SDK APIs by public frequency                                   | GPT-4o produced only 38.58% valid invocations of **low-frequency** APIs; documentation retrieval raised that to 47.94% but hurt high-frequency APIs by 39.02% with a sub-optimal retriever.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | AWS/Azure SDKs.                                                                                                                                                                                                                                                                                                     | AI-29                                           |
| E18 | CVE-2025-48757                               | Lovable-generated apps                                               | "An insufficient database Row-Level Security policy in Lovable … allows remote unauthenticated attackers to read or write to arbitrary database tables of generated sites"; CVSS base 8.26. Secondary sources report 170 of 1,645 scanned apps exposed — `UNVERIFIED` against the discoverer's post (Cloudflare-blocked).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Platform + generator defaults, not one model.                                                                                                                                                                                                                                                                       | AI-33                                           |
| E19 | Vendor guidance (Anthropic; OpenAI)          | —                                                                    | Anthropic: "Claude Opus 4.5 and Claude Opus 4.6 have a tendency to overengineer by creating extra files, adding unnecessary abstractions, or building in flexibility that wasn't requested"; "can sometimes focus too heavily on making tests pass at the expense of more general solutions". OpenAI Codex guide: "do not add broad try/catch blocks or success-shaped fallbacks"; "avoid unnecessary casts (`as any`, `as unknown as ...`)"; "search for prior art and reuse or extract a shared helper instead of duplicating".                                                                                                                                                                                                                                                                                                                                    | The model vendors themselves name these failure modes — strongest evidence they are systematic, not anecdotal.                                                                                                                                                                                                      | AI-22, AI-27, AI-16, AI-12, AI-20, AI-24, AI-32 |

**Synthesis — the over-represented classes, in the order the evidence supports them:** (1) duplication /
reinvention instead of reuse (E1, E2, E9, E19); (2) dead, unused, redundant code and leftover debugging
(E3, E9); (3) error-masking and success-shaped fallbacks (E1, E5, E19); (4) security omissions, especially
taint-flow ones — injection, XSS, log injection, hard-coded secrets, missing access control (E3, E4, E7, E18);
(5) test theatre and test tampering (E11–E14); (6) resource leaks and ignored API contracts (E3, E7);
(7) readability/naming/format inconsistency (E5); (8) over-engineering and verbosity, which is
**model-specific** — Sonar measured a 4× LOC spread and an 8× comment-density spread across models for the
same tasks (E3), so "too many comments" or "too much code" is not a universal AI tell. Refactoring that _does_
happen is shallow (renames, type changes, annotations — E15).

---

## React escape hatches (the agent's favourite compensations)

### AI-01 `useRef` used as state or as a re-render dodge

- **Signal:** a value that is shown, compared, or branched on in JSX lives in `useRef`; `ref.current` read in
  the component body; the change narrative or a comment says "use a ref to avoid re-renders" / "so it doesn't
  trigger a re-render"; `forceUpdate`-style `useReducer(x => x + 1)` or `setTick` added next to a ref so the
  UI "catches up"; a `useState` converted to `useRef` in a diff whose motivation was a perf or lint complaint.
  rg: `rg -nP '\b\w+Ref\.current\b' --glob '*.tsx'` then check whether any hit is outside an event handler,
  Effect, or ref callback.
- **Tool coverage:** partial — `react-hooks:refs` (eslint-plugin-react-hooks 7.1.1, `recommended`) flags
  reading/writing `ref.current` during render, but "only applies these rules to values it knows are refs":
  returned from `useRef()`/`createRef()`, an identifier named `ref` or ending in `Ref`, or passed through a JSX
  `ref` prop (then followed through assignments/destructuring). Left for judgement: a ref stored under
  another name or inside an object/array; refs read in handlers whose _result_ is then rendered via a later
  unrelated state update (UI coincidentally correct); a ref chosen where state was needed but never read
  during render (the stale-UI bug appears only after the next unrelated render). Full mechanism: REACT-15.
- **Why it hurts:** reliability/maintainability — "setting `ref.current` does not trigger a re-render.
  Information that's used for rendering should be state instead"; "Since React doesn't know when `ref.current`
  changes, even reading it while rendering makes your component's behavior difficult to predict." Failure mode:
  UI that is correct in the demo and stale after the next interaction; React Compiler cannot reason about it.
- **Severity:** major — raise to blocker when the ref gates a user-visible or security-relevant decision
  (disabled state, permission, submitted-once guard shown in UI); lower to minor if the value truly never
  reaches render and only the naming is misleading.
- **Remediation:** Replace the ref with state (or _derive_ it — "Replace Derived Variable with Query"); if
  re-render cost was the real complaint, fix structure (move state down, pass JSX as `children`, split the
  component) or let React Compiler memoise. Trap: swapping to state and then synchronising it with an Effect
  (REACT-01) — derive during render instead.
- **Not a finding when (React's own allow-list):** the value is not needed to calculate the JSX — "Storing
  timeout IDs", "Storing and manipulating DOM elements", "Storing other objects that aren't necessary to
  calculate the JSX"; the ref is read/written only in event handlers or Effects; lazy one-time initialisation
  during render, `if (!ref.current) ref.current = new Thing()` / `if (ref.current === null) ref.current =
expensiveComputation()` ("The only exception"); a React Native `useRef(new Animated.Value(0)).current`
  (the pattern the RN Animations docs themselves use — Reanimated code should use shared values instead,
  RN-10); an instance of a non-React object (a map/chart/editor/WebSocket client) held for imperative calls.
- **Architecture:** yes when many refs coordinate application logic — the docs: "If much of your application
  logic and data flow relies on refs, you might want to rethink your approach." Root cause is usually a
  missing state model (should be a reducer/statechart) or an external system that should sit behind
  `useSyncExternalStore`; escalate to the architecture agent if the ref web spans components.
- **Sources:** https://react.dev/learn/referencing-values-with-refs · https://react.dev/reference/react/useRef ·
  https://react.dev/reference/eslint-plugin-react-hooks/lints/refs · https://reactnative.dev/docs/animations

### AI-02 "Latest value" ref (`callbackRef.current = callback`)

- **Signal:** `const onChangeRef = useRef(onChange); onChangeRef.current = onChange;` in the body; or
  `useEffect(() => { latestRef.current = value }, [value])` / `useLayoutEffect` variant; custom `useLatest`,
  `useEvent`, `useStableCallback`, `useCallbackRef` hooks added to the repo; an Effect that reads
  `xRef.current` so `x` can be omitted from the dependency array. Tested rg:
  `rg -nP '^\s*\w+Ref\.current\s*=\s*[\w.]+;?\s*$'` (render-time write) and
  `rg -nP 'useRef(<[^>]*>)?\((?!null\b|undefined\b|false\b|true\b|\d|\x27|"|\[\]|\{\}|\))[a-z][\w.]*\)'`
  (a ref initialised from a prop/variable — the mirror's first half).
- **Tool coverage:** partial — `react-hooks:refs` catches the render-time write (`ref.current = value`
  in the body is its canonical ❌ example). Not caught: the Effect/LayoutEffect-write variant (legal per the
  lint), a hand-rolled `useLatest` in a library file, and the _reason_ for the pattern (dodging
  `exhaustive-deps`, REACT-09).
- **Why it hurts:** the render-time write races under concurrent rendering (a discarded render writes the
  ref); the Effect variant is one commit late, so a callback fired before the Effect runs sees the previous
  value; either way it hides a real dependency from `exhaustive-deps` and from reviewers.
- **Severity:** major for render-time writes; minor for an Effect-write inside a well-named, tested,
  single custom hook that predates React 19.2.
- **Remediation:** Effect-scoped "latest value" → `useEffectEvent` (stable in React 19.2): it "always
  accesses the latest committed values from render at the time of the call" and is excluded from deps. A
  callback passed to a child → just pass the prop (React Compiler / `memo` handle identity) or lift the
  logic into an event handler. Trap: `useEffectEvent` "can only be called from inside Effects or other Effect
  Events … Do not call them during rendering or pass them to other components or Hooks", and "Do not use
  `useEffectEvent` to avoid specifying dependencies in your Effect's dependency array. This hides bugs" —
  replacing the ref with an Effect Event for a _reactive_ value is the same bug with a newer name (REACT-37).
- **Not a finding when:** the codebase is on React < 19.2 and the pattern is encapsulated once in a shared,
  documented hook whose ref is written in an Effect/layout Effect and read only in event callbacks
  subscribed to a non-React source; a library that must support older React majors; the value is read by an
  imperative third-party callback (e.g. a map SDK listener registered once) that React does not call.
- **Architecture:** no (local), unless the hook is exported from a shared package — then it is a public API
  that locks consumers into the idiom.
- **Sources:** https://react.dev/reference/react/useEffectEvent · https://react.dev/reference/eslint-plugin-react-hooks/lints/refs ·
  https://react.dev/blog/2025/10/01/react-19-2

### AI-03 `isMounted` / `didUnmount` / `cancelled` refs to silence "update on unmounted component"

- **Signal:** `const isMountedRef = useRef(false)` (or `mountedRef`, `unmountedRef`, `isActive`) toggled in a
  `useEffect(() => { ref.current = true; return () => { ref.current = false } }, [])`, then `if
(isMountedRef.current) setX(...)` after an `await` in an event handler; `useIsMounted` hook. rg:
  `rg -n 'is(Mounted|Unmounted)Ref|\bmountedRef\b|useIsMounted|isMounted\s*=\s*useRef'`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** it fixes a warning React removed in 18 and actively breaks newer behaviour. The React
  team: "this fix does not actually solve any 'memory leaks'. It just suppresses the warning"; "The workaround
  is worse than the original problem"; with state preserved for hidden UI, "You'll 'miss' the
  `setPending(false)` call because `isMountedRef.current` is `false` while the component is in a hidden tab."
  That feature shipped: `<Activity mode="hidden">` "will also destroy their Effects" and later "reveal the
  children with their previous state restored" — so the ref reads `false` for a component that is alive.
  The React team also observed the warning "pushes people towards moving mutations (like POST) into effects",
  a second smell (REACT-04). The 2015 post already called `isMounted` "an antipattern" that "defeats the
  purpose of the warning".
- **Severity:** major (lost state updates under `<Activity>` / hidden routes); minor in code that can never
  render under Activity (still dead weight).
- **Remediation:** delete the check in event-handler async flows ("let you remove a bunch of `isMounted`
  checks"); for Effect-owned async work use the Effect's own cleanup (`let ignore = false; … return () => {
ignore = true }` or `AbortController`) — the race-condition pattern in "You Might Not Need an Effect"; for
  data fetching use the framework/query cache (REACT-06, REACT-21). Trap: converting to an `ignore` flag in an
  Effect while _also_ moving a user-triggered mutation into that Effect.
- **Not a finding when:** the flag is a local `let ignore` / `AbortController` scoped to one Effect run and
  flipped in that Effect's cleanup (that is the documented pattern, not a mount ref); a genuine subscription
  whose missing `unsubscribe` would leak ("if you forget the unsubscribe call in the effect cleanup, you'll
  have a memory leak") — fix the cleanup, don't add a mount flag.
- **Architecture:** sometimes — a codebase full of mount refs usually fetches in components; escalate the
  "server state has no cache layer" root cause.
- **Sources:** https://github.com/reactwg/react-18/discussions/82 ·
  https://legacy.reactjs.org/blog/2015/12/16/ismounted-antipattern.html · https://react.dev/reference/react/Activity ·
  https://react.dev/learn/you-might-not-need-an-effect

### AI-04 Ref as a data cache / mirror of props, state or server data

- **Signal:** `const dataRef = useRef<User[] | null>(null)` filled from a fetch and read later; `cacheRef`,
  `prevDataRef`, `itemsRef` holding API results; a ref kept "in sync" with a prop or state value so a callback
  can read it; `Map`/`Set` in a ref used as a memo table for rendered data.
- **Tool coverage:** none for the design; `react-hooks:refs` only if the cached value is read during render.
- **Why it hurts:** a second, untracked copy of state: no invalidation, no refetch, no loading/error states,
  no sharing between screens, stale after mutations; duplicated knowledge (the server is the source of truth).
- **Severity:** major; blocker when the cached data drives authorisation or money.
- **Remediation:** server data → the query cache the repo already uses (TanStack Query / SWR / RSC / router
  loaders); derived data → compute during render (`useMemo` only if measured slow); prop mirror → read the
  prop. Trap: moving the ref into a global store (Zustand/Redux) — same duplication with a wider blast radius
  (REACT-21).
- **Not a finding when:** a non-rendering, per-instance memo of an expensive _pure_ computation keyed by
  input and lazily initialised (the "objects not needed to calculate the JSX" case), a pending-request handle
  used for cancellation, or an explicit offline-first design where the local store is the source of truth.
- **Architecture:** yes — the root cause is usually "server state has no owner on the client". Escalate:
  data-layer boundary / caching contract.
- **Sources:** https://react.dev/learn/referencing-values-with-refs · https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state (via react.md REACT-21)

### AI-05 Ref as an instance-variable bag / "previous value" ref

- **Signal:** several refs (`countRef`, `hasSubmittedRef`, `prevPropsRef`, `firstRenderRef`) emulating class
  instance fields; `usePrevious(value)` implemented as a ref written in an Effect and compared in render;
  `isFirstRender` ref to skip an Effect on mount.
- **Tool coverage:** partial — `react-hooks:refs` flags the render-time comparison of `prevRef.current`;
  none for the design.
- **Why it hurts:** render output depends on history React doesn't track; `firstRender` refs break under
  Strict Mode's double-invoke and Activity remounts; the Effect-skipping ref usually means the Effect should
  not exist (it responds to an event, not a synchronisation).
- **Severity:** minor → major when the previous value decides what is rendered.
- **Remediation:** previous-value logic → state set during render, the documented "Storing information from
  previous renders" pattern, which itself says "In most cases, you don't need this" (derive, or reset with
  `key`); skip-on-mount → move the logic to the event handler that caused the change (REACT-04); flags like
  `hasSubmitted` that the UI shows → state or a statechart. Trap: replacing the ref with state and an Effect
  that copies it (REACT-02).
- **Not a finding when:** a submitted-once guard that is never rendered and only prevents a duplicate
  imperative call in a handler (e.g. double-tap on a native button) — still prefer disabling via state if the
  UI should reflect it; a ref counting frames/ticks for an animation loop driven by `requestAnimationFrame`.
- **Architecture:** no (component-local), unless it signals a missing state machine for a multi-step flow.
- **Sources:** https://react.dev/reference/react/useState (Storing information from previous renders) ·
  https://react.dev/learn/referencing-values-with-refs

### AI-06 Imperative handle / `forwardRef` reflex

- **Signal:** new `useImperativeHandle(ref, () => ({ open, close, reset, setValue, validate }))`; parents calling
  `childRef.current.open()`; new `forwardRef` in React 19 code; a "controller ref" pattern for forms/modals.
- **Tool coverage:** partial — `@eslint-react/no-forward-ref` (per REACT-16) for `forwardRef` in React 19;
  none for imperative-where-declarative-fits.
- **Why it hurts:** two-way hidden coupling; state lives in the child where the parent can't render from it;
  untestable through the UI. Agents reach for it because it compiles without restructuring the parent.
- **Severity:** minor for `forwardRef` alone (React 19: "`forwardRef` is no longer necessary … will be
  deprecated in a future release"); major for imperative state-changing APIs.
- **Remediation:** lift state and pass props ("instead of exposing an imperative handle like `{ open, close }`
  from a `Modal` component, it is better to take `isOpen` as a prop like `<Modal isOpen={isOpen} />`");
  React 19 `ref` as a regular prop. Trap: removing `forwardRef` from a package that still supports React 18
  consumers.
- **Not a finding when:** the handle exposes only behaviours "you can't express as props: for example,
  scrolling to a node, focusing a node, triggering an animation, selecting text"; wrapping a non-React widget;
  RN list refs for `scrollToIndex`/`scrollToOffset`; non-destructive DOM actions ("If you stick to
  non-destructive actions like focusing and scrolling, you shouldn't encounter any problems").
- **Architecture:** no (unless it is a design-system component's public API — then escalate as a contract).
- **Sources:** https://react.dev/reference/react/useImperativeHandle · https://react.dev/reference/react/forwardRef ·
  https://react.dev/learn/manipulating-the-dom-with-refs

### AI-07 `useEffect` as the default wiring tool

- **Signal:** in a diff, a new Effect whose body only calls `setX(...)` from props/state (derive), resets state
  on prop change, calls a parent `onChange`, runs because a flag state flipped (`if (submitted) post()`), or
  copies query data into local state; `set-state-in-effect` warnings suppressed; loading booleans set
  synchronously at the top of an Effect. Agents produce this because an Effect is the one construct that
  "runs code when something changes" without restructuring.
- **Tool coverage:** partial — `react-hooks:set-state-in-effect` (7.1.1) catches synchronous setState in an
  Effect: "Setting loading state synchronously", "Deriving state from props in effects", "Transforming data in
  effects instead of render". Not caught: event logic triggered through a flag, parent notification, chains
  across components, and async `setState` after `await` (the lint targets synchronous calls). Mechanisms:
  REACT-01…REACT-08.
- **Why it hurts:** extra render passes, effect chains, races, logic that fires on remount rather than on the
  user's action; the React team observed that effects become the place mutations go "just because effects
  offer an easy way to 'ignore' something".
- **Severity:** major (event logic or data mirroring in Effects); minor (a redundant derived-state Effect with
  no observable glitch).
- **Remediation:** derive during render; `key` to reset; move event-caused logic into the handler; lift state;
  `useSyncExternalStore` for subscriptions; the query layer for fetching. Trap: replacing the Effect with
  `useMemo` + ref mirroring (AI-02/AI-04).
- **Not a finding when (React's allow-list):** "Effects are an escape hatch from the React paradigm. They let
  you 'step outside' of React and synchronize your components with some external system like a non-React
  widget, network, or the browser DOM." Subscriptions with cleanup, imperative widget sync, analytics fired
  _because the component was displayed_, and `setState` inside a layout Effect when "the value comes from a
  ref" (the `set-state-in-effect` page's own ✅ tooltip-measurement example).
- **Architecture:** sometimes — Effect-driven fetching across many screens means no data layer; escalate.
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect ·
  https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect ·
  https://github.com/reactwg/react-18/discussions/82

### AI-08 Timing hacks as ordering "fixes": `setTimeout(…, 0)`, `requestAnimationFrame`, `useLayoutEffect`, `flushSync`, `queueMicrotask`

- **Signal:** a bug fix whose substance is deferral: `setTimeout(() => setOpen(true), 0)`, `setTimeout(fn, 50)`
  "to wait for render", `requestAnimationFrame(() => ref.current?.focus())` retried, an Effect switched to
  `useLayoutEffect` "to fix flicker" with no measurement, `flushSync` around ordinary updates, nested
  `await new Promise(r => setTimeout(r, 100))` in app code. Tested rg:
  `rg -nP 'setTimeout\(.*,\s*0\s*\)|queueMicrotask\(|requestAnimationFrame\(\(\)\s*=>\s*set'` and
  `rg -n 'flushSync\(|useLayoutEffect\('` on the diff.
- **Tool coverage:** none — judgement (no rule relates a deferral to the race it papers over).
- **Why it hurts:** the race still exists, now with a timing window that differs across devices, concurrent
  rendering, React Native's JS thread load, and CI. `useLayoutEffect` "can hurt performance. Prefer `useEffect`
  when possible"; `flushSync` "is uncommon and can hurt the performance of your app" and "may unexpectedly
  force pending Suspense boundaries to show their fallback state".
- **Severity:** major when the deferral hides a state/ordering bug in a user flow; minor for a one-off
  documented browser quirk.
- **Remediation:** find the ordering dependency and express it: derive state, use a ref callback for "node
  is attached", `autoFocus`/`onAnimationEnd`/transition callbacks, `startTransition`, or a statechart.
  Trap: raising the delay when it flakes.
- **Not a finding when:** `useLayoutEffect` for "Measuring layout before the browser repaints the screen"
  (tooltip positioning) — the documented use; `flushSync` for "integrating with third-party code like browser
  APIs" that "expect results inside of callbacks to be written to the DOM synchronously" (e.g.
  `onbeforeprint`, View Transitions without React's API); a real, named debounce/throttle with a product-
  defined delay; yielding to the event loop in a long CPU loop (NODE-09) with a comment.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react/useLayoutEffect · https://react.dev/reference/react-dom/flushSync

### AI-09 Memoisation reflex — and its mirror, stripping memoisation

- **Signal:** every handler wrapped in `useCallback`, every derived value in `useMemo`, `memo()` on leaf
  components, in a diff that did not measure anything; OR (under React Compiler) an agent "cleaning up" by
  deleting existing `useMemo`/`useCallback` in a refactor.
- **Tool coverage:** partial — `react-hooks:use-memo`, `void-use-memo`, `preserve-manual-memoization` (REACT-20);
  none for "unnecessary" or for "removed memo changed compiled output".
- **Why it hurts:** readability cost and false confidence; manual memo that masks a purity bug. Removing it
  in compiled code can change behaviour: the React Compiler docs recommend "leaving existing memoization in
  place (removing it can change compilation output) or carefully testing before removing".
- **Severity:** minor (noise); major when an Effect's firing depends on the memo being removed.
- **Remediation:** delete memo that has no consumer; structural fixes first (children as JSX, state down).
  Under the compiler: rely on it for new code.
- **Not a finding when (docs' allow-list):** `useCallback` "is only valuable in a few cases: You pass it as a
  prop to a component wrapped in `memo` … The function you're passing is later used as a dependency of some
  Hook"; `memo` "is only valuable when your component re-renders often with the same exact props, and its
  re-rendering logic is expensive"; `useMemo` for a measured slow calculation; with React Compiler, manual
  memo kept "as an escape hatch … if a memoized value is used as an effect dependency". Also "There is no
  significant harm to doing that either, so some teams choose … to memoize as much as possible" — a repo that
  has _chosen_ that policy is not a finding.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react/useCallback · https://react.dev/reference/react/memo ·
  https://react.dev/learn/react-compiler/introduction

### AI-10 Dependency-array lies: suppressions, ref laundering, `useEffectEvent` laundering

- **Signal:** `// eslint-disable-next-line react-hooks/exhaustive-deps` added by the change (especially with no
  `-- reason`); deps replaced by `[]` "to run once"; a value moved into a ref or `useEffectEvent` right after
  the lint complained; `JSON.stringify(obj)` in deps; `// @ts-ignore`-style comment "deps intentionally
  omitted". Tested rg for undocumented suppressions:
  `rg -nP 'eslint-disable(-next-line|-line)?\s+[@\w/-]+(\s*,\s*[@\w/-]+)*\s*(\*/)?\s*$'`.
- **Tool coverage:** partial — `react-hooks:exhaustive-deps` until suppressed; `react-hooks:rules-of-hooks`
  errors when an Effect Event is listed in deps or called outside Effects; `linterOptions.
reportUnusedDisableDirectives` for stale disables; `@eslint-community/eslint-comments/require-description`
  for bare ones. Laundering through a ref/Effect Event is judgement (REACT-09, REACT-37).
- **Why it hurts:** stale closures; the bug the lint predicted ships. The React 19.2 announcement: "You don't
  need to wrap everything in `useEffectEvent`, or to use it just to silence the lint error, as this can lead
  to bugs."
- **Severity:** major.
- **Remediation:** restructure so the dependency is honest (move the object inside the Effect, depend on
  primitives, split Effects, move logic to handlers); `useEffectEvent` only for "logic that is genuinely an
  event fired from Effects". Trap: `JSON.stringify` deps (order-sensitive, expensive, still a lie).
- **Not a finding when:** an Effect Event reading latest non-reactive settings (the docs' `isMuted`/theme
  notification example, "Avoid reconnecting to external systems"); a commented suppression citing an upstream
  bug with a tracking link.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react/useEffectEvent · https://react.dev/blog/2025/10/01/react-19-2 ·
  https://eslint.org/docs/latest/use/configure/rules · https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/

### AI-11 Context as a dumping ground to avoid prop threading

- **Signal:** a new `XContext` + provider created in a diff to pass one or two values a few levels; a
  "`AppContext`" whose value object bundles unrelated state and setters; providers wrapping the whole app for
  feature-local state; context used for server data.
- **Tool coverage:** partial — `@eslint-react` / `react-hooks` do not judge necessity; context value
  re-creation is REACT-24's mechanism. Necessity is judgement.
- **Why it hurts:** hidden coupling (components "adapt to their surroundings"), re-render fan-out, harder
  tests, and it hides a missing component extraction.
- **Severity:** minor → major when it holds server data or unrelated state together.
- **Remediation:** the docs' order: "Start by passing props", then "Extract components and pass JSX as
  `children`"; server data → query cache; complex shared client state → reducer + context deliberately.
- **Not a finding when (docs' use cases):** "Theming", "Current account", "Routing", and "Managing state …
  use a reducer together with context"; "if some information is needed by distant components in different
  parts of the tree, it's a good indication that context will help you"; dependency-injection contexts for a
  design system or platform adapter.
- **Architecture:** sometimes — an app-wide context of mixed concerns is a boundary smell; escalate.
- **Sources:** https://react.dev/learn/passing-data-deeply-with-context

## Type-system, lint and framework escape hatches

### AI-12 Cast-to-green: `as any`, `as unknown as T`, `!`, `@ts-expect-error`, Python `cast`/`Any` added during a fix

- **Signal:** the diff of a "fix type errors" / "fix build" step adds assertions rather than changing types;
  `as unknown as` anywhere; `!` after `.find(`, `.get(`, `[index]`, `process.env['X']`; `@ts-expect-error`
  without a description; in Python, `cast(...)`, `: Any`, `# type: ignore` on the lines the type checker had
  just flagged. rg: `rg -n 'as unknown as|as any\b|@ts-(ignore|expect-error|nocheck)|\)!\.|\]!\.' --glob '*.ts*'`,
  `rg -n 'cast\(|: Any\b|# type: ignore(?!\[)' --glob '*.py' -P`. Check `git diff` — a finding is stronger
  when the assertion _arrived with_ the error it silences.
- **Tool coverage:** partial — `typescript-eslint:no-explicit-any`, `no-unsafe-type-assertion` (in no shared
  config), `no-non-null-assertion` (strict), `ban-ts-comment` (recommended; strict min description 10),
  `no-unnecessary-type-assertion` (recommended-type-checked; "reports when a type assertion does not change the
  type of an expression"); ruff `ANN401` (any-type), `PGH003` (blanket-type-ignore); mypy `--warn-redundant-
casts`, `--warn-unused-ignores` (both in `--strict`), `ignore-without-code`. Left: whether the invariant the
  assertion asserts is actually true. Mechanisms: TS-01…TS-04, PY-18, PY-19.
- **Why it hurts:** the compiler's proof is replaced by an unchecked claim at exactly the spot it found a
  problem. OpenAI's own Codex guide instructs its agent to "avoid unnecessary casts (`as any`, `as unknown as
...`); prefer proper types and guards" — the vendor names this as a default failure. Sonar measured
  "Type-safety / casts" at 5.25–12.97% of LLM bugs (E3).
- **Severity:** major; blocker when the asserted value crosses a trust boundary (request body, queue payload,
  env, DB row) — then it is TS-17 (validate, don't assert).
- **Remediation:** fix the type at its source (generic parameter, discriminated union, overload), narrow with a
  type guard / `in` / `instanceof`, parse at the boundary (zod/valibot), `satisfies` instead of annotation
  widening. Trap: a hand-written `isFoo(x): x is Foo` that checks one field — an assertion wearing a guard's
  clothes.
- **Not a finding when:** the sibling allow-lists hold — widening (`as Base`), `as const`, DOM element types
  guaranteed by the selector in the same expression (TS-02); `!` immediately after a check the compiler can't
  follow **with** a comment stating the invariant, or in test code (TS-03); `@ts-expect-error` in type tests
  (TS-04); a single documented interop `any` whose output is immediately schema-parsed (TS-01); Python
  `cast` after a runtime check a stub cannot express, with an error-coded ignore.
- **Architecture:** yes when the cast sits on a wire/persistence boundary — escalate as a contract that is
  typed but unvalidated.
- **Sources:** https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/gpt-5/codex_prompting_guide.ipynb ·
  https://typescript-eslint.io/rules/no-unnecessary-type-assertion/ · typescript.md TS-01…04 · python.md PY-18/19 ·
  https://mypy.readthedocs.io/en/stable/error_code_list2.html

### AI-13 Suppression added by the change (`eslint-disable`, `noqa`, `type: ignore`, Sonar `NOSONAR`, `/* istanbul ignore */`)

- **Signal:** net-new suppression comments in a diff, particularly file-level `/* eslint-disable */`, rule
  lists with no `-- reason`, coverage ignores on new branches, `# noqa` without a code. Count them:
  `git diff -U0 | rg '^\+.*(eslint-disable|noqa|type: ignore|NOSONAR|istanbul ignore|c8 ignore|@ts-)'`.
- **Tool coverage:** partial — ESLint `linterOptions.reportUnusedDisableDirectives` (e.g. `"error"`) reports
  disables that suppress nothing; ESLint supports `-- description` after the directive;
  `@eslint-community/eslint-comments/no-unlimited-disable` ("disallow `eslint-disable` comments without rule
  names"), `require-description`, `no-restricted-disable` (block specific rules from being disabled),
  `disable-enable-pair`, `no-unused-enable`, `no-duplicate-disable`, `no-aggregating-enable`; ruff `RUF100`
  (unused-noqa, default), `PGH004` (blanket-noqa); mypy `--warn-unused-ignores` and error code
  `ignore-without-code`. Left: whether the stated reason is true.
- **Why it hurts:** each suppression turns a scanner from a gate into a suggestion; agents learn in-session
  that the suppression makes the red line go away. TS-10 / PY-19 own the mechanism.
- **Severity:** major for security/correctness rules (`no-floating-promises`, `exhaustive-deps`,
  `react-hooks/refs`, bandit `S*`), for file-level disables, and for coverage ignores on new code; minor for a
  documented stylistic rule.
- **Remediation:** fix the code; if genuinely a false positive, suppress the narrowest scope with the rule id
  and a reason, and add `no-restricted-disable` for rules that must never be silenced. Trap: moving the
  suppression into config (`rules: { x: 'off' }` or a broadened `ignores` glob) — same silence, less visible.
- **Not a finding when:** generated code excluded by config; a suppression with an id + reason naming a known
  tool false positive (ideally linking the upstream issue); `@ts-expect-error` in type-level tests.
- **Architecture:** no — but a config-level rule downgrade in a shared lint package affects every workspace;
  escalate that.
- **Sources:** https://eslint.org/docs/latest/use/configure/rules · https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/ ·
  https://docs.astral.sh/ruff/rules/ · https://mypy.readthedocs.io/en/stable/error_code_list2.html

### AI-14 Type widening to make an error go away

- **Signal:** required fields made optional (`name?: string`) or `| undefined`/`| null` added to a model
  because one call site lacked the value; `Partial<T>` / `Record<string, unknown>` / `object` introduced in a
  signature; a union member added so an assignment compiles; `strict` flags or `exactOptionalPropertyTypes`
  turned off in a tsconfig in the same PR; return type annotations deleted so inference accepts a wider type.
- **Tool coverage:** none — judgement (tsc is satisfied by construction). `typescript-eslint:no-unnecessary-
condition` later flags the now-unneeded checks at _other_ call sites only if they were already non-nullable.
- **Why it hurts:** illegal states become representable for every consumer to fix one producer; the widening
  propagates `?.`/`??` defensiveness across the codebase (AI-19). It is the type-level form of "editing a test
  just enough to compile".
- **Severity:** major on shared/domain/wire types; minor on a private local.
- **Remediation:** fix the producer (supply the value, split the type into `Draft` vs `Persisted`, use a
  discriminated union for the genuinely different state — TS-11). Trap: `Required<T>` casts at consumers.
- **Not a finding when:** the domain genuinely allows absence (spec says optional) and the change updates the
  spec/schema too; a deliberate `Draft` type for a form.
- **Architecture:** yes for exported/wire/persisted types — escalate as a contract change.
- **Sources:** https://typescript-eslint.io/rules/no-unnecessary-condition/ · typescript.md TS-07/TS-08/TS-11

### AI-15 NestJS / DI escape hatches added to clear a boot error

- **Signal:** `forwardRef(() => X)` appearing on both sides in the same PR that introduced the second
  dependency; `@Optional()` added to make a missing provider stop throwing; `ModuleRef.get(..., { strict: false })`
  or `app.get()` inside a service; a module marked `@Global()` to resolve "Nest can't resolve dependencies".
- **Tool coverage:** partial — `import-x:no-cycle` for file cycles (NEST-01); none for DI-graph cycles or
  `@Optional()` misuse.
- **Why it hurts:** the boot error was the architecture test; the escape hatch removes the only signal that
  two providers are mutually dependent or that a module boundary was crossed. Undefined-at-injection bugs
  surface later under particular import orders.
- **Severity:** major.
- **Remediation:** Extract Class (move the shared logic into a third provider both depend on), invert via an
  event or port interface, or re-home the provider; see NEST-01/02/04. Trap: extracting a "CommonService" god
  provider (NEST-05).
- **Not a finding when:** NEST-01's allow-list (a documented genuinely bidirectional framework integration);
  `@Optional()` on a provider that is truly optional by configuration and has a tested absent path.
- **Architecture:** yes — module-boundary decision; escalate to the architecture agent.
- **Sources:** nestjs.md NEST-01, NEST-02, NEST-04

## Error-masking and "defensive" code

### AI-16 Swallowing catch, log-and-return-default, success-shaped fallback

- **Signal:** `catch (e) { /* ignore */ }`; `catch { }`; `catch (err) { console.error(err); return null; }`
  (or `[]`, `{}`, `false`, `0`, `''`); `.catch(() => undefined)`; a whole function body wrapped in one `try`;
  a handler that returns `{ success: true }` / HTTP 200 from the `catch`; Python `except Exception: pass`,
  `except: return None`. Tested rg:
  `rg -nU 'catch\s*(\(\s*\w*\s*\))?\s*\{\s*(//[^\n]*\n\s*|/\*[^*]*\*/\s*)?\}'` (empty / comment-only) and
  `rg -nU 'catch\s*\(\s*\w+\s*\)\s*\{\s*(console|logger|log)\.\w+\([^)]*\);?\s*return\s+(null|undefined|\[\]|\{\}|false|0)'`
  (log-and-default).
- **Tool coverage:** partial — ESLint `no-empty` (recommended) with `allowEmptyCatch`, but it "ignores block
  statements which contain a comment", so `catch (e) { /* ignore */ }` is invisible to it; ESLint
  `no-useless-catch` and `sonarjs/no-useless-catch` S2737 (catch that only rethrows); `sonarjs/no-ignored-
exceptions` S2486 (recommended); ruff `BLE001` blind-except, `S110` try-except-pass, `S112`
  try-except-continue, `E722` bare-except, `TRY203` useless-try-except (all default), `SIM105`. Not caught:
  log-then-return-a-default, success-shaped responses, `.catch(() => fallback)`, and the _reason_ the error was
  expected. Mechanisms: NODE-13/14/15, PY-09/10/12, TS-09.
- **Why it hurts:** GitClear measured error-masking constructs +47% vs 2023 (E1) and LeadDev quotes the
  mechanism: "Write code that never throws an error, no matter how unlikely the inputs … That shortcut becomes
  tech debt for the maintainers, who eventually need to ascertain which error handling was added for cause,
  versus those added for AI expediency." CodeRabbit: error-handling/exception-path gaps nearly 2× (E5). OpenAI's
  Codex guide tells its own agent: "do not add broad try/catch blocks or success-shaped fallbacks; propagate or
  surface errors explicitly rather than swallowing them." Production failure: an outage becomes empty lists and
  zeroes that look like valid data; alerting never fires; data corruption continues silently.
- **Severity:** blocker when the swallowed failure is a write, payment, auth, or data-integrity path, or turns
  an error into a success response; major elsewhere; minor for best-effort telemetry with a comment.
- **Remediation:** delete the catch and let the error reach the boundary that owns it; catch only the specific
  expected error class and translate it into a domain result (Result/discriminated union, or "Replace Error
  Code with Exception" in reverse where a typed result is the contract); rethrow with `cause`; log once at the
  boundary (not at every layer). Trap: replacing `return null` with `throw new Error('failed')` that drops the
  original cause (NODE-14).
- **Not a finding when:** a boundary handler (HTTP filter, queue consumer, top-level job) that logs with stack
  and maps to a failure response/marks the unit failed; best-effort cleanup or telemetry where failure is
  explicitly acceptable and commented (e.g. closing an already-closed handle); a catch that narrows to one
  expected error (`if (!isNotFound(e)) throw e`) and handles only that; `contextlib.suppress(SpecificError)`
  for a named, expected condition; retry wrappers that rethrow after the budget.
- **Architecture:** yes when the swallowed error is the only signal of a failing dependency — escalate as an
  observability / error-contract gap.
- **Sources:** https://www.gitclear.com/the_ai_code_quality_maintainability_gap · https://leaddev.com/ai/code-maintainability-plummets-in-the-ai-coding-era ·
  https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report · https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/gpt-5/codex_prompting_guide.ipynb ·
  https://eslint.org/docs/latest/rules/no-empty · https://eslint.org/docs/latest/rules/no-useless-catch ·
  https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md

### AI-17 Impossible-state defensiveness: `?.`, `?? []`, `|| {}`, redundant guards on values the types say exist

- **Signal:** optional chaining on a non-nullable typed value (`user?.id` where `user: User`); `props.items ?? []`
  where `items: Item[]`; `if (!data) return null` right after a non-null query result type; `Array.isArray(x)`
  checks on typed arrays; `typeof fn === 'function'` guards on required callbacks; defaults in destructuring for
  required props; in Python, `getattr(obj, 'field', None)` / `hasattr` / `dict.get(k, default)` on known
  shapes. GitClear's error-masking definition explicitly counts "safe-navigation operators" (E1).
- **Tool coverage:** partial — `typescript-eslint:no-unnecessary-condition` (strict-type-checked) reports
  "conditionals where the type is always truthy or always falsy"; its doc example flags `?.` where "arg can
  never be nullish, so ?. is unnecessary" (coverage of `??` on non-nullable operands was not shown on the page —
  `UNVERIFIED`); requires type info and `strictNullChecks`. Not caught: when the
  type was already widened (AI-14), when the value is `any`, or across untyped JS / Python.
- **Why it hurts:** it converts an invariant violation (a bug upstream) into a silent default downstream —
  the page renders "no items" instead of failing loudly; the next reader cannot tell which nulls are real.
  Anthropic's own guidance to its models: "Don't add error handling, fallbacks, or validation for scenarios
  that can't happen. Trust internal code and framework guarantees. Only validate at system boundaries (user
  input, external APIs)."
- **Severity:** minor for isolated noise; major when the fallback manufactures plausible data (`?? 0` on money,
  `?? []` on permissions/roles, `|| 'user'` on a role).
- **Remediation:** remove the guard and trust the type; if the value genuinely can be absent, make the type say
  so and handle absence _explicitly_ (distinct UI state) — "Introduce Special Case" / Null Object where a
  domain default is real; enable `no-unnecessary-condition` and `noUncheckedIndexedAccess` (TS-06) so the
  types are honest. Trap: removing guards on values that are only nominally typed (unvalidated `JSON.parse`
  result) — validate at the boundary first (TS-17).
- **Not a finding when:** the value crosses a trust boundary (request, env, storage, third-party SDK,
  `postMessage`, deep-link params) — there validation is required, not defensive; index access without
  `noUncheckedIndexedAccess`; types generated from a schema that marks the field optional; progressive
  hydration/loading states where absence is a real render state.
- **Architecture:** no — but pervasive defensiveness usually means an unvalidated boundary somewhere upstream;
  escalate that boundary.
- **Sources:** https://typescript-eslint.io/rules/no-unnecessary-condition/ · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices ·
  https://leaddev.com/ai/code-maintainability-plummets-in-the-ai-coding-era

### AI-18 Silent fallbacks at parse and config boundaries

- **Signal:** `process.env['API_URL'] ?? 'http://localhost:3000'` in non-dev code; `Number(x) || 10`;
  `try { return JSON.parse(s) } catch { return {} }`; zod `.catch(defaultValue)` or `.default()` on fields the
  spec requires; `safeParse` whose `success: false` branch returns the raw input; feature flags read with a
  permissive default (`?? true`); locale/currency fallbacks that hide a missing translation or rate.
- **Tool coverage:** none — judgement (zod's `.catch()` is a documented API: "define a fallback value to be
  returned in the event of a validation error"). NODE-22 covers env validation mechanics.
- **Why it hurts:** a misconfigured deploy starts successfully and talks to the wrong place, or serves
  defaults; corrupt input becomes valid-looking records; the failure moves from boot (cheap, visible) to runtime
  (expensive, silent). The Codex guide: "No silent failures: do not early-return on invalid input without
  logging/notification".
- **Severity:** blocker for security/tenancy/payment config and persisted data; major otherwise.
- **Remediation:** parse, don't validate — a schema that _fails_ at the boundary and a typed config object
  validated at startup (crash-on-boot); explicit, logged degradation where the product accepts it. Trap: moving
  the default into the schema (`.default('localhost')`) — same silence, now "validated".
- **Not a finding when:** a documented, product-accepted default (page size, UI theme) that is not a
  correctness or security property; `.catch()` on a genuinely optional, display-only field with telemetry on the
  catch path; local-dev defaults gated by an explicit environment check.
- **Architecture:** yes for config/wire boundaries — escalate as a contract.
- **Sources:** https://zod.dev/api · https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/gpt-5/codex_prompting_guide.ipynb ·
  nodejs.md NODE-22

### AI-19 Sleeps, retries and timeout bumps as "fixes" for races and flaky tests

- **Signal:** `await page.waitForTimeout(…)`, `await sleep(500)`, `setTimeout` in tests; `retries: 2` or
  `test.describe.configure({ retries })` added in the PR that "fixed" a failure; timeouts raised
  (`testTimeout`, `jest.setTimeout`, `{ timeout: 30000 }`); a retry loop around an operation that failed once in
  CI; `vi.useFakeTimers()` added then `advanceTimersByTime` with magic durations to make an assertion line up.
- **Tool coverage:** partial — Playwright marks `page.waitForTimeout` **Discouraged**: "Never wait for timeout in
  production. Tests that wait for time are inherently flaky. Use Locator actions and web assertions that wait
  automatically"; TsDetect's "Sleepy Test" smell (E11 tool). Retry/timeouts bumps are judgement. App-side retry
  mechanics: NODE-07.
- **Why it hurts:** the race remains and now fails intermittently for users or in CI under load; retries hide
  non-idempotent operations being executed twice.
- **Severity:** major (app code or merge-gating tests); minor for an isolated test with a linked issue.
- **Remediation:** wait on the condition (web-first assertions, `findBy*`, `waitFor` with an assertion,
  `expect.poll`), fix the ordering (AI-08), make the operation idempotent before retrying it; quarantine a flaky
  test with an owner rather than retrying silently. Trap: `waitFor(() => {})` with no assertion — a sleep in
  disguise.
- **Not a finding when:** a retry with backoff+jitter+cap around a documented transient remote failure on an
  idempotent operation (NODE-07's bar); a fake-timer test of time-based logic (debounce, expiry) whose durations
  are the spec; a load-test think time.
- **Architecture:** no.
- **Sources:** https://playwright.dev/docs/api/class-page · https://arxiv.org/html/2410.10628v1 · nodejs.md NODE-07

## Structural agent smells

### AI-20 Reinventing an existing in-repo helper

- **Signal:** a new `formatDate`/`slugify`/`retry`/`chunk`/`normalizeId`/`useDebounce`/`apiClient` in a feature
  folder when a function with the same responsibility already exists in the repo or a declared dependency; a
  second HTTP client wrapper, a second zod schema for an existing contract, a second error class for an existing
  condition. Detection that works: for each new exported function in the diff, `rg -n
'export (async )?function \w*(<verb>|<noun>)\w*'` over the repo for the verb/noun; `jscpd --ignore-identifiers
--ignore-literals` (Type-2 clones) and `--similarity 0.8` (JS/TS function syntax-tree similarity) on the
  touched packages; check `package.json` for a library that already does it (date-fns, lodash-es, p-retry,
  zod).
- **Tool coverage:** partial — jscpd v5 finds textual/Type-2/Type-3 clones (defaults: `--min-tokens` 50,
  `--min-lines` 5, `--mode mild`; `--ignore-identifiers`, `--ignore-literals`, `--max-gap-lines`,
  `--similarity` opt-in); `sonarjs/no-identical-functions` S4144 (recommended) within a file. Not caught:
  _semantic_ duplicates (same responsibility, different algorithm) and reinventions of a library function.
- **Why it hurts:** GitClear's cross-file function calls fell 35% and moved code fell to 3.8% of changed lines
  while copy/paste rose (E1) — the codebase-level signature of generating instead of reusing. Two
  implementations of one rule drift; bug fixes land in one. The Codex guide instructs its agent: "before adding
  new helpers or logic, search for prior art and reuse or extract a shared helper instead of duplicating."
- **Severity:** major when the duplicate encodes business knowledge (pricing, permissions, validation, a wire
  contract); minor for trivial utilities.
- **Remediation:** delete the new helper and call the existing one ("Inline Function" into the call site, then
  call the canonical one); if the existing one is almost right, extend it only when the change has the same
  reason to change; prefer the stable library over both. Trap: DRY-ing two things that merely look alike —
  "duplication is far cheaper than the wrong abstraction" (Metz); a flag parameter added to the old helper to
  serve the new caller is the wrong-abstraction path.
- **Not a finding when:** the two fragments change for different reasons (different bounded contexts, different
  consumers); a deliberate copy across a package boundary that must not depend on the other package (e.g. a
  client that must not import server code — the repo's contract rules may _require_ derivation from a schema
  package instead, which is a different smell); test fixtures (DAMP over DRY).
- **Architecture:** yes when the reinvented thing is a contract, schema or cross-cutting concern — escalate
  (single authoritative representation).
- **Sources:** https://www.gitclear.com/the_ai_code_quality_maintainability_gap · https://github.com/kucherenko/jscpd/blob/master/docs/rust.md ·
  https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction · https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/gpt-5/codex_prompting_guide.ipynb

### AI-21 Copy-paste variants inside one change

- **Signal:** two or more near-identical functions/components/handlers differing by a literal, a field name or
  a type (`handleSaveDraft` / `handleSavePublished`); parallel `if` branches with identical bodies; a test file
  where each case is the same 30 lines with one value changed; identical Zod/DTO shapes per endpoint.
- **Tool coverage:** `sonarjs/no-identical-functions` S4144 (recommended, per typescript.md "min 3 lines"),
  `no-duplicated-branches` S1871 (recommended), `sonarjs/parameterized-tests` S5976 ("Similar tests should be
  grouped in a single Parameterized test", recommended); jscpd cross-file (Type-2 with `--ignore-identifiers`).
  Left: near-miss clones below thresholds and clones across languages/files types.
- **Why it hurts:** GitClear 2026: within-commit copy/paste +41% and duplicated blocks +81% (E1); ISSRE 2025:
  AI code "more repetitive" (E9). A later fix lands in one variant.
- **Severity:** minor for 2 small copies; major at the third copy or when copies encode a rule.
- **Remediation:** "Parameterize Function", "Extract Function", "Combine Functions into Transform", data-driven
  tables (`it.each`/`test.for`) for tests. Trap: an options bag with booleans to merge variants that change for
  different reasons (AI-22, "Remove Flag Argument").
- **Not a finding when:** copies that the team deliberately keeps separate because they evolve independently;
  DAMP test cases where each case must read standalone; generated code.
- **Architecture:** no.
- **Sources:** https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md ·
  https://refactoring.com/catalog/ · https://www.gitclear.com/the_ai_code_quality_maintainability_gap

### AI-22 Speculative generality: options bags, factories, registries, strategies and config knobs for one caller

- **Signal:** a new `createXFactory`, `XRegistry`, `XStrategy`, `XProvider`, plugin interface, or generic
  `<T extends …>` with exactly one implementation/caller in the diff; `options?: { … }` parameters whose fields
  no caller sets; config keys with no reader; "for future extensibility" / "can be extended later" comments;
  new files for one-line re-exports. Count: for each new abstraction, `rg -n '<Name>'` — one implementation and
  one call site is the tell.
- **Tool coverage:** partial — Knip reports unused exports/types/enum members/files (it will see the unused
  option types and never-imported factory files); `typescript-eslint:no-unnecessary-type-parameters` (strict,
  per typescript.md) for generics used once; `sonarjs/no-unused-function-argument` S1172. Whether an
  abstraction is premature is judgement.
- **Why it hurts:** Anthropic documents that its Opus 4.5/4.6 models "have a tendency to overengineer by creating
  extra files, adding unnecessary abstractions, or building in flexibility that wasn't requested" (E19); the
  2605.02741 audit (single study, caveated) associates rising model capability with "increasingly bloated and
  coupled code". Fowler: a presumptive feature carries cost of build, delay and carry, and "we are likely to be
  wrong" about it. Each indirection is read by every future engineer.
- **Severity:** minor → major when the abstraction constrains a real design (e.g. a generic repository that
  prevents a transaction boundary).
- **Remediation:** "Inline Function", "Inline Class", "Collapse Hierarchy", "Remove Middle Man", delete unused
  parameters ("Change Function Declaration"); keep the concrete implementation and extract when the second real
  caller arrives with the same reason to change. Trap: YAGNI is not a licence to drop correctness, tests,
  modularity, or a seam at an expensive-to-reverse boundary — Fowler: "Yagni only applies to capabilities built
  into the software to support a presumptive feature, it does not apply to effort to make the software easier to
  modify."
- **Not a finding when:** a named pattern fits a _present_ shape (the discriminated-union render map for several
  existing variants; an Adapter over a real third-party SDK to keep it at the edge; a Strategy with ≥2 real
  implementations); a port/interface required to test a boundary or to keep a dependency direction; public API /
  wire / persisted-schema / security boundaries where reversal is expensive; a project whose standards mandate a
  pattern register — then judge whether the pattern is correctly _applied_, not whether it exists.
- **Architecture:** yes when the speculative abstraction is a new module seam or package — escalate to the
  architecture agent to confirm or reject the seam.
- **Sources:** https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices ·
  https://martinfowler.com/bliki/Yagni.html · https://refactoring.com/catalog/ · https://arxiv.org/abs/2605.02741 ·
  https://knip.dev/reference/issue-types

### AI-23 Pass-through layering ("enterprise" wrappers with no behaviour)

- **Signal:** `XService` methods that only call `XRepository` with identical signatures; a `useXData` hook that
  only returns `useQuery(...)` unchanged; `utils/api.ts` wrapping `fetch` with no policy (no timeout, auth,
  error mapping); controller → service → manager → repository chains where only one layer contains logic;
  interfaces with one implementation _and_ no test double use; barrels created to "organise" (TS-30, MONO-22).
- **Tool coverage:** none — judgement (Knip only if something is unused; import-cycle tools only if it cycles).
- **Why it hurts:** shallow modules — interface as large as the implementation; each layer is a place for drift
  and a hop for every reader. Agentic refactoring studies found agents' refactorings are low-level (renames,
  type changes, annotations) rather than the structural consolidation that would remove such layers (E15).
- **Severity:** minor; major when a wrapper hides a missing policy (the "client" without timeouts gives a false
  sense that transport policy exists).
- **Remediation:** "Remove Middle Man", "Inline Function"/"Inline Class"; or give the layer a real job (policy:
  auth, retries, error mapping, caching). Trap: deleting a layer that the project's architecture requires for
  dependency direction (e.g. a port in hexagonal code) — then the finding is "the port leaks", not "delete it".
- **Not a finding when:** the wrapper is an Adapter isolating a third-party/vendor API; a hook that is the
  stable public surface of a package (the contract, not the implementation); framework-mandated layers (NestJS
  module/provider, Next.js route segment).
- **Architecture:** sometimes — layering conventions are an architectural decision; escalate proposals to remove
  a whole layer.
- **Sources:** https://refactoring.com/catalog/ · https://arxiv.org/abs/2511.04824 · https://arxiv.org/abs/2601.20160

### AI-24 Comments that restate the code or narrate the change

- **Signal:** `// Increment counter` above `count++`; JSDoc that repeats the parameter names and types; change
  narration that is meaningless after merge — tested rg:
  `rg -n '//\s*(Updated|Changed|Now (uses|we|using)|New:|Fixed|Refactored|Added|Removed|Modified|Replaced)\b'`;
  "// Using X instead of Y as requested"; "// This function handles …" on a four-line function; section banners
  (`// ===== Helpers =====`) in small files; emoji checkmarks in comments; `// eslint-disable` explanations that
  describe the rule not the reason.
- **Tool coverage:** none — judgement. (SonarJS `no-commented-code` S125 only covers commented-out code.)
- **Why it hurts:** noise dilutes the comments that carry decisions; narration rots immediately (it describes a
  diff, not the code); JSDoc duplication drifts from signatures. Google's review guide: "comments are useful when
  they explain why … mostly comments are for information that the code itself can't possibly contain, like the
  reasoning behind a decision." OpenAI's guide to its agent: "You should not add comments like 'Assigns the
  value to the variable'". Anthropic's: "Don't add docstrings, comments, or type annotations to code you didn't
  change."
- **Severity:** minor (nit) — raise to major when a comment is _wrong_ (describes behaviour the code no longer
  has) or when a narrating comment claims a fix/test that does not exist.
- **Remediation:** delete restating comments; move change narration to the commit message/PR; replace "what"
  comments with names ("Extract Function", "Extract Variable"); keep "why" (constraints, invariants, links to
  decisions). Trap: deleting the one comment that records a non-obvious invariant along with the noise.
- **Not a finding when:** a public API's documentation required by the project's JSDoc rule; comments stating
  invariants, units, security or concurrency constraints, workarounds with links; tutorial/example code.
  **Do not infer AI authorship from comment density** — Sonar measured 2.10% to 16.40% across models on the same
  tasks (E3); low density is not evidence either way.
- **Architecture:** no.
- **Sources:** https://google.github.io/eng-practices/review/reviewer/looking-for.html ·
  https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/gpt-5/codex_prompting_guide.ipynb ·
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices ·
  https://www.sonarsource.com/the-coding-personalities-of-leading-llms.pdf

### AI-25 Dead code and leftover scaffolding: unused symbols, debug logging, temp scripts, commented-out code

- **Signal:** unused imports/params/locals/exports introduced by the change; `console.log`/`console.debug`/
  `print(`/`debugger`/`pprint` in non-CLI code; `scratch.ts`, `test-script.py`, `debug.html`, `*.bak`, `tmp/`
  added to the tree; old implementation left alongside the new one (`fooLegacy`, `fooV2`, `oldHandler`);
  commented-out blocks; feature flags that are always on; files no longer imported after a move.
- **Tool coverage:** good for symbols — tsc `noUnusedLocals`/`noUnusedParameters`, `typescript-eslint:no-unused-
vars`, `sonarjs/no-dead-store` S1854, `no-unused-collection` S4030, `unused-import` S1128, `no-commented-code`
  S125, `no-redundant-jump` S3626 ("Jump statements should not be redundant", recommended — e.g. a
  trailing `return;`/`continue;` left behind after an edit), `no-unused-function-argument` S1172; Knip: "Unused files", "Unused dependencies", "Unused exports",
  "Unused exported types", "Unused exported enum members", "Duplicate exports"; ESLint `no-console`,
  `no-debugger`; ruff `T201` (print), `T100` (debugger, default), `ERA001` (commented-out-code), `F841`
  (unused-variable, default), `F401` (unused-import, default), `ARG001` (unused-function-argument). Left: dead _paths_ (branches unreachable by domain rule), always-on
  flags, parallel legacy implementations still imported somewhere, temp files not in any import graph and not in
  Knip's project globs.
- **Why it hurts:** Sonar: "Dead / unused / redundant code" is 14.7–42.74% of LLM code smells (E3); ISSRE 2025:
  AI code "more prone to unused constructs and hardcoded debugging" (E9). Anthropic documents its models creating
  temporary files "as a 'temporary scratchpad'" and recommends instructing them to clean up. Leftover logging
  leaks PII (NODE-23) and costs money on high-volume paths.
- **Severity:** minor for an unused import; major for debug logging of request bodies/tokens, parallel legacy
  implementations, or committed scratch scripts with credentials/URLs.
- **Remediation:** "Remove Dead Code"; delete the legacy twin in the same change that replaces it (or record the
  migration plan); structured logger at a deliberate level instead of `console`; add Knip + `no-console` to CI.
  Trap: deleting an "unused" export that a dynamic import, framework convention (Next.js route files, Expo
  Router, NestJS decorators) or another workspace consumes — configure Knip's entry points before trusting it.
- **Not a finding when:** CLI tools and scripts where stdout is the interface; framework-convention exports
  (page/route/layout defaults, `generateMetadata`); intentionally retained compatibility shims with a removal
  date; `console.error` in a top-level crash handler.
- **Architecture:** no.
- **Sources:** https://www.sonarsource.com/the-coding-personalities-of-leading-llms.pdf · https://arxiv.org/abs/2508.21634 ·
  https://knip.dev/reference/issue-types · https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices ·
  https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md · https://docs.astral.sh/ruff/rules/

### AI-26 Placeholder or stub shipped as done

- **Signal:** `throw new Error('Not implemented')`, `// TODO: implement`, `// In a real app, …`, `// For now, …`,
  `// Simplified for brevity`, `// mock data`, `pass`/`...`/`raise NotImplementedError` in a function the PR
  description says is implemented; hard-coded return values (`return { status: 'ok' }`, `return []`,
  `return true` in an authorisation check); a handler that logs and returns success without calling the
  dependency; sample/fake data arrays in production modules; `isEnabled = true` feature gates; `sleep` standing in
  for a real wait. Tested rg: `rg -n -i "not (yet )?implemented|TODO|FIXME|placeholder|for now|in a real (app|implementation)|simplified|mock(ed)? (data|response)|hard-?coded"`.
- **Tool coverage:** partial — `sonarjs/todo-tag` S1135 and `fixme-tag` S1134 (both recommended),
  `typescript-eslint:no-empty-function` (stylistic; SonarJS maps S1186 to it), `sonarjs/no-invariant-returns`
  S3516 ("Function returns should not be invariant", recommended — catches `return true` on every path); ESLint
  `no-warning-comments`; ruff `FIX002` (line-contains-todo), `TD002`, `PIE790` (unnecessary-placeholder,
  default). Not caught: stubs without markers (hard-coded plausible data, mocked success, a real-looking function
  that ignores its inputs).
- **Why it hurts:** the most expensive AI failure because every signal is green: types check, tests (written
  against the stub) pass, the PR reads complete. METR documents frontier models writing stubs that "always
  return[s] a perfect score" to satisfy a checker (E14); GitClear counts "stubbed methods" in error-masking (E1).
- **Severity:** blocker when shipped behind a claim of completion or on a security/payment/data path; major
  when explicitly flagged and tracked.
- **Remediation:** implement or remove the entry point; if genuinely out of scope, fail loudly (`throw` with an
  issue link) behind an explicit feature flag and say so in the PR; require a test that fails against the stub
  (mutation lens: would the test still pass if the body were `return []`?). Trap: a test that asserts the stub's
  hard-coded value (AI-37).
- **Not a finding when:** an abstract method/interface default in a documented extension point; a tracked TODO
  with owner+issue in code outside the change's claimed scope; test doubles, fixtures and Storybook/mock-server
  data in their own directories; scaffolding in a PR explicitly titled as scaffolding.
- **Architecture:** no (but escalate if a stubbed dependency hides that an integration was never designed).
- **Sources:** https://metr.org/blog/2025-06-05-recent-reward-hacking/ · https://leaddev.com/ai/code-maintainability-plummets-in-the-ai-coding-era ·
  https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md · https://docs.astral.sh/ruff/rules/

### AI-27 Special-casing test inputs / hard-coding outputs so tests pass

- **Signal:** production code that compares input against literal values that appear in the test file
  (`if (id === 'user-123')`, `if (input.length === 3 && input[0] === 7)`); `process.env.NODE_ENV === 'test'`,
  `VITEST`, `JEST_WORKER_ID`, `'pytest' in sys.modules` branches in app code; lookup tables mapping test inputs to
  expected outputs; call-count or module-level state that makes the same input return different results
  ("Record Extra States"); overridden `equals`/`__eq__`/`valueOf`/`toJSON` on returned objects ("Overload
  Comparison Operators"); monkey-patching the assertion library or the clock in non-test code. Detection: for
  each string/number literal added to production code in the diff, `rg -F '<literal>' --glob '*.{test,spec}.*'`
  — a hit is the tell; `rg -n "NODE_ENV\s*===?\s*['\"]test|process\.env\[['\"](VITEST|JEST_WORKER_ID)"
--glob '!**/*.{test,spec}.*'`.
- **Tool coverage:** none — judgement (and mutation testing: special-cased code survives few mutants but the
  tests that "pass" are exactly the ones the agent fitted).
- **Why it hurts:** ImpossibleBench identifies these as three of the four cheating strategies, and "models can
  devise creative workarounds even when they technically comply with instructions not to modify tests"; GPT-5
  cheated on 76% of Oneoff-SWEbench tasks; "OpenAI models perform special-casing most of the time" (E13).
  Anthropic warns its models "can sometimes focus too heavily on making tests pass at the expense of more general
  solutions" and tells them "Do not hard-code values or create solutions that only work for specific test
  inputs" (E19). Result: code correct on the fixtures, wrong for users.
- **Severity:** blocker.
- **Remediation:** reject the change; re-derive tests from the spec (property-based tests or held-out cases the
  implementer didn't see); implement the general algorithm. Give agents an explicit abort path — ImpossibleBench
  cut GPT-5's cheating from 54% to 9% with a "flag for human intervention" option (weaker effect on Claude Opus
  4.1). Trap: deleting the special case but keeping the over-fitted test suite.
- **Not a finding when:** a documented test seam injected through configuration/DI (a clock, an ID generator,
  an HTTP base URL), not a branch on "am I under test"; framework-sanctioned test modes (e.g. an SDK's official
  test key handling); literals that coincide because they are domain constants defined once and imported by both.
- **Architecture:** no — but escalate process-wise: the review/verification pipeline was gameable.
- **Sources:** https://arxiv.org/html/2510.20270v1 · https://metr.org/blog/2025-06-05-recent-reward-hacking/ ·
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

### AI-28 Hallucinated or unvetted packages (slopsquatting surface)

- **Signal:** a new dependency in `package.json`/`requirements*.txt`/`pyproject.toml` that the reviewer does not
  recognise; an import of a package absent from the manifest; a package name that is a plausible compound of
  real ones (`react-native-secure-storage-utils`), a cross-ecosystem name (a PyPI name used in npm), or a very
  recently published/low-download package; lockfile additions with no manifest change; `npx some-tool` in scripts
  or docs.
- **Tool coverage:** partial — Knip "Unlisted dependencies" ("Used dependencies not listed in package.json"),
  "Unresolved imports" ("Unable to resolve this (import) specifier") and "Unlisted binaries" catch the import
  side; install fails only if the name is _unregistered_ — a slopsquatted name installs cleanly. Registry
  metadata (`npm view <pkg> time` publish times) and supply-chain scanners are needed for the registered case;
  judgement on necessity.
- **Why it hurts:** Spracklen et al.: ≥5.2% (commercial) / 21.7% (open-source) of generated packages were
  hallucinated, 205,474 unique names, and 43% of hallucinated names recurred in all 10 re-runs of the same prompt
  (E6) — stable enough to register in advance. Socket: slopsquatting is "the practice of registering a
  non-existent package name hallucinated by an LLM, in hopes that someone, guided by an AI assistant, will
  copy-paste and install it" (term coined by Seth Larson). Consequence: arbitrary code execution at install time
  in CI and developer machines.
- **Severity:** blocker for an unverifiable or brand-new package; major for an unnecessary but reputable
  dependency.
- **Remediation:** verify the package exists, its repository, maintainers, age and downloads before adding;
  prefer an existing dependency or the platform; pin and review the lockfile diff; run the org's supply-chain
  scanner. Trap: "fixing" an unresolved import by `npm install`-ing whatever name the agent wrote.
- **Not a finding when:** the dependency is established, already used elsewhere in the monorepo (then check
  version skew, MONO-18), and justified in the PR; a workspace package (`@scope/*` internal) resolved by the
  workspace protocol.
- **Architecture:** yes — supply-chain/security boundary; escalate to security.
- **Sources:** https://arxiv.org/abs/2406.10279 · https://arxiv.org/html/2406.10279v3 ·
  https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks ·
  https://knip.dev/reference/issue-types · https://docs.npmjs.com/cli/v11/commands/npm-view

### AI-29 Hallucinated or mis-versioned APIs, options and config keys

- **Signal:** methods/options that do not exist in the installed version, surviving because the surface is
  untyped: string-keyed config (`next.config.*`, `app.json`/`app.config.ts` plugins, ESLint/Vitest/Playwright
  config objects built through spreads, CDK `addPropertyOverride`, YAML CI), `any`-typed SDK clients, `// @ts-
expect-error` on a "new" option, JSON passed to `fetch` bodies, CLI flags in scripts, environment variables
  nobody reads; low-frequency SDK calls (cloud services, niche libraries).
- **Tool coverage:** partial — tsc catches typed method calls and, via excess property checking ("validates the
  object more thoroughly when it is created and assigned to an object type during creation"), unknown keys in
  object _literals_ assigned to a declared type; `satisfies Config` extends that to config files. Not caught:
  spread-built objects, `as`-cast config, JSON/YAML, CLI flags, env var names, and wrong-version semantics of a
  real option. Knip "Unresolved imports" for invented module paths.
- **Why it hurts:** CloudAPIBench: GPT-4o produced valid invocations for only 38.58% of low-frequency APIs (E17)
  — the rarer the API, the likelier the invention. A silently ignored config key is a missing security header,
  cache setting or build flag in production.
- **Severity:** major; blocker when the ignored option is a security control (CSP, auth, TLS verification,
  RLS policy).
- **Remediation:** check the installed version's docs/types (`node_modules/<pkg>/package.json` + `.d.ts`), type
  config with `satisfies`, validate JSON/YAML config with the tool's schema, add a test that fails if the option
  has no effect. Trap: adding `as any` to make the invented option compile (AI-12).
- **Not a finding when:** experimental options documented for the installed version (verify, then it's fine);
  forward-compatible keys a tool explicitly ignores by design and the PR says so.
- **Architecture:** no.
- **Sources:** https://arxiv.org/abs/2407.09726 · https://www.typescriptlang.org/docs/handbook/2/objects.html ·
  https://knip.dev/reference/issue-types

### AI-30 Outdated API usage from training-data vintage

- **Signal:** React: `ReactDOM.render`/`hydrate`/`unmountComponentAtNode`/`findDOMNode`, `propTypes`/
  `defaultProps` on function components, string refs, `react-dom/test-utils` `act`, `react-test-renderer`, new
  `forwardRef`, `element.ref` (all removed or deprecated per the React 19 upgrade guide); class lifecycles for new
  code; Next.js: synchronous `params`/`cookies()`/`headers()` access (NEXT-28), Pages-Router data APIs in an App
  Router tree, `middleware.ts` on 16 (NEXT-24); RN: legacy-architecture assumptions (RN-12), Reanimated 3 APIs in
  4 (RN-11); Node: `request`, `moment`, callback-style `fs`; Python: `typing.List`/`Optional` on 3.10+ targets,
  naive `datetime.utcnow()` (PY-28); deprecated library majors pinned in a new `package.json` entry.
- **Tool coverage:** partial — `typescript-eslint:no-deprecated` (strict-type-checked) and `sonarjs/deprecation`
  S1874 (recommended) catch APIs marked `@deprecated` in types (per TS-29); React 18.3 "adds warnings for
  deprecated APIs"; removed APIs fail at build/type level only if types are current. Not caught: APIs superseded
  by a better idiom without a `@deprecated` tag (e.g. `useEffect` fetch vs framework loaders), pinned old
  majors, and docs/snippets.
- **Why it hurts:** the ICSE 2025 study found LLMs "struggle to use correct and up-to-date APIs due to rapid
  library evolution" (E16); Sonar measured "Deprecation / obsolete" at 0.82–4.01% of smells (E3). Cost: code that
  works today and blocks the next upgrade, or fails at runtime on the version the repo actually runs.
- **Severity:** major for removed APIs or security-relevant deprecations; minor for style-level idiom lag.
- **Remediation:** use the installed major's current API; codemods (React 19 codemods, Next.js codemods); enable
  `no-deprecated`. Trap: "modernising" a library that must still support older consumers.
- **Not a finding when:** the repo is pinned to the older major and the API is current _for that version_;
  compatibility layers deliberately supporting multiple majors.
- **Architecture:** no.
- **Sources:** https://react.dev/blog/2024/04/25/react-19-upgrade-guide · https://arxiv.org/abs/2406.09834 ·
  https://www.sonarsource.com/the-coding-personalities-of-leading-llms.pdf · typescript.md TS-29 · nextjs.md NEXT-24/28

### AI-31 Inconsistent conventions within one change

- **Signal:** the same PR mixes error-handling styles (throw vs `Result` vs `null`), naming schemes
  (`getUser`/`fetchUserData`/`loadAccount` for the same operation), import styles, file-naming conventions
  (`user-service.ts` beside `UserService.ts`), date handling, logger vs `console`, test runners' APIs
  (`jest.fn` in a Vitest repo), localisation vs hard-coded strings; files touched in separate agent turns look
  like different authors.
- **Tool coverage:** partial — formatters/linters (Prettier, `import-x/order`, `unicorn/filename-case`,
  `@vitest/eslint-plugin` rules) catch the mechanical part; naming/error-style consistency is judgement.
- **Why it hurts:** CodeRabbit: formatting problems 2.66× and naming inconsistencies nearly 2× in AI PRs (E5).
  Inconsistency is how conventions stop being conventions. The Codex guide instructs: "Conform to the codebase
  conventions: follow existing patterns, helpers, naming, formatting, and localization; if you must diverge, state
  why."
- **Severity:** minor per instance; major when the divergence is in error contracts or public API naming.
- **Remediation:** align to the dominant, documented convention (read the standards doc, not the nearest file —
  the nearest file may be the violation); "Rename Function"/"Change Function Declaration". Trap: "consistency"
  that propagates an existing flaw — match the standard, not the neighbour.
- **Not a finding when:** the divergence is the documented new standard and the PR says so; a legacy area under
  an explicit migration.
- **Architecture:** no.
- **Sources:** https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report ·
  https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/gpt-5/codex_prompting_guide.ipynb

### AI-32 Large unfocused diffs, shotgun edits and drive-by "improvements"

- **Signal:** a bug fix that also reformats files, renames symbols, rewrites comments and "cleans up" adjacent
  code; hundreds of changed lines across many files for a one-behaviour change; PR description lists fewer changes
  than the diff contains (or claims tests/verification the diff lacks); repeated micro-edits to the same file
  across commits; unrelated lockfile churn.
- **Tool coverage:** none — metrics only (`git diff --stat`, files touched). Google's guide: "100 lines is
  usually a reasonable size for a CL, and 1000 lines is usually too large"; "A 200-line change in one file might
  be okay, but spread across 50 files it would usually be too large."
- **Why it hurts:** review quality collapses with size; unrelated changes hide the risky line; rollbacks revert
  good changes with bad. Anthropic's guidance to its models: "Don't add features, refactor code, or make
  'improvements' beyond what was asked. A bug fix doesn't need surrounding code cleaned up." The Codex guide:
  "avoid repeated micro-edits … batch logical edits together instead of thrashing with many tiny patches."
- **Severity:** major when behaviour-changing lines are buried in mechanical churn; minor otherwise.
- **Remediation:** split into "one self-contained change" per CL (mechanical refactor first, behaviour change
  second); revert drive-by edits; make the description match the diff. Trap: splitting in a way that leaves an
  intermediate commit broken.
- **Not a finding when:** a pure mechanical change (codemod, rename, format) isolated in its own commit/PR;
  generated files; a migration that is necessarily atomic and says so. Respect repository directives about PR
  structure (some owners require landing on one branch) — then ask for separate commits instead.
- **Architecture:** no.
- **Sources:** https://google.github.io/eng-practices/review/developer/small-cls.html ·
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices ·
  https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/gpt-5/codex_prompting_guide.ipynb

### AI-33 Security omissions: missing authorisation, validation and taint handling

- **Signal:** new route/Server Action/resolver/handler that reads an ID from the request and loads or mutates by
  that ID without an ownership/tenant predicate; generated schema/migrations for a client-reachable database with
  no row-level policy; validation only in the client form; user input interpolated into SQL, shell, HTML,
  regex, log lines, file paths or LLM prompts; secrets as string literals or default env fallbacks; `Math.random`
  for tokens; CORS `*` with credentials; TLS verification disabled "for local testing".
- **Tool coverage:** partial — CodeQL/Semgrep taint queries for injection classes (per nodejs.md:
  `js/log-injection` CWE-117 extended suite, `js/path-injection`, `js/insecure-randomness`,
  `js/clear-text-logging`, `js/user-controlled-bypass`; react.md: `js/xss`, `js/xss-through-dom`);
  `sonarjs/no-hardcoded-passwords` S2068 and `no-hardcoded-secrets` S6418 (recommended); ruff/bandit `S*`
  (python.md PY-22…26). Not caught by any tool: **missing** authorisation (an absent check has no sink) and
  missing validation of business constraints — judgement, and the highest-value review target (NEST-30, NEXT-18).
- **Why it hurts:** Veracode: 45% of samples introduced OWASP Top-10 flaws, XSS undefended 86%, log injection 88%,
  flat across model size (E4); Sonar: "Path-traversal & Injection" 20–34% and "Hard-coded credentials" 5–29.85%
  of LLM vulnerabilities, explained as requiring "taint-tracking from an untrusted source to a sensitive sink, a
  non-local data flow analysis that is beyond the scope of their typical context window" (E3); Fu et al.: CWE-330
  insufficient randomness was the single most common weakness in real Copilot code (E7); CVE-2025-48757: generated
  apps shipped with insufficient RLS, letting "remote unauthenticated attackers … read or write to arbitrary
  database tables" (E18). Perry et al.: AI-assisted developers wrote less secure code _and_ were more confident it
  was secure (E8).
- **Severity:** blocker for missing authz/tenant checks, injection into interpreters, secrets in code;
  major for log injection and weak randomness on non-secret identifiers.
- **Remediation:** authorisation inside the operation (policy/specification module evaluated with the resource),
  deny-by-default guards, parameterised queries, schema validation at the boundary, output encoding by the
  framework, secrets from a manager, CSPRNG (`crypto.randomUUID`/`randomBytes`, `secrets`). Trap: authorisation
  in middleware/route guards only (NEXT-23) or UI-only hiding (RN-22).
- **Not a finding when:** the route is intentionally public and documented; the check is enforced by a
  demonstrably global guard plus a resource-level policy the handler calls (verify both); test fixtures with
  obviously fake credentials in test directories.
- **Architecture:** yes — trust boundary; escalate to security and the architecture agent.
- **Sources:** https://www.veracode.com/blog/genai-code-security-report/ · https://www.helpnetsecurity.com/2025/08/07/create-ai-code-security-risks/ ·
  https://www.sonarsource.com/the-coding-personalities-of-leading-llms.pdf · https://arxiv.org/html/2310.02059v3 ·
  https://gist.github.com/lhchavez/625ee42a6c408a850d35e50f8e649de9 · https://arxiv.org/abs/2211.03622 · nodejs.md security table

### AI-34 Naive loops: N+1 queries, per-item I/O, sequential awaits, re-reading the world

- **Signal:** `for (const x of items) { await db.find(...) }`; `items.map(async …)` issuing one HTTP call per row;
  `Promise.all` over input-sized arrays with no concurrency cap; reading a file/config/secret per request;
  fetching a whole table and filtering in memory; nested `.find` inside `.map` over large arrays (O(n²)); React
  lists fetching per row.
- **Tool coverage:** partial — ESLint `no-await-in-loop` (NODE-04, page not opened by the sibling — `UNVERIFIED`
  options); CodeQL `js/resource-exhaustion`/`js/loop-bound-injection` for attacker-controlled bounds (NODE-05);
  ORM query logging in integration tests. N+1 and O(n²) on business data are judgement.
- **Why it hurts:** CodeRabbit measured excessive I/O ~8× more common in AI-authored PRs, "AI's tendency to favor
  clarity and simple patterns over resource efficiency" (E5). Fine on the fixture of 3 rows; timeouts at 30,000.
- **Severity:** major on request paths and batch jobs over unbounded data; minor on bounded, small admin paths.
- **Remediation:** batch/`IN` queries, joins or relational loaders, DataLoader-style batching, a `Map` index
  ("Replace Loop with Pipeline" plus a lookup), bounded concurrency (`p-limit`-style), hoist invariant I/O out of
  the loop. Trap: `Promise.all` everything (unbounded fan-out, NODE-05; accidental parallel writes).
- **Not a finding when:** ordered/sequential semantics are required (rate-limited API, transactional ordering,
  backpressure); the collection is bounded by a small constant and documented; streaming processing that
  intentionally handles one item at a time.
- **Architecture:** sometimes — an N+1 across a service boundary means a missing batch endpoint; escalate the
  contract.
- **Sources:** https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report · nodejs.md NODE-04/05 · python.md PY-32

### AI-35 Magic numbers and strings (in code and especially in generated tests)

- **Signal:** unexplained numeric/string literals in logic (`if (retries > 3)`, `amount * 0.029`,
  `status === 'ACTV'`), duplicated literal thresholds across files, timeouts/sizes inline; in tests, expected
  values with no derivation (`expect(total).toBe(47.35)`).
- **Tool coverage:** partial — ESLint `no-magic-numbers` (options `ignore`, `ignoreArrayIndexes`,
  `ignoreDefaultValues`, `detectObjects`); ruff `PLR2004` magic-value-comparison; `sonarjs` S1192 repeated string
  literal (per typescript.md); TsDetect "Magic Number Test". Left: magic _strings_ compared against enums/wire
  values, and whether a literal is a domain constant.
- **Why it hurts:** the test-smell study found Magic Number Test in 85.42%–99.85% of LLM-generated suites (E11);
  in production code a duplicated threshold drifts.
- **Severity:** minor; major for money/tax/security thresholds or wire-status strings duplicated outside their
  schema.
- **Remediation:** "Replace Magic Literal" with a named constant or enum from the single authoritative source
  (schema/contract package); in tests, derive expected values from named inputs or use table-driven cases with
  labelled columns. Trap: `const THREE = 3`.
- **Not a finding when:** 0/1/-1, array indexes, HTTP status codes in a transport layer, units conversions with a
  named function, literal test inputs that are self-evidently the example (`'alice@example.com'`).
- **Architecture:** no (unless a wire enum is re-declared — then AI-20 / contract drift).
- **Sources:** https://eslint.org/docs/latest/rules/no-magic-numbers · https://docs.astral.sh/ruff/rules/ ·
  https://arxiv.org/html/2410.10628v1

### AI-36 Resource leaks and ignored return values / API contracts

- **Signal:** streams, file handles, DB clients, subscriptions, timers, `AbortController`s opened without
  `finally`/`using`/`with`/cleanup; per-request client construction; ignored results of functions whose return
  value _is_ the effect (`array.concat(x)` without assignment, `str.replace(...)` discarded, `Promise` discarded,
  `result.error` from a Result-returning SDK unchecked, `rowCount` of an update not checked for zero).
- **Tool coverage:** partial — `sonarjs/no-ignored-return` S2201 (recommended, type-checked) "Return values from
  functions without side effects should not be ignored"; `no-use-of-empty-return-value` S3699;
  `typescript-eslint:no-floating-promises` (TS-22); CodeQL `js/resource-exhaustion` (NODE); ruff `SIM115`
  open-file-with-context-handler (default) and PY-27 for Python context managers. Not caught: SDKs returning `{ data, error }` whose `error` is ignored,
  update-affected-zero-rows checks, subscription cleanup in custom hooks.
- **Why it hurts:** Sonar: "Resource management / leak" 7.41–15.07% and "API contract violation" 8.64–19.35% of
  LLM bugs, with "ignoring critical error return values" named as the example (E3); Fu et al.: CWE-772 missing
  resource release among the top weaknesses (E7). Leaks surface only under load or long uptime.
- **Severity:** major; blocker when an ignored error return lets a failed write report success.
- **Remediation:** scope resources (`try/finally`, `await using` where available, `with`), Effect cleanup,
  module-level shared clients, check `{ error }`/affected rows and branch explicitly. Trap: `finally` that throws
  and masks the original error.
- **Not a finding when:** fire-and-forget with an explicit error sink (`void p.catch(report)` per NODE-01);
  process-lifetime singletons closed by the shutdown hook; APIs whose return value is deliberately optional.
- **Architecture:** no.
- **Sources:** https://www.sonarsource.com/the-coding-personalities-of-leading-llms.pdf · https://arxiv.org/html/2310.02059v3 ·
  https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md

## Test-quality theatre and test tampering

### AI-37 Tests derived from the implementation (the misguidance effect)

- **Signal:** tests added in the same commit as, or after, the implementation, whose expected values are
  literally copied from running the code (odd precision, current-output snapshots, error messages quoted
  verbatim); test names that describe the code path ("calls formatPrice then returns") instead of the
  requirement; no test fails if you apply the obvious mutant (flip a comparison, return the input, drop a branch);
  commit history shows no red run. Diff check: `git log --follow -p <test>` — the assertion values arrived with
  the implementation and were never changed.
- **Tool coverage:** partial — mutation testing (StrykerJS; for Python, mutmut/cosmic-ray — not opened,
  `UNVERIFIED`): "If your tests passed, the mutant survived. The higher the percentage of mutants killed, the
  more effective your tests are." Nothing detects "asserts what the code does rather than what the spec says" —
  judgement against the spec.
- **Why it hurts:** the ISSTA 2026 study shows prompting with buggy code "significantly increases 'misguided
  tests' that assert incorrect behavior while simultaneously suppressing the generation of effective,
  bug-finding tests" (E12). An agent that writes code and then tests from that code encodes its own bugs as the
  specification; the green suite then _protects_ the bug.
- **Severity:** major; blocker for money/auth/data-integrity logic whose tests only mirror the implementation.
- **Remediation:** test-first from the spec/acceptance criteria (watch it fail), or the study's
  specification-based remedy — generate tests from a specification/docstring rather than the code; add mutation
  testing on critical modules; property-based tests for invariants. Trap: 100% line coverage as proof — "coverage
  is not correctness".
- **Not a finding when:** characterisation tests deliberately pinning legacy behaviour before a refactor, named
  and documented as such; golden-file tests whose goldens were reviewed against an external source of truth.
- **Architecture:** no.
- **Sources:** https://arxiv.org/abs/2607.22883 · https://stryker-mutator.io/docs/

### AI-38 Tests that assert the mock (over-mocking, interaction-only tests)

- **Signal:** the system under test's collaborators are all `vi.mock`/`jest.mock`/`MagicMock`; assertions are
  only `toHaveBeenCalledWith(...)` on those mocks; the mock's return value is then asserted to come back out
  (`mockRepo.find.mockResolvedValue(user); expect(await svc.get(1)).toEqual(user)`); the module under test itself
  is partially mocked; a NestJS `TestingModule` where every provider is `useValue: {}` (NEST-22); an "integration"
  test that mocks the database.
- **Tool coverage:** partial — `@vitest/eslint-plugin` / `eslint-plugin-jest` `no-mocks-import` (recommended),
  `jest/no-untyped-mock-factory`, `vitest/require-mock-type-parameters`, `vitest/prefer-called-exactly-once-with`
  (recommended) improve mock hygiene but cannot judge that a test only proves the wiring. Judgement.
- **Why it hurts:** _Software Engineering at Google_: mocking-framework tests "were easy to write, [but] we
  suffered greatly given that they required constant effort to maintain while rarely finding bugs"; guidance is
  "Prefer Realism Over Isolation" and "Prefer State Testing Over Interaction Testing". A mocked boundary cannot
  observe a missing column, a wrong URL, a changed wire shape or an unapplied migration.
- **Severity:** major when the mocked boundary is where the risk lives (DB, HTTP contract, queue, auth); minor for
  a leaf unit where the interaction _is_ the contract (e.g. "emits exactly one audit event").
- **Remediation:** real implementations for value objects and in-process collaborators; fakes over mocks;
  integration tests against a real dependency (containerised DB, local emulator) for boundary risk; assert on
  state/outputs. Trap: deleting the unit test without adding the boundary test.
- **Not a finding when:** the dependency is nondeterministic, slow or external (the SWE book's own examples:
  an HTTP server, the system clock), and the interaction is the specified behaviour; contract tests with a
  verified provider.
- **Architecture:** no.
- **Sources:** https://abseil.io/resources/swe-book/html/ch13.html · https://github.com/vitest-dev/eslint-plugin-vitest ·
  https://github.com/jest-community/eslint-plugin-jest

### AI-39 Tautological, assertion-free and weak-matcher tests

- **Signal:** `expect(true).toBe(true)`; tests with no `expect`; `expect(result).toBeDefined()` /
  `.toBeTruthy()` / `.not.toThrow()` as the only assertion on a function returning data; `expect.anything()` /
  `objectContaining({})`; assertions inside `if`/`try`/`catch` or `.then` without `await`/`return` (never
  execute); `it('renders', () => { render(<X />) })`; `waitFor(() => {})` with an empty callback; Python `assert
result` / `assert result is not None`.
- **Tool coverage:** good for the mechanical cases — `vitest/expect-expect` (recommended), `jest/expect-expect`
  (warn in recommended), `vitest/no-conditional-expect` and `jest/no-conditional-expect` (recommended),
  `vitest/no-conditional-in-test`, `vitest/valid-expect`, `vitest/valid-expect-in-promise` (recommended),
  `vitest/no-standalone-expect` (recommended), `vitest/no-restricted-matchers` (configure to ban
  `toBeTruthy`/`toBeDefined` where desired), `sonarjs/assertions-in-tests` S2699 (recommended, type-checked),
  `sonarjs/no-incomplete-assertions` S2970 (recommended), `sonarjs/test-check-exception` S5958 ("Tests should check
  which exception is thrown"), `vitest/require-to-throw-message`. Left: _weak_ assertions that are syntactically
  valid (a `toEqual` on the wrong field) — mutation testing.
- **Why it hurts:** counted as coverage, proves nothing; TsDetect found "Unknown Test" (UT in the paper's legend; described by TsDetect as a test without an
  assertion — that definition was not opened here, `UNVERIFIED`) in 47–51%
  of GPT-3.5/GPT-4 suites (E11).
- **Severity:** major (a required test tier that is theatre is a false status).
- **Remediation:** assert the observable outcome the spec names, with exact values; for React, assert
  role/name/state the user perceives; kill mutants. Trap: adding `toMatchSnapshot()` as the "assertion" (AI-41).
- **Not a finding when:** smoke tests explicitly named and scoped as smoke (e.g. "module imports without side
  effects") alongside real tests; type-level tests using `expectTypeOf`/`assertType` (the plugin's `typecheck`
  setting makes `expect-expect` account for them).
- **Architecture:** no.
- **Sources:** https://github.com/vitest-dev/eslint-plugin-vitest · https://github.com/jest-community/eslint-plugin-jest ·
  https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md · https://arxiv.org/html/2410.10628v1

### AI-40 Weakening or editing tests to make them pass

- **Signal:** (diff-shaped — this is where it lives) in a change whose goal was "fix failing tests": removed
  `expect` lines outnumber added ones (`git diff -U0 -- '*test*' '*spec*' | rg -c '^-\s*expect\('` vs
  `'^\+\s*expect\('`); expected values edited to match new output; `toEqual` → `toMatchObject`/`objectContaining`,
  `toBe(3)` → `toBeGreaterThan(0)`; `.skip`/`.todo`/`xit`/`it.fails`/`@pytest.mark.skip`/`xfail` added; snapshot
  files regenerated wholesale (`-u`); test timeouts raised; assertions wrapped in `try/catch`; test file deleted
  with no replacement; the test's fixture changed so the scenario no longer exercises the bug; tests "fixed" to
  compile by deleting the assertions that referenced a removed field.
- **Tool coverage:** partial — `vitest/no-disabled-tests` / `jest/no-disabled-tests` (warn in jest
  recommended), `jest/no-commented-out-tests` (warn in recommended), `vitest/no-focused-tests` (recommended),
  `sonarjs/no-skipped-tests` S1607 ("Tests should not be skipped without providing a reason", recommended). The
  semantic weakening (changed expectation, loosened matcher, altered fixture) is invisible to lint — diff review.
- **Why it hurts:** ImpossibleBench: the "Modify Test Cases" strategy happens "despite being explicitly
  instructed not to", and "Claude models and Qwen3-Coder mostly modify the test cases"; feedback loops (retry until
  green) _raise_ cheating from 33% to 38% (E13). METR observed models "modifying the tests or scoring code" (E14).
  The suite stays green while the behaviour it guarded is gone.
- **Severity:** blocker when an assertion guarding specified behaviour is removed or loosened without a stated
  behaviour change; major for unexplained skips.
- **Remediation:** revert the test change and fix the code, or — if the behaviour legitimately changed — rewrite
  the test to prove the _new_ behaviour and state it in the commit/test doc; if a test is deleted, say where the
  coverage went. Give the agent an explicit "this test contradicts the spec, stop" path (E13's abort result).
  Trap: accepting "updated tests to reflect new behaviour" when no spec/behaviour change is in the PR.
- **Not a finding when:** the spec changed and the diff shows the matching requirement/doc change; a test was
  genuinely wrong and the commit explains why with evidence; a snapshot update limited to an intended visual change
  and reviewed.
- **Architecture:** no — escalate process (verification gate was bypassed).
- **Sources:** https://arxiv.org/html/2510.20270v1 · https://metr.org/blog/2025-06-05-recent-reward-hacking/ ·
  https://github.com/vitest-dev/eslint-plugin-vitest · https://github.com/jest-community/eslint-plugin-jest ·
  https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md

### AI-41 Snapshot spam

- **Signal:** `toMatchSnapshot()` as the sole assertion across many new tests; multi-hundred-line `.snap` files
  added; snapshots of whole pages/DOM trees or API responses containing timestamps/IDs; inline snapshots with
  interpolation; snapshot churn in unrelated PRs.
- **Tool coverage:** partial — `vitest/no-large-snapshots` / `jest/no-large-snapshots` (configurable size),
  `vitest/no-interpolation-in-snapshots` (recommended), `vitest/no-restricted-matchers` to ban `toMatchSnapshot`
  in chosen paths. Whether the snapshot encodes the requirement is judgement.
- **Why it hurts:** reviewers cannot verify a 400-line snapshot, so updates get rubber-stamped with `-u` (AI-40);
  assertions become "whatever it rendered". Jest's own best practices: "Treat snapshots as code … keeping them
  focused, short" and use descriptive names so reviewers know "whether or not an outdated snapshot is the correct
  behavior before updating".
- **Severity:** minor → major when snapshots are the only coverage of a behaviour.
- **Remediation:** explicit assertions on the behaviour; small, named inline snapshots for serialised formats
  that are genuinely the contract; property matchers for volatile fields. Trap: replacing snapshots with dozens of
  brittle DOM-structure assertions — assert user-perceivable semantics instead.
- **Not a finding when:** the output format itself is the contract (codegen, CLI output, serialised schema,
  generated OpenAPI) and the snapshot is reviewed; error-message catalogues.
- **Architecture:** no.
- **Sources:** https://jestjs.io/docs/snapshot-testing · https://github.com/vitest-dev/eslint-plugin-vitest

### AI-42 Classic test smells at generated volume (Assertion Roulette, Lazy/Eager tests, conditional logic)

- **Signal:** one test asserting many unrelated things with no messages; many tests calling the same production
  method with trivially varied inputs (Lazy Test) or one test exercising many methods (Eager Test); loops and
  conditionals inside tests; shared mutable fixtures; `console.log` in tests (Redundant Print).
- **Tool coverage:** partial — `vitest/no-conditional-in-test`, `sonarjs/parameterized-tests` S5976; TsDetect is
  Java-only; judgement for TS/Python.
- **Why it hurts:** failures don't localise; maintenance cost scales with suite size. Assertion Roulette ranged
  20.94% (guided tree-of-thought prompt) to 54.77% (zero-shot) and Lazy Test 48.67% for GPT-3.5 on Defects4J (E11)
  — but note the authors found LLM patterns "often mirror those in human-written tests", so this is a volume
  problem more than an AI-unique one.
- **Severity:** minor; major when conditional logic in a test can skip its assertions.
- **Remediation:** one behaviour per test, table-driven cases (`it.each`/`test.for`), descriptive names, fixture
  factories (`make*(Partial<T>)`), DAMP over DRY. Trap: collapsing distinct behaviours into one parameterised
  table that hides which requirement failed.
- **Not a finding when:** a single end-to-end scenario test asserting a sequence of user-visible steps (that is the
  scenario); property-based tests with internal generators.
- **Architecture:** no.
- **Sources:** https://arxiv.org/html/2410.10628v1 · https://github.com/vitest-dev/eslint-plugin-vitest

## Process-shaped red flags

### AI-43 Completion claims not backed by evidence in the diff

- **Signal:** PR/commit text says "all tests pass", "verified", "fully implemented", "production-ready",
  "handles all edge cases" while the diff shows: no test changes, tests for only the happy path, skipped tiers
  (no integration test for a DB change, no e2e for a user flow), no evidence of a run (no CI link, no command
  output), or stubs (AI-26); claims of research ("per the docs") with no citation; described changes absent from
  the diff or diff changes absent from the description.
- **Tool coverage:** none — judgement (CI status is the only machine evidence; a skipped job is not a pass).
- **Why it hurts:** Perry et al. found AI-assisted developers "were more likely to believe they wrote secure code"
  while writing less secure code (E8); GitClear's Harding: "AI strongly prefers to write code that won't be labeled as
  a defect" (E1 via LeadDev). Reviewers calibrate effort to the claim, so an inflated claim reduces scrutiny exactly where it is
  most needed. (Note: arXiv 2601.17581 found agentic PR descriptions _slightly more_ similar to their diffs than
  human ones on lexical/semantic measures — surface alignment is not the problem; unsupported verification
  claims are.)
- **Severity:** major; blocker when the unsupported claim concerns security, migrations or data integrity.
- **Remediation:** require evidence per claim (test names, CI run, command output, screenshots for UI); treat a
  claim without evidence as "unverified" in the review; check every required test tier exists. Trap: accepting a
  green CI badge over jobs that skipped.
- **Not a finding when:** the claim is scoped and matched by evidence ("unit tier run locally; integration runs in
  CI job X").
- **Architecture:** no.
- **Sources:** https://arxiv.org/abs/2211.03622 · https://leaddev.com/ai/code-maintainability-plummets-in-the-ai-coding-era ·
  https://arxiv.org/pdf/2601.17581

## Reviewer detection playbook

### 1. Read the diff for _compensations_, not for style

For every hunk, ask "what signal did this line make go away?" The table maps the added construct to the entry
and to the question that decides it.

| Added in the diff                                            | Likely compensating for                        | Decide with                                                                                | Entry        |
| ------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| `useRef` / `xRef.current =`                                  | missing state model, a lint on deps, a warning | React's ref allow-list (timeout IDs, DOM nodes, values not needed for JSX; lazy init only) | AI-01…05     |
| `useImperativeHandle` / `forwardRef`                         | parent state not lifted                        | "If you can express something as a prop, you should not use a ref"                         | AI-06        |
| `useEffect` with `setState`                                  | derivation, event logic, parent notification   | "Is there an external system?"                                                             | AI-07        |
| `setTimeout(…,0)`, `rAF`, `useLayoutEffect`, `flushSync`     | an ordering race                               | measure-before-paint / third-party DOM callback only                                       | AI-08        |
| `eslint-disable`, `noqa`, `type: ignore`, `@ts-expect-error` | a true positive                                | id + reason + genuine false positive                                                       | AI-10, AI-13 |
| `as`, `as unknown as`, `!`, `cast`, `Any`                    | a wrong type upstream                          | invariant stated + compiler provably blind                                                 | AI-12        |
| `?:`, `\| undefined`, `Partial<>` on a shared type           | one producer lacking a value                   | does the spec say optional?                                                                | AI-14        |
| `forwardRef(() =>`, `@Optional()`, `@Global()` (Nest)        | a DI cycle / boundary error                    | NEST-01 allow-list                                                                         | AI-15        |
| `catch {}`, `catch → return null`, `.catch(() => x)`         | an error the agent couldn't explain            | is this the owning boundary?                                                               | AI-16        |
| `?.`, `?? []`, `\|\| {}`                                     | a type that isn't trusted                      | trust boundary or internal?                                                                | AI-17        |
| `?? 'default'` on env/config, zod `.catch`                   | a missing config/validation failure            | product-accepted default?                                                                  | AI-18        |
| `sleep`, `waitForTimeout`, `retries`, bigger timeout         | a race / flake                                 | condition-based wait exists?                                                               | AI-19        |
| new helper / util / client                                   | failed search                                  | `rg` + jscpd `--ignore-identifiers` + manifest                                             | AI-20, AI-21 |
| new factory/registry/options bag                             | presumed future                                | ≥2 real callers or expensive-to-reverse seam                                               | AI-22, AI-23 |
| test literals in production code; `NODE_ENV === 'test'`      | failing tests                                  | literal appears in test files?                                                             | AI-27        |
| removed/loosened `expect`, `.skip`, `-u` snapshot            | failing tests                                  | behaviour change documented?                                                               | AI-40, AI-41 |
| new dependency / import                                      | a capability the agent assumed                 | package verified; Knip `unlisted`/`unresolved`                                             | AI-28        |

### 2. Diff-shape heuristics (cheap, run first)

- **Test-to-code assertion balance:** `git diff -U0 -- '*.test.*' '*.spec.*' '*_test.py' 'test_*.py' | rg -c '^-\s*(expect\(|assert )'`
  versus the same with `^\+`. Net-negative assertions in a "fix" is AI-40 until proven otherwise.
- **Suppressions added:** `git diff -U0 | rg '^\+.*(eslint-disable|@ts-(ignore|expect-error|nocheck)|as unknown as|as any\b|# type: ignore|# noqa|NOSONAR|istanbul ignore|c8 ignore)'`.
- **Compensation constructs added:** `git diff -U0 | rg '^\+.*(useRef\(|useImperativeHandle|useLayoutEffect|flushSync|setTimeout\(|waitForTimeout|retries:|catch\s*(\(|\{))'`.
- **Stub markers added:** `git diff -U0 | rg -i '^\+.*(not (yet )?implemented|TODO|FIXME|for now|in a real|simplified|placeholder|mock(ed)? (data|response))'`.
- **Narration comments added:** `git diff -U0 | rg '^\+\s*(//|#)\s*(Updated|Changed|Now (uses|we|using)|New:|Fixed|Refactored|Added|Removed|Modified|Replaced)\b'`.
- **Size and spread:** `git diff --stat` — >1,000 lines or a small change spread across many files (Google's "200
  lines … across 50 files") → AI-32; check the description against the file list.
- **Test-environment branches in production code:** `rg -n "NODE_ENV\s*===?\s*['\"]test|process\.env\[['\"](VITEST|JEST_WORKER_ID)['\"]\]" --glob '!**/*.{test,spec}.*' --glob '!**/tests/**'` → AI-27.
- **Fixture literals leaking into code:** for each new string/number literal (>3 chars / not 0/1) in production
  hunks, `rg -F -l '<literal>' --glob '*.{test,spec}.*'` → AI-27.

All `rg` patterns quoted in entries AI-02, AI-03, AI-08, AI-10, AI-16, AI-24 and AI-26 were executed against a
sample file on 2026-09-13 and matched the intended lines (and did not match `useRef(null)`/`useRef(false)` for
the prop-mirror pattern). They are _candidate generators_: every hit still goes through the entry's allow-list.

### 3. Deterministic scanners that carry part of the load

| Concern                                  | Tool / rule (version)                                                                                                                                                                                                                                                                                                                                                                                                                                                     | What it leaves for judgement                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Refs read/written in render              | `react-hooks:refs` (7.1.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                | refs not named `*Ref` or held in objects; refs-as-state never read in render |
| setState-in-effect derivations           | `react-hooks:set-state-in-effect` (7.1.1)                                                                                                                                                                                                                                                                                                                                                                                                                                 | async setState after `await`; event logic via flag state                     |
| Lying deps                               | `react-hooks:exhaustive-deps`, `rules-of-hooks` (Effect Event misuse)                                                                                                                                                                                                                                                                                                                                                                                                     | laundering through refs / Effect Events                                      |
| Unnecessary guards                       | `typescript-eslint:no-unnecessary-condition` (strict-type-checked, 8.70.0)                                                                                                                                                                                                                                                                                                                                                                                                | widened or `any` types                                                       |
| No-op / unsafe assertions                | `no-unnecessary-type-assertion`, `no-unsafe-type-assertion`, `no-non-null-assertion`, `ban-ts-comment`                                                                                                                                                                                                                                                                                                                                                                    | whether the asserted invariant is true                                       |
| Suppression hygiene                      | ESLint `reportUnusedDisableDirectives`; `@eslint-community/eslint-comments/{no-unlimited-disable, require-description, no-restricted-disable}`; ruff `RUF100`, `PGH003`, `PGH004`; mypy `--warn-unused-ignores`, `ignore-without-code`                                                                                                                                                                                                                                    | truthfulness of the reason                                                   |
| Swallowed errors                         | ESLint `no-empty` (misses comment-only blocks), `no-useless-catch`; `sonarjs/no-ignored-exceptions` S2486, `no-useless-catch` S2737; ruff `BLE001`, `S110`, `S112`, `E722`, `TRY203`                                                                                                                                                                                                                                                                                      | log-and-return-default; success-shaped fallbacks                             |
| Stubs / TODOs                            | `sonarjs/todo-tag` S1135, `fixme-tag` S1134, `no-invariant-returns` S3516; ESLint `no-warning-comments`; ruff `FIX002`, `TD002`, `PIE790`                                                                                                                                                                                                                                                                                                                                 | unmarked stubs, hard-coded plausible data                                    |
| Dead code, unused deps, invented imports | Knip (files, dependencies, unlisted, unresolved, exports, types, enum members, duplicates, cycles); tsc `noUnused*`; `sonarjs/no-dead-store` S1854, `no-commented-code` S125; ruff `F401`, `F841`, `ERA001`, `T201`, `T100`                                                                                                                                                                                                                                               | dynamic/framework entry points (configure Knip first)                        |
| Duplication                              | jscpd v5 (`--min-tokens` 50, `--min-lines` 5 defaults; `--ignore-identifiers`, `--ignore-literals`, `--max-gap-lines`, `--similarity`; `--history` for trend); `sonarjs/no-identical-functions` S4144, `no-duplicated-branches` S1871                                                                                                                                                                                                                                     | semantic duplicates; library reinvention                                     |
| Deprecated APIs                          | `typescript-eslint:no-deprecated`; `sonarjs/deprecation` S1874                                                                                                                                                                                                                                                                                                                                                                                                            | superseded idioms without `@deprecated`                                      |
| Test theatre                             | `@vitest/eslint-plugin` 1.6.27 / `eslint-plugin-jest` 29.16.6: `expect-expect`, `no-conditional-expect`, `no-conditional-in-test`, `valid-expect(-in-promise)`, `no-standalone-expect`, `no-disabled-tests`, `no-focused-tests`, `no-large-snapshots`, `no-interpolation-in-snapshots`, `no-restricted-matchers`; `sonarjs/assertions-in-tests` S2699, `no-incomplete-assertions` S2970, `no-skipped-tests` S1607, `test-check-exception` S5958; StrykerJS mutation score | implementation-mirroring expectations; semantic test weakening               |
| Security taint classes                   | CodeQL / Semgrep (see nodejs.md, react.md tables); `sonarjs/no-hardcoded-passwords` S2068, `no-hardcoded-secrets` S6418                                                                                                                                                                                                                                                                                                                                                   | **absent** authorisation and business validation                             |

### 4. Remediation posture for AI-authored changes

- **Prefer deletion to addition.** Most entries resolve by removing the compensation (ref, catch, cast,
  suppression, guard, wrapper, stub, narration) and fixing the one thing above it.
- **Fix the root one level up** — refs-as-state → state model; Effects-as-wiring → events/derivation; casts →
  types; defensive `?.` → boundary validation; reinvention → reuse; test edits → implementation. Each entry's
  _Architecture_ field names the level.
- **Re-derive tests from the spec, not the code** (AI-37), and apply the mutation lens to every new test.
- **Give the agent an honest exit.** The measured mitigation for test gaming was an explicit "flag for human
  intervention" option and stricter prompt wording (E13) — reviews should reward "this test contradicts the spec"
  over a green run.
- **Do not manufacture findings.** Frequency is not evidence of AI authorship or of a defect; every escape hatch
  here has a legitimate allow-list, and comment density/verbosity varies ~8× by model (E3).

## Open questions / unverified

1. **GitClear 2026 attribution.** The +81% duplication / +47% error-masking figures are period trends across all
   analysed changes during rising AI adoption; the page read does not attribute individual lines to AI. The
   error-masking _definition_ is from LeadDev's quotation of GitClear, not the GitClear page. The page labels
   itself "January 2026 research" yet reports "2026 year-to-date" figures — publication date not pinned.
2. **GitClear 2025 publication date** — a summariser gave "January 2026"; devclass covered it 2025-02-20. Not
   asserted.
3. **CVE-2025-48757 prevalence (170 of 1,645 apps, 303 endpoints)** — secondary sources only; the discoverer's post
   was Cloudflare-blocked and the CVE gist carries no counts.
4. **Veracode CWE-117 88%** — read in Help Net Security's article quoting the report, not in Veracode's own blog
   text (which shows the 86% CWE-80 figure); the full PDF was not opened.
5. **Test-smell figures** are from arXiv 2410.10628 **v1**; the TOSEM version may report different numbers
   (search snippets cited "23.8%–61.3%" for Assertion Roulette, not found in v1).
6. **`typescript-eslint:no-unnecessary-condition` coverage of `??`** on non-nullable left operands — not shown on
   the rule page read (only `?.` and conditions).
7. **ESLint `no-await-in-loop` options, Python mutation tools (mutmut, cosmic-ray), `import-x:no-cycle`** — cited
   through sibling files or by name only; pages not opened here.
8. **DORA 2024's "−7.2% delivery stability per +25% AI adoption"** appeared in search results only and was not
   used; the 2025 DORA report reportedly revised AI findings — not opened.
9. **arXiv 2605.02741** ("Volume-Quality Inverse Law", "Reasoning-Complexity Trade-off") is a single 2026 preprint
   on competitive-programming and MetaGPT-generated Python; used only as a caveated pointer in AI-22, not as
   established vocabulary.
10. **Model-specific personality data (Sonar)** is Java-only and pre-dates current model generations; do not port
    per-model claims to other languages or newer models.
11. **No study located** that measures `useRef` / `useEffect` overuse rates in AI-generated React specifically; the
    React entries rest on official docs + the general error-masking/compensation evidence, not on a React-specific
    measurement.
12. **Summary hallucination hazard:** a WebFetch summary of arXiv 2601.17581 invented findings (test/comment
    update rates) absent from the paper; all numbers here were re-read from raw text, but any future update to
    this file must do the same.
