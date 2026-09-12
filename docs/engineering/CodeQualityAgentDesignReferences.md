# Code-quality agent design — KitchenSink-specific decisions and evaluation record

Decisions about `staff-code-quality` that depend on **this** repository, and the evaluation that shaped the
agent. Cited from `CLAUDE.md`.

> **The portable rationale travels with the agent**, at `~/.claude/agents/staff-code-quality.rationale.md`: the
> lane table, the escape-hatch allow-lists, the root-cause ladder, scanner status honesty, and the residual
> risks. Read that first for _why the agent is shaped this way at all_; read this for _what it found here and
> how it is wired here_.
>
> ⚠️ The agent and its three skills (`code-quality-corpus`, `code-quality-toolchain`,
> `code-quality-mode-playbooks`) are **user-scoped** (`~/.claude/`), so they are not reviewed in this repo's PRs
> and have no version history here. This file and the portable sibling are the durable record.

## 1. The gap it fills here

Measured on 2026-09-13, before the agent existed (the two ESLint gaps below are now closed; see §4):

- `packages/tools/eslint/index.js` spreads `tseslint.configs.recommended`, **not** `recommendedTypeChecked` — so
  `no-floating-promises`, `no-misused-promises`, `no-unnecessary-condition` and `no-misused-spread` run nowhere.
  Only `restrict-template-expressions` and `no-base-to-string` are type-aware.
- The resolved ESLint config for web and feature packages contains **zero** `react-hooks` rules
  (`npx eslint --print-config <tsx file> | grep -c react-hooks` → `0`). The React Compiler-era rules that
  detect refs-as-state and render-time impurity (`refs`, `purity`, `set-state-in-effect`) are therefore
  enforced only by human attention and by `patternRegister.test.ts`'s ref census.
- No duplication, complexity or dead-code metric runs anywhere (no jscpd, no `complexity`/`max-lines`, no knip).
- `docs/engineering/ENGINEERING_EXCELLENCE.md` → _Anti-patterns & code smells_ is a pointer, not a catalogue.
  The agent's corpus is new content, not a restatement — do not "de-duplicate" it against that section.

## 2. How it is wired here

| Moment                                           | Mode    | Scope                                           |
| ------------------------------------------------ | ------- | ----------------------------------------------- |
| During implementation, before a commit or push   | GATE    | the working diff against `origin/main`          |
| Code review of a PR or branch                    | REVIEW  | `git diff origin/main...HEAD` plus blast radius |
| On demand (a module, a package, a hotspot sweep) | INSPECT | the named paths                                 |

Lanes: `code-reviewer` owns correctness; `staff-architect` owns shape; `staff-ux-engineer` owns experience.
`staff-code-quality` owns code health and escalates structural findings to `staff-architect` with a precise
question rather than adjudicating them.

**The push is held to the GATE.** A user-level Claude Code PreToolUse hook
(`~/.claude/skills/code-quality-toolchain/scripts/prePushGate.mjs`) denies a `git push` in this repo when any file
the push changes does not match, by blob id, the content a GATE recorded as PASS. GATE's final step writes that
stamp (`gateStamp.mjs record`). It DENIES rather than asks because the owner's sessions run `bypassPermissions`,
which turns an `ask` into an `allow`. A push that genuinely needs no GATE is re-run as
`SCQ_GATE_WAIVED='<reason>' git push …`, which leaves the reason in the transcript. The hook fails open on its own
errors. It is user-scoped, so it binds Claude Code sessions only — a human `git push` in a terminal is untouched.

The scanner layer (`~/.claude/skills/code-quality-toolchain`) runs entirely outside the work tree: a pinned
toolchain in `~/.cache/staff-code-quality/toolchain` and output in `$TMPDIR/scq/…`. Local CodeQL uses the
`gh codeql` extension (CLI 2.27.0, the version `codeql.yml` runs in CI); the CI alert feed is read with
`direnv exec . gh api …/code-scanning/alerts?ref=refs/pull/<N>/merge` (the default gh token returns 403).

## 3. Evaluation record (2026-09-13)

Every fixture was reviewed by the agent and by the existing opus `code-reviewer` given an equivalent
"staff-level code-quality review" prompt. Answer keys were hidden from both.

| Fixture                                                                                                        | Authored by          | `code-reviewer`                                                                        | `staff-code-quality`                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blatant multi-package smells (scratch monorepo, no standards)                                                  | the building session | ≈90% of 80 seeded items, 524 s                                                         | not run — already green without the agent                                                                                                                        |
| Realistic "recently viewed rail" in a worktree of this repo (reinvention, refs-as-state, §11.0/§14 violations) | the building session | ≈95%, 621 s / 173k tokens                                                              | ≈95% + **one verified blocker the baseline missed**, 721 s / 202k (REVIEW); 360 s / 145k (GATE)                                                                  |
| Version-specific non-obvious pitfalls, no standards                                                            | the building session | 100%, 415 s / 103k                                                                     | not run — already green without the agent                                                                                                                        |
| Real utilities (`initialsFor`, `greetingBucketForHour`, `weekdayLabels`) replayed as a change — restraint      | this repo's history  | same real defect found; remediation needs a polyfill it does not mention; 422 s / 141k | same real defect; remediation checked against Hermes' `Intl` set; explicit "not findings" (kept a load-bearing guard, respected an in-file ruling); 671 s / 179k |
| **Backtest:** the three files `ed273e20` later fixed, at its parent                                            | this repo's history  | both real ref smells; pattern named at 2 sites; 839 s / 175k                           | both real ref smells; pattern named at all **6** sites (the shape of the later real fix); legitimate refs graded as the owner graded them; 990 s / 244k          |
| **Backtest 2 (non-React):** recipe-service collections at `d35906a9^` — non-atomic clone/pull, N+1 seeding     | this repo's history  | 4/5 key defects; missed the three divergent `Writer` copies; 694 s / 163k              | 4/5, the same miss; plus a ruling check that the planned fix (CP-8 Task 1) keeps the check-then-act race; 733 s / 245k                                           |
| **Re-run of backtest 1** after the HALT-gate change                                                            | this repo's history  | —                                                                                      | same findings; the `closeRef` claim now cited installed Radix source and made the pinning suite a condition; 1,022 s / 236k                                      |

**What this shows, and what it does not.**

- ⛔ **SUPERSEDED — "detection parity with `code-reviewer`" was an artefact of a biased baseline.** Every
  baseline above was `code-reviewer` given a prompt that told it to do THIS agent's job ("a thorough, staff-level
  CODE QUALITY review … code smells, anti-patterns, red flags"). That measured whether a quality-prompted model
  mentions smells, not how `code-reviewer` behaves in the lane it is actually invoked for. Re-run on 2026-09-14 on
  both backtests with a NEUTRAL prompt ("Review these files", the way CLAUDE.md invokes it):
    - It still NOTICED the smells (render-time `getTokenRef` and `wasOpenRef`/`triggerRef` writes, the leaked object
      URLs, the non-atomic clone/pull and N+1) — this repo's `CLAUDE.md` forbids refs, which primes any reader.
    - But its own severity contract (`~/.claude/agents/code-reviewer.md`: Medium = "small smell — fix now or in
      follow-up") filed the ref writes as **Medium, 1 of 10**, under a **"Changes requested — fix Critical/High
      first"** verdict, at **one site** — it never saw the same latch in the other five components. The
      transaction seam was offered as a fix, not diagnosed as the root cause. Both missed the three `Writer` copies.
    - That is the owner's observation, explained: a smell reported as deferrable is a smell an implementing session
      defers. The agent's advantage is the LANE — smells are blocking, patterns are counted across the tree, root
      causes are named, and GATE plus the push hook enforce it — not raw detection when both are told to look.
- ⚠️ Three of five fixtures were authored by the same model family being evaluated, so they cannot expose shared
  blind spots. Only the backtest and the restraint fixture are defects neither side authored.
- Where the agent added value: the **root-cause climb** found that the rail's per-card `getRecipeById` would hit
  the detail handler that captures `recipe_viewed` (`recipes.controller.ts`, ADR-0030 §1/§3) and permanently
  inflate lifetime view counts — found by neither the baseline nor the fixture author; the **pattern breadth**
  (6 sites vs 2) matched the later real fix; it **ran the repo's own gates** (`patternRegister.test.ts`, typecheck,
  lint) instead of predicting them; and its **remediations were platform-checked**.
- **Cost is not lower.** REVIEW/INSPECT are comparable to or heavier than the baseline. GATE is roughly twice
  as fast as REVIEW (≈ 6 minutes on a 223-line diff) — usable before a push, not per keystroke.
- **The second backtest reproduced the first.** On a NestJS/DAL defect class neither side authored, both reviewers
  scored 4/5 and missed the same item; the agent's extra was a ruling check on the planned fix, at 1.5× the tokens.
  Its scanners added nothing there: the scratch worktree had no `node_modules`, so type-aware lint could not run.
  Two backtests agreeing is the strongest evidence here that the agent's edge is procedure, not detection.
- **The `closeRef` "false positive" was not one.** Both reviewers recommended deleting `HomeMobileNav`'s `closeRef`
  as redundant with Radix's default; this record first scored that against what looked like an owner ruling. The
  ruling was the component's own doc comment. Measured on 2026-09-13: with the `onOpenAutoFocus` override removed,
  `HomeChrome.test.tsx` and `HomeMobileNav.test.tsx` pass 24/24, including "focus moves to the close control on
  open" — Radix 1.1.16's `focusFirst(removeLinks(...))` already lands there. The HALT gate added for it
  (installed-source verification, find the pinning test) changed the agent's behaviour as intended on the re-run,
  and stays. The ref was then deleted: the pinning test was mutation-checked (a focusable control placed ahead of
  the close button reds it), so it distinguishes the two behaviours after all.
- **Dogfooded on this change.** A GATE on this document's own change BLOCKED it on two real defects the author's
  full-suite run had missed — an undeclared `react` in the ESLint fixtures (CI's boundaries ratchet) and the web
  Replace path discarding the admission verdict — and four minors. It also mis-attributed one ratchet failure to a test file; the real source was a stale, gitignored `dist/`. The cause was the tool, not the reading: `boundariesRatchet.mjs` named only `package -> dependency`, and `rg` skips ignored files, so a search could only land on a comment. The ratchet now prints each NEW violation's file:line and excludes (while listing) findings in gitignored build output — which also stops `--update` baselining a phantom; the agent's scanner does the same.

## 4. Defects the evaluation surfaced in the live tree — and how each was closed

Verified by hand at `60fb10aa`, then fixed test-first:

1. **`initialsFor`** (`packages/apps/commise/features/core/src/utils/initials.ts`) — code-point iteration yielded
   `'🇫C'` for `'🇫🇷 Marie Curie'`, `'👩C'` for `'👩‍🍳 Chef'`, `'J('` for `'Jane Doe (she/her)'`. An initial is now
   the leading `\p{L}\p{M}*` of each word that starts with a letter (compiled by the repo's `hermesc`; Hermes has no
   `Intl.Segmenter`). The old `'🍳' → '🍳'` expectation was rewritten, not edited: a letterless name yields `''`
   and both top bars draw their existing fallback.
2. **Photo pick past the cap.** `useRecipePhotoUploadQueue.enqueue` silently truncated a batch, and the web edit
   container had already minted an object URL per file. The cap arithmetic existed three times (the queue and both
   create containers) and the edit container had none. Now ONE pure policy (`remainingPhotoSlots` +
   `admitPhotoBatch` in `photos/model.ts`, per `staff-architect`'s review) admits a batch whole or refuses it whole;
   `enqueue` RETURNS the verdict and exposes `remaining`; the edit container revokes what it minted and shows
   `photos.overCapError`; the draft flush reads the verdict instead of assuming it; mobile handles it too.
3. **ESLint.** The shared config now ships `@typescript-eslint/no-floating-promises`, `no-misused-promises` and
   `await-thenable`, and every `eslint-plugin-react-hooks` 7.1.1 `recommended` rule at `error`. Measured before
   enabling: 44 reports across 28 files. All were resolved and every package lints at zero; `require-await` was left off (503
   reports, nearly all `async` methods satisfying a Promise interface). What resolving them meant:
    - **Fixed in place:** a ref read during render (`EnterTransition` → lazy `useState`; `useReturnFocusOnClose`'s
      DOM snapshot → state, which also rolls back with a discarded render); state following a prop moved from
      effects into render (`useDiscardGuard`, `RecipeConflictView` ×2, `useRecipeEditor`'s seed); a redundant
      `setState` deleted from an effect (`useParseJobReview` re-set a stall clock its own decision never needed); Effect Events for non-reactive callbacks (`useIngredientResolver`, the photo queue's `upload`); a memo
      reading pages its key did not cover (`useRecipeNutritionBatches`); an ineffective `useCallback`
      (`RecipeDiscoveryContainer`); two async handlers passed to void props; a test helper named `useOf`; loosely typed
      test mocks (`ReturnType<typeof vi.fn>` → `Mock`).
    - **Suppressed with a stated invariant (4):** `RoadmapWidgetSlot` web + mobile (`static-components` cannot see
      that a loader-keyed cache returns one component per loader — pinned by a new "loads once across re-renders and
      a remount" test) and the photo queue's drive effect plus the draft flush (`set-state-in-effect` — each IS the
      synchronisation with an external process, and the queue's single-flight invariant needs the id set before the
      upload starts).
    - Two behaviour changes were test-proven, not assumed: `useDiscardGuard` no longer commits a dirty frame after a
      save, and `useRecipeEditor`'s navigation test was REWRITTEN — the commit that paired the new recipe's query with
      the previous recipe's draft no longer exists, and the test now proves that (it fails on the effect seed).

## 5. Residual risks

- ⚠️ The corpus (438 entries) is dated to the versions in each reference's _Scope & sources_ table and rots as
  frameworks move; UNVERIFIED entries were not confirmed against a primary source.
- ⚠️ `eslint-plugin-react` and `eslint-plugin-jsx-a11y` do not declare ESLint 10 peer support; both were verified
  working on 10.9.1 with the React version passed explicitly.
- ⚠️ Two backtests (React refs; NestJS atomicity) are still two data points, both reviewed by one model family.
- ⚠️ The push hook binds Claude Code sessions only, and `SCQ_GATE_WAIVED` is an honour system with a visible trace.
  A GATE on a large diff costs ≈ 10 minutes, which is the pressure most likely to erode it.
- ⚠️ `useRecipeDraftPhotos`' flush is still an effect keyed on the created id, with a `set-state-in-effect`
  suppression. Whether it should be an event fired from create success is a `staff-architect` question, not yet asked.
