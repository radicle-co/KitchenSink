---
name: code-quality-corpus
description: Use when judging code for smells, anti-patterns, spaghetti code or red flags in TypeScript, React, React Native/Expo, Next.js, Node.js, NestJS, Python or npm/Turborepo monorepos — when a decision needs the legitimate-use exceptions for an escape hatch (refs, effects, memoisation, casts, suppressions, forwardRef), a rule ID or threshold from its source, version-specific framework pitfalls, AI-generated-code smells, or the root cause a local smell is a symptom of.
---

# Code-quality corpus

## Overview

A cited reference of 438 entries (11 references), each with an operational **signal**, the **tool** that detects it (or
"judgement"), the **cost**, a default **severity**, a **remediation** with its trap, **"Not a finding
when"** (the legitimate-use allow-list — the field that prevents false positives), an **architecture**
flag, and the **sources** it was taken from. Every rule ID and threshold was taken from an opened source
or the installed package (versions and dates in each file's _Scope & sources_ table). Where a claim could
not be confirmed it is marked UNVERIFIED in the entry or the file's _Open questions_ — say so if you rely
on one.

**The corpus holds the detail; your judgement holds the shape.** Quote it; do not paraphrase thresholds
or rule names from memory.

## How to use it

1. Route: pick every reference whose trigger is present in scope (table below).
2. For each: read the **Index** table at the top of the file. Select every entry whose smell could apply.
3. Open the selected entries: `rg -n -A 14 '^### <ID> ' ~/.claude/skills/code-quality-corpus/references/<file>.md`.
4. Apply **Not a finding when** before reporting anything. If the code matches a legitimate use, it is not
   a finding — say nothing, or say "legitimate use of X" if a reader would otherwise wonder.
5. For every major+ finding, open `rootCause.md` and `aiGeneratedCode.md` entries it relates to before
   writing the remediation.
6. INSPECT mode, or an ambiguous index: read the relevant sections in full.

## Routing

| Present in scope                                                                | Reference              | Start with sections                                                        |
| ------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| any `.ts` / `.tsx`                                                              | `typescript.md`        | Type-safety erosion · Illegal states · Boundaries · Promise typing         |
| `.tsx` / `.jsx`, React imports                                                  | `react.md`             | Effects · Purity & Rules of React (refs) · State structure · Composition   |
| `.native.tsx`, `react-native`, Expo, Reanimated                                 | `reactNative.md`       | Lists · Animations · New Architecture · Storage & release                  |
| `next` dependency, `app/` routes, `'use server'`, `proxy`/`middleware`          | `nextjs.md`            | Server/Client boundary · Caching (15→16) · Server Actions                  |
| Node runtime code: services, workers, CLIs, Lambdas                             | `nodejs.md`            | Async · Event-loop blocking · Error handling · Resource leaks              |
| `@nestjs/*` decorators, modules, providers                                      | `nestjs.md`            | DI & module design · Layering · Validation & wire contract                 |
| `.py`                                                                           | `python.md`            | Tooling baseline (read first) · Correctness traps · Error handling · Async |
| `package.json`, `turbo.json`, workspaces, cross-package imports, tsconfig paths | `monorepoTurborepo.md` | Detection cheat-sheet · Task graph & caching · Package boundaries          |
| tests of any kind                                                               | `crossCutting.md`      | Test smells, mocking and test-effectiveness                                |
| always, for naming a smell and grading it                                       | `crossCutting.md`      | Grading scales & thresholds · Fowler's 24 · Connascence · Comment & naming |
| always, for escape hatches and agent-written code                               | `aiGeneratedCode.md`   | its Index                                                                  |
| every major+ finding, every cluster                                             | `rootCause.md`         | symptom → root cause table · climbing procedure · local vs structural      |

## Reading an entry

```
### <ID> <name>
- Signal            what to look for (shape, pattern, metric + threshold)
- Tool coverage     tool:rule (version) — or "none — judgement"; "partial" says what is left to you
- Why it hurts      qualities damaged + the concrete failure
- Severity          default + what raises/lowers it (the agent's severity table still governs blocking)
- Remediation       named refactoring / pattern / API — the trap to avoid when applying it
- Not a finding when  legitimate uses; false-positive guidance
- Architecture      whether it implicates a boundary/contract/system property and whom to escalate to
- Sources           what it was taken from
```

## Caveats worth knowing

- **Package truth beats doc summaries.** Example: a fetched README summary claimed the React Compiler lint
  rules live only in `recommended-latest`; the installed `eslint-plugin-react-hooks@7.1.1` ships them in
  `recommended` (read from the package, 2026-09-13). When a claim matters, confirm against the installed
  version in the repo under review (`node_modules/<pkg>/package.json`, the config object).
- **Versions move.** Each reference records the versions researched (React 19.x, Next 15/16, Expo SDK 5x/RN
  0.8x, NestJS 11/12, Node 24, TypeScript 6, Python 3.10–3.13, Ruff 0.16, Turborepo 2.x). In an older repo,
  check whether an entry's premise applies to the version actually installed.
- **Same-named thresholds differ by tool** (Code Climate vs Qlty vs SonarJS). Cite the tool whose number
  you use; prefer the repository's configured value when one exists.
- **The repository's standard wins** over this corpus when they conflict; say that it does.

## Maintenance

Each reference's Index is generated in place by `python3 scripts/buildIndex.py [name …]` (idempotent; no
argument = every reference). Edit the entries, then regenerate. A new entry must carry every field above and
a source you opened.
