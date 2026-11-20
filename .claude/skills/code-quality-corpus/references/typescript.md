# TypeScript — code smells, anti-patterns, red flags (reference corpus for `staff-code-quality`)

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID    | Smell                                                                                      | Section                                  | Detected by | Default severity | Architecture |
| ----- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------- | ---------------- | ------------ |
| TS-01 | Explicit `any` (and `any` smuggled through generics/defaults)                              | Type-safety erosion                      | partial     | major            | yes          |
| TS-02 | Unsafe narrowing type assertion (`as T`) and double assertion                              | Type-safety erosion                      | partial     | major            | no           |
| TS-03 | Non-null assertion `!` as a nullability silencer                                           | Type-safety erosion                      | partial     | major            | no           |
| TS-04 | `@ts-ignore` / `@ts-nocheck` / undocumented `@ts-expect-error`                             | Type-safety erosion                      | partial     | major            | no           |
| TS-05 | `Function`, `Object`, `{}`, boxed primitives as types                                      | Type-safety erosion                      | tool        | minor            | no           |
| TS-06 | Index signatures / `Record<string, T>` hiding missing keys (no `noUncheckedIndexedAccess`) | Type-safety erosion                      | partial     | major            | no           |
| TS-07 | Optional-vs-undefined conflation (no `exactOptionalPropertyTypes`)                         | Type-safety erosion                      | partial     | major            | yes          |
| TS-08 | Weakened compiler baseline                                                                 | Type-safety erosion                      | judgement   | major            | yes          |
| TS-09 | `catch (e)` used without narrowing; non-Error throws                                       | Type-safety erosion                      | partial     | major            | no           |
| TS-10 | Suppression sprawl via inline disables                                                     | Type-safety erosion                      | partial     | major            | no           |
| TS-11 | Boolean soup / optional-field bags instead of a discriminated union                        | Illegal states representable             | judgement   | major            | yes          |
| TS-12 | Non-exhaustive branching over a union/enum (missing `never` check)                         | Illegal states representable             | partial     | major            | no           |
| TS-13 | Primitive obsession — IDs, money, units as bare `string`/`number`                          | Illegal states representable             | judgement   | major            | yes          |
| TS-14 | Enums: numeric/mixed/const enums and non-erasable syntax                                   | Illegal states representable             | partial     | major            | yes          |
| TS-15 | Overload sets where a union (or a split function) is right                                 | Illegal states representable             | partial     | minor            | no           |
| TS-16 | Shallow `readonly` believed deep / `readonly` theatre                                      | Illegal states representable             | partial     | minor            | no           |
| TS-17 | Unvalidated external data typed by assertion (`JSON.parse` / `res.json()` / env / queue p… | Runtime / compile-time mismatch at boun… | partial     | blocker          | yes          |
| TS-18 | Duplicate hand-written type and runtime schema (two sources of truth)                      | Runtime / compile-time mismatch at boun… | judgement   | major            | yes          |
| TS-19 | Declaration merging / global module augmentation that lies                                 | Runtime / compile-time mismatch at boun… | partial     | major            | yes          |
| TS-20 | `type` imports not marked / reliance on import elision                                     | Runtime / compile-time mismatch at boun… | tool        | minor            | no           |
| TS-21 | Non-erasable TS syntax in code meant to run via type stripping                             | Runtime / compile-time mismatch at boun… | partial     | major            | yes          |
| TS-22 | Floating promises                                                                          | Promise & async typing                   | partial     | major            | no           |
| TS-23 | Promises in void-expecting positions (`forEach(async)`, async event handlers, conditional… | Promise & async typing                   | tool        | major            | no           |
| TS-24 | `return promise` inside `try` without `await`                                              | Promise & async typing                   | tool        | major            | no           |
| TS-25 | `async` noise and misleading Promise signatures                                            | Promise & async typing                   | tool        | minor            | no           |
| TS-26 | Type-level over-engineering / clever generics                                              | Type-level design & over-engineering     | partial     | minor            | no           |
| TS-27 | Annotation widening instead of `satisfies`                                                 | Type-level design & over-engineering     | judgement   | minor            | no           |
| TS-28 | Namespaces and classes-as-namespaces                                                       | Type-level design & over-engineering     | tool        | minor            | no           |
| TS-29 | Deprecated API usage                                                                       | Type-level design & over-engineering     | tool        | minor            | no           |
| TS-30 | Intra-package barrel files and re-export hubs                                              | Module structure                         | partial     | minor            | yes          |
| TS-31 | Circular imports                                                                           | Module structure                         | partial     | major            | yes          |
| TS-32 | Default exports                                                                            | Module structure                         | tool        | minor            | no           |
| TS-33 | High cognitive complexity / deep nesting / long functions                                  | Complexity & size (SonarJS / ESLint met… | partial     | minor            | no           |
| TS-34 | Duplicated knowledge detectable syntactically                                              | Complexity & size (SonarJS / ESLint met… | partial     | minor            | no           |
| TS-35 | Dead code and dead stores                                                                  | Complexity & size (SonarJS / ESLint met… | partial     | minor            | no           |
| TS-36 | Truthiness checks on non-boolean types                                                     | Complexity & size (SonarJS / ESLint met… | tool        | major            | no           |
| TS-37 | Unsafe stringification / arithmetic on mixed types                                         | Complexity & size (SonarJS / ESLint met… | tool        | minor            | no           |

<!-- END GENERATED INDEX -->

## Scope & sources consulted

| Source                                                                                                                                                                                                                                                                                        | Version / date read                                   | URL                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| typescript-eslint shared configs                                                                                                                                                                                                                                                              | docs v8.70.0 (read 2026-09-13)                        | https://typescript-eslint.io/users/configs/                                         |
| typescript-eslint rules index                                                                                                                                                                                                                                                                 | v8.70.0                                               | https://typescript-eslint.io/rules/                                                 |
| typescript-eslint rule pages: `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `ban-ts-comment`, `no-unsafe-type-assertion`, `no-unnecessary-condition`, `consistent-type-assertions`, `return-await`, `restrict-template-expressions`, `class-methods-use-this` | v8.70.0                                               | https://typescript-eslint.io/rules/<name>/                                          |
| TSConfig reference                                                                                                                                                                                                                                                                            | typescriptlang.org (TS 6.0 era)                       | https://www.typescriptlang.org/tsconfig                                             |
| TypeScript 6.0 release notes                                                                                                                                                                                                                                                                  | 6.0 (page states release; see Open questions on date) | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html      |
| TypeScript 5.8 release notes (`--erasableSyntaxOnly`)                                                                                                                                                                                                                                         | 5.8                                                   | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html      |
| TypeScript 5.5 release notes (inferred type predicates)                                                                                                                                                                                                                                       | 5.5                                                   | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html      |
| Handbook — Declaration files Do's and Don'ts                                                                                                                                                                                                                                                  | current                                               | https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html |
| Handbook — More on Functions (generic guidelines, overloads, `object`/`Function`/`unknown`)                                                                                                                                                                                                   | current                                               | https://www.typescriptlang.org/docs/handbook/2/functions.html                       |
| Handbook — Enums                                                                                                                                                                                                                                                                              | current                                               | https://www.typescriptlang.org/docs/handbook/enums.html                             |
| Node.js — Modules: TypeScript (type stripping)                                                                                                                                                                                                                                                | Node v26 docs                                         | https://nodejs.org/api/typescript.html                                              |
| eslint-plugin-sonarjs README + packaged rule configs                                                                                                                                                                                                                                          | 4.2.0 (npm tarball, read 2026-09-13)                  | https://www.npmjs.com/package/eslint-plugin-sonarjs                                 |
| SonarJS source `S107` (max-params decoration), `S138`                                                                                                                                                                                                                                         | GitHub master (2026-09-13)                            | https://github.com/SonarSource/SonarJS/tree/master/packages/analysis/src/jsts/rules |
| ESLint `preserve-caught-error`                                                                                                                                                                                                                                                                | ESLint v10.10.0 docs                                  | https://eslint.org/docs/latest/rules/preserve-caught-error                          |
| eslint-plugin-import-x `no-cycle`                                                                                                                                                                                                                                                             | master                                                | https://github.com/un-ts/eslint-plugin-import-x/blob/master/docs/rules/no-cycle.md  |
| Zod v4 branded types                                                                                                                                                                                                                                                                          | zod.dev (v4.x)                                        | https://zod.dev/api?id=branded-types                                                |
| Alexis King, "Parse, don't validate"                                                                                                                                                                                                                                                          | 2019-11-05                                            | https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/                 |
| Marvin Hagemeister, "Speeding up the JavaScript ecosystem – barrel files"                                                                                                                                                                                                                     | part 7                                                | https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/                   |

### Config-membership cheat sheet (typescript-eslint v8.70.0)

- `strict` and `strict-type-checked` are **explicitly NOT semver-stable**: "Its enabled rules and/or their options may change outside of major version updates." Pin the typescript-eslint version in a lockfile or a strict-config upgrade can turn CI red with no code change.
- `strict-type-checked` = `recommended` + `recommended-type-checked` + `strict` + type-aware strict rules. `stylistic(-type-checked)` is **additive**, not a replacement.
- Rules that matter for quality and are in **NO shared config** (must be enabled explicitly): `switch-exhaustiveness-check`, `strict-boolean-expressions`, `no-unsafe-type-assertion`, `explicit-module-boundary-types`, `explicit-function-return-type`, `consistent-type-imports`, `consistent-type-exports`, `prefer-readonly`, `prefer-readonly-parameter-types`, `promise-function-async`, `require-array-sort-compare`, `naming-convention`, `no-restricted-types`, `no-shadow`, `no-magic-numbers`, `max-params`, `strict-void-return`, `no-unused-private-class-members`, `class-methods-use-this`, `consistent-return`, `prefer-ts-expect-error` (the index lists it "None"; `ban-ts-comment` covers the intent).
- **Verified against the packaged flat configs** (`@typescript-eslint/eslint-plugin@8.70.0` `dist/configs/flat/*.js`): `strict-type-checked` enables 69 typescript-eslint rules (65 as plain `'error'`, 4 with options: `ban-ts-comment`, `restrict-plus-operands`, `restrict-template-expressions`, `return-await`) incl. `no-unsafe-*`, `no-floating-promises`, `no-misused-promises`, `no-misused-spread`, `no-deprecated`, `no-unnecessary-condition`, `no-unnecessary-type-parameters`, `unbound-method`, `use-unknown-in-catch-callback-variable`, `no-useless-default-assignment`, `no-unnecessary-type-conversion`; `stylistic-type-checked` enables 21 incl. `consistent-type-assertions`, `prefer-nullish-coalescing`, `prefer-optional-chain`, `non-nullable-type-assertion-style`, `no-empty-function`, `dot-notation`.
- **Config conflict (non-obvious):** `strict(-type-checked)` sets `no-non-null-assertion: 'error'` while `stylistic-type-checked` sets `non-nullable-type-assertion-style: 'error'`, which _prefers_ `x!` over `x as NonNullable<…>`. With both extended, an author who writes `x as T` to drop `null` is pushed to `x!`, which strict then bans — the only clean exit is a real narrowing check. Neither rule page mentions the interaction. An agent seeing `eslint-disable no-non-null-assertion` in such a repo should suggest narrowing, not a cast.
- **Config differences that bite:** `ban-ts-comment` — recommended `minimumDescriptionLength: 3`, strict `10`; `ts-expect-error: 'allow-with-description'`, `ts-ignore: true`, `ts-nocheck: true`. `return-await` — recommended `in-try-catch`, strict `error-handling-correctness-only`. `restrict-template-expressions` — recommended allows any/boolean/nullish/number/RegExp; strict allows none of them (only `Error`, `URL`, `URLSearchParams` via `allow`).

### SonarJS thresholds (eslint-plugin-sonarjs 4.2.0 packaged `config.js` defaults — opened, not recalled)

| Rule                             | S-ID  | Default                                                                           | In plugin `recommended`? |
| -------------------------------- | ----- | --------------------------------------------------------------------------------- | ------------------------ |
| `sonarjs/cognitive-complexity`   | S3776 | 15                                                                                | yes                      |
| `sonarjs/cyclomatic-complexity`  | S1541 | 10                                                                                | no                       |
| `sonarjs/max-lines-per-function` | S138  | 200 lines (React function components exempt)                                      | no                       |
| `sonarjs/max-lines`              | S104  | 1000 lines per file                                                               | no                       |
| `sonarjs/nested-control-flow`    | S134  | 3 (if/for/while/switch/try depth)                                                 | no                       |
| `sonarjs/expression-complexity`  | S1067 | 3 conditional operators per expression                                            | no                       |
| `sonarjs/max-switch-cases`       | S1479 | 30                                                                                | yes                      |
| `sonarjs/no-duplicate-string`    | S1192 | threshold 3 (ignores `application/json`)                                          | no                       |
| `sonarjs/no-nested-functions`    | S2004 | depth 4                                                                           | yes                      |
| `sonarjs/no-identical-functions` | S4144 | min 3 lines                                                                       | yes                      |
| S107 (max params)                | S107  | 7 — **not shipped in the ESLint plugin**; SonarQube decorates `eslint/max-params` | n/a                      |

Non-obvious: SonarQube's S107 **ignores a TypeScript constructor whose parameters are all parameter properties** (`constructor(private a: A, public b: B)`) and Angular `@Component` constructors (SonarJS `S107/rule.ts`). A DI constructor with 12 `private readonly` injections — the classic over-injected god service — is therefore invisible to S107. See TS-33 and NestJS file.

---

## Type-safety erosion

### TS-01 Explicit `any` (and `any` smuggled through generics/defaults)

- **Signal:** `: any`, `as any`, `<any>`, `any[]`, `Record<string, any>`, `Promise<any>`, generic default `= any`; also `// eslint-disable` of `no-explicit-any`. ast-grep: `$X as any`. Count per diff; any new occurrence outside a migration/interop shim is a finding.
- **Tool coverage:** `typescript-eslint:no-explicit-any` (recommended, v8.70.0) catches the written keyword; `no-unsafe-assignment`, `no-unsafe-argument`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return` (recommended-type-checked) catch _propagation_. partial: implicit `any` from untyped deps (`skipLibCheck` hides bad `.d.ts`), `JSON.parse`, `response.json()` flows — the `no-unsafe-*` family flags the _use_, not the missing boundary parse (see TS-17).
- **Why it hurts:** Handbook: the compiler "effectively treats `any` as 'please turn off type checking for this thing'… similar to putting an `@ts-ignore` comment around every usage". Refactors silently skip the erased region; renames of fields don't break the build; reliability/maintainability.
- **Severity:** major — blocker when on a wire/persistence boundary or in an exported signature (infects every caller); minor inside a test double.
- **Remediation:** Replace with `unknown` + narrowing, a precise type, or a generic that relates values (Handbook "Type Parameters Should Appear Twice"). For third-party gaps write a local `.d.ts` module augmentation. — Trap: swapping `any` for `unknown` then immediately `as Foo` — that is the same hole with more keystrokes (TS-02).
- **Not a finding when:** a documented interop shim with a single `any` whose output is immediately parsed by a schema; declaration files mirroring a genuinely `any`-typed JS API; test files asserting on deliberately malformed input (prefer `unknown` there too).
- **Architecture:** yes when `any` crosses a package/service boundary (exported type, client SDK) — contract erosion; escalate to architect.
- **Sources:** https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html ; https://typescript-eslint.io/rules/

### TS-02 Unsafe narrowing type assertion (`as T`) and double assertion

- **Signal:** `x as Foo` where `x`'s type is wider (union, `unknown`, `object`, `string`), `as unknown as T`, `{} as T`, `[] as T[]`, `Object.keys(o) as (keyof T)[]`, `(await res.json()) as Dto`, `event.target as HTMLInputElement`. ast-grep: `$A as unknown as $T`.
- **Tool coverage:** `typescript-eslint:no-unsafe-type-assertion` (type-checked, **in no shared config**, not configurable) — "forbids using type assertions to narrow down a type"; `consistent-type-assertions` (stylistic) with `objectLiteralTypeAssertions: 'never'` catches `{} as T`; `no-unnecessary-type-assertion` (recommended) removes no-op ones. partial: assertions to `unknown`/`any` are always allowed by `consistent-type-assertions`, so `as unknown as T` needs `no-unsafe-type-assertion`.
- **Why it hurts:** A narrowing assertion is an unchecked claim; the runtime value is unchanged. Failure: `undefined` property access three frames away from the lie, in production, on the input shape nobody tested.
- **Severity:** major — blocker when asserting external data (HTTP body, DB row JSON, message payload, env) into a domain type.
- **Remediation:** Replace Type Code with a type guard / schema parse (`schema.parse(x)`), `satisfies` for literal conformance without widening, a typed factory for `{}`-then-fill objects (build the object in one expression). — Trap: a hand-written `x is Foo` predicate is also unchecked by the compiler (the body is not verified against `Foo`), so a sloppy guard is a cast with a nicer name; test the guard with negative cases.
- **Not a finding when:** widening (`as Base`), `as const`, DOM APIs where the element type is guaranteed by the selector in the same expression, or a test fixture building a partial mock (still prefer a `make*(Partial<T>)` factory).
- **Architecture:** no (yes if systemic at a boundary — then it is TS-17).
- **Sources:** https://typescript-eslint.io/rules/no-unsafe-type-assertion/ ; https://typescript-eslint.io/rules/consistent-type-assertions/

### TS-03 Non-null assertion `!` as a nullability silencer

- **Signal:** postfix `!` on member access/call results: `map.get(k)!`, `arr[0]!`, `this.foo!.bar`, `process.env['X']!`, `document.getElementById('x')!`; definite-assignment `prop!: T` in classes; `foo?.bar!` (optional chain then assert).
- **Tool coverage:** `typescript-eslint:no-non-null-assertion` (strict); `no-non-null-asserted-optional-chain` (recommended); `no-non-null-asserted-nullish-coalescing` (strict); `no-extra-non-null-assertion` (recommended); `no-confusing-non-null-assertion` (stylistic). partial: `prop!:` definite assignment is not flagged by these; judgement for whether the invariant holds.
- **Why it hurts:** Converts a compile-time error into a runtime `TypeError: Cannot read properties of undefined`. `process.env['X']!` pushes a config error from startup to first request (see Node config entries).
- **Severity:** major on external/config/map lookups; minor where an invariant is established on the preceding line.
- **Remediation:** Narrow with an explicit check that throws a named error (`if (v === undefined) { throw new MissingXError(k); }`), an `assertDefined(v, msg)` helper with `asserts v is T`, or restructure so the type is non-optional (Introduce Parameter Object / constructor-time parse). For `Map.get` after `has`, use the single `get` + undefined check. — Trap: `?? ''`/`?? 0` defaults that silently manufacture a valid-looking value where absence was a bug.
- **Not a finding when:** immediately after a check the compiler can't follow (e.g., across a callback) AND a comment states the invariant; test code.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/

### TS-04 `@ts-ignore` / `@ts-nocheck` / undocumented `@ts-expect-error`

- **Signal:** `// @ts-ignore`, `// @ts-nocheck`, `// @ts-expect-error` with no or trivial description; also `// eslint-disable-next-line @typescript-eslint/no-unsafe-*` clusters.
- **Tool coverage:** `typescript-eslint:ban-ts-comment` (recommended: ts-ignore/ts-nocheck banned, ts-expect-error `allow-with-description`, min description 3; strict: min 10). ESLint core `--report-unused-disable-directives` / `linterOptions.reportUnusedDisableDirectives` for stale disables. partial: whether the description is a real justification is judgement.
- **Why it hurts:** `@ts-ignore` suppresses _every_ error on the next line, including ones introduced later; `@ts-expect-error` at least fails when the error disappears. Maintainability: suppressions rot into lies.
- **Severity:** major for `@ts-ignore`/`@ts-nocheck` in production code; minor for a described `@ts-expect-error` in a test asserting a type error.
- **Remediation:** Fix the type; if blocked by a third-party type bug, module augmentation or a narrow wrapper with one documented cast; `@ts-expect-error <issue link + reason>` as last resort. — Trap: replacing `@ts-ignore` with `as any` — same suppression, now invisible to `ban-ts-comment`.
- **Not a finding when:** type tests (`expectTypeOf`, `tsd`) that deliberately assert a compile error with `@ts-expect-error`.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/ban-ts-comment/

### TS-05 `Function`, `Object`, `{}`, boxed primitives as types

- **Signal:** `fn: Function`, `cb: Function`, `x: Object`, `x: {}`, `String`/`Number`/`Boolean` as types, `interface Foo {}`.
- **Tool coverage:** `typescript-eslint:no-unsafe-function-type` (recommended), `no-wrapper-object-types` (recommended), `no-empty-object-type` (recommended), `no-empty-interface` (none), `no-restricted-types` (none; configurable ban-list). Full coverage when enabled.
- **Why it hurts:** Handbook: calls on `Function` "return `any`… an _untyped function call_"; `{}` accepts every non-nullish value including primitives; `Object` "It's very likely you will never use". The signature documents nothing.
- **Severity:** minor (major on exported/public API).
- **Remediation:** Precise function type `(a: A) => R`, `() => void` for "any function I won't call" (Handbook), `object` for non-primitive, `Record<string, unknown>` for dictionaries, `unknown` for "anything". — Trap: `(...args: any[]) => any` reintroduces `any`; use `(...args: never[]) => unknown` for "any callable" constraints.
- **Not a finding when:** `{}` used intentionally as `NonNullable` constraint (`T extends {}`), documented.
- **Architecture:** no.
- **Sources:** https://www.typescriptlang.org/docs/handbook/2/functions.html ; https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html

### TS-06 Index signatures / `Record<string, T>` hiding missing keys (no `noUncheckedIndexedAccess`)

- **Signal:** `Record<string, T>` or `[k: string]: T` lookups used without an undefined check (`const v = dict[key]; v.foo`), `arr[i].x` in non-loop code, tsconfig lacking `"noUncheckedIndexedAccess": true`.
- **Tool coverage:** tsc `noUncheckedIndexedAccess` (default `false`, **not** part of `strict`, TS 4.1) adds `undefined` to un-declared index access; `noPropertyAccessFromIndexSignature` (default false, 4.2) forces `obj['k']` for index-signature keys. `typescript-eslint:no-unnecessary-condition` docs explicitly defer to `noUncheckedIndexedAccess` for "pessimistic, but correct" index types; `sonarjs/no-empty-collection`. partial: the flag is off by default even in TS 6.0 (`strict` default changed, this flag did not), so absence in tsconfig is the finding.
- **Why it hurts:** `env.NODE_ENV` typed `string` when absent (tsconfig docs example). Reliability: undefined deref on unseen keys.
- **Severity:** major for new/greenfield tsconfigs lacking the flag; minor per-site.
- **Remediation:** Enable `noUncheckedIndexedAccess`; use `Map<K,V>` (`get` returns `V | undefined`), a closed union key type (`Record<Status, T>` with literal union — exhaustive by construction), `array.at(i)`, `for…of`. — Trap: turning the flag on then papering every access with `!` (TS-03); refactor loops to `for…of`/`entries()` instead.
- **Not a finding when:** `Record<LiteralUnion, T>` — keys are exhaustive; the flag is not needed there.
- **Architecture:** no.
- **Sources:** https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess ; https://typescript-eslint.io/rules/no-unnecessary-condition/

### TS-07 Optional-vs-undefined conflation (no `exactOptionalPropertyTypes`)

- **Signal:** `prop?: T` where code distinguishes "absent" from "present but undefined" (`'k' in obj`, `Object.hasOwn`, PATCH semantics, JSON serialisation where `undefined` drops a key, DB update builders where `undefined` means "don't touch" but `null` means "clear").
- **Tool coverage:** tsc `exactOptionalPropertyTypes` (default false, not in `strict`, 4.4). partial: semantic "absent vs null vs undefined" modelling is judgement.
- **Why it hurts:** tsconfig docs: "`colorThemeOverride: undefined` is not the same as `colorThemeOverride` not being defined". PATCH endpoints that accidentally clear columns or fail to clear them.
- **Severity:** major on PATCH/update DTOs and persistence mappers; minor elsewhere.
- **Remediation:** Enable the flag for new code; model tri-state explicitly (`{ kind: 'unchanged' } | { kind: 'set', value } | { kind: 'clear' }` or `T | null` + absent). — Trap: enabling the flag across a large codebase generates many errors in spread-merge code; stage by package.
- **Not a finding when:** the value is never inspected for presence.
- **Architecture:** yes if on a wire contract (PATCH semantics) — escalate to API contract owner.
- **Sources:** https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes

### TS-08 Weakened compiler baseline

- **Signal:** tsconfig with `"strict": false`, or `strict: true` then individual opt-outs (`strictNullChecks: false`, `noImplicitAny: false`, `useUnknownInCatchVariables: false`, `strictPropertyInitialization: false`), `skipLibCheck` used to hide errors in _own_ `.d.ts`, absent `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`; per-package tsconfig that diverges from the base without comment.
- **Tool coverage:** none — judgement (tsc enforces whatever is configured). `typescript-eslint:no-unnecessary-condition` refuses to run without `strictNullChecks` unless the `allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing` option is set — seeing that option is a red flag.
- **Why it hurts:** Every downstream guarantee (lint rules, narrowing) is only as strong as the flags. TS 6.0 changed `strict` default to `true` — so an explicit `"strict": false` in 2026 is a deliberate downgrade.
- **Severity:** major (blocker for a new package opting out of `strict`).
- **Remediation:** Extend a shared strict base; enable `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`; ratchet per package. Note TS 6.0 also deprecates `alwaysStrict: false`, `esModuleInterop: false`, `moduleResolution node/node10`, `baseUrl`, `outFile`, `target: es5` (removed in 7.0). — Trap: `ignoreDeprecations: "6.0"` as a permanent fix; it is removed in 7.0.
- **Not a finding when:** a legacy-JS migration package with a documented ratchet plan.
- **Architecture:** yes — toolchain policy is a repo-wide contract; escalate if a package diverges.
- **Sources:** https://www.typescriptlang.org/tsconfig ; https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html

### TS-09 `catch (e)` used without narrowing; non-Error throws

- **Signal:** `catch (e) { log(e.message) }`, `catch (e: any)`, `.catch((err) => err.code)`, `throw 'string'`, `throw { code: 1 }`, `Promise.reject('x')`, `(e as Error).message`.
- **Tool coverage:** tsc `useUnknownInCatchVariables` (in `strict`, 4.4) makes `e` `unknown`; `typescript-eslint:use-unknown-in-catch-callback-variable` (strict) for `.catch`/`.then` rejection callbacks; `only-throw-error` (recommended-type-checked); `prefer-promise-reject-errors` (recommended-type-checked); ESLint core `preserve-caught-error` (v9.35, recommended in v10) for dropped `cause`; `sonarjs/no-ignored-exceptions` S2486; `sonarjs/no-useless-catch` S2737. partial: `(e as Error)` passes all of them (TS-02).
- **Why it hurts:** Anything can be thrown (strings, `null`, a rejected fetch `Response`); `e.message` is `undefined`; stack traces lost; `cause` chain lost so the root failure is invisible in logs.
- **Severity:** major.
- **Remediation:** `if (e instanceof KnownError) … else throw e`; `throw new DomainError(msg, { cause: e })`; custom error classes with type guards. — Trap: `instanceof Error` fails across realms (vm contexts, some test runners, duplicated package copies); use `Error.isError()` where available or a brand/`name` check — see Open questions.
- **Not a finding when:** top-level handler that normalises `unknown` into a logged error object.
- **Architecture:** no (yes if error taxonomy crosses a service boundary).
- **Sources:** https://www.typescriptlang.org/tsconfig ; https://typescript-eslint.io/rules/ ; https://eslint.org/docs/latest/rules/preserve-caught-error

### TS-10 Suppression sprawl via inline disables

- **Signal:** `eslint-disable` (file-level especially), `/* eslint-disable @typescript-eslint/no-unsafe-* */` at top of file, `// biome-ignore`, disables without a reason, disables whose rule no longer fires.
- **Tool coverage:** ESLint `linterOptions.reportUnusedDisableDirectives`; `eslint-plugin-eslint-comments` (`@eslint-community/eslint-comments/require-description`, `no-unlimited-disable`) — UNVERIFIED rule IDs (not opened this session). partial: legitimacy is judgement.
- **Why it hurts:** A file-level disable exempts all future code in that file.
- **Severity:** major for file-level unsafe-* disables; minor for scoped, reasoned ones.
- **Remediation:** Scope to line, require description, track count as a ratchet metric.
- **Not a finding when:** generated code excluded by config instead.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/ban-ts-comment/

---

## Illegal states representable

### TS-11 Boolean soup / optional-field bags instead of a discriminated union

- **Signal:** ≥2 booleans describing one lifecycle (`isLoading`, `isError`, `isSuccess`), or optional fields valid only in some states (`{ status: string; error?: Error; data?: T; retryAt?: Date }`), code with `if (x.error && !x.data)` checks; `status: string` compared to literals.
- **Tool coverage:** none — judgement. Symptoms partially caught: `typescript-eslint:no-unnecessary-condition` (strict) after refactor; `sonarjs/expression-complexity` S1067 (default 3 operators).
- **Why it hurts:** 2ⁿ representable combinations, most invalid ("loading AND error"); every consumer re-derives the valid subset (shotgun parsing — King: "throwing a cloud of checks at the input, and hoping").
- **Severity:** major on domain/state models and wire contracts; minor on local UI flags.
- **Remediation:** Replace Type Code with discriminated union (`{ kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'failed'; error: E }`) + exhaustive switch (TS-12); State pattern / statechart where transitions matter. — Trap: a union whose members all still carry every optional field — the discriminant must _narrow_ the payload.
- **Not a finding when:** flags are genuinely orthogonal (e.g., `isPinned` and `isArchived` with all four combos valid).
- **Architecture:** yes when persisted or on the wire (schema shape decision) — escalate.
- **Sources:** https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/

### TS-12 Non-exhaustive branching over a union/enum (missing `never` check)

- **Signal:** `switch (x.kind)` with a `default:` that returns/throws a generic value; `if/else if` chains over a union with no final `assertNever(x)`; `Record<Kind, Handler>` built as `Partial<Record<…>>`; `default: return null`.
- **Tool coverage:** `typescript-eslint:switch-exhaustiveness-check` (type-checked, **in no shared config**). Defaults: `allowDefaultCaseForExhaustiveSwitch: true`, `considerDefaultExhaustiveForUnions: false`, `requireDefaultForNonUnion: false`, `defaultCaseCommentPattern: /^no default$/iu`. tsc `noImplicitReturns` catches fallthrough return gaps; `noFallthroughCasesInSwitch`. partial: `if/else` chains and lookup maps are not checked — use `satisfies Record<Kind, …>`.
- **Why it hurts:** Adding a union member compiles cleanly and silently takes the default path. The rule doc warns: with `considerDefaultExhaustiveForUnions`, "a `default` would prevent the rule from reporting on the new case not being handled".
- **Severity:** major (blocker for money/permission/state-transition logic).
- **Remediation:** Visitor via exhaustive switch + `const _exhaustive: never = x; throw new UnreachableError(x)` in `default`; `const handlers = {…} satisfies Record<Kind, Handler>`. — Trap: enabling `considerDefaultExhaustiveForUnions` — it re-opens the hole.
- **Not a finding when:** switching on an open-ended type (string/number) where `default` is the real behaviour.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/switch-exhaustiveness-check/

### TS-13 Primitive obsession — IDs, money, units as bare `string`/`number`

- **Signal:** functions taking ≥2 same-primitive params with different meanings (`transfer(fromId: string, toId: string, amount: number)`), `userId: string` and `recipeId: string` interchangeable, `amount: number` without currency/unit, `email: string` validated in several places.
- **Tool coverage:** none — judgement. `sonarjs/arguments-order` S2234 (recommended) catches only swapped args whose _names_ match params.
- **Why it hurts:** Structural typing lets a `RecipeId` flow into a `UserId` slot; argument swaps compile; validation repeated (DRY of knowledge).
- **Severity:** major on domain boundaries (IDs, money, time); minor for local helpers.
- **Remediation:** Branded/opaque types (`type UserId = string & { readonly __brand: 'UserId' }`) produced only by a smart constructor/parser (Zod `.brand<'UserId'>()` — "a static-only construct", runtime value unchanged); Value Object; Introduce Parameter Object for same-typed params. — Trap: branding via `as UserId` sprinkled at call sites — the brand then proves nothing; only the parser may mint it.
- **Not a finding when:** a pure utility genuinely generic over strings.
- **Architecture:** yes when the ID type is part of a shared contract package — escalate for one authoritative definition.
- **Sources:** https://zod.dev/api?id=branded-types ; https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/

### TS-14 Enums: numeric/mixed/const enums and non-erasable syntax

- **Signal:** `enum X { A, B }` (numeric, reverse-mapped), mixed string/number members, `const enum` in a library or under `isolatedModules`, enum values persisted/sent on the wire as ordinals, `declare enum`.
- **Tool coverage:** `typescript-eslint:no-mixed-enums` (strict), `no-duplicate-enum-values` (recommended), `no-unsafe-enum-comparison` (recommended-type-checked), `prefer-literal-enum-member` (strict), `prefer-enum-initializers` (none); tsc `erasableSyntaxOnly` (5.8) errors on every `enum`. partial: wire/persistence ordinal risk is judgement.
- **Why it hurts:** Handbook const-enum pitfalls: incompatible with `isolatedModules`; "inlined values from version A may differ from runtime version B". Numeric ordinals persisted in a DB change meaning if members are reordered. Node's native type stripping (default on since v22.18/v23.6, stable v24.12/v25.2) throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on enums.
- **Severity:** major for `const enum` in published packages or ordinal persistence; minor for a local string enum.
- **Remediation:** `as const` object + `type X = typeof O[keyof typeof O]` (Handbook "Objects vs Enums"), or a string-literal union; if enums kept, explicit string initialisers. — Trap: converting a persisted numeric enum without a data migration.
- **Not a finding when:** a framework requires `enum` (e.g., some ORMs/GraphQL registration) and values are explicit strings.
- **Architecture:** yes if values are persisted/on the wire.
- **Sources:** https://www.typescriptlang.org/docs/handbook/enums.html ; https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html ; https://nodejs.org/api/typescript.html

### TS-15 Overload sets where a union (or a split function) is right

- **Signal:** ≥2 overload signatures differing only in one argument's type or trailing optional args; overloads selecting _behaviour_ by a literal flag (`get(id, true)`); implementation signature with `any`.
- **Tool coverage:** `typescript-eslint:unified-signatures` (strict), `adjacent-overload-signatures` (stylistic); `sonarjs/no-selector-parameter` S2301 (recommended, type-checked) for boolean selector params. partial: "should be two functions" is judgement.
- **Why it hurts:** Handbook: "Always prefer parameters with union types instead of overloads when possible"; overloads can't be called with a union value ("passing through"). First-match resolution order bugs.
- **Severity:** minor (major on public API).
- **Remediation:** Union parameter; optional params; Replace Parameter with Explicit Methods (Fowler: "Remove Flag Argument") when overloads encode different behaviours. — Trap: collapsing overloads that genuinely relate input→output types (e.g., `parse(s: string): A; parse(b: Buffer): B`) — there a generic/conditional or overloads are correct.
- **Not a finding when:** return type varies with argument type and callers rely on it.
- **Architecture:** no.
- **Sources:** https://www.typescriptlang.org/docs/handbook/2/functions.html ; https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html

### TS-16 Shallow `readonly` believed deep / `readonly` theatre

- **Signal:** `readonly items: Item[]` (array still mutable), `Readonly<T>` over nested objects assumed frozen, `Object.freeze` used as a type-level guarantee, mutation of function parameters (`arr.sort()`, `obj.x = …`) in "pure" functions.
- **Tool coverage:** `typescript-eslint:prefer-readonly` (none) for never-reassigned private members; `prefer-readonly-parameter-types` (none; noisy); `sonarjs/no-misleading-array-reverse` S4043 (recommended) for `reverse`/`sort` mutating in assignments; `sonarjs/public-static-readonly` S1444. partial: deep immutability is judgement.
- **Why it hurts:** `readonly` on a property blocks reassignment only; `Readonly<T>` is one level. Shared cached objects mutated by one caller corrupt others (reliability).
- **Severity:** minor; major when a cached/shared/module-level object is mutated.
- **Remediation:** `ReadonlyArray<T>`/`readonly T[]`, `toSorted()`/`toReversed()` (ES2023), copy-on-write, `as const` for literals. — Trap: `prefer-readonly-parameter-types` on an entire codebase produces mass noise; use at boundaries only.
- **Not a finding when:** local builder mutating its own freshly created object.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/

---

## Runtime / compile-time mismatch at boundaries

### TS-17 Unvalidated external data typed by assertion (`JSON.parse` / `res.json()` / env / queue payload as T)

- **Signal:** `JSON.parse(s) as T`, `const body: Dto = await res.json()`, `const row = result.rows[0] as User`, `event.detail as Payload`, `process.env as Env`, `const msg: Message = JSON.parse(record.body)` — any typed binding of `any`-returning I/O without a schema `.parse`/`.safeParse` in the same module.
- **Tool coverage:** partial: `typescript-eslint:no-unsafe-assignment`/`no-unsafe-return`/`no-unsafe-member-access` flag `JSON.parse` (returns `any`) flowing untyped; they do **not** flag `res.json()` in libs typed `Promise<unknown>`→`as T`, nor `as T` on `unknown` (needs `no-unsafe-type-assertion`). Annotation form `const x: T = JSON.parse(s)` is caught by `no-unsafe-assignment`. none for "a schema should exist here".
- **Why it hurts:** Types describe what you _hope_; production sends what it sends. King: validation "returns nothing meaningful"; parsing "produces more-structured output". Failure: deploy of an upstream API change produces `undefined` deep in domain code rather than a 4xx/alert at the edge.
- **Severity:** blocker on trust boundaries (HTTP in, third-party HTTP out, queue/webhook payloads, DB JSON columns, env); major internally.
- **Remediation:** Parse at the boundary with a schema library (zod/valibot/arktype/TypeBox) and derive the type from the schema (`z.infer`); Anti-Corruption Layer for third-party APIs; one parse per boundary, domain code receives parsed types only. Handbook pattern: `function safeParse(s: string): unknown`. — Trap: defining the TS interface and the schema separately (two sources of truth drift); derive one from the other. Also: `z.infer` vs `z.input` differ under transforms.
- **Not a finding when:** data originates from the same process and was already parsed (internal call), or a generated, validated client guarantees the shape.
- **Architecture:** yes — boundary/contract ownership; escalate to architect for where the parse lives.
- **Sources:** https://www.typescriptlang.org/docs/handbook/2/functions.html ; https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/ ; https://zod.dev/api?id=branded-types ; https://typescript-eslint.io/rules/

### TS-18 Duplicate hand-written type and runtime schema (two sources of truth)

- **Signal:** `interface CreateUserDto {…}` alongside `const createUserSchema = z.object({…})` with the same fields; class-validator DTO class + separate interface; OpenAPI YAML hand-edited next to TS types.
- **Tool coverage:** none — judgement (a type-test `expectTypeOf<z.infer<typeof s>>().toEqualTypeOf<Dto>()` is a guard).
- **Why it hurts:** DRY of knowledge: a field added to one is missing from the other; validation passes data the type doesn't describe.
- **Severity:** major on wire contracts.
- **Remediation:** Derive type from schema (`z.infer`) or schema from type via generator; if both must exist, a compile-time equality test. — Trap: `satisfies z.ZodType<Dto>` only checks assignability in one direction.
- **Not a finding when:** the shapes legitimately differ (input vs domain) and one is `Pick/Omit` derived.
- **Architecture:** yes — contract ownership.
- **Sources:** https://zod.dev/api?id=branded-types

### TS-19 Declaration merging / global module augmentation that lies

- **Signal:** `declare module 'express' { interface Request { user: User } }` (non-optional), `declare global { interface Window { … } }`, `interface Foo` + `class Foo` same name, augmenting third-party types to add fields only some middleware sets; `namespace` merged with functions.
- **Tool coverage:** `typescript-eslint:no-unsafe-declaration-merging` (recommended) catches interface+class merges only; `no-namespace` (recommended). partial: augmentation that asserts a runtime property always exists is judgement.
- **Why it hurts:** A global augmentation makes `req.user` typed as present on _every_ route, including unauthenticated ones → runtime undefined deref; changes are global and invisible at the use site.
- **Severity:** major when the augmented property is conditionally present (auth, tenant, correlation id).
- **Remediation:** Make it optional and narrow; or typed accessor (`getPrincipal(req): Principal` throwing if absent); a custom param decorator in NestJS (see NestJS file). — Trap: optional field + `!` everywhere (TS-03).
- **Not a finding when:** the augmented property is set by global middleware that runs on every request before any handler (document it).
- **Architecture:** yes — a global type contract; escalate when shared across packages.
- **Sources:** https://typescript-eslint.io/rules/

### TS-20 `type` imports not marked / reliance on import elision

- **Signal:** type-only symbols imported as values (`import { User } from './user'` where `User` is an interface), tsconfig without `verbatimModuleSyntax`, side-effect imports of modules that only export types.
- **Tool coverage:** tsc `verbatimModuleSyntax` (5.4 per tsconfig page; default false); `typescript-eslint:consistent-type-imports` / `consistent-type-exports` (none), `no-import-type-side-effects` (none); tsc `noUncheckedSideEffectImports` (5.6, default `true` in TS 6.0).
- **Why it hurts:** Under Node type stripping "the `type` keyword is **mandatory** for type imports" — otherwise a runtime error; also creates spurious runtime import edges → circular-import `undefined` at load time. Exception worth knowing: NestJS/`emitDecoratorMetadata` needs _value_ imports for injected classes (see NestJS file) — `import type` on a constructor-injected class breaks DI.
- **Severity:** minor (major if the runtime is Node type-stripping or an isolated transpiler).
- **Remediation:** Enable `verbatimModuleSyntax` + `consistent-type-imports` autofix. — Trap: the autofix converting a DI-token class import to `import type` in decorator-metadata code; exclude or verify with a boot test.
- **Not a finding when:** bundler handles elision and no decorator metadata is involved.
- **Architecture:** no.
- **Sources:** https://nodejs.org/api/typescript.html ; https://www.typescriptlang.org/tsconfig

### TS-21 Non-erasable TS syntax in code meant to run via type stripping

- **Signal:** `enum`, runtime `namespace`, parameter properties (`constructor(private readonly x: X)`), `import x = require()`, `export =`, decorators — in packages executed with `node file.ts` or targeting `erasableSyntaxOnly`.
- **Tool coverage:** tsc `erasableSyntaxOnly` (5.8) for enum/namespace/parameter properties/`import =`/`export =`; Node emits `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (also for decorators). partial: knowing which runtime executes the package is judgement.
- **Why it hurts:** Portability: works under `tsc`/`tsx`, crashes under native Node. Node: "Node.js ignores `tsconfig.json`… path aliases… unsupported"; "No TypeScript in `node_modules`".
- **Severity:** major when the package's run script uses native Node TS; otherwise not a finding.
- **Remediation:** Explicit field + constructor assignment; `as const` objects; ESM `import`. — Trap: applying this to a NestJS app — NestJS needs legacy decorators + `emitDecoratorMetadata`, which type stripping cannot provide; such apps must keep a compiler (tsc/swc).
- **Not a finding when:** the package is compiled by tsc/swc/esbuild.
- **Architecture:** yes — runtime/toolchain choice per package.
- **Sources:** https://nodejs.org/api/typescript.html ; https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html

---

## Promise & async typing

### TS-22 Floating promises

- **Signal:** a call returning `Promise` used as a statement with no `await`/`return`/`.catch(fn)`/two-arg `.then`; `array.map(async …)` not wrapped in `Promise.all`; `void promise` without a comment in server code.
- **Tool coverage:** `typescript-eslint:no-floating-promises` (recommended-type-checked). Defaults: `ignoreVoid: true`, `ignoreIIFE: false`, `checkThenables: false`, `allowForKnownSafePromises: []`, `allowForKnownSafeCalls: []`. It "reports when an Array containing Promises is created and not properly handled". partial: `ignoreVoid: true` means `void doWork()` passes — fire-and-forget with no error handler is still an unhandled rejection risk (judgement); custom thenables need `checkThenables`.
- **Why it hurts:** Unhandled rejections crash Node by default (`--unhandled-rejections=throw` default since Node 15 — see Node file NODE entries); ordering bugs; work outlives request/transaction.
- **Severity:** major; blocker inside a DB transaction or request handler whose response depends on it.
- **Remediation:** `await`; `Promise.all`/`allSettled`; explicit background-task runner with error logging (`queueMicrotask` is not a substitute). — Trap: `void` as the "fix" — requires an attached `.catch`.
- **Not a finding when:** test framework-managed promises; `void` with a `.catch` that logs, documented as fire-and-forget.
- **Architecture:** no (yes if it hides a missing job/queue abstraction).
- **Sources:** https://typescript-eslint.io/rules/no-floating-promises/

### TS-23 Promises in void-expecting positions (`forEach(async)`, async event handlers, conditionals)

- **Signal:** `items.forEach(async (i) => { await … })`, `emitter.on('x', async () => …)`, `if (promise)`, `setTimeout(async () => …)`, `{ ...promise }`, async method implementing an interface method typed `() => void`.
- **Tool coverage:** `typescript-eslint:no-misused-promises` (recommended-type-checked) — `checksConditionals: true`, `checksVoidReturn: true` (sub-options `arguments`, `attributes`, `inheritedMethods`, `properties`, `returns`, `variables`), `checksSpreads: true`. `strict-void-return` (none). `sonarjs/no-try-promise` S4822. Full for shape; judgement for intended concurrency.
- **Why it hurts:** rule doc: `forEach(async …)` "creates unhandled Promises since forEach ignores return values"; loop "completes" before work does; errors escape try/catch.
- **Severity:** major.
- **Remediation:** `for…of` + `await` (sequential) or `await Promise.all(items.map(…))` (bounded parallel — see Node file); wrap handlers: `emitter.on('x', (e) => { handle(e).catch(logError); })`.
- **Not a finding when:** the void-position API awaits the callback (e.g., some test frameworks) — configure `checksVoidReturn` sub-options rather than disabling.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/no-misused-promises/

### TS-24 `return promise` inside `try` without `await`

- **Signal:** `try { return doAsync(); } catch (e) { … }` or `finally { release() }` around an unawaited returned promise.
- **Tool coverage:** `typescript-eslint:return-await` (recommended `in-try-catch`; strict `error-handling-correctness-only`). Full.
- **Why it hurts:** rule doc: it "should be awaited in order to trigger subsequent `catch` or `finally` blocks". `finally` releases a DB connection/lock before the query finishes.
- **Severity:** major (blocker with resource release in `finally`).
- **Remediation:** `return await`. — Trap: `require-await` then complaining; `return await` inside try satisfies it.
- **Not a finding when:** outside try/catch/finally.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/return-await/

### TS-25 `async` noise and misleading Promise signatures

- **Signal:** `async` function with no `await` (`require-await`), functions returning `Promise` that are not `async` and can throw synchronously, `Promise<void>` returned where the value is used, `await` on non-thenables, `async` constructor-like patterns (`constructor() { this.init(); }`).
- **Tool coverage:** `typescript-eslint:require-await` (recommended-type-checked), `await-thenable` (recommended-type-checked), `promise-function-async` (none), `sonarjs/no-async-constructor` S7059 (recommended), `no-confusing-void-expression` (strict), `sonarjs/no-use-of-empty-return-value` S3699. Full for shapes.
- **Why it hurts:** A non-async Promise-returning function that throws synchronously escapes `.catch` handlers (mixed error channels). Async work in constructors leaves half-initialised objects.
- **Severity:** minor; major for sync-throw-in-promise-API and async-constructor.
- **Remediation:** `promise-function-async`; static async factory (`static async create()`) instead of async constructor; for NestJS use `onModuleInit` or async providers (see NestJS file). — Trap: removing `async` to satisfy `require-await` from a function that must keep a Promise contract for sync throws.
- **Not a finding when:** interface requires `Promise` return and the implementation is sync — `async` is the correct adapter.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/

---

## Type-level design & over-engineering

### TS-26 Type-level over-engineering / clever generics

- **Signal:** conditional + mapped + recursive + template-literal types in application (not library) code; type parameters used once (`<T extends string>(s: T)` with `T` not in return); generic constraint where the parameter itself would do (`<T extends any[]>(arr: T)`); >3 type params; types requiring comments to decode; slow `tsc` (`--extendedDiagnostics` instantiation counts).
- **Tool coverage:** `typescript-eslint:no-unnecessary-type-parameters` (strict), `no-unnecessary-type-arguments` (strict), `no-unnecessary-type-constraint` (recommended). partial: readability/over-abstraction is judgement.
- **Why it hurts:** Handbook: a type parameter "that _doesn't relate two values_… is always a red flag"; `firstElement2<Type extends any[]>` infers `any`. Error messages become unreadable; compile time grows; next engineer can't modify.
- **Severity:** minor; major when it degrades inference to `any` or blocks change.
- **Remediation:** Handbook rules: "use the type parameter itself rather than constraining it", "use as few type parameters as possible", "If a type parameter only appears in one location, strongly reconsider". Inline Type / explicit simpler types; keep type gymnastics in a tested library module with type tests.
- **Not a finding when:** library/contract packages where precise inference is the product, backed by type tests.
- **Architecture:** no.
- **Sources:** https://www.typescriptlang.org/docs/handbook/2/functions.html

### TS-27 Annotation widening instead of `satisfies`

- **Signal:** `const config: Record<string, Route> = { home: {…} }` then `config.home!`; `const handlers: Handlers = {…}` losing literal keys; `as const` absent on lookup tables.
- **Tool coverage:** none — judgement (`prefer-as-const` recommended catches only `'a' as 'a'`).
- **Why it hurts:** Widening loses key knowledge → `!` or `noUncheckedIndexedAccess` noise; exhaustiveness of maps not checked.
- **Severity:** minor.
- **Remediation:** `const x = {…} as const satisfies Record<Kind, Route>` (TS 4.9+). — Trap: `satisfies` does not widen, so a later mutation typed as the wide type fails; choose deliberately.
- **Not a finding when:** the variable is intentionally mutable wide.
- **Architecture:** no.
- **Sources:** UNVERIFIED — `satisfies` release notes (TS 4.9) not opened this session.

### TS-28 Namespaces and classes-as-namespaces

- **Signal:** `namespace Utils { export function … }`, `class StringUtils { static a(); static b() }` with no instance state.
- **Tool coverage:** `typescript-eslint:no-namespace` (recommended), `no-extraneous-class` (strict); `erasableSyntaxOnly` (runtime namespaces). Full.
- **Why it hurts:** Not tree-shakeable; non-erasable; hides module boundaries.
- **Severity:** minor.
- **Remediation:** Plain ES module with named exports. — Trap: NestJS providers/modules are classes by framework contract — not extraneous.
- **Not a finding when:** type-only namespaces (Node: "Type-only namespaces work correctly"); framework-required decorator classes (`@Module({})` with no body is correct).
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/ ; https://nodejs.org/api/typescript.html

### TS-29 Deprecated API usage

- **Signal:** calls to symbols with `@deprecated` JSDoc (own or third-party), e.g., old SDK methods.
- **Tool coverage:** `typescript-eslint:no-deprecated` (strict, type-checked); `sonarjs/deprecation` S1874 (recommended). Full.
- **Why it hurts:** Upgrade blocker; removed in next major → outage on dependency bump.
- **Severity:** minor; major when the replacement fixes a correctness/security issue.
- **Remediation:** migrate to replacement; if not possible, track with an issue link.
- **Not a finding when:** adapter module deliberately wrapping a deprecated API pending migration, isolated.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/ ; eslint-plugin-sonarjs 4.2.0 README

---

## Module structure

### TS-30 Intra-package barrel files and re-export hubs

- **Signal:** `index.ts` whose body is only `export * from`/`export { … } from`; imports of `'./components'` resolving to a barrel inside the same package; `export *` chains ≥2 deep.
- **Tool coverage:** partial: `eslint-plugin-barrel-files` (`barrel-files/avoid-barrel-files`, `avoid-importing-barrel-files`) — UNVERIFIED rule IDs (not opened); `import-x/no-cycle` detects cycles the barrels create. Judgement: a package's public entry (`package.json` `exports` target) is a legitimate barrel.
- **Why it hurts:** Hagemeister: loading modules scales (e.g., "10000 take 3.12s, 25000 take 16.81s"); tools "load nearly the entire project's module graph even when importing a single function"; test runners rebuild the graph per test file; cycle detection lint time spirals. Plus hidden cycles → `undefined` at import time.
- **Severity:** minor; major when it causes a cycle or measurable test/cold-start regression (Lambda cold start).
- **Remediation:** Import from the declaring module; keep barrels only as package public entry points; `sideEffects: false` for bundlers. — Trap: deleting a package's public entry barrel breaks consumers — that one is a contract.
- **Not a finding when:** it is the `exports` target of a workspace/published package.
- **Architecture:** yes if it defines a package public surface — escalate API-surface changes.
- **Sources:** https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/

### TS-31 Circular imports

- **Signal:** module A imports B imports A (directly or via barrel); symptoms: `undefined` class at decoration time, `Cannot access 'X' before initialization`, NestJS "cannot resolve dependency … at index [n]" with `undefined`.
- **Tool coverage:** `import-x:no-cycle` (options `maxDepth`, `ignoreExternal` default false, `allowUnsafeDynamicCyclicDependency`); docs: "comparatively computationally expensive"; `madge --circular`/`dpdm` (UNVERIFIED flags). partial: whether the cycle is a design smell (wrong boundary) is judgement.
- **Why it hurts:** Load-order-dependent bugs that appear only when an entry point changes; import-x docs: "Cyclic dependency are **always** a dangerous anti-pattern."
- **Severity:** major.
- **Remediation:** Extract shared module (Move Function to a lower layer), Dependency Inversion (interface in the lower module), remove barrel hop. — Trap: "fixing" with lazy `require()`/dynamic import or NestJS `forwardRef` — hides the cycle.
- **Not a finding when:** type-only cycles erased at compile time (`import type` both ways) — still a design signal, not a runtime bug.
- **Architecture:** yes — layering violation; escalate.
- **Sources:** https://github.com/un-ts/eslint-plugin-import-x/blob/master/docs/rules/no-cycle.md

### TS-32 Default exports

- **Signal:** `export default` outside framework-required files (Next.js pages, config files, Expo entry).
- **Tool coverage:** `import-x:no-default-export` — UNVERIFIED (rule page not opened this session). Judgement for framework exceptions.
- **Why it hurts:** Name drift across importers (`import Foo from` vs `import Bar from`), weaker rename refactors and auto-import.
- **Severity:** minor.
- **Remediation:** named exports.
- **Not a finding when:** framework requires default export.
- **Architecture:** no.
- **Sources:** UNVERIFIED

---

## Complexity & size (SonarJS / ESLint metrics applied to TS)

### TS-33 High cognitive complexity / deep nesting / long functions

- **Signal:** `sonarjs/cognitive-complexity` > 15 (S3776); cyclomatic > 10 (S1541); nesting depth > 3 (S134); function > 200 LOC (S138); file > 1000 LOC (S104); expression with > 3 `&&`/`||`/`?:` (S1067); nested ternary (S3358 `no-nested-conditional`); > 30 switch cases (S1479); > 7 params (S107, SonarQube only; ESLint core/typescript-eslint `max-params`).
- **Tool coverage:** thresholds above (eslint-plugin-sonarjs 4.2.0 defaults). partial: (a) S107 skips all-parameter-property constructors → DI over-injection invisible; (b) S138's 200-line default is permissive — 200 lines is already far beyond a readable unit; (c) a function can be under every threshold and still mix abstraction levels — judgement.
- **Why it hurts:** Maintainability/testability: branch count drives test cases needed; nesting obscures error paths.
- **Severity:** minor at threshold; major at ≥2× threshold or in a hot-change file (churn × complexity).
- **Remediation:** Extract Function, Replace Nested Conditional with Guard Clauses, Decompose Conditional, Replace Conditional with Polymorphism / strategy map, Introduce Parameter Object. — Trap: extracting into many single-use helpers that must be read together (shallow modules, Ousterhout) — reduce _concepts_, not just lines.
- **Not a finding when:** a flat exhaustive `switch` over a union (high cyclomatic, low cognitive); generated parsers; table-driven code.
- **Architecture:** no (yes when the size signals a god class/module — escalate).
- **Sources:** eslint-plugin-sonarjs 4.2.0 packaged configs; https://github.com/SonarSource/SonarJS/tree/master/packages/analysis/src/jsts/rules

### TS-34 Duplicated knowledge detectable syntactically

- **Signal:** identical function bodies ≥3 lines (S4144), identical branches (S1871 `no-duplicated-branches`, S3923 `no-all-duplicated-branches`), string literal repeated ≥3 times (S1192), collapsible ifs (S1066), boolean-return wrapped in if (S1126), variable declared then immediately returned (S1488).
- **Tool coverage:** `sonarjs:*` rules above; jscpd for cross-file clones (UNVERIFIED thresholds). partial: DRY is about knowledge — two identical-looking fragments that change for different reasons are NOT duplication; tools can't tell.
- **Why it hurts:** Divergent fixes (bug fixed in one copy).
- **Severity:** minor; major when the duplicated thing is a business rule/constant/contract.
- **Remediation:** Extract Function / Introduce Constant only after confirming a shared reason to change (rule of three). — Trap: merging look-alikes into a flag-parameter helper (the wrong abstraction).
- **Not a finding when:** test code (DAMP over DRY); coincidental similarity.
- **Architecture:** no.
- **Sources:** eslint-plugin-sonarjs 4.2.0 README

### TS-35 Dead code and dead stores

- **Signal:** unused locals/params/imports/private members/exports; assignments never read (S1854); collections written never read (S4030); functions returning the same value on every path (S3516); commented-out code (S125).
- **Tool coverage:** tsc `noUnusedLocals`/`noUnusedParameters`; `typescript-eslint:no-unused-vars` (recommended), `no-unused-private-class-members` (none); `sonarjs/no-dead-store` S1854, `no-unused-collection` S4030, `no-invariant-returns` S3516, `no-commented-code` S125; Knip for unused files/exports/deps (UNVERIFIED — not opened). partial: unused _exports_ across packages need Knip/ts-prune.
- **Why it hurts:** Readers maintain code that does nothing; false leads during incidents.
- **Severity:** minor.
- **Remediation:** Remove Dead Code (Fowler). — Trap: deleting an export consumed dynamically (DI tokens, reflection, route registration by glob).
- **Not a finding when:** framework-invoked (lifecycle hooks, decorated handlers).
- **Architecture:** no.
- **Sources:** eslint-plugin-sonarjs 4.2.0 README ; https://www.typescriptlang.org/tsconfig

### TS-36 Truthiness checks on non-boolean types

- **Signal:** `if (count)`, `if (str)`, `value || default` where `0`/`''` are valid, `.filter(x => !!x)` on numbers, `if (promise)`.
- **Tool coverage:** `typescript-eslint:strict-boolean-expressions` (none), `prefer-nullish-coalescing` (stylistic-type-checked), `no-unnecessary-condition` (strict). TS 5.5 inferred type predicates: `.filter(x => x !== undefined)` narrows; `.filter(x => !!x)` does **not** infer a predicate for primitives (5.5 notes). Full when enabled.
- **Why it hurts:** `0` quantity / empty string treated as absent → data loss (e.g., price 0 replaced by default).
- **Severity:** major where 0/'' are valid domain values.
- **Remediation:** `??`, explicit `!== undefined`/`!== null`, `.length > 0`.
- **Not a finding when:** type is `T | undefined` with `T` an object.
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/ ; https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html

### TS-37 Unsafe stringification / arithmetic on mixed types

- **Signal:** `` `${obj}` `` → `[object Object]`, `'' + value`, `a + b` with `string | number`, `String(err)` of objects, `-x` on non-number, `delete arr[i]`, `for…in` over arrays, `.sort()` without comparator on numbers.
- **Tool coverage:** `typescript-eslint:restrict-template-expressions`, `restrict-plus-operands`, `no-base-to-string`, `no-unsafe-unary-minus`, `no-array-delete`, `no-for-in-array` (all recommended-type-checked), `require-array-sort-compare` (none), `sonarjs/no-alphabetical-sort` (UNVERIFIED ID). Full.
- **Why it hurts:** Log lines with `[object Object]` destroy incident diagnosis; `[10, 9, 1].sort()` → `[1, 10, 9]`.
- **Severity:** minor (major in money/ordering logic).
- **Remediation:** explicit formatters, `toSorted((a, b) => a - b)`, `splice`/`filter`.
- **Not a finding when:** type has a meaningful `toString` (rule already allows `Error`, `URL`).
- **Architecture:** no.
- **Sources:** https://typescript-eslint.io/rules/restrict-template-expressions/ ; https://typescript-eslint.io/rules/

---

## Security-hygiene overlap

Flag and escalate to a security reviewer; the quality agent does not adjudicate exploitability.

| Smell (entry)                                               | CWE                                                                                            | Tool rule IDs (opened unless marked)                                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unvalidated external data typed by assertion (TS-17, TS-02) | CWE-20 Improper Input Validation; CWE-843 Type Confusion                                       | `typescript-eslint:no-unsafe-assignment`/`no-unsafe-type-assertion`; CodeQL/Semgrep: none specific (judgement)                                      |
| `eval`/`new Function`/string `setTimeout`                   | CWE-95 Eval Injection                                                                          | `typescript-eslint:no-implied-eval` (recommended-type-checked); `sonarjs/code-eval` S1523 (recommended); `codeql:js/code-injection` (see Node file) |
| Dynamic `delete obj[key]` / computed-key writes from input  | CWE-1321 Prototype Pollution                                                                   | `typescript-eslint:no-dynamic-delete` (strict); `codeql:js/prototype-polluting-assignment` (see Node file)                                          |
| Hard-coded credentials/secrets                              | CWE-798                                                                                        | `sonarjs/no-hardcoded-passwords` S2068, `no-hardcoded-secrets` S6418, `hardcoded-secret-signatures` S6437 (all recommended 4.2.0)                   |
| Dynamic SQL string building                                 | CWE-89                                                                                         | `sonarjs/sql-queries` S2077 (recommended)                                                                                                           |
| ReDoS-prone regex                                           | CWE-1333                                                                                       | `sonarjs/slow-regex` S5852, `sonarjs/super-linear-regex` S8786, `sonarjs/regex-complexity` S5843 (recommended)                                      |
| `Math.random()` for tokens/IDs                              | CWE-338                                                                                        | `sonarjs/pseudo-random` S2245 (recommended)                                                                                                         |
| Shell command execution                                     | CWE-78                                                                                         | `sonarjs/os-command` S4721 (not recommended), `sonarjs/no-os-command-from-path` S4036 (recommended)                                                 |
| Swallowed exceptions hiding auth/validation failure (TS-09) | CWE-390 Detection of Error Condition Without Action                                            | `sonarjs/no-ignored-exceptions` S2486                                                                                                               |
| Global type augmentation claiming `req.user` exists (TS-19) | CWE-476 NULL Pointer Dereference / possible CWE-862 Missing Authorization if handlers trust it | none — judgement                                                                                                                                    |

## Open questions / unverified

1. **TS 6.0 release date**: the typescriptlang.org 6.0 page (as summarised by the fetch tool) stated "September 8, 2026", while a Visual Studio Magazine article URL is dated 2026-03-23. Treat the date as unverified; the content (strict default `true`, `types: []`, `noUncheckedSideEffectImports: true`, deprecations removed in 7.0) was quoted from the official page.
2. `satisfies` (TS 4.9) — release notes not opened; TS-27 source marked UNVERIFIED.
3. `import-x:no-default-export`, `eslint-plugin-barrel-files` rule IDs, `@eslint-community/eslint-comments` rule IDs, Knip, jscpd, madge/dpdm — not opened this session.
4. `sonarjs/no-alphabetical-sort` exact ID not confirmed in the 4.2.0 README grep (the grep did not surface it).
5. `Error.isError()` availability in current Node/TS lib — not verified (TS-09 trap).
6. RESOLVED: config membership was re-checked against the packaged `dist/configs/flat/strict-type-checked.js` and `stylistic-type-checked.js` (8.70.0). `class-methods-use-this` is in no config (the index summariser had mislabelled it). Membership of `recommended`-only rules was not separately diffed.
7. Whether a hand-written `x is T` predicate body is checked: stated as judgement from language behaviour; no official doc quote opened.
