# 0025 — The CRF ingredient parser is a Python deployable of its own, with a second runtime pin and its own packaging guard

- **Status**: Accepted
- **Date**: 2026-08-25
- **Drivers**: The ingredient-resolution plan
  (`docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`, U17 / KTD-16) needs
  `ingredient-parser-nlp` — a **Python** conditional-random-field parser, 90 MB installed, with native
  wheels (`numpy`, `python-crfsuite`) and a 1.6 MB CRF model shipped inside the distribution — reachable as
  a deployed function. Every deployable this repository has is Node, and three standing rules were written
  as if that would always be true.
- **Relates to**:
  [ADR-0017](0017-service-ownership-for-features-006-007-009-010.md) — the **"no new deployable"** default
  this takes a named exception to;
  [ADR-0019](0019-recipe-import-spine.md) — §3 is the exception TEMPLATE, and it fixes the consequence: the
  new deployable owns no database;
  [ADR-0004](0004-minimize-nat-egress.md) — this function is deliberately **not** VPC-attached, so it adds
  nothing to the NAT consumer list;
  [ADR-0013](0013-cdk-nag-advisory-iac-security-linting.md) — `AwsSolutions-L1` on the Python runtime is
  left **reporting**, not suppressed;
  [ADR-0014](0014-service-owned-api-contracts.md) — the engine's response is an **inverse case**: validated
  at the boundary, with no `packages/schemas/*` copy and no OpenAPI document;
  [ADR-0015](0015-input-validation-at-every-boundary.md) — §3, the inbound boundary the response crosses.

## Context

Four collisions, each of which had to be resolved rather than worked around.

1. **ADR-0017 says no new deployable.** That is a default, not a prohibition, and ADR-0019 §3 records the
   grounds on which it is set aside.
2. **W2 of `serviceInfraWiringInvariants.test.ts`** pairs every deployed `handler:` string with an entry
   point in the service's `esbuild.mjs`, and skips a service that has none. A Python service has none.
3. **`NODE_LAMBDA_RUNTIME`** is described as _"the Node.js Lambda runtime for EVERY function this repository
   defines"_, asserted against the newest runtime CDK knows and the repo's `engines.node`. There was no pin
   for any other runtime.
4. **GR-008** requires every workspace to target Node 24.x and says _"no feature may specify a lower runtime
   version without a documented constitutional waiver."_ A **different language runtime** is outside what
   that rule contemplates.

## Decision

### 1. A separate deployable, on ADR-0019 §3's three grounds, owning no database

`packages/services/ingredient-parser` is a **named exception to ADR-0017's "no new deployable" default**,
justified on the same three grounds ADR-0019 §3 uses for the image processor, which fit almost verbatim:

- the workload is **CPU-shaped and bursty** rather than request-shaped — a CRF decode per line, in batches,
  triggered by imports;
- it carries a **vendor dependency the recipe service should not link** — a Python interpreter, 90 MB of
  wheels and a model file, in a service whose runtime is Node;
- it **scales on a different axis from recipe CRUD** — with import volume, not with reads.

ADR-0019 also fixes the consequence and this ADR adopts it literally: **the new deployable owns no
database.** The parse cache is a table in the recipe database (KTD-14), not beside the engine. The function
holds no state, so it can be redeployed or scaled to zero without owning data.

**It is not VPC-attached**, and that is a decision rather than an omission. There is nothing to attach it
for: no database, no private endpoint, and no run-time network call — the engine, its model **and the NLTK
tagger corpus it loads at import** are all packaged into the asset. A VPC attachment would put it on
ADR-0004's single `t4g.nano` NAT instance and would require amending that ADR's consumer table in the same
change, which `natEgressConsumers.test.ts` asserts in both directions. No interface VPC endpoint is
introduced either (they bill $0.01 per endpoint-hour **per AZ** — $14.60/month/stage at `maxAzs: 2`).

The corpus is load-bearing rather than incidental, which is why it is packaged rather than fetched:
`ingredient_parser/en/_utils.py` calls `download_nltk_resources()` at import, and `preprocess.py` tags every
token so the tag can become a CRF feature (`features["pos"]`, and the neighbouring tags). It cannot be
stubbed out, and left unpackaged it makes an HTTP fetch and a `$HOME` write on the cold-start path of a
function with no egress and a read-only filesystem.

### 2. Zip-packaged, with **no `esbuild.mjs`**, so W2 skips it truthfully

The asset is staged by `infra/bin/buildAsset.ts` and published by `Code.fromAsset`, which uploads through S3
— so the 50 MB direct-upload limit does not bind. The staged tree is **93.8 MB unzipped** (30.7 MB zipped),
inside the 250 MB limit, and the integration tier asserts that rather than assuming it.

The service deliberately carries **no `esbuild.mjs`**, so W2 skips it for the reason its own docstring
anticipates: _"A service with no `esbuild.mjs` is skipped rather than reported: it packages its Lambdas some
other way."_ That is the honest route.

The rejected alternative was a **container image**. It would have forced an amendment to
`RecipeWorkersStack.test.ts`, which reads `fn.Properties?.Handler` unguarded and whose docstring explicitly
warns against letting a real Lambda _"leave the guard by looking like a provider"_. Weakening a guard to
admit a new shape is worse than adding a guard for it.

### 3. Its **own** packaging guard, derived and non-vacuous

W2 skipping is honest and it is also a hole — the same hole `handle-sync-worker` fell through, shipping
**4.6 KB of raw `tsc` output** against siblings of 436 KB–981 KB and dying on every cold start with
`ERR_MODULE_NOT_FOUND`, while two guard tests watched, because _"both enumerated the same five names… a copy
of a list cannot detect that the list is incomplete."_

So the replacement guard **enumerates nothing**. Every subject is derived:

| What is checked                       | Derived from                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| the handler module is in the asset    | the CDK `handler:` string, split at its last dot                                 |
| every dependency the handler imports  | the handler's own Python **AST**, minus `sys.stdlib_module_names`                |
| every engine file, byte for byte      | **pip's own `RECORD`** manifest for the installed distribution                   |
| which distribution to look for        | `requirements.txt`, normalised per PEP 503/427                                   |
| the interpreter and CPU wheels target | the runtime pin and the function's declared `architecture`                       |
| which NLTK resources must be staged   | the **engine's own AST** — the string arguments of its `nltk.data.find(…)` calls |
| every corpus file, byte for byte      | the corpus **archive's own central directory**, persisted as `nltk_data/RECORD`  |

`RECORD` is the load-bearing choice for the engine's own files: it is pip's per-file manifest with a declared
size for every real file, so "the model artifact is present and whole" needs nobody to know that the model is
called `model.en.crfsuite` or that it is 1,596,376 bytes. Delete it, truncate it, or ship a source-only
install with no model, and the derivation notices without being told.

**`RECORD` is also the limit of what pip can be asked, which is why the corpus needs a second authority
rather than a second list.** `RECORD` is exhaustive over what pip INSTALLED; NLTK data is downloaded, not
installed, so it appears in no `RECORD` and a guard built only on that authority reports success honestly
while the function is broken. The general rule this encodes, because it will recur: _a derivation is only as
complete as the authority it derives from, and "everything the package needs" and "everything pip installed"
are not the same set._ Both manifests are read by the same predicate and the same two failure modes
(`missing`, `wrong size`) are reported for each; an empty resource set and an empty corpus manifest are each
reported as violations in their own right, so a guard with nothing to check cannot pass.

Two further properties, both deliberate:

- **The predicate runs in the BUILD, not only in a test.** `assetViolations` is pure and lives in
  `infra/lib/assetContents.ts`; `infra/bin/buildAsset.ts` runs it against the tree it just produced and
  exits non-zero on any finding. A bad asset is therefore never PRODUCED. The guard test proves the same
  code can detect the failure, by firing it at deliberately-violating fakes — and the integration tier does
  it for real, deleting the model artifact from the staged tree and asserting the guard reports it.
- **The stack refuses an unstaged asset at synth.** `Code.fromAsset` throws on a missing directory but will
  happily zip an **empty** one, which is the `handle-sync-worker` outcome exactly. The staging directory is
  a stack prop so that refusal is testable against a real, an empty and a missing directory.

### 4. A second runtime pin — `PYTHON_LAMBDA_RUNTIME` — and an L1 finding left REPORTING

`packages/infra/security/src/pythonLambdaRuntime.ts` is the sibling of `lambdaRuntime.ts`, in the same
package for the same reason: the pin **is** the `AwsSolutions-L1` supply-chain control.

It differs from the Node pin in one way that matters. The Node pin can equal the newest runtime CDK knows,
because the repository chooses its own Node major. This one cannot: `ingredient-parser-nlp==2.3.0` declares
`Requires-Python: <3.14,>=3.10`, while `aws-cdk-lib` **already** exposes `python3.14`. So the pin is
`latestPythonRuntimeBelow(ENGINE_PYTHON_CEILING)` = `python3.13`, and both halves are asserted rather than
written down.

**The resulting `AwsSolutions-L1` finding is left reporting, and is not suppressed.** This is the precedent
`lambdaRuntime.ts` already records for the two `framework-onEvent` functions: the finding is ACCURATE (this
really is not the newest Python), it is not ours to fix (the ceiling belongs to the engine), it clears itself
the moment the engine supports the newer Python, and suppressing it would write `cdk_nag` metadata into a
template in exchange for hiding a genuinely stale runtime later. cdk-nag is advisory here (ADR-0013), so the
finding is a warning, not a broken build.

What is asserted instead is that the finding is **explained**:
`ruleIdsForRuntime(PIN).includes('AwsSolutions-L1') === (PIN.name !== latestPythonRuntimeKnownToCdk())`. The
assertion is total in both directions and flips on its own the day the ceiling is raised, so nobody has to
remember to revisit it.

### 5. The engine's response is an inbound boundary, and `foundation_foods` is REFUSED

The response is parsed on receipt against zod authored in the service that serves it
(`src/engine.schema.ts`), before it becomes anything. ADR-0014's **inverse** case applies — there is no HTTP
surface to describe (the function is reached by `lambda:InvokeFunction`, so there is no path, method or
status code), and the content inside our envelope is a third party's reading, whose shape moves between
releases. So: **no `packages/schemas/*` copy and no OpenAPI document**, for the same reason ADR-0014 forbids
writing one for `usda-client`.

**The CRF's `foundation_foods` output is rejected outright.** The engine can attach a Food Data Central
match to each name. Accepting it would stand up a **second, unowned ingredient-resolution authority** beside
`resolutionCascade.ts`, and it is measurably wrong — it mis-mapped soy flour in the sample. The handler
never passes the flag and never reads the field, and the caller's schema is `strictObject`, so the key's
appearance is a loud failure rather than a silent drop. Turning it on is a resolution-architecture decision,
not a parser flag.

### 6. GR-008 ruling — recorded, not assumed

GR-008 reads: _"All workspaces, including AWS Lambda functions, MUST target Node.js 24.x… No feature may
specify a lower runtime version without a documented constitutional waiver."_

**The ruling: GR-008 governs the Node major wherever Node is the runtime. It does not contemplate a second
language runtime, and this is not a lower Node version — it is a different language.** Concretely:

- The **workspace** `@kitchensink/ingredient-parser` targets Node 24.x like every other: `engines.node` is
  `24.x`, and its build, tests, lint, typecheck, CDK app and packaging script all run on Node 24. GR-008's
  acceptance criteria AC-008-a/b/c are satisfied unchanged — no CDK definition here specifies a Node runtime
  below 24, because none specifies a Node runtime at all.
- The **deployed function** runs `python3.13`, which is not a Node version and therefore not a "lower
  runtime version" in GR-008's sense. It is recorded here as a **documented waiver** under AC-008-c
  regardless, because the alternative — deciding by interpretation that the rule does not apply — is exactly
  the silence KTD-16 forbids.
- The waiver is **narrow**: it covers this function, on the Python runtime pinned by
  `PYTHON_LAMBDA_RUNTIME`, and it comes with the obligation that a non-Node runtime carries the same
  controls Node's does — one pinned constant, one place, and a drift test that fails when it falls behind.
  A future non-Node deployable inherits that obligation, not this waiver.

GR-008's own amendment process reserves rule changes to the senior product owner. Nothing here changes
GR-008's text or severity — it records a waiver the rule already provides for. If the owner would rather read
GR-008 as forbidding a non-Node runtime outright, this decision is the thing to reverse, and the reversal is
a single ADR status change plus deleting one package.

## Consequences

**Accepted:**

- A second language in the deployed surface, with its own toolchain, its own runtime pin and its own
  packaging path. That is the cost of the engine, and it was paid deliberately.
- One standing `AwsSolutions-L1` warning per synth of this app until the engine supports Python 3.14.
- The integration tier needs **network** — pip, and nltk's package index for the corpus — and takes ~20 s.
  It runs in the same CI job that already installs the pinned engine for the cookbook-import parse
  comparison.
- **The build needs the network twice, and `nltk` on the build host transiently.** Staging the corpus
  installs `nltk` (at the version the asset itself records, so the downloader matches the consumer) into a
  temporary directory and calls `nltk.download`, which fetches from `raw.githubusercontent.com`. The asset's
  own `nltk` cannot be used for this — it sits beside arm64/CPython-3.13 wheels no build host can load. Both
  the second dependency and its failure mode (`nltk`'s index unreachable) surface at build time rather than
  at cold start.
- **Nothing prunes the asset.** `nltk`, `numpy` and `regex` ship as transitive dependencies and the parse
  path may not touch all of them. At 37% of the 250 MB limit, pruning would trade a real risk — removing
  something imported lazily — for no benefit, and the expensive failure in this package has been a _missing_
  file, not a spare one.

**Residual risk:**

- **Nothing in this repository lints or typechecks Python.** ESLint does not read `.py` and neither tsconfig
  project includes it, so a syntax error in `handler.py` is invisible to `npm run lint`, `npm run typecheck`
  and every unit suite. Three things mitigate it and none is a substitute for a Python linter: the packaging
  guard **parses** the handler with `ast` (so a file that does not parse fails the build), the handler
  integration tier imports and invokes it against the real engine, and the module is 140 lines with one
  third-party call. If more Python lands here, a `ruff` job is owed.
- **The deployed cold start is the only place an asset defect can surface, and it surfaces silently.** A code
  package that cannot import — or that imports and then dies reaching for something unstaged — deploys
  CLEAN. Nothing downstream reports it: `crfInvoke.ts` maps a failed invoke to `unavailable` per line and
  ADR-0026 §3 reads that as absence, which is the right behaviour and is exactly why a permanently broken
  engine would be quiet. `infra/smoke/deployedSmoke.ts` exists for this: it invokes the **running** function
  and validates the answer with this package's own zod, asserting the interpreter loaded, the model ran and
  the engine version is the pinned one. It is the earliest signal, and it is the only one.
- **The build host cannot rehearse the deployed interpreter.** Every local proof — the packaging guard, the
  handler integration tier, the unwritable-`$HOME` invocation — runs on whatever interpreter the host has,
  because the staged arm64/CPython-3.13 wheels cannot be loaded anywhere else. That the deployed function
  resolves `NLTK_DATA` at `/var/task/nltk_data` and reads the tagger there is inferred from the same import
  path, not observed locally. `deployedSmoke.ts` is what observes it.
