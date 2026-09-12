# 0042 — Every runtime's logs reach Sentry, and a dead drain is not silent

- **Status:** Accepted
- **Date:** 2026-09-16
- **Relates to:** [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md) — the retired identity ECS
  log group its expand-first rule keeps alive is deliberately absent from the register below.

## Context

A CloudWatch subscription filter forwards a log group to the `kitchensink-log-drain` Sentry project. Three
groups had one: the webhook Lambdas, the webhook API access log, and the identity ECS service. Every other
runtime in the repository — ten recipe Lambdas sharing a group, the recipe API, three food groups, the Python
ingredient parser — wrote to CloudWatch and stopped there.

Two things were additionally wrong with the coverage that existed, and both were invisible:

- The forwarder derived the Sentry `environment` from the log-group name with one regex shaped for
  `kitchensink-identity-<component>-<stage>-…`. The identity ECS group is `/kitchensink/identity-service/<stage>`
  — slashes, not hyphens — so it matched nothing and every line from the service that serves real users arrived
  tagged `environment:unknown`.
- That regex's `sandbox-[a-z0-9]+` arm matched a CDK-generated name's CONSTRUCT ID, so a sandbox webhook group
  reported an environment called `sandbox-webhookslogroup`. Nobody filters on that either.

The forwarder also publishes a `LogForwarderFailure` metric on both of its failure paths, and nothing watched
it. That is the worst shape an observability component can fail in: when the drain stops, the symptom is an
absence of logs, and an absence is what a healthy quiet system looks like.

## Decision

**A register, not a pattern.** `identity-webhooks/src/common/logDrainRegister.ts` names every drained group and
where its stage sits. An unregistered group is refused rather than guessed at; the forwarder still forwards
such a line, because its first duty is not to drop logs, but `unknown` now means "nobody registered this"
rather than "the regex did not fit a group we own".

**The filter is created by the stack that OWNS the group, and the forwarder's ARN reaches EVERY owner as a
CI-resolved input rather than a CloudFormation import.** A subscription filter is a property of the group, so
attaching from elsewhere means importing another stack's resource — which is how the webhooks stack once
pinned a reclaimable stack and blocked its deletion. So the ARN travels instead of the group, with the
`logs.amazonaws.com` invoke grant made once in `WebhooksStack` and scoped by `sourceAccount`.

It may not travel as an EXPORT, and that is a deadlock rather than a race. `WebhooksStack` — which publishes
it — imports `kitchensink-data-{stage}:HandleSyncTopicArn` from the global app, so the global app cannot
deploy after it; and ADR-0035 deploys each SCHEMA stack ahead of everything that reads its database, the
webhooks stack included, so a schema stack cannot either. Both failures were observed: every global deploy
failed with _"No export named … LogForwarderArn found"_, taking the sandbox scheduler, the database stack and
the ingredient parser with it, and `kitchensink-identity-schema-sandbox` later died the same way in
`UPDATE_ROLLBACK_IN_PROGRESS`. The first repair moved three stacks off the import and left seven on it, which
is what a list of names does — right about what it named, silent about the rest.

So every owner now takes `logForwarderArn?: string` and attaches nothing without it. Each deploy surface
resolves the export with `cfnExport.sh --optional` and exports `LOG_FORWARDER_ARN` **for the whole job**
rather than per step: an absent value is a supported state (it is how a fresh account bootstraps at all), and
a deploy step that quietly omits the variable would be GREEN with its drains unattached — the same
silent-absence failure this ADR exists to stop. `logDrainRegister.test.ts` holds three things no source-text
count can see, since wrapping a filter in an `if` leaves its `new logs.SubscriptionFilter(` text exactly where
it was: that **no** infra source imports the ARN, that every filter-declaring stack takes the prop and guards
on it, and that every file deploying such an app resolves the ARN. The BEHAVIOUR — filter present with an
ARN, absent without — is asserted in each owning package's own infra suite, because those stacks' `aws-cdk-lib`
resolves only from their own `infra/` install. The `crossAppImports` manifest makes the remaining edges
checkable, and after this change they are acyclic.

**The forwarder's own group is NOT drained.** A filter on it feeds the Lambda its own output: every forwarded
batch writes a line, which the filter forwards. It is in the runtime register so a line arriving by any other
route is identified — identifying a group and subscribing to it are different questions, and only the second
loops.

**The drain's failure pages.** `LogForwarderFailureAlarm` watches the metric that already existed.

### The register

<!-- log-drain:start -->

| Log group                                                            | Owner stack             | Filter | Register key            |
| -------------------------------------------------------------------- | ----------------------- | ------ | ----------------------- |
| `/kitchensink/identity-service/{stage}`                              | `WebhooksStack`         | yes    | `identity-service`      |
| `kitchensink-identity-webhooks-{stage}-WebhooksLogGroup*`            | `WebhooksStack`         | yes    | `identity-webhooks`     |
| `kitchensink-identity-webhooks-{stage}-IdentityWebhooksApiLogGroup*` | `WebhooksStack`         | yes    | `identity-webhooks-api` |
| `kitchensink-identity-webhooks-{stage}-LogForwarderLogGroup*`        | `WebhooksStack`         | no     | `log-forwarder`         |
| `/aws/lambda/kitchensink-recipe-workers-{stage}`                     | `RecipeWorkersStack`    | yes    | `recipe-workers`        |
| `/aws/lambda/kitchensink-ingredient-parser-{stage}`                  | `IngredientParserStack` | yes    | `ingredient-parser`     |
| `kitchensink-recipe-{stage}-RecipeApiLogGroup*`                      | `RecipeServiceStack`    | yes    | `recipe-service`        |
| `kitchensink-food-{stage}-FoodApiLogGroup*`                          | `FoodServiceStack`      | yes    | `food-service`          |
| `kitchensink-food-{stage}-FoodWorkerLogGroup*`                       | `FoodServiceStack`      | yes    | `food-worker`           |
| `kitchensink-food-{stage}-FoodChangeRefreshLogGroup*`                | `FoodServiceStack`      | yes    | `food-change-refresh`   |
| `kitchensink-identity-schema-{stage}-IdentityMigrationLogGroup*`     | `IdentitySchemaStack`   | yes    | `identity-migration`    |
| `kitchensink-food-schema-{stage}-FoodMigrationLogGroup*`             | `FoodSchemaStack`       | yes    | `food-migration`        |
| `kitchensink-recipe-schema-{stage}-RecipeMigrationLogGroup*`         | `RecipeSchemaStack`     | yes    | `recipe-migration`      |
| `kitchensink-data-{stage}-DbBootstrapLogGroup*`                      | `DataStack`             | yes    | `db-bootstrap`          |
| `kitchensink-data-{stage}-PerPrDatabaseReaperLogGroup*`              | `DataStack`             | yes    | `per-pr-reaper`         |
| `kitchensink-sandbox-scheduler-{stage}-SandboxSchedulerLogGroup*`    | `SandboxSchedulerStack` | yes    | `sandbox-scheduler`     |

<!-- log-drain:end -->

The `Filter` column is `no` for exactly one row, the forwarder's own group, for the loop reason above.
`yes` means the group is DRAINED BY DESIGN — its owner declares a filter and attaches it whenever CI resolved
an ARN. It is not a claim that a given deploy attached one; that is the conditional above, and the residual
risk below.

**Seven functions wrote to IMPLICIT groups.** A Lambda with no declared group gets one created by the service
on first invocation — outside CloudFormation, so it exists in no template, is deleted by no teardown, and has
NO RETENTION: it keeps every line forever, and the cost is invisible because nothing in the repository names
the resource. The three schema migration runners, the database bootstrap, the per-PR reaper and the sandbox
scheduler now declare theirs. None declares a `logGroupName`: CDK generates one from the construct path, and
naming it explicitly would require naming the FUNCTION explicitly, which changes a Lambda's physical name
from generated to explicit and REPLACES it — a needless replacement of the function that migrates the
production database.

## Consequences

- Every runtime's logs reach one Sentry project, queryable by `environment` and by the register key.
- The register is a DOCUMENT rather than an assertion over one synthesized template, because no single
  template can see across CDK apps, and the filters are spread across most of them. `logDrainRegister.test.ts`
  holds the runtime half to this table, deriving the population from the tree rather than from a figure
  restated here — which is how "five different ones" came to be written and then quietly outlived its truth.
- The retired identity ECS group (kept alive by ADR-0035's expand-first rule until its export stops being
  imported) is deliberately absent: nothing writes to it, and a stage read off a group nobody writes to is
  noise.
- Lambda@Edge is out of scope and stays out: it writes to a log group in whichever region served the viewer,
  and no single stack can enumerate them. The edge verifier reports to Sentry directly instead.

### Residual risk — absence is now representable, and only the TEMPLATE observes it

Making the forwarder's ARN an input rather than an import removed a deploy deadlock, and it bought that with
a state the old form did not have: an app deployed with its filters unattached. Three gaps follow from it,
all stated rather than closed.

- **Convergence is bounded by the next deploy of EACH app, not the next pipeline run.** Nothing arms a deploy
  when the `LogForwarderArn` export appears — a deploy is armed by a `workflow_dispatch`, a change under the
  app's own paths, or (sandbox only) an absent platform _stack_, which is a different fact from an absent
  _filter_. On a fresh account the window opens on run 1 and closes only when one of those happens. Arming a
  deploy off a probe of deployed state is a larger and riskier change than the gap it closes, so each deploy
  surface warns instead.
- **The warning can no longer name the affected drains, and must not pretend to.** It used to, and was held
  per stage against the global app's synth — correct while that app owned the only conditional filters. Every
  drain is conditional now, across six CDK apps, and which subset a run deploys depends on which deploy flags
  fired, so no synthesis available to any test can enumerate it. The earlier prod message named
  `per-pr-reaper` and `sandbox-scheduler`, neither of which prod builds; rather than replace one unverifiable
  claim with a longer one, the warning states the gap without enumerating, and `logDrainRegister.test.ts`
  asserts that it names no register key.
- **The check that reads a RUNNING stage is BUILT, and what it can and cannot say is the residual.** Every
  other guard reads source. `verifyDeployment.sh drains` asks the account: for each log group a stack
  manages, does a subscription filter exist, and can its destination be confirmed. It runs after every
  deploy OF AN APP THAT OWNS A DRAINED LOG GROUP, on three surfaces. Two are in
  `.github/actions/infra-package` — a full-app sweep over the stacks the app synthesises, and a schema-only
  sweep over `{schema-stack}-{stage}` alone, separate because the SCHEMA stacks own conditional filters and
  only a schema-only invocation deploys them, so one step gated on `schema-only != 'true'` would never have
  looked at them. The third is **`prod-deploy.yml` and `sandbox-identity-deploy.yml` directly**, which do
  not route through that action: naming the action alone is how the stages where an undrained log group
  costs most came to be the ones the check could not reach, while this bullet read as though they were
  covered. ⚠️ They are not the only paths that bypass the action — `accountDeploy.yml` and
  `sandbox-router-deploy.yml` do too, and are exempt because their apps declare no filter at all, which the
  guard below ASSERTS rather than assumes.
- **The pairing of a `verify` site with its sweep is DERIVED, not hand-maintained.** `deployVerificationCoverage.test.ts`
  asserts that every job verifying an app which constructs a filter-declaring stack also sweeps it, with the
  exemption derived from what each entry constructs rather than listed. ⚠️ It keys on VERIFIED apps rather
  than deployed ones, which is safe only because the same file's `deploy ⇒ verify` rule is total with no
  allowlist — so this rule INHERITS that totality. Weakening the older rule silently weakens this one.
- ⚠️ **Four things that guard cannot see, stated because each fails in the vacuous-pass direction:**
  (1) it matches `new <fileBasename>(`, so construction through an alias, a loop or a factory is invisible —
  the same limit `logDrainRegister.test.ts`'s `conditionalEntries()` carries, and nothing in the tree does
  it today; (2) one level of indirection is covered only by the prop NAME — `props.logForwarderArn` is the
  entire reason `GlobalStack → DataStack` is not exempt, so a wrapper forwarding the ARN under another name
  or inside a config object would silently exempt its whole app; (3) the candidate set is a PATH convention
  (`**/infra/lib/**` ∪ `**/lib/platform/**`), total today because every `extends Stack` file sits inside it,
  which is a fact about this tree and not a property of the rule; (4) a missing entrypoint resolves to "owns
  no drain". For one verified by a job that also DEPLOYS that is sound, because `verified ⊆ deployed` (same
  file) and `deployed ⊆ the apps this tree defines` (same file, and `cdkAppDeployCoverage.test.ts`), so a
  typo is REFUSED rather than exempted. For one verified by a job that deploys nothing discoverable,
  NOTHING refuses it — `deployInfra.yml`'s `shared` job is exactly that shape: its verify site
  resolves to `shared/infra/bin/app.ts`, which does not exist, and no deploy-side rule keys on it. It is
  correct there (`shared/infra` has no `bin/`, so it owns no stack) and it is unguarded: a job verifying a
  real drain-owning app under a path that did not resolve would be silently exempt. Closing that means
  asserting over non-deploying jobs, which is larger than the gap, so it is stated instead.
- ⚠️ It FAILS on a destination it cannot confirm — delivery fails silently there, which is the worst shape
  available — and only REPORTS a group with no filter, because absence is a supported state: a fresh account
  has no forwarder, and the forwarder's own group must never have one. A destination that is not a Lambda
  (Kinesis, Firehose, a cross-account `logs:destination`) is legal and is reported UNCHECKED rather than
  failed, and a call that FAILS is a finding rather than either — folding it into "no filter" would let a
  principal without `logs:DescribeSubscriptionFilters` pass the check green having asked nothing.
- ⛔ It cannot tell the forwarder's own group from one left undrained by an empty `LOG_FORWARDER_ARN`.
  Linking a CDK-generated log group back to its function is not derivable from a resource listing, so both
  appear as reported rows rather than one being silently excused.
- ⚠️ `logs:DescribeSubscriptionFilters` is a NEW action for the deploy principal, whose policy is
  console-managed rather than declared in this repository, so the grant is assumed and not proven here. The
  failed-call branch above is what makes the answer visible on the first run instead of silently. ⚠️ The same gap covers a deploy run BY HAND: each `infra/package.json`'s own
  `deploy` script resolves no export, so a local `npm run infra:deploy` attaches nothing and says nothing.
  The guards grade the CI surfaces, which is where every deploy is supposed to happen.
- **The guard reads a class NAME, so an indirect construction escapes it.** `conditionalEntries()` in
  `logDrainRegister.test.ts` decides which app entries owe the wiring by matching `new <StackClass>(`. A
  construction through an alias (`import { X as Y }`), a loop over a class list, or a factory is not
  detected — and such an entry is then classified non-conditional, so both the forward and the inverse
  direction pass VACUOUSLY rather than fail. No entry does this today (all ten `bin/*.ts` name their stacks
  directly), and resolving identifiers through their import bindings is a larger change than the gap it
  closes, so the limit is recorded here and stated in the guard's own docstring instead of assumed away.
