# Runbook — Sandbox VPC/RDS recreation + legacy `dev` retirement

Operational procedure for plan `docs/plans/2026-06-14-004-refactor-vpc-consolidation-plan.md` (U2 + U3) and ADR `docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md`.

> **These are manual, coordinated operations — not CI.** A CIDR change cannot be applied by a one-shot `cdk deploy --all` (CloudFormation refuses to change an export while another stack imports it → export-in-use deadlock). Run each step yourself, read the output, and stop on anything unexpected. **Never `cdk destroy` the global/data stack to recover** — its buckets are `autoDeleteObjects: true` + `DESTROY` and the RDS is `deletionProtection: false`; destroy empties the buckets and drops the DB. Fix forward only. `destroy` is the procedure for the service/webhooks stacks, not the data stack.

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
3. **Final snapshot (insurance, even for recreate-fresh)** — converts an irreversible drop into a recoverable one.
    ```bash
    ! aws rds create-db-snapshot --db-instance-identifier kitchensink-identity-sandbox \
        --db-snapshot-identifier kitchensink-identity-sandbox-pre-cidr-$(printf '%(%Y%m%d)T')
    ```

### A1. Suppress the sandbox CI auto-deploy

`sandbox-identity-deploy.yml` deploys the global stack on **PR open** via `cdk deploy --all`, which would fire the deadlocking deploy. Disable or path-gate that workflow for the duration of the operation (e.g. comment out its trigger on a throwaway commit, or disable the workflow in the GitHub Actions UI), and re-enable in A6.

### A2. Tear down the consumers (they import the network/data exports)

```bash
! STAGE=sandbox npx cdk destroy --app "node packages/services/identity-webhooks/infra/dist/bin/app.js" --all
! STAGE=sandbox npx cdk destroy --app "node packages/services/identity/infra/dist/bin/app.js" --all
```

Notes: `cdk destroy` matches by **construct id**, not stack name. Expect a possible stuck ACM cert on the webhooks/domain teardown — re-run with `--retain-resources <logicalId>` and delete the orphaned cert manually afterward (this matched prior prod experience).

### A3. Redeploy the global stack with the new CIDR + fresh RDS

```bash
! STAGE=sandbox DOMAIN_NAME=commise.app npx cdk deploy --app "node packages/infra/global/dist/bin/app.js" --all --require-approval never
```

This replaces the sandbox VPC (→ `10.1.0.0/16`), its subnets, and the RDS (fresh, empty). S3/SQS/secrets in the data stack are **not** VPC-bound and survive the update — do not destroy the data stack. If this deploy wedges (`UPDATE_ROLLBACK_FAILED`), **fix forward** — resolve the error and re-deploy; do not `cdk destroy`.

### A4. Re-resolve the VPC id and purge the stale context cache

The service stack reaches the VPC via `Vpc.fromLookup`, cached in the git-tracked `packages/services/identity/cdk.context.json`. The old entry points at the deleted VPC with `10.0.x.x` subnets — purge it so the lookup re-resolves.

```bash
! export IDENTITY_VPC_ID=$(aws cloudformation list-exports \
    --query "Exports[?Name=='kitchensink-identity-network-sandbox:IdentityVpcId'].Value" --output text)
! echo "new sandbox VPC: $IDENTITY_VPC_ID"
# remove the stale sandbox vpc-provider entry (and the webhooks copy if present), let CI/next synth regenerate it
! npx cdk context --clear   # or hand-edit packages/services/identity/cdk.context.json to drop the dead vpc-id key
```

Commit the regenerated context (or confirm CI runs with no stale sandbox entry) so a later prod deploy isn't poisoned.

### A5. Confirm the new RDS secret, redeploy consumers, migrate

```bash
# the recreated RDS generates a NEW managed secret ARN — confirm it before the consumers read it
! aws cloudformation list-exports --query "Exports[?contains(Name,'kitchensink-identity-data-sandbox')].{Name:Name,Value:Value}" --output table

! STAGE=sandbox DOMAIN_NAME=commise.app IDENTITY_VPC_ID=$IDENTITY_VPC_ID \
    npx cdk deploy --app "node packages/services/identity/infra/dist/bin/app.js" --all --require-approval never
! STAGE=sandbox DOMAIN_NAME=commise.app IDENTITY_VPC_ID=$IDENTITY_VPC_ID \
    npx cdk deploy --app "node packages/services/identity-webhooks/infra/dist/bin/app.js" --all --require-approval never

# apply schema to the fresh DB via the in-VPC migration Lambda
! MIGRATION_FN=$(aws cloudformation list-exports \
    --query "Exports[?contains(Name,'MigrationFunctionName')].Value" --output text)
! aws lambda invoke --function-name "$MIGRATION_FN" /tmp/migrate-out.json && cat /tmp/migrate-out.json
```

### A6. Verify and re-enable CI

- Sandbox service health-check is green against `10.1.0.0/16`.
- The migration Lambda reports all expected tables.
- Re-enable the `sandbox-identity-deploy.yml` trigger disabled in A1.

### Rollback notes (per step)

- Fail in A2 (consumer teardown stuck): retry with `--retain-resources`, clean orphans, continue.
- Fail in A3 (global deploy): **fix forward** — never destroy the data stack. If the VPC/RDS half-created, resolve and re-deploy.
- Fail in A5: re-resolve the secret ARN and re-deploy the consumers; the migration Lambda is idempotent (re-invokable).

---

## Part B — Retire the legacy `dev` VPC/RDS (U3)

The parentless `IdentityNetwork-dev` VPC + `kitchensink-identity-data-dev` RDS are leftovers from an old `STAGE=dev` deploy no current workflow reproduces. Retire only after confirming nothing live depends on them.

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
