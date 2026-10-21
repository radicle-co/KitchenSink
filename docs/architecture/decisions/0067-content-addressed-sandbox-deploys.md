# 0067 — Sandbox deploys are named by content and deploy only the stacks that changed

- **Status:** Accepted
- **Date:** 2026-10-21
- **Relates to:** [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md): this closes its residual risk 2 (a
  content-addressed image tag) for the sandbox identity tier, and keeps every one of its ensure-exists terms.
  [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md): the migrate invoke stays gated only on the sandbox
  being up. [ADR-0060](0060-sandbox-starts-only-by-hand.md): nothing here starts the sandbox.

## Context

The owner asked why the sandbox identity deploy took more than 45 minutes and why it ran at all for code that had not
changed. On 2026-10-21, three pushes to PR 91 in 30 minutes queued three identity deploys of about 28 minutes each. The
third waited 22 minutes for its turn, and CI's 45-minute wait for it ran out two minutes before it finished.

Three things made every push a full deploy:

1. **What counted as changed.** The workflow's `paths:` trigger and its `dorny/paths-filter` step both diff the pull
   request against its base, not against the last push. A large PR therefore answers "changed" for every leg on every
   push.
2. **What the image was named by.** The tag was `sandbox-<commit sha>`, so the same code got a new tag on every push:
   a Docker build and push, a new ECS task definition and a full service rollout. The webhooks' `SENTRY_RELEASE` was the
   commit too, so their template changed every time.
3. **What CloudFormation was asked.** Each running leg ran `cdk deploy --all`. Run 39627231419, whose only change was to
   the ingredient parser, updated all 10 global stacks (the VPC, NAT instance and RDS instance among them) and every
   identity stack. CDK cannot skip a stack whose `CommitSha` tag changed or which reads an SSM parameter.

A probe showed the builds are deterministic: the global app and the identity and webhooks apps, built twice from clean on
one machine, produced byte-identical templates (46 and 54 files, no difference).

## Decision

1. **An image is named by a hash of what it is built from.** `scripts/infrastructureManifest.mjs` generates
   `docs/generated/infrastructure/imageClosures.tsv` under its staleness gate. For each content-keyed deployable, it lists
   every package its runtime `dependencies` reach and the tsconfig `extends` chain. It also lists the root manifest and
   lockfile, turbo's `globalDependencies` and the root scripts the packages run. Development dependencies are never in it.
   `.github/scripts/deployKey.sh` hashes the git objects of exactly those paths at the revision. The tag is `ck-<key>`
   (`imageTag.sh content`). It never contains a commit.
2. **Content tags are immutable.** `ecrTagKind.sh` owns the `ck-` prefix. The retention policy keeps the newest 50 under a
   rule of their own, and `ecrEnsureRepo.sh` leaves the prefix out of the mutable set (owner ruling, 2026-10-21).
   `ecrPushVerdict.sh` answers `skip` for a content tag that exists, without the release ledger, because a content tag is
   not a release.
3. **The sandbox identity deploy uses content names.** The identity image tag, every `IDENTITY_IMAGE_TAG`, the CURRENT
   smoke's expected tag and the webhooks' `SENTRY_RELEASE` come from one `content` step. The build runs only on `push`.
4. **Each running leg deploys only its stale stacks.** `.github/scripts/stackCurrency.sh` synthesizes the app once and
   judges each stack, from `deployGate.sh stacks-for`, against the account. A stack is current when three things hold: it
   is in a usable resting state, `cdk diff --method=template --fail --exclusively` exits 0, and every SSM value it resolved
   at deploy time still holds. Anything else is stale, including an answer the gate cannot read. If no stack is stale, the
   deploy step does not run. Otherwise it runs `cdk deploy --exclusively <stale stacks>`. A dispatch or a Sandbox Up call
   is forced and deploys everything.
5. **The `CommitSha` stack tag keeps its meaning.** It is not part of a template, so it now changes only on the stacks that
   deploy, and it means "the last commit that deployed this stack" (owner ruling, 2026-10-21).

The path filter still decides which legs run. Removing it is a separate step, because several guards and the Sandbox Up
path read the leg flags.

## Consequences

- A push that changes nothing a stack declares leaves the stack alone, and a push that changes nothing the identity image
  is built from rebuilds no image and rolls no task. Verification and both smokes still run on every leg that runs.
- Measured read-only against the live sandbox with CI's inputs: 6 of the 10 global stacks read current. The other 4 differ
  only in their Lambda asset, which the global app's Lambdas share, built locally against `pg` 8.23.0 where CI had 8.23.1.
- **Residual: the CDK packages carry no lockfile.** CI installs each `infra/` package with `npm install`, so their
  dependencies float. A patch release upstream changes the Lambda bundles, which this gate then deploys. That is the safe
  direction, but the bundles are not reproducible until those packages get lockfiles and `npm ci`.
- **Residual: one shared bundle for the global Lambdas.** A change to any global handler changes the asset of every global
  stack with a Lambda, so those stacks deploy together.
- **Residual: ECR's documentation does not state that retention expires an image whose tag is immutable.** It describes
  immutability only as refusing an overwrite. If retention does not expire them, the repository holds more than 50
  content images, and a listing shows it.
- **Residual: the CI wait is still per commit.** CI's "wait for this commit's identity deploy" still needs a run for its
  own commit. Making it accept a deploy that is already live for the same key is the next step.
- **Residual: a content key can be claimed first.** The non-prod role can push a new tag of any shape. An image planted
  under a future key is then reused. The role cannot overwrite a content tag, and a planter needs the future tree in hand.
