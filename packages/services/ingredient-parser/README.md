# `@kitchensink/ingredient-parser`

The CRF ingredient-parse engine, deployed. **The repository's first non-Node deployable** — the runtime is
Python, the TypeScript here is its CDK stack, its packaging guard, and the zod its callers parse its answer
with.

Read [ADR-0025](../../../docs/architecture/decisions/0025-ingredient-parser-python-deployable.md) before
changing anything in it.

## Layout

| Path                         | What it is                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/handler.py`             | The Lambda handler. Batches lines, flattens the parser's own text, never emits `foundation_foods`. |
| `src/engine.schema.ts`       | The wire contract + the inbound boundary a caller reads the response through.                      |
| `requirements.txt`           | The engine, pinned exactly. The pin is load-bearing three ways — read the file.                    |
| `infra/lib/assetContents.ts` | The packaging predicate. Pure, derived, no lists.                                                  |
| `infra/bin/buildAsset.ts`    | Stages the asset with pip, then runs the predicate and refuses a bad one.                          |
| `infra/lib/packaging.ts`     | The handler string, the staging path, and the interpreter/CPU wheels target.                       |

## Commands

```bash
# Stage the Lambda asset (~91 MB; needs python3 + network). Refuses to produce a broken one.
npm run bundle:lambda --workspace=@kitchensink/ingredient-parser

# Unit tier — the packaging predicate against fakes, the stack, the boundary.
npm run test --workspace=@kitchensink/ingredient-parser

# Integration tier — runs the REAL build and interrogates it, and invokes the handler against the REAL
# engine. Needs `pip install --user 'ingredient-parser-nlp==2.3.0'` for the handler half.
npm run test:integration --workspace=@kitchensink/ingredient-parser

# Synthesize (stages the asset first).
npm run infra:synth --workspace=@kitchensink/ingredient-parser
```

## Three things that look wrong and are not

- **There is no `esbuild.mjs`, deliberately.** W2 of `serviceInfraWiringInvariants.test.ts` skips a service
  that has none, for the reason its own docstring gives. Adding one to "fix" the skip would demand entry
  points for a handler that is not TypeScript. The replacement is `infra/__tests__/packaging.test.ts` plus
  the same predicate running inside the build.
- **The function reports `AwsSolutions-L1`, and that is left alone.** It runs `python3.13` because the
  engine declares `Requires-Python: <3.14`, while CDK already knows `python3.14`. Suppressing it would hide
  a genuinely stale runtime later; `pythonLambdaRuntime.test.ts` asserts the finding is explained by that
  ceiling and flips when the ceiling moves.
- **Nothing here lints or typechecks the Python.** ESLint does not read `.py` and no tsconfig project
  includes it. The packaging guard parses `handler.py` with `ast` (so a file that does not parse fails the
  build) and the integration tier imports and invokes it — but if more Python lands here, a `ruff` job is
  owed. See ADR-0025's residual risk.
