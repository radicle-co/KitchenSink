# React 19 — code smells, anti-patterns, red flags

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID       | Smell                                                                                      | Section                                  | Detected by | Default severity | Architecture |
| -------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------- | ---------------- | ------------ |
| REACT-01 | Derived value stored in state and synced by an Effect                                      | Effects: the #1 source of React defects  | tool        | major            | no           |
| REACT-02 | Resetting or "adjusting" state on prop change inside an Effect                             | Effects: the #1 source of React defects  | partial     | major            | no           |
| REACT-03 | Effect chains (Effect → setState → Effect → setState)                                      | Effects: the #1 source of React defects  | tool        | major            | no           |
| REACT-04 | User-event logic placed in an Effect (flag-state → Effect → side effect)                   | Effects: the #1 source of React defects  | judgement   | blocker          | no           |
| REACT-05 | Notifying the parent from an Effect / passing fetched data up                              | Effects: the #1 source of React defects  | judgement   | major            | no           |
| REACT-06 | Fetch in an Effect with no race/abort handling                                             | Effects: the #1 source of React defects  | tool        | major            | yes          |
| REACT-07 | Manual external-store subscription in `useEffect` + `useState`                             | Effects: the #1 source of React defects  | tool        | minor            | no           |
| REACT-08 | One-time app initialisation inside a component Effect                                      | Effects: the #1 source of React defects  | judgement   | major            | no           |
| REACT-09 | Lying to the dependency array (suppressing `exhaustive-deps`)                              | Effects: the #1 source of React defects  | tool        | major            | no           |
| REACT-10 | Object/function literal as an Effect or memo dependency                                    | Effects: the #1 source of React defects  | tool        | major            | no           |
| REACT-11 | Unrelated synchronisations crammed into one Effect / missing cleanup                       | Effects: the #1 source of React defects  | tool        | major            | no           |
| REACT-12 | Impure render: non-idempotent calls or side effects during render                          | Purity & the Rules of React              | tool        | major            | no           |
| REACT-13 | Mutating props, state, hook arguments/return values, or values already passed to JSX       | Purity & the Rules of React              | tool        | major            | no           |
| REACT-14 | Conditional / looped hooks; calling components as functions; passing hooks as values       | Purity & the Rules of React              | tool        | blocker          | no           |
| REACT-15 | Reading/writing `ref.current` during render; refs used as state                            | Purity & the Rules of React              | tool        | major            | no           |
| REACT-16 | Imperative-handle / ref overuse where a prop would do                                      | Purity & the Rules of React              | tool        | minor            | no           |
| REACT-17 | Ref callback implicit return (React 19 cleanup semantics)                                  | Purity & the Rules of React              | tool        | minor            | no           |
| REACT-18 | Contradictory boolean state (impossible states)                                            | State structure & identity               | judgement   | major            | no           |
| REACT-19 | Duplicated / mirrored state (prop copied into state, selected object stored twice)         | State structure & identity               | tool        | major            | no           |
| REACT-20 | Cargo-cult memoisation (or memo that can never hit)                                        | State structure & identity               | tool        | minor            | no           |
| REACT-21 | Server state copied into client state (store or `useState`)                                | State structure & identity               | judgement   | major            | yes          |
| REACT-22 | Code that silently de-opts React Compiler (interior mutability, unsupported syntax, suppr… | State structure & identity               | tool        | major            | yes          |
| REACT-23 | Controlled ↔ uncontrolled switching; `value` without `onChange`                            | State structure & identity               | tool        | minor            | no           |
| REACT-24 | Context value re-created every render (context re-render storm)                            | Composition & component structure        | tool        | major            | yes          |
| REACT-25 | Component defined inside a component (or created dynamically per render)                   | Composition & component structure        | tool        | major            | no           |
| REACT-26 | God component / boolean-prop explosion                                                     | Composition & component structure        | partial     | major            | yes          |
| REACT-27 | Prop drilling vs context overuse (misapplied either way)                                   | Composition & component structure        | judgement   | minor            | no           |
| REACT-28 | Render-prop / HOC nesting pyramid                                                          | Composition & component structure        | tool        | minor            | no           |
| REACT-29 | Missing, index-based, unstable or duplicate keys                                           | Composition & component structure        | tool        | major            | no           |
| REACT-30 | State reset surprises from tree position                                                   | Composition & component structure        | judgement   | major            | no           |
| REACT-31 | Leaked falsy values in conditional rendering                                               | Composition & component structure        | tool        | minor            | no           |
| REACT-32 | Referential default props (`= {}` / `= []` in parameter defaults)                          | Composition & component structure        | tool        | minor            | no           |
| REACT-33 | Missing or mis-scoped error boundaries; expecting them to catch everything                 | Async rendering, Suspense, errors, Reac… | tool        | major            | yes          |
| REACT-34 | `use(promise)` misuse: promise created in render, `use` in try/catch, bypassing `use`      | Async rendering, Suspense, errors, Reac… | tool        | blocker          | no           |
| REACT-35 | Suspense boundary misplacement                                                             | Async rendering, Suspense, errors, Reac… | judgement   | minor            | no           |
| REACT-36 | Hand-rolled pending/optimistic/error state around mutations in React 19                    | Async rendering, Suspense, errors, Reac… | tool        | minor            | no           |
| REACT-37 | `useEffectEvent` misuse                                                                    | Async rendering, Suspense, errors, Reac… | tool        | major            | no           |
| REACT-38 | Legacy APIs in React 19 code                                                               | Async rendering, Suspense, errors, Reac… | tool        | blocker          | no           |
| REACT-39 | Clickable `div`/`span` instead of `<button>`/`<a>`                                         | Accessibility anti-patterns (React DOM)  | tool        | major            | yes          |
| REACT-40 | Unlabelled form controls and icon-only buttons                                             | Accessibility anti-patterns (React DOM)  | tool        | major            | no           |
| REACT-41 | ARIA misuse: invalid roles, redundant roles, positive tabIndex, autofocus, aria-hidden on… | Accessibility anti-patterns (React DOM)  | tool        | minor            | no           |
| REACT-42 | `dangerouslySetInnerHTML` with non-constant content                                        | Security-hygiene overlap                 | tool        | blocker          | yes          |
| REACT-43 | User-controlled URLs in `href`/`src` (`javascript:` URLs) and `target="_blank"`            | Security-hygiene overlap                 | tool        | blocker          | no           |
| REACT-44 | Tokens/JWTs in `localStorage`; decoding JWT client-side for authorisation                  | Security-hygiene overlap                 | tool        | blocker          | yes          |
| REACT-45 | Server Functions treated as private / RSC runtime not patched                              | Security-hygiene overlap                 | tool        | blocker          | yes          |

<!-- END GENERATED INDEX -->

## Scope & sources consulted

Scope: React 19.x (latest on npm at research time: `react@19.3.0`, 2026-09-11) as used on web (react-dom) and,
where renderer-agnostic, React Native. Next.js-specific RSC/boundary items live in `nextjs.md`; RN-specific
items in `reactNative.md`. All sources opened 2026-09-13.

| Source                                                                                                                                               | Version / date                                                   | URL                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| react.dev — You Might Not Need an Effect                                                                                                             | live docs, opened 2026-09-13                                     | https://react.dev/learn/you-might-not-need-an-effect                                                                                                                                                   |
| react.dev — Rules of React (index)                                                                                                                   | live                                                             | https://react.dev/reference/rules                                                                                                                                                                      |
| react.dev — Components and Hooks must be pure                                                                                                        | live                                                             | https://react.dev/reference/rules/components-and-hooks-must-be-pure                                                                                                                                    |
| react.dev — Removing Effect Dependencies                                                                                                             | live                                                             | https://react.dev/learn/removing-effect-dependencies                                                                                                                                                   |
| react.dev — Preserving and Resetting State                                                                                                           | live                                                             | https://react.dev/learn/preserving-and-resetting-state                                                                                                                                                 |
| react.dev — Choosing the State Structure                                                                                                             | live                                                             | https://react.dev/learn/choosing-the-state-structure                                                                                                                                                   |
| react.dev — Rendering Lists (keys)                                                                                                                   | live                                                             | https://react.dev/learn/rendering-lists                                                                                                                                                                |
| react.dev — useMemo / useContext / useSyncExternalStore / use / useEffectEvent / forwardRef / Component / `<input>` refs                             | live                                                             | https://react.dev/reference/react/useMemo · /useContext · /useSyncExternalStore · /use · /useEffectEvent · /forwardRef · /Component · https://react.dev/reference/react-dom/components/input           |
| react.dev — `'use server'` (security considerations)                                                                                                 | live                                                             | https://react.dev/reference/rsc/use-server                                                                                                                                                             |
| react.dev — React Compiler introduction; directives                                                                                                  | compiler `babel-plugin-react-compiler@1.0.0` (npm)               | https://react.dev/learn/react-compiler/introduction · https://react.dev/reference/react-compiler/directives                                                                                            |
| react.dev — eslint-plugin-react-hooks lint index + rule pages (`set-state-in-effect`, `refs`, `purity`, `incompatible-library`, `static-components`) | plugin `7.1.1` (npm, 2026-09-11)                                 | https://react.dev/reference/eslint-plugin-react-hooks                                                                                                                                                  |
| eslint-plugin-react-hooks CHANGELOG + packaged README + compiled preset table (inspected from the npm tarball)                                       | 7.1.1                                                            | https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/CHANGELOG.md                                                                                                            |
| React blog — React 19; React 19.2                                                                                                                    | 2024-12-05; 2025-10-01                                           | https://react.dev/blog/2024/12/05/react-19 · https://react.dev/blog/2025/10/01/react-19-2                                                                                                              |
| React blog — RSC security advisories                                                                                                                 | 2025-12-03; 2025-12-11 (+2026-01-26 update)                      | https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components · https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components |
| eslint-plugin-react README                                                                                                                           | `7.37.5` (npm)                                                   | https://github.com/jsx-eslint/eslint-plugin-react/blob/master/README.md                                                                                                                                |
| @eslint-react (ESLint React) rules overview + rule page; unified plugin rule keys enumerated from the installed package                              | `@eslint-react/eslint-plugin@5.19.0` (2026-09-06)                | https://eslint-react.xyz/docs/rules/overview · https://eslint-react.xyz/docs/rules/no-nested-component-definitions                                                                                     |
| eslint-plugin-jsx-a11y README + packaged `lib/index.js` preset table                                                                                 | `6.10.2`                                                         | https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/main/README.md                                                                                                                               |
| SonarJS rules README (S-number ↔ key map)                                                                                                            | master, opened 2026-09-13 (`eslint-plugin-sonarjs@4.2.0` on npm) | https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md                                                                                                          |
| CodeQL JS query help index; `js/xss-through-dom` page                                                                                                | live                                                             | https://codeql.github.com/codeql-query-help/javascript/ · https://codeql.github.com/codeql-query-help/javascript/js-xss-through-dom/                                                                   |
| Semgrep rules repo — `typescript/react/{security,security/audit,best-practice}`                                                                      | `develop` branch                                                 | https://github.com/semgrep/semgrep-rules/tree/develop/typescript/react                                                                                                                                 |
| TanStack Query — "Does this replace client state?"                                                                                                   | latest docs                                                      | https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state                                                                                                           |
| TkDodo — React Query and Forms (maintainer blog)                                                                                                     | —                                                                | https://tkdodo.eu/blog/react-query-and-forms                                                                                                                                                           |

### Tool-version facts worth knowing before citing a rule (verified from the packages themselves)

- **`eslint-plugin-react-hooks@7.x` IS the React Compiler linter.** 7.0.0 "streamlined presets to just two
  configurations: `recommended` and `recommended-latest`", enabled "all compiler rules … by default", and
  removed `recommended-latest-legacy` / `flat/recommended` (CHANGELOG). Rules in `recommended` (compiled
  preset table in 7.1.1): `rules-of-hooks`, `exhaustive-deps`, `config`, `error-boundaries`, `gating`,
  `globals`, `immutability`, `incompatible-library` (warn), `preserve-manual-memoization`, `purity`, `refs`,
  `set-state-in-effect`, `set-state-in-render`, `static-components`, `unsupported-syntax` (warn), `use-memo`.
  `void-use-memo` is `recommended-latest` only. Present-but-`Off`: `no-deriving-state-in-effects`,
  `memoized-effect-dependencies`, `exhaustive-effect-dependencies`, `rule-suppression`, `capitalized-calls`,
  `memo-dependencies`, `hooks`. `component-hook-factories` was restored in 7.1.1 as a _deprecated_ rule.
  → A repo pinned on `eslint-plugin-react-hooks@4/5` (or v6 with the legacy `recommended`) has **none** of the
  purity/refs/set-state-in-effect coverage below — check `package.json` before claiming "the linter covers it".
- **`@eslint-react/eslint-plugin@5.x` rule keys are hyphen-flattened**, not slash-namespaced: e.g.
  `@eslint-react/dom-no-dangerously-set-innerhtml`, `@eslint-react/web-api-no-leaked-event-listener`,
  `@eslint-react/naming-convention-ref-name`, `@eslint-react/jsx-no-useless-fragment`. Older docs/blogs show
  `@eslint-react/dom/no-…`; that spelling is stale for v5. Three spellings are live for the same X rule: the
  unified bare key (`@eslint-react/no-array-index-key`, used by `recommended-typescript`), the unified `x-` alias
  (`@eslint-react/x-no-array-index-key` — every X rule is registered twice in 5.19.0), and the modular plugin key
  (`react-x/no-array-index-key`, shown on the rule doc pages). None of the three is "wrong". v5 also re-implements the compiler-family names
  (`@eslint-react/purity`, `refs`, `set-state-in-effect`, `static-components`, …). Note that
  `no-leaked-conditional-rendering`, `no-unstable-context-value`, `no-unstable-default-props` exist but are
  **not** in `recommended-typescript` (enumerated from the installed package).
- **`jsx-a11y/control-has-associated-label` and `jsx-a11y/anchor-ambiguous-text` are `off` in both
  `recommended` and `strict`** in 6.10.2 (packaged `lib/index.js`), despite the README table rendering them
  with a check mark in one fetch. Don't claim they run by default.
- **CodeQL query IDs use slashes** (`js/xss-through-dom`); the query-help URL slug uses hyphens.

---

## Effects: the #1 source of React defects

### REACT-01 Derived value stored in state and synced by an Effect

- **Signal:** `useState` + `useEffect(() => setX(f(a, b)), [a, b])` where `f` is pure over props/state.
  Grep: `useEffect\(\(\) => \{?\s*set[A-Z]\w*\(` whose deps are only props/state. Variants:
  `setFullName(first + ' ' + last)`, `setVisible(items.filter(...))`, `setSelected(items.find(...))`.
- **Tool coverage:** `react-hooks:set-state-in-effect` (7.1.1, recommended) flags synchronous setState in an
  effect body; `@eslint-react/set-state-in-effect` (5.19.0, warn). `react-hooks:no-deriving-state-in-effects`
  exists but is **off** in every preset. partial: tools flag _any_ sync setState; judgement decides whether the
  value is truly derivable, and whether the "fix" should be derive-in-render, `key` reset, or lifting.
- **Why it hurts:** performance (extra render pass with a stale value — "it does an entire render pass with a
  stale value … then immediately re-renders"), correctness (one frame of inconsistent UI; stale value visible
  to children and to other effects), maintainability (two sources of truth).
- **Severity:** major — raise to blocker when the stale frame drives a side effect (analytics, a POST, a
  navigation) or a cascade (REACT-03); minor when the value is purely presentational and cheap.
- **Remediation:** _Replace Derived Variable with Query_ (Fowler) — compute during render
  (`const fullName = first + ' ' + last`); wrap in `useMemo` only if measured ≥ ~1 ms (see REACT-20).
  Trap: replacing it with `useMemo` + the same dependency bug, or moving the computation into a `ref` read.
- **Not a finding when:** the value comes from a ref/DOM read (layout measurement in `useLayoutEffect` is the
  documented exception: "setState in an effect is acceptable when the value comes from a ref read"), or from a
  genuine external system (subscription callback, timer), or the setState is inside an async callback
  (`.then(...)`) rather than the synchronous body.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect · https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect

### REACT-02 Resetting or "adjusting" state on prop change inside an Effect

- **Signal:** `useEffect(() => { setComment(''); }, [userId])` or `useEffect(() => setSelection(null), [items])`.
- **Tool coverage:** `react-hooks:set-state-in-effect` catches the shape. partial: the tool cannot pick between
  the two correct remediations (keyed remount vs derive-from-id).
- **Why it hurts:** children render once with state belonging to the _previous_ entity (e.g. a draft comment
  shown on another user's profile for one frame, or submitted if an effect fires) — a privacy/correctness bug,
  not just perf.
- **Severity:** major; blocker if the stale state can be persisted or sent (form drafts, selections that
  drive a mutation).
- **Remediation:** (a) reset the whole subtree with `key={userId}` on the child ("React [treats] two `Profile`
  components with different `userId` as two different components that should not share any state"); (b) store
  an **id** and derive the object (`items.find(i => i.id === selectedId) ?? null`); (c) last resort: the
  "adjust during render" `prevItems` pattern. Trap: `key` remounts _everything_ below — including expensive
  children and their fetched data; don't key a whole page to reset one field.
- **Not a finding when:** the reset is a deliberate response to an external event (e.g. websocket reconnect).
- **Architecture:** no.
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect · https://react.dev/learn/preserving-and-resetting-state

### REACT-03 Effect chains (Effect → setState → Effect → setState)

- **Signal:** ≥2 effects where one effect's deps include a state variable set by another effect
  (`[card]` sets `goldCardCount`; `[goldCardCount]` sets `round`; `[round]` sets `isGameOver`). Metric: count
  effects in a component whose dep arrays reference state set by a sibling effect — ≥1 edge is a finding.
- **Tool coverage:** `react-hooks:set-state-in-effect` flags each link; none — judgement for recognising the
  _chain_ and relocating the logic.
- **Why it hurts:** "the component (and its children) have to re-render between each `set` call in the chain";
  brittle ordering; logic that belongs to one user action becomes impossible to trace; replaying history
  (e.g. undo, restoring state) re-triggers the chain.
- **Severity:** major.
- **Remediation:** derive terminal values in render (`const isGameOver = round > 5`) and compute all next state
  inside the event handler that caused it; for complex transitions _Replace Conditional Logic with a state
  machine_ — `useReducer` (Command/Reducer) or a statechart. Trap: collapsing into one giant effect with the
  same logic.
- **Not a finding when:** each step genuinely synchronises with a distinct external system.
- **Architecture:** no (yes if the chain spans contexts/stores — escalate as a state-ownership issue).
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect

### REACT-04 User-event logic placed in an Effect (flag-state → Effect → side effect)

- **Signal:** state named like an event (`submitted`, `jsonToSubmit`, `shouldSave`, `clicked`) set in a handler
  and consumed by `useEffect(() => { if (flag) post(...)/showNotification(...) }, [flag, ...])`.
- **Tool coverage:** none — judgement (no rule models "why does this run"). `set-state-in-effect` won't fire
  because the setState is in the handler.
- **Why it hurts:** the side effect re-fires when an unrelated dependency changes (the docs' example re-shows a
  notification on theme change); fires twice under StrictMode dev double-invoke; duplicated POSTs; fires on
  mount when a page is restored with the flag already true.
- **Severity:** blocker when the effect performs a non-idempotent mutation (POST, payment, email); major otherwise.
- **Remediation:** _Move Function_ into the event handler; share logic across handlers by extracting a plain
  function (`buyProduct()`); for mutations use a React 19 Action / `useActionState` or TanStack `useMutation`
  (Command). Decision rule from the docs: "Use Effects only for code that should run _because_ the component
  was displayed."
- **Not a finding when:** the side effect really is "because it was displayed" (page-view analytics,
  `post('/analytics/event', { eventName: 'visit_form' })`).
- **Architecture:** no.
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect · https://react.dev/learn/removing-effect-dependencies

### REACT-05 Notifying the parent from an Effect / passing fetched data up

- **Signal:** `useEffect(() => { onChange(isOn) }, [isOn, onChange])` or
  `useEffect(() => { if (data) onFetched(data) }, [data, onFetched])` in a child.
- **Tool coverage:** none — judgement.
- **Why it hurts:** two render passes; inverted data flow ("the data flow becomes very difficult to trace");
  infinite loops when the parent passes an inline `onChange` that sets state.
- **Severity:** major (blocker if it produces a render loop).
- **Remediation:** call `onChange` in the same event handler that sets local state, or make the component fully
  **controlled** (`{ isOn, onChange }`), or _lift the fetch_ into the parent and pass data down.
- **Not a finding when:** reporting a value that originates from an external system the parent can't see
  (e.g. an imperative map widget emitting viewport changes) — but even then prefer the widget's callback.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect

### REACT-06 Fetch in an Effect with no race/abort handling

- **Signal:** `useEffect(() => { fetch(url).then(r => r.json()).then(setData) }, [query])` with **no** cleanup
  returning `ignore = true` / `controller.abort()`. Also `async` function inside effect without cancellation.
- **Tool coverage:** `@eslint-react/web-api-no-leaked-fetch` (5.19.0, warn in recommended) — "Enforces
  AbortController cleanup for fetch". partial: it doesn't catch non-`fetch` clients (axios, SDK calls), nor the
  missing loading/error states, nor caching/dedup.
- **Why it hurts:** race condition — "there is no guarantee about which order the responses will arrive in" →
  results for an old query overwrite the new one; setState after unmount; no caching, no dedup, request
  waterfalls, double fetch in StrictMode dev.
- **Severity:** major; blocker when the stale response is rendered as authoritative (search results, account
  data after account switch).
- **Remediation:** use the framework's data layer (RSC fetch, route loaders) or TanStack Query `useQuery`; if an
  Effect is unavoidable, add the `ignore` flag / `AbortController` cleanup. Trap: an `isMounted` ref — it hides
  the warning without fixing the ordering race.
- **Not a finding when:** the fetch is fire-and-forget page-view analytics, or the code already goes through a
  cache library.
- **Architecture:** yes when repeated across features — no data-fetching layer is an architectural gap;
  escalate to architecture (choose server-state library / RSC data pattern).
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect · https://eslint-react.xyz/docs/rules/overview

### REACT-07 Manual external-store subscription in `useEffect` + `useState`

- **Signal:** `useEffect(() => { const h = () => setX(read()); h(); target.addEventListener('evt', h); return () => target.removeEventListener('evt', h) }, [])`
  reading `navigator.onLine`, `window.matchMedia`, a non-React store, `localStorage`, etc.
- **Tool coverage:** `react-hooks:set-state-in-effect` fires on the initial `h()` call; `@eslint-react/web-api-no-leaked-event-listener`
  catches a _missing_ removal. none — judgement for "should be `useSyncExternalStore`".
- **Why it hurts:** tearing under concurrent rendering (different components see different snapshots); a flash
  of the default value on mount; SSR mismatch.
- **Severity:** minor–major (major when the value gates behaviour, e.g. offline mode).
- **Remediation:** `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` wrapped in a custom hook
  (Adapter over the external store). Traps (all from the docs): `getSnapshot` must return a cached/immutable
  value ("The result of getSnapshot should be cached" infinite loop if it returns a new object); define
  `subscribe` **outside** the component or it resubscribes every render; omitting `getServerSnapshot` throws
  during server rendering. And the docs prefer plain `useState`/`useReducer` when the state is React-owned.
- **Not a finding when:** the effect synchronises _to_ the external system (writes) rather than reading from it.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect · https://react.dev/reference/react/useSyncExternalStore

### REACT-08 One-time app initialisation inside a component Effect

- **Signal:** `useEffect(() => { checkAuthToken(); loadDataFromLocalStorage(); }, [])` in the root component.
- **Tool coverage:** none — judgement.
- **Why it hurts:** "it runs twice in development. This can cause issues — for example, maybe it invalidates the
  authentication token because the function wasn't designed to be called twice"; also re-runs on remount of the
  root (fast refresh, error-boundary reset).
- **Severity:** major if non-idempotent (token rotation, one-time codes); minor otherwise.
- **Remediation:** module-level init guarded by `typeof window !== 'undefined'`, or a top-level `didInit` flag;
  better, make the operation idempotent. Trap: removing `<StrictMode>` to "fix" the double call.
- **Not a finding when:** the effect is idempotent and its cleanup correctly undoes it.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/you-might-not-need-an-effect

### REACT-09 Lying to the dependency array (suppressing `exhaustive-deps`)

- **Signal:** `// eslint-disable-next-line react-hooks/exhaustive-deps` (or file-level disable) above a hook;
  `useEffect(..., [])` that reads props/state; refs used purely to smuggle latest values
  (`latestX.current = x` during render).
- **Tool coverage:** `react-hooks:exhaustive-deps` finds the lie _until suppressed_; the compiler rule
  `rule-suppression` exists but is **off** in presets. ESLint core `--report-unused-disable-directives` catches
  stale suppressions only. Grep `eslint-disable.*exhaustive-deps` is the reliable detector.
- **Why it hurts:** stale closures — "Suppressing the linter leads to very unintuitive bugs that are hard to find
  and fix" (timer stuck at its initial count). React Compiler also bails out on components that suppress React
  lint rules (see REACT-22).
- **Severity:** major; blocker when the stale value is security/tenant-relevant (stale `userId`, stale auth token).
- **Remediation:** change the code, not the deps: move objects/functions inside the effect or outside the
  component; destructure primitives; use updater functions (`setMsgs(m => [...m, x])`); split unrelated
  effects; for non-reactive reads use `useEffectEvent` (React 19.2). Docs: "treat the dependency lint error as a
  compilation error." Trap: wrapping everything in `useEffectEvent` "just to silence the lint error, as this can
  lead to bugs" (19.2 blog).
- **Not a finding when:** a justified, commented suppression for a documented upstream bug with a tracking link
  (still flag as minor debt).
- **Architecture:** no.
- **Sources:** https://react.dev/learn/removing-effect-dependencies · https://react.dev/blog/2025/10/01/react-19-2

### REACT-10 Object/function literal as an Effect or memo dependency

- **Signal:** `const options = { roomId, serverUrl }` (or an inline function) declared in component body and
  listed in a `useEffect`/`useMemo`/`useCallback` dep array.
- **Tool coverage:** `react-hooks:exhaustive-deps` warns for functions/objects that change every render ("The
  'x' object makes the dependencies of useEffect change on every render" — UNVERIFIED exact message text);
  compiler auto-memoises when enabled. partial: judgement on whether to move inside, hoist, or destructure.
- **Why it hurts:** effect re-synchronises every render (reconnect storms, repeated fetches); memo is silently
  useless — "a single value that's 'always new' is enough to break memoization for an entire component."
- **Severity:** major for effects that connect/fetch; minor for memo.
- **Remediation:** move the object inside the effect / `useMemo` callback; hoist static objects to module scope;
  depend on primitives. Trap: adding `useMemo` around the object just to feed another hook — a memo chain.
- **Not a finding when:** React Compiler is enabled and the value is compiler-memoised, _and_ nothing relies on
  referential stability for correctness.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/removing-effect-dependencies · https://react.dev/reference/react/useMemo

### REACT-11 Unrelated synchronisations crammed into one Effect / missing cleanup

- **Signal:** an effect body with two `fetch`/`subscribe` calls keyed on different inputs, or an effect that
  calls `addEventListener`/`setInterval`/`setTimeout`/`new IntersectionObserver`/`new ResizeObserver` without a
  returned cleanup.
- **Tool coverage:** `@eslint-react/web-api-no-leaked-event-listener`, `web-api-no-leaked-interval`,
  `web-api-no-leaked-timeout`, `web-api-no-leaked-intersection-observer`, `web-api-no-leaked-resize-observer`
  (5.19.0, all warn in recommended). none — judgement for the "two purposes" split.
- **Why it hurts:** leaks (listeners accumulate per remount; StrictMode double-mount doubles them), unneeded
  refetches when either input changes.
- **Severity:** major for leaks on long-lived screens; minor for split-purpose alone.
- **Remediation:** _Split Phase_ — one effect per external system; always return cleanup mirroring setup.
- **Not a finding when:** the listener is registered on an element whose lifetime equals the component (a ref
  callback with React 19 cleanup) — still prefer returning cleanup.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/removing-effect-dependencies · https://eslint-react.xyz/docs/rules/overview

---

## Purity & the Rules of React

### REACT-12 Impure render: non-idempotent calls or side effects during render

- **Signal:** in a component/hook body (not in a handler/effect): `Date.now()`, `new Date()`, `Math.random()`,
  `crypto.randomUUID()`, `performance.now()`; DOM writes (`document.title = …`); network calls; `localStorage`
  writes; logging/analytics dispatch; mutating a module-level variable (`items.push(...)` on an array declared
  outside the component).
- **Tool coverage:** `react-hooks:purity` (7.1.1) — known-impure functions `Math.random()`, `Date.now()` /
  `new Date()`, `crypto.randomUUID()`, `performance.now()`; `react-hooks:globals` — assignment/mutation of
  globals during render; `@eslint-react/purity` (warn). partial: user-defined impure helpers
  (`getNow()`, `track()`) and network/storage calls are invisible to the known-function list.
- **Why it hurts:** React may render components multiple times/abandon renders (concurrent, StrictMode);
  hydration mismatches (server time ≠ client time); memoisation/compiler correctness assumptions broken;
  duplicated analytics.
- **Severity:** major; blocker when it produces hydration errors on SSR pages or duplicated writes.
- **Remediation:** move to event handlers or Effects; stable IDs via `useState(() => crypto.randomUUID())` or
  `useId`; time via a `useTime` hook with an interval effect. Trap: `useMemo(() => Date.now(), [])` — memo is a
  perf hint, not a semantic guarantee.
- **Not a finding when:** **local mutation** of values created in this render ("Local mutation is absolutely
  fine" — building an `items` array with `push` inside the component); impure call inside a `useState`
  initializer; inside an event handler closure defined in render.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/rules/components-and-hooks-must-be-pure · https://react.dev/reference/eslint-plugin-react-hooks/lints/purity

### REACT-13 Mutating props, state, hook arguments/return values, or values already passed to JSX

- **Signal:** `item.url = …` on a prop; `state.list.push(x); setState(state)`; `count = count + 1`;
  `icon.className = …` inside a custom hook on its argument; `styles.size = 'small'` after `<Header styles={styles}/>`;
  `array.sort()` / `.reverse()` / `.splice()` on props or state (in-place mutators).
- **Tool coverage:** `react-hooks:immutability` (7.1.1) — "mutating props, state, and other immutable values";
  `@eslint-react/immutability`; `codeql:js/react/direct-state-mutation` (class `this.state`);
  `react:no-direct-mutation-state` / `sonarjs:S6746` (class components only); `sonarjs:S6759`
  (`prefer-read-only-props`, TS `Readonly<Props>`). partial: mutation through helper functions or deep objects
  from a store; `.sort()` on a prop copy-vs-original distinction needs judgement (ES2023 `toSorted()` fixes it).
- **Why it hurts:** UI doesn't update (same reference → bail-out), or updates inconsistently; memoised children
  show stale data; parent's data silently corrupted; compiler optimisations become wrong.
- **Severity:** major; blocker when the mutated object is shared cache data (TanStack Query cache, store state).
- **Remediation:** copy-on-write (`{...obj}`, `toSorted`, `toSpliced`, `with`), Immer (`useImmer`/`produce`) for
  deep updates; `Readonly<>` prop types. Trap: shallow copy then mutating a nested object.
- **Not a finding when:** mutating a fresh object created in the same render before it is passed anywhere.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/rules/components-and-hooks-must-be-pure · https://react.dev/reference/eslint-plugin-react-hooks · https://codeql.github.com/codeql-query-help/javascript/ · https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md

### REACT-14 Conditional / looped hooks; calling components as functions; passing hooks as values

- **Signal:** a hook after an early `return`; `if (x) useEffect(...)`; `items.map(i => useMemo(...))`;
  `{Header()}` instead of `<Header/>`; `const useFn = cond ? useA : useB`; hooks passed as props.
- **Tool coverage:** `react-hooks:rules-of-hooks` (recommended; `sonarjs:S6440`); 6.1.0 added "disallowing `use`
  calls in try/catch blocks and `useEffectEvent` functions in arbitrary closures"; compiler `hooks` rule is off.
  partial: calling a component as a function (`Header()`) is often not caught.
- **Why it hurts:** hook order corruption → state attached to the wrong hook; calling a component as a function
  merges its hooks into the caller, breaking identity/state reset and devtools.
- **Severity:** blocker (hook order) / major (component-as-function).
- **Remediation:** extract a child component for per-item hooks (`<Report item={item}/>`); render components via
  JSX only ("Never call component functions directly"). Note `use()` is the one API allowed conditionally.
- **Not a finding when:** plain helper functions named without `use`/capitalisation that return JSX (render
  helpers) — but see REACT-26.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/rules · https://react.dev/reference/react/useMemo · https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/CHANGELOG.md

### REACT-15 Reading/writing `ref.current` during render; refs used as state

- **Signal:** `const v = ref.current` in the component body used in JSX; `ref.current = value` in render
  ("latest ref" pattern); UI that depends on a ref value (won't re-render).
- **Tool coverage:** `react-hooks:refs` (7.1.1) — detects reading/writing `ref.current` during render; refs
  recognised via `useRef()`, `createRef()`, identifiers named `ref`/`*Ref`, JSX `ref` prop.
  `@eslint-react/naming-convention-ref-name` makes that heuristic reliable. partial: refs stored in objects or
  renamed escape the name heuristic.
- **Why it hurts:** render output depends on a value React can't track → stale UI; the "latest ref" pattern
  races under concurrent rendering (a discarded render writes the ref).
- **Severity:** major.
- **Remediation:** state for anything shown; read refs in handlers/effects; for "latest value in a callback" use
  `useEffectEvent` (from Effects) or an event handler. Trap: moving the write into `useLayoutEffect` without
  considering that callbacks may fire before it runs.
- **Not a finding when:** lazy initialisation `if (ref.current === null) ref.current = expensive()` (documented
  exception); reading refs inside handlers/effects.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/eslint-plugin-react-hooks/lints/refs

### REACT-16 Imperative-handle / ref overuse where a prop would do

- **Signal:** `useImperativeHandle(ref, () => ({ open, close, setValue }))`; parents calling `childRef.current.open()`;
  new `forwardRef` in React 19 code.
- **Tool coverage:** `@eslint-react/no-forward-ref` (warn, recommended — "Replaces forwardRef with ref as prop
  (React 19+)"). none — judgement for imperative-API-where-declarative-fits.
- **Why it hurts:** hidden two-way coupling, untestable state lives in the child, breaks controlled data flow.
- **Severity:** minor (forwardRef in React 19) / major (imperative state APIs).
- **Remediation:** "If you can express something as a prop, you should not use a ref" (`<Modal isOpen/>`);
  React 19 `ref` as a regular prop — "`forwardRef` will be deprecated in a future release." Trap: codemodding
  `forwardRef` away in a library that still supports React 18 consumers.
- **Not a finding when:** focus, scroll, select text, trigger animation, integrate a non-React widget (the
  docs' allowed list).
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react/forwardRef · https://react.dev/blog/2024/12/05/react-19

### REACT-17 Ref callback implicit return (React 19 cleanup semantics)

- **Signal:** `ref={el => (this.node = el)}` / `ref={current => instance = current}` — arrow with expression
  body that returns a value.
- **Tool coverage:** TypeScript with React 19 types "now rejects non-cleanup returns". none for JS files.
- **Why it hurts:** in React 19 a function returned from a ref callback is treated as cleanup; returning a
  non-function is a type error, returning a function by accident runs it on detach.
- **Severity:** minor.
- **Remediation:** block body: `ref={current => { instance = current }}`.
- **Not a finding when:** the returned function is an intentional cleanup.
- **Architecture:** no.
- **Sources:** https://react.dev/blog/2024/12/05/react-19

---

## State structure & identity

### REACT-18 Contradictory boolean state (impossible states)

- **Signal:** ≥2 booleans describing one lifecycle: `isLoading` + `isError` + `isSuccess`, `isSending` +
  `isSent`; guards like `if (isSending && isSent)`. Metric: ≥2 related booleans updated together in handlers.
- **Tool coverage:** none — judgement.
- **Why it hurts:** "you leave room for mistakes" — both true at once; UI shows spinner + success; every new
  flag doubles the state space.
- **Severity:** major.
- **Remediation:** _Replace Type Code with_ a discriminated-union `status` (`'typing' | 'sending' | 'sent'`),
  derive booleans; `useReducer` or a statechart for transitions. Trap: a string status with ad-hoc payload fields
  not tied to the variant — use a TS discriminated union.
- **Not a finding when:** the flags are genuinely orthogonal (e.g. `isMenuOpen` and `isDarkMode`).
- **Architecture:** no.
- **Sources:** https://react.dev/learn/choosing-the-state-structure

### REACT-19 Duplicated / mirrored state (prop copied into state, selected object stored twice)

- **Signal:** `useState(props.messageColor)` where the prop name lacks `initial`/`default`; `const [selectedItem, setSelectedItem] = useState(items[0])`
  alongside `items`; deeply nested trees updated by copying parent chains.
- **Tool coverage:** `semgrep:typescript.react.best-practice.react-props-in-state` (react best-practice pack;
  exact message UNVERIFIED — file name seen in repo). none for the object-duplication case.
- **Why it hurts:** state stops tracking the prop ("won't update if prop changes"); edits to `items` don't
  reflect in `selectedItem`; nested updates are error-prone.
- **Severity:** major.
- **Remediation:** use the prop directly; if intentionally uncontrolled, rename to `initialX`/`defaultX`
  (documented convention); store IDs and derive; normalise nested state into id-keyed maps.
- **Not a finding when:** the prop is explicitly an initial value (`initialColor`) and the component documents
  that later changes are ignored.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/choosing-the-state-structure · https://github.com/semgrep/semgrep-rules/tree/develop/typescript/react/best-practice

### REACT-20 Cargo-cult memoisation (or memo that can never hit)

- **Signal:** `useMemo`/`useCallback` around trivial expressions; every handler wrapped in `useCallback` with no
  `memo` consumer and no effect dependency; `memo(Component)` receiving inline object/function/JSX `children`
  props; `useMemo` whose callback returns nothing.
- **Tool coverage:** `react-hooks:use-memo` (useMemo without return value); `react-hooks:void-use-memo`
  (`recommended-latest` only); `react-hooks:preserve-manual-memoization` (compiler cannot preserve existing
  memo). none — judgement for "unnecessary".
- **Why it hurts:** readability cost, dependency bugs, false sense of optimisation. Docs: valuable only when the
  calculation is "noticeably slow" (measure; "1ms or more"), when passed to a `memo` child, or when used as a
  hook dependency.
- **Severity:** minor (noise) / major when manual memo masks a purity bug ("If re-rendering a component causes a
  problem … it's a bug in your component! Fix the bug instead of adding memoization").
- **Remediation:** delete the wrapper and prefer the structural fixes: accept JSX as `children`, keep state
  local, remove effect chains; adopt React Compiler. Trap: on a compiler-enabled codebase, the compiler docs
  recommend "leaving existing memoization in place (removing it can change compilation output) or carefully
  testing before removing".
- **Not a finding when:** the memoised value is an Effect dependency (the compiler docs explicitly keep this
  use), a context value (REACT-24), or measured-expensive.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react/useMemo · https://react.dev/learn/react-compiler/introduction

### REACT-21 Server state copied into client state (store or `useState`)

- **Signal:** `useEffect(() => { if (data) setForm(data) }, [data])` after `useQuery`; Redux/Zustand slices
  holding `users`, `projects`, `isLoading`, `error` fetched from APIs; hand-written cache invalidation.
- **Tool coverage:** none — judgement (`set-state-in-effect` catches only the sync-copy shape).
- **Why it hurts:** "as soon as we copy that state somewhere else, React Query cannot do its job anymore" —
  background refetches ignored, last-writer-wins in collaborative edits; duplicated loading/error logic.
- **Severity:** major.
- **Remediation:** server state in TanStack Query (or RSC); client store only for UI state; for editable forms
  use "initial values only" (`defaultValue` + `staleTime: Infinity`) or _derived_ display state (client edits
  overlay server state). Trap: `staleTime: Infinity` globally to stop the copy being overwritten.
- **Not a finding when:** an explicit offline-first/local-first model where the store is the source of truth.
- **Architecture:** yes — ownership of server vs client state is an app-wide boundary; escalate to architecture.
- **Sources:** https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state · https://tkdodo.eu/blog/react-query-and-forms

### REACT-22 Code that silently de-opts React Compiler (interior mutability, unsupported syntax, suppressions)

- **Signal:** `useForm().watch(...)` (react-hook-form), `useReactTable(...)` (TanStack Table), MobX `observer`;
  `"use no memo"` without TODO/ticket; lint suppressions in component files; `eval`/`with`/other
  unsupported syntax.
- **Tool coverage:** `react-hooks:incompatible-library` (warn; detects react-hook-form `watch`, TanStack
  `useReactTable`; MobX "not yet automatically detected"), `react-hooks:unsupported-syntax` (warn),
  `react-hooks:config`, `react-hooks:gating`. partial: custom libraries with interior mutability aren't known.
- **Why it hurts:** memoised children receive a same-reference object whose contents changed → stale UI after
  compiler adoption (a regression that appears only when the compiler is turned on).
- **Severity:** major on compiler-enabled apps; minor otherwise.
- **Remediation:** `useWatch({ control, name })` instead of `watch`; isolate incompatible components with a
  documented `"use no memo"` (docs: "temporary escape hatch … Add the directive with a TODO comment, Create a
  tracking issue"); design own hooks to "return immutable state with explicit update functions".
- **Not a finding when:** compiler is not in use and no manual memo sits downstream.
- **Architecture:** yes if a core library (tables, forms) is incompatible — library choice is architectural.
- **Sources:** https://react.dev/reference/eslint-plugin-react-hooks/lints/incompatible-library · https://react.dev/reference/react-compiler/directives

### REACT-23 Controlled ↔ uncontrolled switching; `value` without `onChange`

- **Signal:** `<input value={maybeUndefined} onChange=…/>` (value initially `undefined`/`null`); `value` with no
  `onChange` and no `readOnly`; async or transformed setState in `onChange` (caret jump).
- **Tool coverage:** runtime warning only ("A component is changing an uncontrolled input to be controlled").
  none static (TS `string | undefined` types hint at it).
- **Why it hurts:** input stops accepting typing or loses value; caret jumps; flaky form tests.
- **Severity:** minor–major (major on primary forms).
- **Remediation:** `value={x ?? ''}`; choose `defaultValue` for uncontrolled; update synchronously with
  `e.target.value`; in React 19 consider uncontrolled forms + Actions/`FormData`.
- **Not a finding when:** a deliberately read-only input with `readOnly`.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react-dom/components/input

---

## Composition & component structure

### REACT-24 Context value re-created every render (context re-render storm)

- **Signal:** `<Ctx value={{ user, login }}>` / `<Ctx.Provider value={{...}}>` or inline arrow functions as the
  value; one "AppContext" holding many unrelated fast-changing fields consumed widely.
- **Tool coverage:** `react:jsx-no-constructed-context-values` (not in recommended) = `sonarjs:S6481`;
  `@eslint-react/no-unstable-context-value` (not in recommended-typescript). partial: "one mega context with
  unrelated fields" is judgement.
- **Why it hurts:** every consumer re-renders on every provider render; "`memo` does not prevent children from
  receiving fresh context values."
- **Severity:** major for providers high in the tree; minor for leaf providers.
- **Remediation:** `useMemo` the value and `useCallback` functions (docs pattern); _split context_ by change
  rate (state vs dispatch); for high-frequency shared state use an external store with selectors via
  `useSyncExternalStore`. Trap: memoising the value while one dep (an inline object) changes every render.
- **Not a finding when:** React Compiler is enabled and memoises the provider value, or the provider sits at a
  leaf with a trivially small subtree.
- **Architecture:** yes if context is used as a global state manager — escalate state-management choice.
- **Sources:** https://react.dev/reference/react/useContext · https://github.com/jsx-eslint/eslint-plugin-react/blob/master/README.md · https://eslint-react.xyz/docs/rules/overview

### REACT-25 Component defined inside a component (or created dynamically per render)

- **Signal:** `function Parent() { const Child = () => …; return <Child/> }`; `const Comp = cond ? () => <a/> : () => <b/>`;
  `renderItem={() => <Row/>}` passed as a _component type_ (`component={() => …}`); `React.lazy` inside a component.
- **Tool coverage:** `react-hooks:static-components` (7.1.1), `@eslint-react/no-nested-component-definitions`
  (error), `@eslint-react/no-nested-lazy-component-declarations`, `react:no-unstable-nested-components` =
  `sonarjs:S6478`; semgrep `typescript.react.best-practice.define-styled-components-on-module-level`
  (styled-components variant).
- **Why it hurts:** "React sees each as a brand new component type, unmounting the old one and mounting the new
  one, destroying all state and DOM nodes" — input focus loss per keystroke, effects re-run, perf collapse.
- **Severity:** major (blocker when it holds user input).
- **Remediation:** hoist to module scope and pass data via props; pick between pre-defined components
  (Strategy/lookup map). Trap: `useCallback`-wrapping the inner component — still a new identity whenever deps
  change.
- **Not a finding when:** a render _function_ called as `{renderRow(item)}` (not used as `<Comp/>`), or a render
  prop invoked as a function.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/eslint-plugin-react-hooks/lints/static-components · https://react.dev/learn/preserving-and-resetting-state · https://eslint-react.xyz/docs/rules/no-nested-component-definitions

### REACT-26 God component / boolean-prop explosion

- **Signal:** component file > ~300 LOC or > ~10 `useState`/`useEffect` calls (heuristic — no primary source
  gives a React-specific threshold; use the repo's own cognitive-complexity gate, e.g. `sonarjs:S3776`);
  ≥3 boolean props that select _different subtrees/behaviour_ (`isEditing`, `isCompact`, `showActions`,
  `variant` + `isX`); JSX with nested ternaries selecting layouts.
- **Tool coverage:** partial — `sonarjs:S3776` cognitive complexity / ESLint `complexity`, `max-lines` catch
  size; none — judgement for boolean-mode props.
- **Why it hurts:** combinatorial prop states nobody tests; every feature adds a flag; impossible to reason
  about which combinations are valid (REACT-18 at the props level).
- **Severity:** major when modes switch behaviour (data fetching, mutations); minor for cosmetic variants.
- **Remediation:** _Replace Conditional with Polymorphism_ → compound components / separate components per mode
  selected by an orchestrating parent; discriminated-union props (`{ mode: 'edit', onSave } | { mode: 'view' }`);
  container/presentational split; headless hook + render components. Trap: a single `variant` string that still
  hides behaviour branches inside.
- **Not a finding when:** booleans are purely presentational tokens of a design-system primitive (`disabled`,
  `fullWidth`) mapping 1:1 to styles.
- **Architecture:** yes for shared design-system components (public API is expensive to change) — escalate to
  architecture/UX owner.
- **Sources:** https://react.dev/learn/choosing-the-state-structure (principle applied to props; thresholds UNVERIFIED)

### REACT-27 Prop drilling vs context overuse (misapplied either way)

- **Signal:** the same prop threaded through ≥3 intermediate components that don't use it; _or_ a context
  introduced to avoid passing one prop one level.
- **Tool coverage:** none — judgement.
- **Why it hurts:** drilling couples intermediates to data they don't own; context overuse hides dependencies,
  makes components non-reusable outside the provider, and causes REACT-24 storms.
- **Severity:** minor (major at design-system boundaries).
- **Remediation:** first try composition — pass JSX as `children`/slots so intermediates don't see the data
  (docs: "When a component visually wraps other components, let it accept JSX as children"); keep state as
  local as possible; context for truly cross-cutting values (theme, locale, auth session).
- **Not a finding when:** 1–2 levels of explicit props (explicit is good).
- **Architecture:** no (yes if it reflects missing state ownership).
- **Sources:** https://react.dev/reference/react/useMemo (principles section) · https://react.dev/reference/react/useContext

### REACT-28 Render-prop / HOC nesting pyramid

- **Signal:** `withA(withB(withC(Component)))`, JSX pyramids of render-prop components (`<Query>{d => <Mutation>{m => …}</Mutation>}</Query>`);
  `React.cloneElement` / `Children.map` to inject props.
- **Tool coverage:** `@eslint-react/no-clone-element`, `no-children-map`, `no-children-for-each`,
  `no-children-count`, `no-children-only`, `no-children-to-array` (warn). none for HOC depth.
- **Why it hurts:** props collision/shadowing across HOCs, opaque devtools trees, fragile implicit contracts
  (cloneElement breaks when a child is wrapped in a Fragment/memo).
- **Severity:** minor–major.
- **Remediation:** replace with custom hooks (the hook _is_ the Decorator); compound components with context
  instead of `cloneElement`.
- **Not a finding when:** a single boundary HOC required by a library (e.g. error boundary wrapper), or legacy
  code not being touched.
- **Architecture:** no.
- **Sources:** https://eslint-react.xyz/docs/rules/overview

### REACT-29 Missing, index-based, unstable or duplicate keys

- **Signal:** `.map(x => <Row …/>)` without `key`; `key={index}` / `key={i}` on reorderable/insertable lists;
  `key={Math.random()}` / `key={crypto.randomUUID()}` in render; `<>` shorthand inside `.map` (can't take a key);
  `key` placed after `{...spread}`.
- **Tool coverage:** `react:jsx-key` = `sonarjs:S6477`; `@eslint-react/no-missing-key` (error),
  `@eslint-react/no-duplicate-key`, `@eslint-react/no-implicit-key`, `@eslint-react/jsx-no-key-after-spread`
  (error); `react:no-array-index-key` = `sonarjs:S6479` / `@eslint-react/no-array-index-key` (warn);
  `react-hooks:purity` flags `Math.random()` keys. partial: `sonarjs:S6479` misses composite keys containing
  the index (community FP/FN report); keys unique per sibling but _not stable across refetch_ (e.g. derived from
  display name) need judgement.
- **Why it hurts:** "Index as a key often leads to subtle and confusing bugs" — state/input attached to the wrong
  row after insert/delete/sort; random keys "cause … all your components and DOM being recreated every time …
  lose any user input".
- **Severity:** major for lists with local state/inputs or reorder; minor for static never-reordered lists.
- **Remediation:** DB ids; for local items assign an id at creation (`crypto.randomUUID()` in the _creation
  handler_); `<Fragment key={id}>`.
- **Not a finding when:** a static list that never reorders/filters and whose items hold no state (the index is
  then equivalent).
- **Architecture:** no (yes if the API doesn't return stable ids — contract issue).
- **Sources:** https://react.dev/learn/rendering-lists · https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md · https://eslint-react.xyz/docs/rules/overview

### REACT-30 State reset surprises from tree position

- **Signal:** conditional rendering of the _same component type at the same position_ expecting a reset
  (`isFancy ? <Counter isFancy/> : <Counter/>`), or conversely wrapping a subtree in a new element type
  conditionally (e.g. `cond ? <div><Form/></div> : <Form/>`) and losing state unexpectedly.
- **Tool coverage:** none — judgement.
- **Why it hurts:** "it's the position in the UI tree — not in the JSX markup — that matters"; form state leaks
  between two logical entities, or is wiped on a cosmetic wrapper change.
- **Severity:** major when user input is involved.
- **Remediation:** add `key` to express identity; keep wrapper structure stable (toggle classes, not wrappers).
- **Not a finding when:** preserving state is intended.
- **Architecture:** no.
- **Sources:** https://react.dev/learn/preserving-and-resetting-state

### REACT-31 Leaked falsy values in conditional rendering

- **Signal:** `{count && <Badge/>}`, `{items.length && <List/>}` where the left side can be `0`/`NaN`; in RN
  this crashes (text outside `<Text>`).
- **Tool coverage:** `react:jsx-no-leaked-render` (not recommended); `@eslint-react/no-leaked-conditional-rendering`
  (not in recommended-typescript; type-aware). partial: requires type info to know the operand is numeric.
- **Why it hurts:** renders a stray "0"; on React Native renders a raw string outside `<Text>` → runtime error
  (see reactNative.md).
- **Severity:** minor on web, major on RN.
- **Remediation:** `{count > 0 && …}`, `{Boolean(x) && …}` or ternary with `null`.
- **Not a finding when:** the operand is typed `boolean`.
- **Architecture:** no.
- **Sources:** https://github.com/jsx-eslint/eslint-plugin-react/blob/master/README.md · https://eslint-react.xyz/docs/rules/overview

### REACT-32 Referential default props (`= {}` / `= []` in parameter defaults)

- **Signal:** `function List({ items = [], style = {} })` feeding memo/effect deps or `memo` children.
- **Tool coverage:** `react:no-object-type-as-default-prop`; `@eslint-react/no-unstable-default-props` (not in
  recommended-typescript).
- **Why it hurts:** a new array every render when the prop is omitted → effects re-run, memo breaks.
- **Severity:** minor (major if it feeds an effect that fetches/subscribes).
- **Remediation:** hoist `const EMPTY: readonly T[] = []` to module scope.
- **Not a finding when:** value is never used as a dependency or passed to memoised children, or the compiler
  handles it.
- **Architecture:** no.
- **Sources:** https://github.com/jsx-eslint/eslint-plugin-react/blob/master/README.md · https://eslint-react.xyz/docs/rules/overview

---

## Async rendering, Suspense, errors, React 19 APIs

### REACT-33 Missing or mis-scoped error boundaries; expecting them to catch everything

- **Signal:** no error boundary above data-dependent/`use()`/Suspense subtrees; a single root boundary only;
  `try/catch` wrapped around JSX/child rendering; relying on a boundary to catch errors thrown in event handlers,
  `setTimeout`, or async code.
- **Tool coverage:** `react-hooks:error-boundaries` (7.1.1) — "usage of Error Boundaries instead of try/catch for
  child errors"; `@eslint-react/error-boundaries`. none — judgement for boundary _placement_.
- **Why it hurts:** one widget's crash blanks the whole app; errors from handlers/async code are _not_ caught
  ("Event handlers … Server side rendering … the error boundary itself … Asynchronous code") → silently
  swallowed or unhandled rejections.
- **Severity:** major (blocker for payment/checkout or top-level routes without any boundary).
- **Remediation:** `react-error-boundary` at route and widget granularity with `resetKeys`; handle handler/async
  errors explicitly (state or Action error); report via React 19 root `onCaughtError`/`onUncaughtError`; errors
  thrown inside `startTransition` _are_ caught by boundaries.
- **Not a finding when:** the framework supplies boundaries (Next.js `error.tsx`, Expo Router `ErrorBoundary`
  export) at the right granularity.
- **Architecture:** yes — error containment granularity is a system property; escalate for app shell design.
- **Sources:** https://react.dev/reference/react/Component · https://react.dev/reference/eslint-plugin-react-hooks · https://react.dev/blog/2024/12/05/react-19

### REACT-34 `use(promise)` misuse: promise created in render, `use` in try/catch, bypassing `use`

- **Signal:** `use(fetch(...))` or `use(getData())` where `getData` isn't cached, inside a Client Component;
  `try { use(p) } catch`; reading `promise.status`/`.value` directly.
- **Tool coverage:** `react-hooks:rules-of-hooks` (≥6.1.0 disallows `use` in try/catch). none for uncached
  promises.
- **Why it hurts:** "Promises created during render are recreated on every render, causing repeated Suspense
  fallbacks" — infinite suspend/refetch loops.
- **Severity:** blocker when it loops; major otherwise.
- **Remediation:** create the promise in a Server Component (or a cache / router loader) and pass it down; errors
  via Error Boundary with `resetKeys`. React 19 blog: "Creating promises inside a Client Component or hook is not
  yet supported" without a Suspense-compatible library.
- **Not a finding when:** the promise comes from a cache (TanStack `useSuspenseQuery`, `cache()`, framework).
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react/use · https://react.dev/blog/2024/12/05/react-19

### REACT-35 Suspense boundary misplacement

- **Signal:** a single `<Suspense>` at the app root (everything shows one spinner); no `<Suspense>` above a
  suspending component (falls to nearest ancestor, possibly the router); sibling fetches each in their own
  boundary causing layout "popcorn".
- **Tool coverage:** none — judgement.
- **Why it hurts:** UX (whole page replaced by fallback on any refetch), CLS; the inverse wastes streaming.
- **Severity:** minor–major.
- **Remediation:** boundaries at meaningful content units; `useTransition`/`startTransition` for navigations to
  keep old UI visible; React 19.2 batches SSR Suspense reveals (heuristic stops batching as load approaches 2.5s).
- **Not a finding when:** intentional single loading state for tiny pages.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react/use · https://react.dev/blog/2025/10/01/react-19-2

### REACT-36 Hand-rolled pending/optimistic/error state around mutations in React 19

- **Signal:** `const [isPending, setIsPending] = useState(false)` + `try { setIsPending(true); await save() } finally { setIsPending(false) }`
    - manual rollback; prop-drilling form status into submit buttons.
- **Tool coverage:** `@eslint-react/dom-no-use-form-state` (replace `useFormState` with `useActionState`). none —
  judgement for the hand-rolled pattern.
- **Why it hurts:** race between overlapping submissions, rollback bugs, flicker; duplicated code per form.
- **Severity:** minor (major when optimistic rollback is wrong).
- **Remediation:** Actions — `useActionState` (returns `[state, action, isPending]`), `useOptimistic` ("automatic
  revert on failure"), `useFormStatus` in child buttons; or TanStack `useMutation` in non-form contexts. Trap:
  treating an Action as authorisation — server functions still need authz (see Security).
- **Not a finding when:** the project standardises on TanStack mutations (Command pattern already satisfied).
- **Architecture:** no.
- **Sources:** https://react.dev/blog/2024/12/05/react-19

### REACT-37 `useEffectEvent` misuse

- **Signal:** Effect Event passed as a prop, called during render, listed in deps, or used to wrap _reactive_
  logic to silence `exhaustive-deps`.
- **Tool coverage:** `react-hooks:rules-of-hooks` errors: "Functions returned from useEffectEvent must not be
  included in the dependency array"; "… can only be called from Effects". partial: the "used to hide a genuine
  dependency" case is judgement.
- **Why it hurts:** "Do not use `useEffectEvent` to avoid specifying dependencies … This hides bugs"; identity
  "intentionally changes on every render", so passing it down breaks memo.
- **Severity:** major.
- **Remediation:** only non-reactive logic fired from effects; otherwise restructure deps (REACT-09).
- **Not a finding when:** used for e.g. `onMessage` reading latest `isMuted` without reconnecting.
- **Architecture:** no.
- **Sources:** https://react.dev/reference/react/useEffectEvent · https://react.dev/blog/2025/10/01/react-19-2

### REACT-38 Legacy APIs in React 19 code

- **Signal:** `<Ctx.Provider>`, `forwardRef`, `useContext` (where `use` is preferred by team policy),
  `ReactDOM.render`/`hydrate`, `findDOMNode`, string refs, `createRef` in function components,
  `useFormState`, class lifecycle `UNSAFE_*`, `defaultProps` on function components, `propTypes`.
- **Tool coverage:** `@eslint-react/no-context-provider`, `no-forward-ref`, `no-use-context`, `dom-no-render`,
  `dom-no-hydrate`, `dom-no-find-dom-node`, `no-create-ref`, `dom-no-use-form-state`, `no-unsafe-component-will-*`;
  `react:no-find-dom-node` = `sonarjs:S6788`, `sonarjs:S6790` (string refs), `sonarjs:S6957`
  (`react/no-deprecated`).
- **Why it hurts:** removed/deprecated APIs (ReactDOM.render, findDOMNode, string refs removed in 19) break upgrades.
- **Severity:** blocker for APIs removed in the installed major; minor for "soon deprecated" (`forwardRef`,
  `.Provider`).
- **Remediation:** official codemods; `ref` as prop; `<Ctx value>`.
- **Not a finding when:** a library that intentionally supports React 18 consumers.
- **Architecture:** no.
- **Sources:** https://eslint-react.xyz/docs/rules/overview · https://react.dev/blog/2024/12/05/react-19 · https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md

---

## Accessibility anti-patterns (React DOM)

### REACT-39 Clickable `div`/`span` instead of `<button>`/`<a>`

- **Signal:** `<div onClick=…>` / `<span onClick=…>` / `<li onClick>`; `role="button"` without `tabIndex` and
  key handlers; `<a onClick>` with no `href` or `href="#"`.
- **Tool coverage:** `jsx-a11y:no-static-element-interactions` (= `sonarjs:S6848`),
  `jsx-a11y:click-events-have-key-events`, `jsx-a11y:interactive-supports-focus` (= `sonarjs:S6852`),
  `jsx-a11y:no-noninteractive-element-interactions` (= `sonarjs:S6847`), `jsx-a11y:anchor-is-valid`
  (= `sonarjs:S6844`), `jsx-a11y:prefer-tag-over-role` (= `sonarjs:S6819`, not in presets) — all but the last
  are `error` in 6.10.2 recommended. partial: custom `Box` components rendering a `div` with `onPress/onClick`
  props escape the rules unless `settings.jsx-a11y.components` maps them.
- **Why it hurts:** keyboard and screen-reader users can't operate it (WCAG 2.1.1 Keyboard, 4.1.2 Name, Role,
  Value); no focus ring; Enter/Space behaviour missing.
- **Severity:** major (blocker on primary actions).
- **Remediation:** native `<button type="button">` / `<a href>`; design-system `Pressable` that renders a
  button; configure `jsx-a11y` component mapping. Trap: adding `role="button" tabIndex={0}` and only `onKeyDown`
  for Enter (Space missing).
- **Not a finding when:** the handler only stops propagation on a non-interactive wrapper (still consider
  restructuring).
- **Architecture:** yes if the design-system primitive is the source — escalate to UX/design-system owner.
- **Sources:** https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/main/README.md · https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md

### REACT-40 Unlabelled form controls and icon-only buttons

- **Signal:** `<input>` with only `placeholder`; `<label>` not associated (`htmlFor` mismatch); icon-only
  `<button><Icon/></button>` without `aria-label`; `<img>` without `alt`.
- **Tool coverage:** `jsx-a11y:label-has-associated-control` (error; = `sonarjs:S6853`), `jsx-a11y:alt-text`
  (= `sonarjs:S1077`), `jsx-a11y:control-has-associated-label` (**off** in recommended and strict — enable
  explicitly). partial: dynamic ids (`useId`) and custom input components need rule config.
- **Why it hurts:** WCAG 1.3.1, 3.3.2, 4.1.2 failures; untestable via `getByLabelText`/`getByRole(name)`.
- **Severity:** major.
- **Remediation:** `<label htmlFor={id}>` with `useId`; `aria-label` on icon buttons (localised); decorative
  images `alt=""`.
- **Not a finding when:** `aria-labelledby` points to visible text.
- **Architecture:** no.
- **Sources:** https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/main/README.md

### REACT-41 ARIA misuse: invalid roles, redundant roles, positive tabIndex, autofocus, aria-hidden on focusable

- **Signal:** `role="button"` on `<button>`; `tabIndex={1+}`; `autoFocus`; `aria-hidden` on focusable element;
  `role` requiring props without them (`role="checkbox"` without `aria-checked`).
- **Tool coverage:** `jsx-a11y:no-redundant-roles` (S6822), `tabindex-no-positive` (S6841), `no-autofocus`
  (S9379), `no-aria-hidden-on-focusable` (S6825), `role-has-required-aria-props` (S6807), `aria-role` (S6821),
  `aria-proptypes` (S6793).
- **Why it hurts:** broken focus order, disorienting screen-reader output.
- **Severity:** minor–major.
- **Remediation:** native elements first; roving tabindex patterns from WAI-ARIA APG.
- **Not a finding when:** `autoFocus` inside a just-opened modal dialog's first field where focus management is
  intentional (document it).
- **Architecture:** no.
- **Sources:** https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/main/README.md · https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md

---

## Security-hygiene overlap

### REACT-42 `dangerouslySetInnerHTML` with non-constant content

- **Signal:** `dangerouslySetInnerHTML={{ __html: expr }}` where `expr` is not a string literal or the output of
  a vetted sanitizer (`DOMPurify.sanitize`); markdown renderers with raw HTML enabled (`react-markdown` with
  `rehype-raw`).
- **Tool coverage:** `semgrep:typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml`
  (audit; known FP even with DOMPurify — semgrep-rules issue #2168); `semgrep:typescript.react.security.react-markdown-insecure-html`
  (file present in repo); `@eslint-react/dom-no-dangerously-set-innerhtml` (warn); `react:no-danger` (off by
  default); `codeql:js/xss`, `codeql:js/xss-through-dom` (CWE-079, CWE-116), `codeql:js/stored-xss`.
  partial: tools can't judge sanitizer configuration (e.g. `ALLOWED_TAGS` including `style`/`iframe`) or
  trust of CMS content.
- **Why it hurts:** CWE-79 XSS — session theft, action forgery.
- **Severity:** blocker when content is user- or third-party-controlled; minor for build-time constants.
- **Remediation:** render as text/JSX; sanitise with DOMPurify at the boundary; Trusted Types + CSP.
- **Not a finding when:** literal/static content or compiler-generated HTML from trusted build-time sources
  (MDX compiled at build).
- **Architecture:** yes if rich user content is a product feature — sanitisation boundary is a security design
  decision; escalate to security.
- **Sources:** https://github.com/semgrep/semgrep-rules/tree/develop/typescript/react/security · https://codeql.github.com/codeql-query-help/javascript/js-xss-through-dom/ · https://eslint-react.xyz/docs/rules/overview

### REACT-43 User-controlled URLs in `href`/`src` (`javascript:` URLs) and `target="_blank"`

- **Signal:** `<a href={user.website}>`, `<iframe src={x}>`, `window.location = param`; `target="_blank"` without
  `rel="noreferrer"`; `<iframe>` without `sandbox`.
- **Tool coverage:** `semgrep:typescript.react.security.audit.react-href-var.react-href-var`;
  `react:jsx-no-script-url` / `@eslint-react/dom-no-script-url` (literal `javascript:` only);
  `react:jsx-no-target-blank` (recommended) / `@eslint-react/dom-no-unsafe-target-blank`;
  `react:iframe-missing-sandbox` / `@eslint-react/dom-no-missing-iframe-sandbox`;
  `codeql:js/client-side-unvalidated-url-redirection` (CWE-601). partial: React logs a warning for
  `javascript:` URLs but does not block them in all versions (UNVERIFIED whether 19 blocks) — validate scheme.
- **Why it hurts:** XSS via `javascript:` (CWE-79), open redirect (CWE-601), reverse tabnabbing.
- **Severity:** blocker for user-controlled URLs; minor for `target=_blank` to own domains.
- **Remediation:** parse with `new URL()` and allow-list `http:`/`https:`/`mailto:`; `rel="noopener noreferrer"`.
- **Not a finding when:** URLs are constants or built from typed route helpers.
- **Architecture:** no.
- **Sources:** https://github.com/semgrep/semgrep-rules/tree/develop/typescript/react/security/audit · https://github.com/jsx-eslint/eslint-plugin-react/blob/master/README.md · https://codeql.github.com/codeql-query-help/javascript/

### REACT-44 Tokens/JWTs in `localStorage`; decoding JWT client-side for authorisation

- **Signal:** `localStorage.setItem('token', …)`; `jwtDecode(token).role === 'admin'` gating UI _and_ trusted as
  authorisation.
- **Tool coverage:** `semgrep:typescript.react.security.audit.react-jwt-in-localstorage.react-jwt-in-localstorage`
  (CWE-922, id read from YAML), `semgrep:typescript.react.security.audit.react-jwt-decoded-property.react-jwt-decoded-property`
  (id assumed to mirror file name — not read); `codeql:js/clear-text-storage-of-sensitive-data` (CWE-312).
- **Why it hurts:** any XSS exfiltrates the token; client-side role checks are bypassable.
- **Severity:** blocker when the server trusts client-decided authz; major for token storage.
- **Remediation:** HttpOnly/SameSite cookies or the auth SDK's storage; server-side authz always.
- **Not a finding when:** UI-only hints with server enforcement.
- **Architecture:** yes — session/token model; escalate to security/architecture.
- **Sources:** https://github.com/semgrep/semgrep-rules/tree/develop/typescript/react/security/audit · https://codeql.github.com/codeql-query-help/javascript/

### REACT-45 Server Functions treated as private / RSC runtime not patched

- **Signal:** `'use server'` functions without input validation (zod/valibot) and without an authorisation check
  at the top; hardcoded secret literals inside a Server Function body (`db.createConnection('SECRET KEY')`);
  `react-server-dom-*` (or the framework bundling it) at a vulnerable version.
- **Tool coverage:** `@eslint-react/rsc-function-definition` (validates definition shape only); dependency
  scanners (`npm audit`, Dependabot/GHSA) for versions. none — judgement for missing authz/validation.
- **Why it hurts:** "Arguments to Server Functions are fully client-controlled … always treat them as untrusted
  input … validate that the logged-in user is allowed to perform that action." CVE-2025-55182 (CVSS 10.0,
  unauthenticated RCE via RSC deserialisation; fixed 19.0.1/19.1.2/19.2.1) — "Even if your app does not
  implement any React Server Function endpoints it may still be vulnerable if your app supports React Server
  Components". CVE-2025-55183 source-code exposure: "Only hardcoded secrets in source code are exposed …
  Runtime secrets like `process.env.SECRET` are NOT affected". DoS CVE-2025-55184 / CVE-2025-67779 /
  CVE-2026-23864 — fixed in **19.0.4 / 19.1.5 / 19.2.4**; 19.0.3, 19.1.4, 19.2.3 were incomplete patches.
- **Severity:** blocker.
- **Remediation:** validate (schema parse), authenticate and authorise inside every server function; no secret
  literals in source; pin RSC packages ≥ fixed versions. Full treatment in `nextjs.md`.
- **Not a finding when:** function is authenticated+authorised and args parsed.
- **Architecture:** yes — public endpoint surface; escalate to security.
- **Sources:** https://react.dev/reference/rsc/use-server · https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components · https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components

### Security mapping table

| Concern                          | CWE                                | CodeQL                                                                                                | Semgrep                                                                                                                                                                                                             | Lint                                                                |
| -------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| XSS via innerHTML                | CWE-79, CWE-116                    | `js/xss`, `js/xss-through-dom`, `js/stored-xss`, `js/reflected-xss`, `js/html-constructed-from-input` | `typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml`, `…react-unsanitized-method`, `…react-unsanitized-property`, `typescript.react.security.react-markdown-insecure-html` | `@eslint-react/dom-no-dangerously-set-innerhtml`, `react:no-danger` |
| `javascript:` / open redirect    | CWE-79, CWE-116, CWE-601           | `js/client-side-unvalidated-url-redirection`                                                          | `…audit.react-href-var`                                                                                                                                                                                             | `react:jsx-no-script-url`, `@eslint-react/dom-no-script-url`        |
| Token storage                    | CWE-312, CWE-315, CWE-359, CWE-922 | `js/clear-text-storage-of-sensitive-data`                                                             | `…audit.react-jwt-in-localstorage`                                                                                                                                                                                  | none                                                                |
| postMessage without origin check | CWE-20, CWE-940                    | `js/missing-origin-check`                                                                             | —                                                                                                                                                                                                                   | none                                                                |
| Server function authz            | CWE-285, CWE-862                   | none — judgement                                                                                      | none                                                                                                                                                                                                                | none                                                                |
| Insecure request (http://)       | CWE-319                            | —                                                                                                     | `typescript.react.security.react-insecure-request` (file present)                                                                                                                                                   | none                                                                |

(Semgrep registry ids = repo path with dots + the rule `id:` field. The `id:` fields were read from the YAML in
`semgrep/semgrep-rules@develop` for `react-href-var` (CWE-79), `react-jwt-in-localstorage` (CWE-922),
`react-unsanitized-property` (CWE-79), `react-insecure-request` (CWE-319), `react-props-in-state`; so e.g.
`typescript.react.security.audit.react-href-var.react-href-var`. Also present and relevant to the localisation
gate: `typescript.react.portability.i18next.jsx-not-internationalized.jsx-not-internationalized`, and
`javascript.react.correctness.hooks.set-state-no-op.calling-set-state-on-current-state`. There is **no**
`nextjs`, `react-native` or `expo` directory in the community rules repo.)

---

## Open questions / unverified

- Exact `react-hooks:exhaustive-deps` message text for object dependencies (REACT-10) — not opened.
- Whether React 19 _blocks_ (vs warns on) `javascript:` URLs in `href` — not verified from a primary source.
- No primary source gives React-specific size thresholds for "god component" (REACT-26); the numbers are
  heuristics — rely on the repo's complexity gate.
- Semgrep `react-dangerouslysetinnerhtml`, `react-unsanitized-method`, `react-jwt-decoded-property`,
  `react-markdown-insecure-html` `id:` fields not read (assumed = file name); `react-props-in-state` message text not read.
- `@eslint-react` v5 docs site shows both `@eslint-react/<rule>` and `react-x/<rule>` spellings; the flattened
  `dom-`/`web-api-`/`naming-convention-` prefixes were verified only from the installed 5.19.0 package.
- React Compiler behaviour on Rules-of-React violations ("bails out silently") is not stated on the pages
  opened; only implied by `preserve-manual-memoization`/`unsupported-syntax` rules and directives docs.
