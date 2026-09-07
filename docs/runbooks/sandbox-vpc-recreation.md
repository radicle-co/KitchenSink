# Runbook — Sandbox VPC/RDS recreation + legacy `dev` retirement

Operational procedure for plan `docs/plans/2026-06-14-004-refactor-vpc-consolidation-plan.md` (U2 + U3) and ADR `docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md`.

> **These are manual, coordinated operations — not CI.** Two changes compound here: the sandbox CIDR change (→ `10.1.0.0/16`) replaces the VPC/RDS, **and** the shared global stacks were **de-identified** in this PR — renamed from `kitchensink-identity-{global,network,data,domain}-{stage}` to `kitchensink-{global,network,data,domain}-{stage}`. (The identity-specific `service`/`webhooks` stacks keep their `kitchensink-identity-*` names.) Because the stack **names changed**, a deploy does **not** update the old stacks in place — it **creates the new-named stacks fresh and orphans the old ones**. So this is a _create-new + tear-down-old_ operation, not an in-place CIDR update. Run each step yourself, read the output, and stop on anything unexpected.
>
> **Two different "data stacks", opposite rules — do not confuse them:**
>
> - The **new, live** `kitchensink-data-{stage}` — **never `cdk destroy` it** to recover. Its buckets are `autoDeleteObjects: true` + `DESTROY` and the RDS is `deletionProtection: false`, so a destroy empties the buckets and drops the live DB. Fix forward only.
> - The **old, orphaned** `kitchensink-identity-data-{stage}` — this one **is** deleted deliberately in **A6**. Its contents are the discarded pre-rename sandbox data (the A0 snapshot is the insurance), and the new stack starts empty — so nothing "survives the update" the way an in-place CIDR change would have preserved it.

Prerequisite: the per-stage CIDR code (U1) is merged so `STAGE=sandbox` synthesizes `10.1.0.0/16`. Run everything on Node 24 (`nvm use`).

---

## Part A — Sandbox VPC + RDS recreation (U2)

### A0. Pre-flight (do not skip)

1. **CIDR-conflict check** — confirm `10.1.0.0/16` does not collide with any existing VPC, peering, or route in the account. If it does, fall back to `10.2.0.0/16` (update `cidrForStage`) before proceeding.
    ```bash
    ! aws ec2 describe-vpcs --query 'Vpcs[].{Id:VpcId,Cidr:CidrBlock}' --output table
    ! aws ec2 describe-vpc-peering-connections --query 'VpcPeeringConnections[].{Id:VpcPeeringConnectionId,Status:Status.Code}' --output table
    ```
2. **Verified-empty check** — the sandbox RDS is in isolated subnets (no laptop path yet), so count rows in-VPC via the migration Lambda or an ECS-exec into the running service task. Hard rule: **if any application table has non-system rows beyond test fixtures, halt and escalate.**
    ```bash
    # via ECS exec (service task must have execute-command enabled), or a one-off SELECT through the MigrationFunction Lambda
    ! aws ecs execute-command --cluster <sandbox-cluster> --task <task-id> --container <name> --interactive \
        --command "psql \"$DATABASE_URL\" -c \"select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc;\""
    ```
3. **Final snapshot (insurance, even for recreate-fresh)** — converts an irreversible drop into a recoverable one. Snapshot the **old** RDS (in the soon-to-be-orphaned `kitchensink-identity-data-sandbox`); resolve its physical id rather than assuming a name.
    ```bash
    ! OLD_RDS=$(aws cloudformation describe-stack-resources --stack-name kitchensink-identity-data-sandbox \
        --query "StackResources[?ResourceType=='AWS::RDS::DBInstance'].PhysicalResourceId" --output text)
    ! aws rds create-db-snapshot --db-instance-identifier "$OLD_RDS" \
        --db-snapshot-identifier kitchensink-sandbox-pre-cidr-$(printf '%(%Y%m%d)T')
    ```

### A1. Suppress the sandbox CI auto-deploy

`sandbox-identity-deploy.yml` deploys the global stack on **PR open** via `cdk deploy --all`. Letting CI drive this mid-operation would create the new-named global stacks uncoordinated with the consumer move (A2/A5) and the old-stack teardown (A6), leaving a half-migrated mess. Disable or path-gate that workflow for the duration of the operation (e.g. comment out its trigger on a throwaway commit, or disable the workflow in the GitHub Actions UI), and re-enable in A7.

### A2. Tear down the consumers (they import the network/data exports)

```bash
! STAGE=sandbox npx cdk destroy --app "node packages/services/identity-webhooks/infra/dist/bin/app.js" --all
! STAGE=sandbox npx cdk destroy --app "node packages/services/identity/infra/dist/bin/app.js" --all
```

Notes: `cdk destroy` matches by **construct id**, not stack name. Expect a possible stuck ACM cert on the webhooks/domain teardown — re-run with `--retain-resources <logicalId>` and delete the orphaned cert manually afterward (this matched prior prod experience).

### A3. Deploy the new-named global stacks (new CIDR + fresh RDS)

```bash
! STAGE=sandbox DOMAIN_NAME=commise.app npx cdk deploy --app "node packages/infra/global/dist/bin/app.js" --all --require-approval never
```

Because the stacks were renamed, this **creates** `kitchensink-{network,data,domain,global}-sandbox` from scratch — a fresh VPC (`10.1.0.0/16`), subnets, and a **brand-new, empty** RDS, S3 buckets, SQS queues, and secrets. It does **not** touch the old `kitchensink-identity-*-sandbox` stacks; they are left **orphaned** for teardown in A6. ⚠️ Unlike the old in-place CIDR plan, the data stack's S3/SQS/secrets do **not** carry over — the new stack starts empty, so copy anything still needed from the old buckets/secrets **before** A6 deletes them. If this deploy wedges (`CREATE_FAILED`/`UPDATE_ROLLBACK_FAILED`), **fix forward** on the new stack — resolve the error and re-deploy; do not `cdk destroy` the new data stack. (A3 leaves the old stacks untouched, so a failure here is non-destructive.)

### A4. Re-resolve the VPC id and purge the stale context cache

The service stack reaches the VPC via `Vpc.fromLookup`, cached in the git-tracked `packages/services/identity/cdk.context.json`. The old entry points at the deleted VPC with `10.0.x.x` subnets — purge it so the lookup re-resolves.

```bash
! export IDENTITY_VPC_ID=$(aws cloudformation list-exports \
    --query "Exports[?Name=='kitchensink-network-sandbox:VpcId'].Value" --output text)
! echo "new sandbox VPC: $IDENTITY_VPC_ID"
# remove the stale sandbox vpc-provider entry (and the webhooks copy if present), let CI/next synth regenerate it
! npx cdk context --clear   # or hand-edit packages/services/identity/cdk.context.json to drop the dead vpc-id key
```

Commit the regenerated context (or confirm CI runs with no stale sandbox entry) so a later prod deploy isn't poisoned.

### A5. Confirm the new RDS secret, redeploy consumers, migrate

```bash
# the recreated RDS generates a NEW managed secret ARN — confirm it before the consumers read it
! aws cloudformation list-exports --query "Exports[?contains(Name,'kitchensink-data-sandbox')].{Name:Name,Value:Value}" --output table

! STAGE=sandbox DOMAIN_NAME=commise.app IDENTITY_VPC_ID=$IDENTITY_VPC_ID \
    npx cdk deploy --app "node packages/services/identity/infra/dist/bin/app.js" --all --require-approval never
! STAGE=sandbox DOMAIN_NAME=commise.app IDENTITY_VPC_ID=$IDENTITY_VPC_ID \
    npx cdk deploy --app "node packages/services/identity-webhooks/infra/dist/bin/app.js" --all --require-approval never

# apply schema to the fresh DB via the in-VPC migration Lambda
#
# The identity service deploy above ALREADY applies the schema — its stack runs the runner inside the
# deploy (an `aws-cdk-lib/triggers` Trigger the ECS service depends on), which is why it is listed first.
# This invocation is the idempotent confirmation, and on a freshly recreated database it is the step that
# proves the schema landed rather than the one that lands it.
#
# ⚠️ The export is named EXACTLY — `contains(Name,'MigrationFunctionName')` used to be unambiguous when
# identity-webhooks owned the only one; food, recipe and identity each export one now, so a substring match
# returns three values and `--output text` would hand `aws lambda invoke` all three.
! MIGRATION_FN=$(aws cloudformation list-exports \
    --query "Exports[?Name=='kitchensink-identity-service-sandbox:IdentityMigrationFunctionName'].Value" \
    --output text)
! aws lambda invoke --function-name "$MIGRATION_FN" /tmp/migrate-out.json && cat /tmp/migrate-out.json
```

### A6. Tear down the orphaned old-named stacks

After A5 the consumers import the new `kitchensink-{network,data}-sandbox` exports, so **nothing imports the old `kitchensink-identity-*-sandbox` exports anymore** — they can be removed. These are the pre-rename stacks; deleting them is the intended cleanup (the A0 snapshot is the insurance).

Because they were **renamed**, `cdk` no longer manages them (they're not in the app) — delete them by **stack name** with `aws cloudformation delete-stack`, **not** `cdk destroy`. Delete the importer (data) before the producer it imports (network); domain and the parent global stack are independent.

```bash
# 1) Sanity: confirm NOTHING still imports the old exports before deleting (empty = safe).
! aws cloudformation list-exports \
    --query "Exports[?contains(Name,'kitchensink-identity-network-sandbox') || contains(Name,'kitchensink-identity-data-sandbox')].{Name:Name,ImportedBy:ExportingStackId}" \
    --output table

# 2) Delete in dependency order, waiting on each. (Skip any that already 'does not exist'.)
! for s in kitchensink-identity-data-sandbox kitchensink-identity-network-sandbox \
           kitchensink-identity-domain-sandbox kitchensink-identity-global-sandbox; do
      echo "deleting $s"
      aws cloudformation delete-stack --stack-name "$s"
      aws cloudformation wait stack-delete-complete --stack-name "$s" 2>/dev/null || echo "  (check $s manually)"
  done
```

The old data stack's `autoDeleteObjects` buckets + `DESTROY` RDS drop on delete — that **is** the intended discard of the old sandbox data. Expect a possible stuck ACM cert on the old domain stack: re-run its delete with `--retain-resources <logicalId>` and remove the orphaned cert manually, as in A2. If a delete wedges on a leftover ENI, find it via `describe-network-interfaces` (Part B style) and detach/delete before re-running.

### A7. Verify and re-enable CI

- Sandbox service health-check is green against `10.1.0.0/16`.
- The migration Lambda reports all expected tables.
- **No** `kitchensink-identity-{global,network,data,domain}-sandbox` stacks or exports remain (the rename's old set is fully gone).
- Re-enable the `sandbox-identity-deploy.yml` trigger disabled in A1.

### Rollback notes (per step)

- Fail in A2 (consumer teardown stuck): retry with `--retain-resources`, clean orphans, continue.
- Fail in A3 (new global deploy): **fix forward** on the new stacks — never `cdk destroy` the new live data stack. If the VPC/RDS half-created, resolve and re-deploy. The old stacks are untouched until A6, so an A3 failure is non-destructive.
- Fail in A5: re-resolve the secret ARN and re-deploy the consumers; the migration Lambda is idempotent (re-invokable).
- Fail in A6 (old-stack teardown): deleting the old stacks is the intended discard — a stuck delete (cert/ENI) is a cleanup nuisance, not a risk to the new live stacks. Use `delete-stack --retain-resources` and remove the orphan manually, then re-run.

---

## Part B — Retire the legacy `dev` VPC/RDS (U3)

The parentless `IdentityNetwork-dev` VPC + `kitchensink-data-dev` RDS are leftovers from an old `STAGE=dev` deploy no current workflow reproduces. Retire only after confirming nothing live depends on them.

### B1. CFN dependency check

```bash
! aws cloudformation list-exports --query "Exports[?contains(Name,'-dev:')].{Name:Name,Importedby:ExportingStackId}" --output table
# grep the repo + CI for importers of kitchensink-identity-*-dev: (research found none; CI only sets prod/sandbox)
```

### B2. Non-CFN dependency sweep (a grep cannot see these)

```bash
! DEV_VPC=<dev vpc id>
! aws ec2 describe-vpc-peering-connections --filters Name=requester-vpc-info.vpc-id,Values=$DEV_VPC
! aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=$DEV_VPC
! aws ec2 describe-network-interfaces --filters Name=vpc-id,Values=$DEV_VPC --query 'NetworkInterfaces[].{Id:NetworkInterfaceId,Desc:Description}' --output table
! aws route53 list-hosted-zones-by-vpc --vpc-id $DEV_VPC --vpc-region "$AWS_REGION" 2>/dev/null || true
# also check SSM params / secrets for a dev connection string
```

### B3. PII-aware data check + snapshot

```bash
# row-count per table for real Clerk user records (not just "negligible")
# take a final snapshot before destruction even if data is judged disposable
! aws rds create-db-snapshot --db-instance-identifier <dev-rds-id> \
    --db-snapshot-identifier kitchensink-identity-dev-final-$(printf '%(%Y%m%d)T')
```

### B4. Staged disable-then-delete

1. Stop the dev RDS and detach (not delete) the VPC for a cool-down window; confirm nothing breaks.
2. Delete the dev stacks in dependency order (any dev webhooks/service first, then data, then network), handling stuck certs with `--retain-resources` as in A2.
3. Delete/rotate-then-delete the dev RDS secret in Secrets Manager; confirm automated backups are removed or retention-zeroed so PII isn't retained post-teardown.
4. Confirm no `*-dev` identity exports remain and the dev VPC is gone.

### B5. Confirm the one-prod-VPC invariant

Record that no other VPC-attached prod infrastructure exists (`SandboxRouterStack` is CloudFront/VPC-independent), so plan 004 R1's "one prod VPC" is verified, not assumed.
