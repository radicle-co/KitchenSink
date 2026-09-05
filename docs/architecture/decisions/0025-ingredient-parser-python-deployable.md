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
for — no database, no private endpoint, ~~no run-time network call at all, because the engine and its model
are packaged into the asset~~ no run-time network call at all, because the engine, its model **and the NLTK
tagger corpus it loads** are packaged into the asset. A VPC attachment would put it on ADR-0004's single
`t4g.nano` NAT instance and would require amending that ADR's consumer table in the same change, which
`natEgressConsumers.test.ts` asserts in both directions. No interface VPC endpoint is introduced either
(they bill $0.01 per endpoint-hour **per AZ** — $14.60/month/stage at `maxAzs: 2`).

> ⚠️ **STALE (2026-09-05) — "no run-time network call at all" was FALSE when it was written, and is true
> only as of this update.** The engine's `ingredient_parser/en/_utils.py:73` calls
> `download_nltk_resources()` **at import**, which is `_common.py:121`: three `nltk.data.find` lookups for
> the `averaged_perceptron_tagger_eng` files and, on `LookupError`, `nltk.download(…)` — an HTTP fetch and
> a write under `$HOME`. That is a run-time network call, on the cold-start path, in a function this ADR
> deliberately gave no egress. It is load-bearing, not incidental: `preprocess.py:566` tags every token and
> the tag becomes a CRF feature (`features["pos"]`, and the neighbouring tags), so it cannot be stubbed out.
>
> The first real deploy of `kitchensink-ingredient-parser-pr-91` therefore succeeded, loaded its code
> package, and threw on invocation with
> `OSError: [Errno 30] Read-only file system: '/home/sbx_user1051'`. **It never reached the network** — the
> read-only filesystem refused it first — so the missing egress was never the visible symptom, and the
> conclusion above ("nothing to attach it for") happens to remain correct for the fixed function.
>
> **Why §3's guard did not catch it, and what changed.** Every derivation in §3 comes from **pip's
> `RECORD`**, which is exhaustive over what pip INSTALLED. NLTK data is not installed; it is downloaded.
> The corpus was therefore outside the guard's subject set entirely, and the guard reported success
> honestly — the same shape of blindness §3 was written to prevent, one authority over. The fix adds a
> **second authority** rather than a list: the resource paths are read out of the engine's own AST (the
> string arguments of its `nltk.data.find` calls, so an engine release needing a fourth file fails the
> BUILD), and the per-file manifest is the downloaded archive's own central directory, persisted into the
> asset as `nltk_data/RECORD` in pip's format. `buildAsset.ts` stages the corpus and
> `IngredientParserStack` sets `NLTK_DATA=/var/task/nltk_data` from the same constant. Both `RECORD`s are
> checked by the same predicate; an empty resource set and an empty corpus manifest are each reported as
> violations in their own right.
>
> **Cost:** +5,716,405 bytes unzipped (88.1 MB → 93.8 MB, of a 250 MB limit) and +1.46 MB zipped
> (29.2 MB → 30.7 MB measured at `-9`; deployed `CodeSize` was 32,409,132 bytes, so expect ≈ 33.9 MB of a
> 50 MB limit — and `Code.fromAsset` publishes through S3, where that limit does not bind anyway).
>
> **Proof:** `tests/handler.integration.test.ts` invokes the handler with `$HOME` pointed at a directory it
> may not write, once without `NLTK_DATA` (which must fail at `nltk/downloader.py`'s `os.makedirs`) and
> once with it pointed at the staged corpus (which must parse, and must not print the engine's
> "Downloading required NLTK resource" line). ⚠️ The reproduction is a mode-0555 directory, so the child
> sees `EACCES` (errno 13) where Lambda saw `EROFS` (errno 30); a test cannot mount a read-only filesystem.
> The raising call is the same one.

### 2. Zip-packaged, with **no `esbuild.mjs`**, so W2 skips it truthfully

The asset is staged by `infra/bin/buildAsset.ts` and published by `Code.fromAsset`, which uploads through S3
— so the 50 MB direct-upload limit does not bind. The staged tree is ~~**91 MB unzipped**~~ **93.8 MB
unzipped** (measured 2026-09-05, after the corpus was added; 30.7 MB zipped), inside the 250 MB limit, and
the integration tier asserts that rather than assuming it.

The service deliberately carries **no `esbuild.mjs`**, so W2 skips it for the reason its own docstring
anticipates: _"A service with no `esbuild.mjs` is skipped rather than reported: it packages its Lambdas some
other way."_ That is the honest route.

> ⛔ **The rejected alternative was a container image.** It would have forced an amendment to
> `RecipeWorkersStack.test.ts:511`, which reads `fn.Properties?.Handler` unguarded and whose docstring
> explicitly warns against letting a real Lambda _"leave the guard by looking like a provider"_. Weakening a
> guard to admit a new shape is worse than adding a guard for it.

### 3. Its **own** packaging guard, derived and non-vacuous

W2 skipping is honest and it is also a hole — the same hole `handle-sync-worker` fell through, shipping
**4.6 KB of raw `tsc` output** against siblings of 436 KB–981 KB and dying on every cold start with
`ERR_MODULE_NOT_FOUND`, while two guard tests watched, because _"both enumerated the same five names… a copy
of a list cannot detect that the list is incomplete."_

So the replacement guard **enumerates nothing**. Every subject is derived:

| What is checked                       | Derived from                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| the handler module is in the asset    | the CDK `handler:` string, split at its last dot                                                    |
| every dependency the handler imports  | the handler's own Python **AST**, minus `sys.stdlib_module_names`                                   |
| every engine file, byte for byte      | **pip's own `RECORD`** manifest for the installed distribution                                      |
| which distribution to look for        | `requirements.txt`, normalised per PEP 503/427                                                      |
| the interpreter and CPU wheels target | the runtime pin and the function's declared `architecture`                                          |
| which NLTK resources must be staged   | the **engine's own AST** — the string arguments of its `nltk.data.find(…)` calls (added 2026-09-05) |
| every corpus file, byte for byte      | the corpus **archive's own central directory**, persisted as `nltk_data/RECORD` (added 2026-09-05)  |

`RECORD` is the load-bearing choice: it is pip's per-file manifest with a declared size for every real file,
so "the model artifact is present and whole" needs nobody to know that the model is called
`model.en.crfsuite` or that it is 1,596,376 bytes. Delete it, truncate it, or ship a source-only install
with no model, and the derivation notices without being told.

⚠️ **`RECORD` is also the limit of what pip can be asked, and that limit shipped a broken function.** It is
exhaustive over what pip INSTALLED, and the engine also loads a part-of-speech tagger that pip never
installs — NLTK data is downloaded, not installed. The guard was green and the deployed function threw; see
the STALE note in §1. The corpus is now covered by the last two rows of the table above, a **second
authority** rather than a second list. Both manifests are read by the same predicate and the same two
failure modes (`missing`, `wrong size`) are reported for each. The general lesson is recorded here because
it will recur: _a derivation is only as complete as the authority it derives from, and "everything the
package needs" and "everything pip installed" are not the same set._

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

⛔ **The resulting `AwsSolutions-L1` finding is left reporting, and must not be suppressed.** This is the
precedent `lambdaRuntime.ts` already records for the two `framework-onEvent` functions: the finding is
ACCURATE (this really is not the newest Python), it is not ours to fix (the ceiling belongs to the engine),
it clears itself the moment the engine supports the newer Python, and suppressing it would write
`cdk_nag` metadata into a template in exchange for hiding a genuinely stale runtime later. cdk-nag is
advisory here (ADR-0013), so the finding is a warning, not a broken build.

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

⛔ **The CRF's `foundation_foods` output is rejected outright.** The engine can attach a Food Data Central
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

> ⚠️ **Ratification.** GR-008's own amendment process reserves rule changes to the senior product owner.
> Nothing here changes GR-008's text or severity — it records a waiver the rule already provides for. If the
> owner would rather read GR-008 as forbidding a non-Node runtime outright, this decision is the thing to
> reverse, and the reversal is a single ADR status change plus deleting one package.

## Consequences

**Accepted:**

- A second language in the deployed surface, with its own toolchain, its own runtime pin and its own
  packaging path. That is the cost of the engine, and it was paid deliberately.
- One standing `AwsSolutions-L1` warning per synth of this app until the engine supports Python 3.14.
- The integration tier needs **network** (pip, and since 2026-09-05 nltk's package index) and takes ~20 s.
  It runs in the same CI job that already installs the pinned engine for the cookbook-import parse
  comparison.

**Residual risk, stated rather than hidden:**

- ⚠️ **Nothing in this repository lints or typechecks Python.** ESLint does not read `.py` and neither
  tsconfig project includes it, so a syntax error in `handler.py` is invisible to `npm run lint`,
  `npm run typecheck` and every unit suite. Three things mitigate it and none is a substitute for a Python
  linter: the packaging guard **parses** the handler with `ast` (so a file that does not parse fails the
  build), the handler integration tier imports and invokes it against the real engine, and the module is 140
  lines with one third-party call. If more Python lands here, a `ruff` job is owed.
- ⚠️ ~~**No deployment has been performed.** The stack synthesizes, the asset builds and is verified, and the
  handler is exercised against the real engine on x86/CPython 3.10 — but the arm64/CPython 3.13 wheels in
  the asset have never been loaded by a Python 3.13 interpreter on ARM. The first real proof is a deploy.~~
  ⚠️ STALE (2026-09-04): **there was no DEPLOYER when this was written, and now there is one, with the
  post-deploy proof this risk asked for.** The stack deploys in both pipelines — `sandbox-deploy.yml:1084-1132`
  (built, bundled, `cdk deploy`d as the third stack, then verified) and `prod-deploy.yml:340-894` — and
  `packages/services/ingredient-parser/infra/smoke/deployedSmoke.ts` invokes the **running** function and
  validates the answer with this package's own zod, asserting the interpreter loaded, the model ran and the
  engine version is the pinned one. Its docstring cites this very paragraph ("the first real proof is a
  deploy") as its reason to exist. It is the earliest signal because nothing downstream reports the failure:
  `crfInvoke.ts` maps a failed invoke to `unavailable` per line and ADR-0026 §3 reads that as absence, so a
  permanently broken engine is silent. See `e005aa6b fix(ci): the crf parser had no deployer — parseline
invoked a function nobody created`.
  ⚠️ ~~UNVERIFIABLE FROM THE REPO (2026-09-04): whether a live deploy has actually **run** to a stage, and
  therefore whether the arm64/CPython 3.13 wheels have now been loaded on ARM, is live AWS/CI-run state. The
  repo proves the path and the assertion exist, not that they have executed.~~
  ✅ **DISCHARGED (2026-09-05) — the wheels have now been loaded on ARM, and they worked.**
  `kitchensink-ingredient-parser-pr-91` deployed and its Python 3.13 / arm64 interpreter **imported the
  whole asset**: `Init Duration: 2180 ms`, `Max Memory Used: 118 MB` (of the 1,024 MB the stack allocates).
  No `ImportError`, no missing shared object, no wrong-ABI extension — `--platform manylinux2014_aarch64`
  plus `--only-binary=:all:` did exactly what §2 claimed. This is a real result from a real deploy and it
  closes the residual this ADR was written with.
  ⚠️ The same invocation then threw for a **different** reason — the unstaged NLTK corpus, see the STALE
  note in §1 — so "the wheels load" and "the function works" were separate facts, and the deploy proved the
  first while disproving the second. The cold-start numbers above are therefore measured up to the point of
  that failure; the post-fix figures will be higher by whatever reading 5.7 MB of tagger JSON costs, and are
  **not yet measured**.
- ⚠️ The engine ships **`nltk`, `numpy` and `regex`** as transitive dependencies. They are packaged but the
  parse path may not touch all of them; nothing prunes the asset, and 91 MB is well inside the limit, so
  pruning would trade a real risk (removing something imported lazily) for no benefit.
  ⚠️ AMENDED (2026-09-05): **`nltk` is not merely packaged — it is on the import path, and it wants data.**
  See the STALE note in §1. The asset is now 93.8 MB unzipped and the same reasoning against pruning holds
  a fortiori: it is 37% of the 250 MB limit, and this package has just demonstrated that the expensive
  failure here is a MISSING file, not a spare one.
- ⚠️ **The build now needs the network twice and `nltk` on the build host, transiently.** Staging the corpus
  installs `nltk` (at the version the asset itself records, so the downloader matches the consumer) into a
  temporary directory and calls `nltk.download`, which fetches from `raw.githubusercontent.com`. The asset's
  own `nltk` cannot be used for this — it sits beside arm64/CPython-3.13 wheels no build host can load. So
  the build has a second network dependency and a second failure mode (`nltk`'s package index unreachable),
  both of which fail loudly at build time rather than at cold start.
- ⚠️ **Nothing has deployed since the fix.** The corpus is staged, the guard covers it, and the handler has
  been invoked against the staged tree with an unwritable `$HOME` — but on x86/CPython 3.10, because that is
  the only interpreter that can import this engine on a build host. That the deployed arm64 function finds
  `NLTK_DATA` at `/var/task/nltk_data` and reads the tagger there is inferred from the same import path, not
  observed. `deployedSmoke.ts` is what observes it, and it has not yet run against a corpus-carrying asset.
