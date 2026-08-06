---
applyTo: '.github/workflows/**,.github/scripts/**'
---

# Reviewing CI/CD workflows and scripts

Defects in these paths are invisible in the normal way: the run goes green and the _absence_ of work is
what ships. Three real production incidents in this repo came from here, so review them with that in
mind rather than as configuration.

## The failure modes that have actually bitten us

- **A step that reports success without doing its job.** The worst one: a CDK custom-resource handler
  whose bundle was missing fell back to a no-op that returned `CREATE_COMPLETE`. Production ran four weeks
  with a missing database role behind entirely green deploys, and it surfaced later in a different service
  as an unrelated-looking auth error. Treat `continue-on-error`, `|| true`, and any `if` that can silently
  skip a required step as suspect and ask what proves the work happened.
- **Step ORDERING.** A build step placed after `npm prune --omit=dev` dies with exit 127 because the
  devDependency binary is gone. Bundling must precede pruning, and any `cdk deploy` of the global app must
  be preceded by the handler-bundling step. Guarded by
  `packages/infra/global/__tests__/global-bootstrap-bundle.test.ts` and `prod-deploy-build-order.test.ts`.
- **Job REACHABILITY.** Production deploy legs existed that no trigger could reach, so they silently never
  ran. When reviewing a job, check that it is reachable from a real trigger through its whole `needs`
  closure — a skipped dependency skips every dependent. Guarded by `prod-deploy-reachability.test.ts`.
- **Artifact pairing.** A `download-artifact` with no earlier matching upload yields an empty directory
  rather than an error.
- **Assertions that cannot fail.** A smoke test that only checks `/health` returns 200 does not prove the
  running task is the image just built — a stale task passes it. Prefer asserting image currency against
  `github.sha`, as the recipe smoke does.

Note that these guards are vitest tests that parse the workflow YAML and **execute the embedded bash**
rather than re-implementing its logic. If you change a step those tests read, keep that property — a
second copy of the rules will drift from the one CI actually runs.

## Do not advise reverting these

- **ENSURE-EXISTS deploy gating (ADR-0010).** `deploy-food` / `deploy-recipe` run when sources changed,
  when dispatched by hand, when the `pr-{N}` stack is absent or wedged, **or** when the origin does not
  answer `200` — skipping only when unchanged _and_ already serving. Do not restore a
  `steps.changes.outputs.* == 'true'` gate on every step: that left a recipe-only PR with no food service
  at all while `RECIPE_FOOD_SERVICE_URL` named a host that did not resolve, silently degrading the whole
  preview behind green checks. Do not "simplify" it to an unconditional redeploy either. The decision lives
  once, in `.github/scripts/deploy-gate.sh`.
- **A `401`/`403`/`429` from a service smoke is the PASS.** Those endpoints require a Clerk token. Only a
  transport failure, the shared ALB's default `404 text/plain`, a `2xx` to an unauthenticated probe, or a
  `5xx` is a failure. Do not "fix" the smoke to expect `200`.
- **The `pr-{N}` teardown matcher (ADR-0005).** There is **no denylist** — teardown deletes everything
  matching `pr-{N}` by tag or name, so safety rests entirely on the delimiter-aware match living once in
  `.github/scripts/pr-scope.sh` (`pr-{N}` exactly or `pr-{N}-…`, so pr-1 ≠ pr-15). Do not add a second
  matcher, do not relax it to a bare prefix, and do not add an "orphaned-looking" sweep. It is
  regression-tested against the real shell functions by `pr-scope.test.ts`.
- **Preview-address teardown ordering.** DNS is deleted **before** the Vercel domain claim is released;
  reversing that manufactures the subdomain-takeover window the code exists to close. An absent record or
  domain is **success** (idempotent); anything else is an error. DNS scope is exact first-label equality.
- **Dependabot-triggered runs cannot see repo secrets.** GitHub withholds them by design, so an AWS
  credential step failing on a Dependabot PR is expected, not a bug to fix with a workaround.

## Repo conventions here

Node 24 (`.nvmrc`). Heavy tiers (Maestro, k6) are gated behind the `heavy-e2e` PR label on purpose so they
do not render as skipped on every PR. Never hardcode a secret — reference `secrets.*` / `vars.*`.
