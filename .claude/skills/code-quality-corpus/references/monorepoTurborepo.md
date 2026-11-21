# Monorepos & Turborepo — code-quality reference corpus

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID      | Smell                                                                                      | Section                                 | Detected by | Default severity | Architecture |
| ------- | ------------------------------------------------------------------------------------------ | --------------------------------------- | ----------- | ---------------- | ------------ |
| MONO-01 | Cacheable task with missing or wrong `outputs`                                             | Task graph & caching correctness        | partial     | major            | no           |
| MONO-02 | `inputs` too narrow → stale cache hit                                                      | Task graph & caching correctness        | partial     | major            | no           |
| MONO-03 | Typecheck/lint/test not depending on upstream changes (parallel-but-wrong)                 | Task graph & caching correctness        | judgement   | blocker          | no           |
| MONO-04 | Missing ordering edge (`^build`) / relying on `--parallel`                                 | Task graph & caching correctness        | tool        | major            | no           |
| MONO-05 | Side-effecting task left cacheable                                                         | Task graph & caching correctness        | judgement   | blocker          | yes          |
| MONO-06 | Environment variables not in the hash → false cache hit (wrong config shipped)             | Task graph & caching correctness        | partial     | blocker          | yes          |
| MONO-07 | Root workspace churn invalidating everything                                               | Task graph & caching correctness        | partial     | minor            | no           |
| MONO-08 | Package Configuration silently replacing inherited arrays                                  | Task graph & caching correctness        | partial     | major            | no           |
| MONO-09 | Non-deterministic task outputs (timestamps, absolute paths, network)                       | Task graph & caching correctness        | judgement   | major            | no           |
| MONO-10 | Unsigned remote cache (cache poisoning surface)                                            | Task graph & caching correctness        | partial     | blocker          | yes          |
| MONO-11 | `--affected` / filtered CI on a shallow clone, or narrowing merge gates                    | Task graph & caching correctness        | judgement   | minor            | no           |
| MONO-12 | Phantom (undeclared) dependencies resolved through hoisting                                | Package boundaries & dependency hygiene | tool        | major            | yes          |
| MONO-13 | Relative imports crossing package boundaries                                               | Package boundaries & dependency hygiene | tool        | major            | yes          |
| MONO-14 | Deep imports bypassing a package's `exports`                                               | Package boundaries & dependency hygiene | partial     | major            | yes          |
| MONO-15 | Circular workspace dependencies (package-level and module-level)                           | Package boundaries & dependency hygiene | tool        | major            | yes          |
| MONO-16 | App-to-app imports / importing e2e projects                                                | Package boundaries & dependency hygiene | tool        | major            | yes          |
| MONO-17 | Layering / tag rules absent in a repo with many packages                                   | Package boundaries & dependency hygiene | tool        | minor            | yes          |
| MONO-18 | Version skew of the same external dependency                                               | Package boundaries & dependency hygiene | tool        | major            | no           |
| MONO-19 | Duplicated React (or other singleton) instances                                            | Package boundaries & dependency hygiene | tool        | blocker          | yes          |
| MONO-20 | Dependency declared in the wrong field                                                     | Package boundaries & dependency hygiene | tool        | major            | no           |
| MONO-21 | Dead code across the workspace (unused files/exports/deps)                                 | Package boundaries & dependency hygiene | partial     | minor            | no           |
| MONO-22 | Barrel packages / intra-package barrels                                                    | Package boundaries & dependency hygiene | partial     | minor            | yes          |
| MONO-23 | Dumping-ground `shared` / `utils` / `common` packages (and nano-packages)                  | Package boundaries & dependency hygiene | judgement   | major            | yes          |
| MONO-24 | TS path aliases that bypass package resolution                                             | Package boundaries & dependency hygiene | partial     | major            | yes          |
| MONO-25 | TypeScript project references: missing where the toolchain needs them, present where it d… | Package boundaries & dependency hygiene | judgement   | minor            | no           |
| MONO-26 | Lint/typecheck not covering every file a package owns                                      | Package boundaries & dependency hygiene | partial     | major            | no           |
| MONO-27 | Hoisting-dependent Docker images / lockfile churn redeploying everything                   | Package boundaries & dependency hygiene | partial     | major            | yes          |
| MONO-28 | Root package not private / internal package accidentally publishable                       | Package boundaries & dependency hygiene | tool        | blocker          | no           |
| MONO-29 | Just-in-Time vs Compiled package chosen without accepting its trade-offs                   | Package boundaries & dependency hygiene | judgement   | major            | yes          |
| MONO-30 | Nested packages / workspace globs matching nothing                                         | Package boundaries & dependency hygiene | tool        | major            | no           |
| MONO-31 | Ownership not encoded (CODEOWNERS) for shared packages                                     | Package boundaries & dependency hygiene | partial     | minor            | no           |
| MONO-32 | Lockfile drift / unordered manifests                                                       | Package boundaries & dependency hygiene | tool        | major            | no           |

<!-- END GENERATED INDEX -->

Domain prefix: `MONO-`. Turborepo facts are from the rendered docs pages read by raw scrape on 2026-09-13;
tool rule names were read from each tool's own README/source/docs. Versions from the npm registry the same day.

## Scope & sources consulted

| Source                                                                                                                                            | Version / date read                             | URL                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Turborepo docs — Structuring a repository                                                                                                         | turbo **2.10.12** (npm latest), read 2026-09-13 | https://turborepo.com/docs/crafting-your-repository/structuring-a-repository                                                                                                                                                                                                                     |
| Turborepo — Managing dependencies                                                                                                                 | 2.10.x                                          | https://turborepo.com/docs/crafting-your-repository/managing-dependencies                                                                                                                                                                                                                        |
| Turborepo — Internal packages (JIT / Compiled / Publishable)                                                                                      | 2.10.x                                          | https://turborepo.com/docs/core-concepts/internal-packages                                                                                                                                                                                                                                       |
| Turborepo — Configuring tasks (`dependsOn`, `outputs`, `inputs`, root tasks, Transit Nodes, `cache:false`)                                        | 2.10.x                                          | https://turborepo.com/docs/crafting-your-repository/configuring-tasks                                                                                                                                                                                                                            |
| Turborepo — Caching (global vs package hash inputs, worktree cache sharing, `--dry`, `--summarize`)                                               | 2.10.x                                          | https://turborepo.com/docs/crafting-your-repository/caching                                                                                                                                                                                                                                      |
| Turborepo — Using environment variables (strict mode default, framework inference, `.env`)                                                        | 2.10.x                                          | https://turborepo.com/docs/crafting-your-repository/using-environment-variables                                                                                                                                                                                                                  |
| Turborepo — turbo.json reference (`$TURBO_ROOT$`, `$TURBO_DEFAULT$`, `$TURBO_EXTENDS$`, deferred hashing, `futureFlags`, `remoteCache.signature`) | 2.10.x                                          | https://turborepo.com/docs/reference/configuration                                                                                                                                                                                                                                               |
| Turborepo — Package Configurations                                                                                                                | 2.10.x                                          | https://turborepo.com/docs/reference/package-configurations                                                                                                                                                                                                                                      |
| Turborepo — `turbo boundaries` (experimental)                                                                                                     | 2.10.x                                          | https://turborepo.com/docs/reference/boundaries                                                                                                                                                                                                                                                  |
| Turborepo — `turbo prune`, Docker guide                                                                                                           | 2.10.x                                          | https://turborepo.com/docs/reference/prune ; https://turborepo.com/docs/guides/tools/docker                                                                                                                                                                                                      |
| Turborepo — Remote caching (HMAC signature)                                                                                                       | 2.10.x                                          | https://turborepo.com/docs/core-concepts/remote-caching                                                                                                                                                                                                                                          |
| Turborepo — `turbo run` reference (`--affected`, `--dry=json`, `--summarize`, `--only`, `--parallel` deprecated, `--env-mode`)                    | 2.10.x                                          | https://turborepo.com/docs/reference/run                                                                                                                                                                                                                                                         |
| Turborepo — Constructing CI, TypeScript guide, Publishing libraries, Package & task graph, `turbo query`                                          | 2.10.x                                          | https://turborepo.com/docs/crafting-your-repository/constructing-ci ; https://turborepo.com/docs/guides/tools/typescript ; https://turborepo.com/docs/guides/publishing-libraries ; https://turborepo.com/docs/core-concepts/package-and-task-graph ; https://turborepo.com/docs/reference/query |
| sherif README (rules)                                                                                                                             | sherif **1.13.0**                               | https://github.com/QuiiBz/sherif                                                                                                                                                                                                                                                                 |
| manypkg README (checks)                                                                                                                           | @manypkg/cli **0.25.1**                         | https://github.com/Thinkmill/manypkg                                                                                                                                                                                                                                                             |
| syncpack docs (status codes, version-group policies)                                                                                              | syncpack **15.3.3**                             | https://syncpack.dev/status/ ; https://syncpack.dev/version-groups/                                                                                                                                                                                                                              |
| knip issue types + monorepo docs                                                                                                                  | knip **6.35.1**                                 | https://knip.dev/reference/issue-types ; https://knip.dev/features/monorepos-and-workspaces                                                                                                                                                                                                      |
| dependency-cruiser recommended config + init template + rules reference                                                                           | dependency-cruiser **18.2.0**                   | https://github.com/sverweij/dependency-cruiser/tree/main/configs ; https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md                                                                                                                                               |
| Nx `@nx/enforce-module-boundaries` (docs v23 + rule source messages)                                                                              | @nx/eslint-plugin **23.2.1**                    | https://nx.dev/docs/kb/enforce-module-boundaries ; https://nx.dev/docs/features/enforce-module-boundaries ; https://github.com/nrwl/nx/blob/master/packages/eslint-plugin/src/rules/enforce-module-boundaries.ts                                                                                 |
| Nx TypeScript project linking                                                                                                                     | Nx v23                                          | https://nx.dev/docs/kb/typescript-project-linking                                                                                                                                                                                                                                                |
| eslint-plugin-import-x rule list, `no-cycle` doc                                                                                                  | 4.17.1                                          | https://github.com/un-ts/eslint-plugin-import-x/tree/master/docs/rules                                                                                                                                                                                                                           |
| eslint-plugin-turbo README (`turbo/no-undeclared-env-vars`)                                                                                       | main, 2026-09-13                                | https://github.com/vercel/turborepo/tree/main/packages/eslint-plugin-turbo                                                                                                                                                                                                                       |
| pnpm motivation / settings                                                                                                                        | pnpm **12.4.1**                                 | https://pnpm.io/motivation ; https://pnpm.io/settings                                                                                                                                                                                                                                            |
| Node.js packages (`exports` encapsulation)                                                                                                        | current                                         | https://nodejs.org/api/packages.html                                                                                                                                                                                                                                                             |
| React "Invalid Hook Call Warning" (duplicate React)                                                                                               | current                                         | https://react.dev/warnings/invalid-hook-call-warning                                                                                                                                                                                                                                             |
| TypeScript handbook — Project References                                                                                                          | current                                         | https://www.typescriptlang.org/docs/handbook/project-references.html                                                                                                                                                                                                                             |
| Docker build secrets                                                                                                                              | current                                         | https://docs.docker.com/build/building/secrets/                                                                                                                                                                                                                                                  |
| GitHub CODEOWNERS                                                                                                                                 | current                                         | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners                                                                                                                                                            |

## Detection command cheat-sheet (run these before judging)

| Question                                                 | Command                                                                                                                                                                | What to read                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| What would run, with what hash/inputs/outputs/env?       | `turbo run build --dry=json`                                                                                                                                           | `tasks[].inputs`, `outputs`, `environmentVariables`, `resolvedTaskDefinition`, `hash` (`null` + `hashReason` for deferred inputs) |
| Why did this miss / hit cache?                           | `turbo run build --summarize` twice, diff `.turbo/runs/*.json`                                                                                                         | `globalEnv`/`env` sections, file inputs, `hashOfExternalDependencies`                                                             |
| Package/task graph                                       | `turbo run build --graph=graph.html` (PNG/JPG/PDF/JSON deprecated for 3.0; graph over-states nodes — documented known bug) ; `turbo query ls --affected --output json` | edges, unexpected app→app edges                                                                                                   |
| Undeclared deps / cross-package file imports / tag rules | `turbo boundaries` (experimental)                                                                                                                                      | "Importing a file outside of the package's directory", "Importing a package that is not specified as a dependency"                |
| Unused files/exports/deps, unlisted deps, cycles         | `npx knip` ; `npx knip --workspace packages/foo` ; `npx knip --production --strict` ; `--include cycles`                                                               | issue keys `files`, `dependencies`, `unlisted`, `binaries`, `unresolved`, `exports`, `types`, `duplicates`, `cycles`              |
| Module-level cycles/orphans/undeclared npm deps          | `npx depcruise src --config .dependency-cruiser.cjs`                                                                                                                   | `no-circular`, `no-orphans`, `no-non-package-json`, `not-to-unresolvable`, `not-to-dev-dep`                                       |
| Version skew / root hygiene                              | `npx sherif` ; `npx @manypkg/cli check` ; `npx syncpack lint`                                                                                                          | `multiple-dependency-versions`, `EXTERNAL_MISMATCH`, `SameRangeMismatch`…                                                         |
| Duplicate React                                          | `npm ls react` / `pnpm why react`                                                                                                                                      | more than one resolved version                                                                                                    |
| Env vars used in code but not in turbo.json              | ESLint `turbo/no-undeclared-env-vars`                                                                                                                                  | reported var names                                                                                                                |

---

## Task graph & caching correctness

### MONO-01 Cacheable task with missing or wrong `outputs`

- **Signal:** `turbo.json` task that emits files (`build`, `codegen`, `bundle`, `docs:generate`) with no `outputs` key or `outputs: []`; a Next.js build whose `outputs` omits `.next/**` or forgets `!.next/cache/**`; outputs globs pointing at root paths without `$TURBO_ROOT$`.
- **Tool coverage:** partial — `turbo run <task> --dry=json` shows `outputs` per task; `--summarize` lists "All the files included in the cached artifact". No linter flags the omission; judgement decides whether a task produces files.
- **Why it hurts:** reliability/CI correctness — docs: "Omitting this key or passing an empty array tells turbo to cache nothing (except logs…)". On a cache hit the logs replay green but `dist/` is absent, so a downstream task (Docker `COPY dist`, deploy) fails or ships stale files left from a previous checkout.
- **Severity:** major; blocker if a deploy step consumes the outputs.
- **Remediation:** declare exact outputs per framework (docs examples: Next.js `[".next/**", "!.next/cache/**", "!.next/dev/**"]`, Vite/tsc `["dist/**"]`); in Package Configurations use `$TURBO_EXTENDS$` to append rather than replace — trap: too-broad outputs (`**`) upload source/`node_modules` into the remote cache and restore over working files; outputs must resolve inside the repo ("Turborepo will not cache outputs that escape the repository").
- **Not a finding when:** the task produces no files (lint, typecheck, test without coverage) — log-only caching is intended.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/configuring-tasks ; https://turborepo.com/docs/reference/configuration ; https://turborepo.com/docs/crafting-your-repository/caching

### MONO-02 `inputs` too narrow → stale cache hit

- **Signal:** `"inputs": ["src/**/*.ts"]` on a task that also reads `tsconfig.json`, `package.json#exports`, a root config, `.env`, fixtures, SQL migrations, codegen output, or files outside the package; `inputs` written without `$TURBO_DEFAULT$`.
- **Tool coverage:** partial — `--dry=json` `inputs` list shows exactly what is hashed; judgement required to know what the tool actually reads.
- **Why it hurts:** correctness — docs: specifying `inputs` "opts out of all of Turborepo's default inputs behavior, including following along with changes tracked by source control… your .gitignore file will no longer be respected". A change to an un-hashed file produces a cache hit with a stale (wrong) result — CI green on broken code.
- **Severity:** major (blocker when the task is a test/typecheck gate).
- **Remediation:** start from `["$TURBO_DEFAULT$", "!README.md"]` and subtract; reference repo-root files with `"$TURBO_ROOT$/tsconfig.json"`; for files generated by a dependency task in the same run use structured inputs `{ "mode": "jit", "globs": [...] }` or `{ "mode": "dependencyOutputs" }` (deferred hashing) — trap: `package.json`, `turbo.json` and lockfiles are always inputs and can't be excluded, so don't try to "optimise" them away.
- **Not a finding when:** narrow inputs for a genuinely narrow tool (docs' own example: spell-check on `**/*.md`).
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/configuring-tasks ; https://turborepo.com/docs/reference/configuration

### MONO-03 Typecheck/lint/test not depending on upstream changes (parallel-but-wrong)

- **Signal:** `"check-types": {}` or `"test": {}` with no `dependsOn` in a repo where packages import each other's source (JIT packages).
- **Tool coverage:** none — judgement (read `turbo.json` against the package graph).
- **Why it hurts:** correctness — Turborepo docs walk through exactly this: make a breaking change in `ui`, run `turbo check-types`, and the app "will show a successful cache hit, despite not being updated to use the new interface". The dependent's hash does not include the dependency's source unless there is a graph edge.
- **Severity:** blocker for merge gates.
- **Remediation:** Transit Node pattern: `"transit": { "dependsOn": ["^transit"] }`, `"check-types": { "dependsOn": ["transit"] }` (keeps parallelism and correctness) — trap: `dependsOn: ["^check-types"]` is correct but serialises the graph.
- **Not a finding when:** the task truly does not read any other package (e.g. markdown spell-check), or dependencies are consumed only via compiled `dist` that is itself an output of a `^build` edge.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/configuring-tasks ; https://turborepo.com/docs/guides/tools/typescript

### MONO-04 Missing ordering edge (`^build`) / relying on `--parallel`

- **Signal:** `build` without `dependsOn: ["^build"]` where apps consume Compiled Packages; `turbo run ... --parallel` in scripts/CI; `turbo run test --only` in CI.
- **Tool coverage:** `turbo run --parallel` is **deprecated** ("discards the task dependency graph, which means caching, ordering, and dependency-awareness are all lost"); `--dry=json` shows `dependencies` per task.
- **Why it hurts:** reliability — race: the app builds against a missing or previous `dist`; passes locally when `dist` exists, fails on clean CI (or worse, succeeds against stale `dist`).
- **Severity:** major.
- **Remediation:** `dependsOn: ["^build"]`; same-package ordering `dependsOn: ["build"]`; cross-package specific `["utils#build"]`; `with` for long-running siblings (`persistent`) — trap: you cannot `dependsOn` a persistent task.
- **Not a finding when:** all internal packages are JIT (no build step) — then there is nothing to order, but see MONO-03 for hash propagation.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/configuring-tasks ; https://turborepo.com/docs/reference/run

### MONO-05 Side-effecting task left cacheable

- **Signal:** tasks named `deploy`, `publish`, `migrate`, `db:push`, `release`, `upload`, `notify`, `seed`, `e2e` against a live environment, without `"cache": false`; `dev` without `persistent: true, cache: false`.
- **Tool coverage:** none — judgement (`--dry=json` shows `cache` per task).
- **Why it hurts:** correctness/operability — a cache hit **replays the log** and skips the side effect: the deploy/migration "succeeded" without running. Docs: "Some tasks should always be run no matter what, like a deployment script after a cached build. For these tasks, add `cache: false`."
- **Severity:** blocker for deploy/migrate/publish.
- **Remediation:** `"cache": false` (and usually no `outputs`); keep the cacheable build as a `dependsOn` of the uncached deploy.
- **Not a finding when:** the task is pure (build/lint/unit test) or an e2e task against a hermetic fixture whose inputs are fully hashed.
- **Architecture:** yes if deploy ordering is encoded only in the task graph — escalate to release owner.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/configuring-tasks ; https://turborepo.com/docs/reference/configuration

### MONO-06 Environment variables not in the hash → false cache hit (wrong config shipped)

- **Signal:** code reads `process.env.X` / `import.meta.env.X` / `os.environ["X"]` in a cacheable task and `X` is absent from that task's `env`/`globalEnv`; `.env*` files not in `inputs`/`globalDependencies`; `--env-mode=loose` or `"envMode": "loose"`; vars set inline in the script (`"dev": "export X=1 && next dev"`); a JIT package reading env consumed by an app that doesn't declare it; secrets placed in `env` (hashing) vs `passThroughEnv`.
- **Tool coverage:** `eslint-plugin-turbo:turbo/no-undeclared-env-vars` ; `turbo run --summarize` (diff `env`/`globalEnv`) ; Vercel platform env check (warns on deploy). partial: non-JS readers, dynamic keys (`process.env[name]`), and `.env` loading are judgement.
- **Why it hurts:** correctness/security — docs' own example: build for preview with `MY_API_URL`, then production build "see[s] a cache hit — even though the value… has changed" and ships the preview URL to prod. Strict mode (the default) makes undeclared vars _unavailable_, but docs warn it "doesn't guarantee task failure" if the app tolerates a missing var. Framework inference auto-adds `NEXT_PUBLIC_*`, `VITE_*`, `EXPO_PUBLIC_*`, etc. — but only those prefixes, and per package.
- **Severity:** blocker for build-time config (URLs, feature flags, keys baked into bundles); minor for lint/test tasks.
- **Remediation:** declare in `env` per task (wildcards `MY_API_*`, negation `!X`); `globalEnv` only for truly global; secrets that must not affect the hash → `passThroughEnv`; `.env` files in `inputs` (`"$TURBO_DEFAULT$", ".env*"`); put `.env` in the application package not the root; keep strict mode; fail fast on missing required env with a schema (zod/envalid) so strict mode _does_ fail — trap: `passThroughEnv` values do not change the hash, so a pass-through var that changes build output re-creates the bug.
- **Not a finding when:** the var is runtime-only for a server process that is not cached (`dev`, `start`), or it is covered by framework inference.
- **Architecture:** yes — build-time vs runtime config boundary; escalate.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/using-environment-variables ; https://turborepo.com/docs/reference/configuration ; https://github.com/vercel/turborepo/tree/main/packages/eslint-plugin-turbo

### MONO-07 Root workspace churn invalidating everything

- **Signal:** app/library dependencies in the root `package.json`; root `tsconfig.json` that packages extend by relative path; TypeScript scripts at the root; root depends on an internal package that changes often; frequent edits to `globalDependencies` files; `futureFlags` toggles.
- **Tool coverage:** `sherif:root-package-dependencies` (warn: only `devDependencies` in root) ; `manypkg:ROOT_HAS_PROD_DEPENDENCIES` ; `turbo query affected --packages` reports `RootInternalDepChanged`. partial: whether a root dep "belongs" is judgement.
- **Why it hurts:** performance/cost — docs: root `package.json`, lockfile changes affecting the root, source of internal packages the root depends on (transitively), `globalDependencies`, `globalEnv`, and future flags are all **global hash** inputs → every task misses cache; "If you install too many dependencies in the root… unnecessary cache misses."
- **Severity:** minor (cost), major in large repos with remote cache.
- **Remediation:** "Install dependencies where they're used"; root only holds repo tools (docs: `turbo`, `husky`, `lint-staged`); shared tsconfig as an internal package (`@repo/typescript-config`) extended by name; move root TS scripts into a package.
- **Not a finding when:** repo-management tooling at root.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/caching ; https://turborepo.com/docs/crafting-your-repository/managing-dependencies ; https://github.com/QuiiBz/sherif

### MONO-08 Package Configuration silently replacing inherited arrays

- **Signal:** `packages/x/turbo.json` with `"extends": ["//"]` redefining `outputs`/`env`/`inputs`/`dependsOn` without `$TURBO_EXTENDS$`.
- **Tool coverage:** partial — `turbo run build --dry-run` shows `resolvedTaskDefinition`.
- **Why it hurts:** correctness — docs: "array fields completely replace the values from the root turbo.json by default". A package adding `outputs: [".next/**"]` also drops root `env`/`dependsOn` if restated partially → MONO-01/04/06 in one package only, invisible in the root file.
- **Severity:** major.
- **Remediation:** `"outputs": ["$TURBO_EXTENDS$", ".next/**"]`; review `resolvedTaskDefinition` in the PR.
- **Not a finding when:** the replacement is intentional and complete.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/reference/package-configurations ; https://turborepo.com/docs/reference/configuration

### MONO-09 Non-deterministic task outputs (timestamps, absolute paths, network)

- **Signal:** build embeds `Date.now()`, git SHA, absolute paths, or fetches remote data; generated files containing machine paths; tests hitting live services in a cacheable task.
- **Tool coverage:** none — judgement; compare two `--summarize` runs.
- **Why it hurts:** reliability — docs: "Turborepo assumes that your tasks are deterministic." Also the new **git-worktree local cache sharing** restores artifacts "without rewriting their contents. If a task output contains the absolute path to its worktree, sharing that artifact can restore an output that points to another checkout."
- **Severity:** major when outputs contain absolute paths and worktrees/remote cache are in use.
- **Remediation:** pass volatile values via declared `env`; make paths relative; mark network-dependent tasks `cache: false`; set explicit `cacheDir` to isolate worktrees.
- **Not a finding when:** the volatile data is informational only and declared in `env`.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/caching

### MONO-10 Unsigned remote cache (cache poisoning surface)

- **Signal:** remote cache enabled (`TURBO_TOKEN`/`TURBO_TEAM`, self-hosted `apiUrl`) without `"remoteCache": { "signature": true }`; short `TURBO_REMOTE_CACHE_SIGNATURE_KEY`; untrusted PR builds with remote cache **write** access; `TURBO_TOKEN` passed as a Docker `--build-arg`.
- **Tool coverage:** partial — `futureFlags.longerSignatureKey` enforces ≥ 32-byte key at run start; `--cache=local:rw,remote:r` restricts writes. Docker build-arg leakage: judgement.
- **Why it hurts:** security/supply chain — anyone who can write the cache can inject artifacts that other machines restore and deploy. Docs: artifacts are HMAC-SHA256-signed and "Any artifacts that fail to verify will be ignored and treated as a cache miss"; "keys shorter than 32 bytes significantly weaken the signature". The Turborepo Docker guide example passes `TURBO_TOKEN` via `--build-arg`, but Docker docs: "Build arguments and environment variables are inappropriate for passing secrets… because they persist in the final image."
- **Severity:** blocker for repos where cache artifacts are deployed.
- **Remediation:** enable signature + `longerSignatureKey`; forks/untrusted CI read-only (`--cache=local:rw,remote:r`); Docker `RUN --mount=type=secret,id=turbo_token` — trap: do not copy the docs' Dockerfile `--build-arg` pattern verbatim.
- **Not a finding when:** no remote cache; single-developer local cache.
- **Architecture:** yes — CI trust boundary; escalate to security.
- **Sources:** https://turborepo.com/docs/core-concepts/remote-caching ; https://turborepo.com/docs/reference/configuration ; https://turborepo.com/docs/guides/tools/docker ; https://docs.docker.com/build/building/secrets/

### MONO-11 `--affected` / filtered CI on a shallow clone, or narrowing merge gates

- **Signal:** CI `actions/checkout` default `fetch-depth: 1` with `turbo run … --affected` or `--filter=...[main...HEAD]`; merge gate running only `--affected` with no periodic full run; `affectedUsingTaskInputs` enabled with narrow `inputs`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** docs: "If the checkout is too shallow, then all packages will be considered changed" (slow, safe direction); conversely task-level affected with too-narrow `inputs` (MONO-02) skips tasks that should run (unsafe direction).
- **Severity:** minor (shallow) / major (skipping gates).
- **Remediation:** fetch enough history (docs suggest `--filter=blob:none --depth=0`); keep a scheduled full run.
- **Not a finding when:** full runs are used for gating and affected only for fast feedback.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/reference/run ; https://turborepo.com/docs/crafting-your-repository/constructing-ci ; https://turborepo.com/docs/reference/configuration

## Package boundaries & dependency hygiene

### MONO-12 Phantom (undeclared) dependencies resolved through hoisting

- **Signal:** `import x from "lodash"` in a package whose `package.json` doesn't list `lodash` (works because the root or a sibling installed it); works under npm/Yarn Classic, breaks under pnpm or in a pruned Docker image.
- **Tool coverage:** `turbo boundaries` ("Importing a package that is not specified as a dependency") ; `knip` issue type `unlisted` (Unlisted dependencies) and `binaries` ; `dependency-cruiser:no-non-package-json` (error; dependency type `npm-no-pkg`) and `not-to-unresolvable` ; `eslint-plugin-import-x:no-extraneous-dependencies` ; `@nx/enforce-module-boundaries` with `banTransitiveDependencies: true` (default `false`; message "Only packages defined in the "package.json" can be imported. Transitive or unresolvable dependencies are not allowed.").
- **Why it hurts:** reliability/portability — pnpm docs: with npm or Yarn Classic "all packages are hoisted to the root of the modules directory. As a result, source code has access to dependencies that are not added as dependencies to the project." A version bump elsewhere silently changes what this package gets; `turbo prune` removes deps not declared by the target → broken image.
- **Severity:** major (blocker if in a deployed service image).
- **Remediation:** declare the dep in the consuming package; prefer pnpm's symlinked (non-flat) `node_modules`; keep `turbo boundaries`/knip in CI — trap: `nodeLinker: hoisted`/`shamefullyHoist` re-enables phantom deps.
- **Not a finding when:** the import is a Node builtin, or a peer dependency provided by the host (declared in `peerDependencies`).
- **Architecture:** yes when it crosses deployable boundaries (image contents).
- **Sources:** https://pnpm.io/motivation ; https://turborepo.com/docs/reference/boundaries ; https://knip.dev/reference/issue-types ; https://github.com/sverweij/dependency-cruiser/tree/main/configs/rules

### MONO-13 Relative imports crossing package boundaries

- **Signal:** `import … from "../../packages/other/src/x"`; `require("../../../libs/y")`; tsconfig `include` reaching into sibling packages.
- **Tool coverage:** `turbo boundaries` ("Importing a file outside of the package's directory") ; `@nx/enforce-module-boundaries` (`noRelativeOrAbsoluteImportsAcrossLibraries`: "Projects cannot be imported by a relative or absolute path, and must begin with a npm scope") ; `eslint-plugin-import-x:no-relative-packages` ; dependency-cruiser custom `forbidden` rule with `path`/`pathNot`.
- **Why it hurts:** modifiability/cache correctness — bypasses `package.json` so the package graph lacks the edge: Turborepo won't order builds or include the file in the dependent's hash (stale cache), `turbo prune` omits it, and the importer depends on internals. Turborepo docs: "If you ever find yourself writing `../` to get from one package to another, you likely have an opportunity to re-think your approach."
- **Severity:** major.
- **Remediation:** add the package as a workspace dependency and import by name via its `exports`; Move Function into the owning package.
- **Not a finding when:** tooling/config files deliberately referencing repo-root config with `$TURBO_ROOT$` declared as input.
- **Architecture:** yes — package boundary violation; escalate.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/structuring-a-repository ; https://turborepo.com/docs/reference/boundaries ; https://github.com/nrwl/nx/blob/master/packages/eslint-plugin/src/rules/enforce-module-boundaries.ts

### MONO-14 Deep imports bypassing a package's `exports`

- **Signal:** `import x from "@repo/ui/src/internal/x"`, `@repo/lib/dist/foo.js`, or `node_modules/@repo/…/file` paths; a package with no `exports` field (everything importable).
- **Tool coverage:** Node runtime: subpaths not in `exports` throw `ERR_PACKAGE_PATH_NOT_EXPORTED` (Node docs note it "is not a strong encapsulation" — absolute paths still resolve) ; TypeScript with `moduleResolution: NodeNext/Bundler` respects `exports` ; `eslint-plugin-import-x:no-internal-modules` ; dependency-cruiser custom rule. partial: bundler aliases and `paths` can bypass.
- **Why it hurts:** modifiability — consumer depends on file layout; internal refactor breaks others; Turborepo docs call `node_modules` locations "not a part of the public API of package managers".
- **Severity:** major across teams; minor inside one team's packages.
- **Remediation:** add an explicit subpath export (`"./button": "./src/button.tsx"`) — docs recommend per-entry exports over barrels.
- **Not a finding when:** the path is a declared export subpath.
- **Architecture:** yes — public surface/contract of a package.
- **Sources:** https://nodejs.org/api/packages.html ; https://turborepo.com/docs/crafting-your-repository/structuring-a-repository ; https://turborepo.com/docs/crafting-your-repository/managing-dependencies

### MONO-15 Circular workspace dependencies (package-level and module-level)

- **Signal:** `A` depends on `B` and `B` on `A` (often via `devDependencies` for tests/fixtures); module cycles inside a package.
- **Tool coverage:** Turborepo documents its Task Graph as a DAG ("directed acyclic graph"); what `turbo` actually does when the _package_ graph contains a cycle (error vs. warning vs. silent mis-ordering) is `UNVERIFIED` — do not rely on turbo to catch it ; `@nx/enforce-module-boundaries` `noCircularDependencies` (and `ignoredCircularDependencies` escape hatch) ; `dependency-cruiser:no-circular` (error) ; `knip` issue type `cycles` (not included by default, `warn` rule; set `rules.cycles: "error"`) ; `eslint-plugin-import-x:no-cycle` ("comparatively computationally expensive"; `maxDepth`).
- **Why it hurts:** build order undefined; hot reload/init-order bugs (`undefined` at import); packages cannot be released or tested independently.
- **Severity:** major — raise to blocker when a package-level cycle participates in `^build` ordering (build order is then undefined whatever turbo reports).
- **Remediation:** Extract Package for the shared core; Dependency Inversion (interface in the lower package); move test fixtures to a separate `testing` package; for type-only cycles use `import type` — trap: breaking the cycle with a devDependency still creates a task-graph cycle for `^build`.
- **Not a finding when:** type-only imports erased at compile time inside one package (module-level tools may still flag; use `tsPreCompilationDeps` config in depcruise).
- **Architecture:** yes — escalate.
- **Sources:** https://turborepo.com/docs/core-concepts/package-and-task-graph ; https://knip.dev/reference/issue-types ; https://github.com/sverweij/dependency-cruiser/blob/main/configs/rules/no-circular.cjs ; https://github.com/un-ts/eslint-plugin-import-x/blob/master/docs/rules/no-cycle.md

### MONO-16 App-to-app imports / importing e2e projects

- **Signal:** `apps/web` imports from `apps/admin` (by path or by package name); app package listed in another package's dependencies.
- **Tool coverage:** `@nx/enforce-module-boundaries` (`noImportsOfApps`: "Imports of apps are forbidden"; `noImportsOfE2e`) ; `turbo boundaries` tags (`"tags": ["app"]` + `dependents.deny`) ; dependency-cruiser custom `forbidden` rule.
- **Why it hurts:** deployables become coupled; shared code has no owner; deploying one app requires building the other.
- **Severity:** major.
- **Remediation:** Extract the shared code into a library package with an owner; tag rules to lock it.
- **Not a finding when:** an e2e/test package depending on the app it tests.
- **Architecture:** yes — escalate.
- **Sources:** https://github.com/nrwl/nx/blob/master/packages/eslint-plugin/src/rules/enforce-module-boundaries.ts ; https://turborepo.com/docs/reference/boundaries

### MONO-17 Layering / tag rules absent in a repo with many packages

- **Signal:** > ~10 packages with no `boundaries.tags` rules, no Nx `depConstraints`, no dependency-cruiser `forbidden` rules; UI packages importing server-only packages; "domain" packages importing framework packages.
- **Tool coverage:** `turbo boundaries` tags (`dependencies.allow/deny`, `dependents.allow/deny`; package names allowed in lists; "applied even for dependencies of dependencies") ; Nx `depConstraints` with `onlyDependOnLibsWithTags`, `notDependOnLibsWithTags`, `allowedExternalImports`, `bannedExternalImports`, `checkNestedExternalImports` ; Nx "A project without tags matching at least one constraint cannot depend on any libraries". Judgement to design the layers.
- **Why it hurts:** architecture erosion is silent until a Big Ball of Mud; server secrets/SDKs leak into client bundles.
- **Severity:** minor (missing guard) → major when a violation already exists.
- **Remediation:** tag by `type:` (app/feature/ui/data/util) and `scope:`; start deny-lists at the most dangerous edge (client → server) — trap: `turbo boundaries` is **experimental** (RFC), so pin turbo and expect config changes.
- **Not a finding when:** small repos (a handful of packages) where review suffices.
- **Architecture:** yes — this IS the architecture guard; escalate design of tags.
- **Sources:** https://turborepo.com/docs/reference/boundaries ; https://nx.dev/docs/kb/enforce-module-boundaries ; https://nx.dev/docs/features/enforce-module-boundaries

### MONO-18 Version skew of the same external dependency

- **Signal:** different ranges for `react`, `typescript`, `zod`, `@types/node`, a design system, or an SDK across packages; `react` vs `react-dom` mismatch in one package.
- **Tool coverage:** `sherif:multiple-dependency-versions` (error), `sherif:unsync-similar-dependencies` (error) ; `manypkg:EXTERNAL_MISMATCH` ("ranges… should exactly match"; excludes peerDependencies), `manypkg:INTERNAL_MISMATCH` ; `syncpack lint` statuses e.g. `SameRangeMismatch`, `SemverRangeMismatch`, `DiffersToHighestOrLowestSemver`, `DiffersToLocal`, `IsBanned` with version-group policies Banned / Highest Semver / Lowest Semver / Pinned / Same Range / Snapped To / Ignored ; pnpm catalogs (knip issue types `catalog`, `catalogReferences`).
- **Why it hurts:** two copies bundled, type incompatibilities between packages (`Type 'X' is not assignable to type 'X'`), singleton breakage (React, i18n, query clients).
- **Severity:** major for singletons/types shared across boundaries; minor for leaf tools.
- **Remediation:** pnpm catalogs / syncpack version groups; deliberate exceptions via `npm:` aliases (manypkg) or `sherif -i name@version` — trap: Turborepo docs note forcing one version everywhere can block teams; allow documented, grouped exceptions rather than forbidding skew entirely.
- **Not a finding when:** intentionally isolated deployables that never share runtime or types (e.g. a legacy app pinned during migration) and the exception is recorded.
- **Architecture:** sometimes — escalate when skew is on a shared contract library.
- **Sources:** https://github.com/QuiiBz/sherif ; https://github.com/Thinkmill/manypkg ; https://syncpack.dev/status/ ; https://turborepo.com/docs/crafting-your-repository/managing-dependencies

### MONO-19 Duplicated React (or other singleton) instances

- **Signal:** "Invalid hook call"; context providers not found across packages; `npm ls react` shows more than one; a library package listing `react` in `dependencies` instead of `peerDependencies`.
- **Tool coverage:** `npm ls react` / `pnpm why react` ; `manypkg:INVALID_DEV_AND_PEER_DEPENDENCY_RELATIONSHIP` (peer deps must also be dev deps) ; `dependency-cruiser:peer-deps-used`/`optional-deps-used` (init template) ; sherif `multiple-dependency-versions`.
- **Why it hurts:** reliability — React docs: hooks require the app's `react` import to "resolve to the same module as the react import from inside the react-dom package… maybe a library you're using incorrectly specifies react as a dependency (rather than a peer dependency)."
- **Severity:** blocker (runtime crash) when present.
- **Remediation:** internal UI packages declare `react` as `peerDependencies` + `devDependencies`; dedupe; bundler `resolve.dedupe`/aliases as last resort.
- **Not a finding when:** micro-frontends deliberately isolating React versions (module federation with explicit sharing config).
- **Architecture:** yes for shared UI packages.
- **Sources:** https://react.dev/warnings/invalid-hook-call-warning ; https://github.com/Thinkmill/manypkg

### MONO-20 Dependency declared in the wrong field

- **Signal:** runtime import from a package listed only in `devDependencies`; `@types/*` in `dependencies` of private packages; same package in both `dependencies` and `devDependencies`; empty `"dependencies": {}`.
- **Tool coverage:** `dependency-cruiser:not-to-dev-dep` (init template) ; `dependency-cruiser:no-duplicate-dep-types` (warn) ; `manypkg:MULTIPLE_DEPENDENCY_TYPES` ; `sherif:types-in-dependencies`, `sherif:empty-dependencies` ; `knip --production` (devDependencies excluded in strict production mode).
- **Why it hurts:** `turbo prune --production` "Exclude[s] in-workspace packages listed only in devDependencies" → runtime `MODULE_NOT_FOUND` in the image; bloated images otherwise.
- **Severity:** major for services.
- **Remediation:** move to the correct field; run `knip --production --strict` in CI for deployables.
- **Not a finding when:** build-time-only deps of bundled apps (bundler inlines them) — dev is correct.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/reference/prune ; https://github.com/QuiiBz/sherif ; https://github.com/Thinkmill/manypkg ; https://knip.dev/reference/issue-types

### MONO-21 Dead code across the workspace (unused files/exports/deps)

- **Signal:** exports imported nowhere in the workspace; files unreachable from any entry; dependencies no longer imported; duplicate exports.
- **Tool coverage:** `knip` issue types `files`, `dependencies`, `exports`, `types`, `enumMembers`, `namespaceMembers`, `duplicates`, `nsExports`/`nsTypes` (not default) ; `dependency-cruiser:no-orphans` (warn) and `reachable: false` rules. partial: exports consumed by string (dynamic import, framework conventions) need knip plugins/`entry` config.
- **Why it hurts:** maintainability — Lava Flow; install/CI time; misleading public surface.
- **Severity:** minor (major for unused deps with CVEs).
- **Remediation:** delete; configure knip `entry`/`project` per workspace so framework-convention files aren't false positives.
- **Not a finding when:** a publishable package's public API (exports used by external consumers) — mark with knip `ignoreExportsUsedInFile`/`@public` JSDoc tag (`UNVERIFIED` exact tag name).
- **Architecture:** no.
- **Sources:** https://knip.dev/reference/issue-types ; https://knip.dev/features/monorepos-and-workspaces ; https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md

### MONO-22 Barrel packages / intra-package barrels

- **Signal:** `index.ts` whose body is only `export * from`/`export { … } from`; a package with a single `.` export re-exporting 50 modules; `import { Button } from "@repo/ui"` pulling the world.
- **Tool coverage:** partial — `knip` `duplicates`; `eslint-plugin-import-x:no-cycle` catches cycles barrels manufacture; no rule flags "barrel" as such (judgement).
- **Why it hurts:** performance/modifiability — Turborepo docs: barrel files "are difficult for compilers and bundlers to handle and can quickly lead to performance problems"; they hide the dependency graph and manufacture cycles.
- **Severity:** minor → major in client bundles or when they create cycles.
- **Remediation:** per-entry `exports` subpaths (`"./button": "./src/button.tsx"`) — trap: a barrel that _is_ the target of a `package.json` `exports` entry is a legitimate public surface; removing it is an API break.
- **Not a finding when:** package public entry point with a deliberate, small surface; generated schema barrels.
- **Architecture:** yes when it's a package's public contract.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/structuring-a-repository ; https://turborepo.com/docs/guides/tools/typescript

### MONO-23 Dumping-ground `shared` / `utils` / `common` packages (and nano-packages)

- **Signal:** package named `shared`, `common`, `utils`, `core`, `helpers` with unrelated modules (dates + auth + UI + API types); its dependents are nearly every package; high churn; conversely dozens of one-file packages each with their own build/config.
- **Tool coverage:** none — judgement. Metrics: dependents count from `turbo query ls`/`--graph`; churn from git; dependency-cruiser `moreUnstable` rule / metrics reporter for instability.
- **Why it hurts:** a change to any util invalidates the whole graph (cache misses everywhere), no clear owner (Divergent Change at package scale), cycles attract; nano-packages multiply config and version-skew surface.
- **Severity:** major for dumping grounds on hot paths.
- **Remediation:** split by reason-to-change (Extract Package per capability: `@repo/dates`, `@repo/auth-client`); merge nano-packages that always change together (Inline Package) — trap: don't split by technical type ("types", "constants") which re-creates shotgun surgery.
- **Not a finding when:** a small, stable, cohesive utility package with few dependencies.
- **Architecture:** yes — escalate package decomposition.
- **Sources:** judgement; https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md (`moreUnstable`)

### MONO-24 TS path aliases that bypass package resolution

- **Signal:** root `tsconfig` `compilerOptions.paths` mapping `@repo/*` to `packages/*/src`; JIT packages using `paths` internally; bundler aliases mirroring them.
- **Tool coverage:** partial — `turbo boundaries` (file outside package) ; Nx `noRelativeOrAbsoluteImportsAcrossLibraries`. Judgement otherwise.
- **Why it hurts:** the package manager graph and the compiler graph diverge: imports work without declaring the dependency (phantom edges), turbo misses ordering/hash edges, `turbo prune`/Docker break. Turborepo docs: a JIT package "cannot use the `compilerOptions.paths` configuration because TypeScript assumes that source code is being transpiled in the package where it is written"; recommends Node.js subpath `imports` (`"#*": "./src/*"`, TS ≥ 5.4).
- **Severity:** major.
- **Remediation:** workspace dependencies + `exports`; `imports` field for intra-package aliases.
- **Not a finding when:** Nx workspaces intentionally using path aliases _with_ `@nx/enforce-module-boundaries` (Nx documents path-alias linking as an option) — still note the Turborepo incompatibility.
- **Architecture:** yes.
- **Sources:** https://turborepo.com/docs/core-concepts/internal-packages ; https://turborepo.com/docs/guides/tools/typescript ; https://nx.dev/docs/kb/typescript-project-linking

### MONO-25 TypeScript project references: missing where the toolchain needs them, present where it doesn't

- **Signal:** Nx/`tsc -b` repo without `composite`/`references`; or a Turborepo repo adding a root solution `tsconfig` with `references` plus `composite` in every package alongside turbo caching.
- **Tool coverage:** none — judgement; Nx sync generators maintain references (`UNVERIFIED` generator name).
- **Why it hurts:** **the right answer depends on the orchestrator — do not flag blindly.** Turborepo docs: "We don't recommend using TypeScript Project References as they introduce both another point of configuration as well as another caching layer." Nx docs: with workspaces "also configure TypeScript project references to speed up your build and typecheck tasks" (`composite`, `declaration`, no `paths`). TS handbook caveat: dependents use built `.d.ts`, so you must build before editor navigation is clean.
- **Severity:** minor.
- **Remediation:** follow the orchestrator's documented model; in Turborepo use per-package `tsconfig` extending a shared config package and the Transit Node for typecheck; in Nx keep references synced.
- **Not a finding when:** the repo is consistent with its orchestrator's guidance.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/guides/tools/typescript ; https://nx.dev/docs/kb/typescript-project-linking ; https://www.typescriptlang.org/docs/handbook/project-references.html

### MONO-26 Lint/typecheck not covering every file a package owns

- **Signal:** package `tsconfig.json` `include: ["src"]` while `tests/`, `scripts/`, `*.config.ts`, `infra/` exist; `lint` script `eslint src`; root files with no `//#lint:root` task; packages missing `lint`/`check-types` scripts (turbo silently skips packages without the script).
- **Tool coverage:** partial — `tsc --listFilesOnly` vs `git ls-files '*.ts'` diff; knip `files` may surface unreferenced; `turbo run lint --dry=json` shows which packages have the task. Judgement to find omitted dirs.
- **Why it hurts:** type errors and lint violations accumulate in tests/config/infra — the files most likely to ship to CI/CD.
- **Severity:** major when infra/scripts are uncovered.
- **Remediation:** separate `tsconfig.test.json`/`tsconfig.node.json` referenced by the check script; root task `"//#lint:root"`; CI assertion that every workspace defines the gate scripts.
- **Not a finding when:** generated files deliberately excluded and regenerated in CI with a diff check.
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/configuring-tasks

### MONO-27 Hoisting-dependent Docker images / lockfile churn redeploying everything

- **Signal:** Dockerfile copying the root lockfile and running a full install for one app; image works only because root `node_modules` has hoisted deps; `npm install` (not `npm ci`/`--frozen-lockfile`) in CI; `globalDependencies` files (root `tsconfig.json`, `.env`) needed in image but missing after `turbo prune`.
- **Tool coverage:** partial — `turbo prune <app> --docker` produces `out/json` + `out/full` + pruned lockfile; `--production`; `futureFlags.pruneIncludesGlobalFiles` (by default "turbo prune does not copy files referenced by globalDependencies").
- **Why it hurts:** reliability/cost — docs: global lockfile means "if we install a new package inside apps/web, we'll cause apps/api to redeploy"; missing global files break pruned builds.
- **Severity:** major.
- **Remediation:** `turbo prune --docker` two-stage copy; frozen installs; enable `pruneIncludesGlobalFiles` or stop depending on root files; alternatively `pnpm deploy` for a self-contained directory.
- **Not a finding when:** single-app repos.
- **Architecture:** yes — deployable packaging.
- **Sources:** https://turborepo.com/docs/reference/prune ; https://turborepo.com/docs/guides/tools/docker

### MONO-28 Root package not private / internal package accidentally publishable

- **Signal:** root `package.json` without `"private": true`; internal packages without `private: true` in a repo that runs `npm publish`/changesets; no `packageManager`/`devEngines.packageManager`.
- **Tool coverage:** `sherif:root-package-private-field` (error), `sherif:root-package-manager-field` (error), `manypkg:INVALID_PACKAGE_NAME`, `manypkg:WORKSPACE_REQUIRED` (with `workspaceProtocol: "require"`) ; Turborepo checks the package-manager declaration (`dangerouslyDisablePackageManagerCheck` opts out).
- **Why it hurts:** security — leaking internal source to a public registry; dependency-confusion exposure if an internal name is unclaimed; unstable lockfiles without a pinned package manager.
- **Severity:** blocker for accidental publication paths.
- **Remediation:** `private: true` on everything not meant for publication; unclaimable scope (docs use `@repo`) or an owned npm scope; changesets for publishable ones (Turborepo recommends changesets).
- **Not a finding when:** deliberately published packages with `publishConfig`.
- **Architecture:** no.
- **Sources:** https://github.com/QuiiBz/sherif ; https://github.com/Thinkmill/manypkg ; https://turborepo.com/docs/crafting-your-repository/structuring-a-repository ; https://turborepo.com/docs/guides/publishing-libraries

### MONO-29 Just-in-Time vs Compiled package chosen without accepting its trade-offs

- **Signal:** JIT package (exports `./src/*.ts`) consumed by a Node service run without a TS loader or by a tool that can't read TS; JIT package on a hot path complaining about slow builds; Compiled package whose `types` points at `src` but is published; publishable package without declaration files.
- **Tool coverage:** none — judgement.
- **Why it hurts:** docs trade-offs: JIT "can only be used when the package is going to be used in tooling that uses a bundler or natively understands TypeScript", "Turborepo cannot cache a build for a Just-in-Time Package", and consumers' typecheck fails on the dependency's TS errors; Compiled packages need `outputs` + `^build`; publishable "cannot use references to source code in types".
- **Severity:** major when runtime can't load it (crash at deploy).
- **Remediation:** pick per consumer set; compiled for Node services without loaders; document the strategy in the package README.
- **Not a finding when:** consistent with consumers and CI builds from clean.
- **Architecture:** yes — packaging contract.
- **Sources:** https://turborepo.com/docs/core-concepts/internal-packages ; https://turborepo.com/docs/guides/tools/typescript

### MONO-30 Nested packages / workspace globs matching nothing

- **Signal:** `apps/a` and `apps/a/b` both with `package.json`; workspace globs `apps/**`; glob entries matching no package; directories matched without `package.json`.
- **Tool coverage:** Turborepo errors on nested packages ("Turborepo does not support nested packages like apps/** or packages/**") ; `sherif:non-existant-packages` (warn), `sherif:packages-without-package-json` (warn).
- **Why it hurts:** ambiguous package-manager behaviour; packages silently not discovered (tasks never run → gate not applied).
- **Severity:** major if a package's gates silently don't run.
- **Remediation:** flat globs `packages/*`, `packages/group/*` with no `package.json` at `packages/group`.
- **Not a finding when:** —
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/structuring-a-repository ; https://github.com/QuiiBz/sherif

### MONO-31 Ownership not encoded (CODEOWNERS) for shared packages

- **Signal:** no `CODEOWNERS`, or a catch-all `*` owner only; shared packages/`turbo.json`/lockfile without an owning team; last-match ordering mistakes (broad rule after specific ones).
- **Tool coverage:** partial — GitHub validates CODEOWNERS syntax (UI errors); ordering is judgement. GitHub docs: "the last matching pattern takes the most precedence."
- **Why it hurts:** operability — shared-package changes merge without review from dependents' owners; nobody owns cache/env config.
- **Severity:** minor → major for repos with multiple teams.
- **Remediation:** CODEOWNERS per package directory plus `turbo.json`, lockfile, CI workflows; order general → specific.
- **Not a finding when:** single-team repos.
- **Architecture:** no.
- **Sources:** https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners

### MONO-32 Lockfile drift / unordered manifests

- **Signal:** CI installing without frozen lockfile; `package.json` changes without lockfile change in the PR; unsorted dependency lists producing noisy diffs; missing lockfile.
- **Tool coverage:** `sherif:unordered-dependencies` (error), `manypkg:UNSORTED_DEPENDENCIES` ; package-manager frozen install (`npm ci`, `pnpm install --frozen-lockfile`) fails on drift. Turborepo: "If you do not have a lockfile present when you run turbo, you may see unpredictable behavior."
- **Why it hurts:** non-reproducible builds; turbo's package graph and hashing use the lockfile.
- **Severity:** major (no frozen install in CI).
- **Remediation:** frozen installs in CI; commit lockfile; sherif in CI.
- **Not a finding when:** —
- **Architecture:** no.
- **Sources:** https://turborepo.com/docs/crafting-your-repository/structuring-a-repository ; https://github.com/QuiiBz/sherif ; https://github.com/Thinkmill/manypkg

## Open questions / unverified

- Exact Turborepo error message for package-graph cycles not opened (DAG requirement is documented).
- knip `@public` JSDoc tag / `ignoreExportsUsedInFile` exact semantics not re-read (see https://knip.dev/reference/jsdoc-tsdoc-tags).
- Nx sync generator name for TS references not opened.
- `turbo boundaries` is **experimental** (RFC); rule syntax may change — re-check on turbo upgrade. `turbo boundaries` does not (per its doc page) check `exports` deep imports or cycles.
- syncpack status list above is partial (read from status page headings); full semantics of each status not individually opened.
- dependency-cruiser `not-to-spec`, `not-to-dev-dep`, `optional-deps-used`, `peer-deps-used` are from the `init` config template (`src/cli/init-config/config-template.mjs`), not the `recommended` preset (which has `no-orphans`, `no-circular`, `no-deprecated-core`, `no-duplicate-dep-types`, `no-non-package-json`, `not-to-deprecated`, `not-to-unresolvable`).
- Thresholds for "dumping-ground" packages (dependents count, churn) are judgement; no sourced numeric threshold.
