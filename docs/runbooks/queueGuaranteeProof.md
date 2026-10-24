# Runbook — proving the queue guarantees on a deployed stage

Companion to [ADR-0041](../architecture/decisions/0041-queue-work-guarantees.md).

Two of the guarantees are proved automatically, on every deployed run, by the `E2E (queues — the deployed
backstop is armed and running)` job in `.github/workflows/deployedE2eTiers.yml`: the backstop's IAM role holds
no queue mutation, and its cron monitor is armed. Nothing below repeats those.

⛔ **The three scenario proofs in this runbook are MANUAL, and the reason is not effort.** Each one has to
reach the stage's database to seed a condition and then read what the system did about it, and that database
is private to the VPC ([ADR-0004](../architecture/decisions/0004-minimize-nat-egress.md)). A GitHub runner
cannot reach it, so a CI job claiming these proofs would either be lying or would need a door into the
private subnet that exists for no other reason — a standing hole in the network to make a test go green.

⚠️ **Run these on a `pr-{N}` preview, never on production.** Every one of them seeds work and then watches
what happens to it. A preview has its own logical database ([ADR-0006](../architecture/decisions/0006-per-pr-feature-deploys-base-stage-and-logical-db.md))
and its own queues, so the blast radius is the preview.

⚠️ **A preview escalates without checking in.** So on a preview the evidence is the Sentry ISSUE, not the
monitor. Read the `kitchensink-recipe-workers` / `kitchensink-food-service` projects filtered to
`stage:pr-{N}`.

## Prerequisites

- The PR carries `sandbox-up` and its stacks are deployed.
- A shell that can reach the preview's database. The supported route is a session through the stage's own
  bastion path used by `docs/runbooks/sandbox-vpc-recreation.md`; connect as the service role
  (`recipe_app` / `food_app`), never the master ([ADR-0039](../architecture/decisions/0039-database-role-split.md)).
- Access to the Sentry org `radicle-co`.

## 1. An expired flood drains with no engine calls

**What it proves.** The claim happens before the paid work: a line whose job has expired is refused by one
statement, and the CRF and Bedrock legs are never reached.

1. Create a parse job through the API, then age it out:

    ```sql
    UPDATE recipe_parse_jobs SET expires_at = now() - interval '1 hour' WHERE id = '<job id>';
    ```

2. Note the CRF function's invocation count before and after:

    ```
    aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations \
      --dimensions Name=FunctionName,Value=kitchensink-ingredient-parser-pr-{N} \
      --start-time <t0> --end-time <t1> --period 300 --statistics Sum
    ```

3. Re-drive the job's lines onto the parse queue.

**Pass:** the lines complete and the invocation count is unchanged. **Fail:** any increase — the claim is
running after the engines rather than before them, which is the defect ADR-0041's first section exists for.

⚠️ A `Sum` of zero over a window with no datapoints and a `Sum` of zero over a window with datapoints look
the same in the CLI output. Confirm the window contains at least one datapoint by widening it until a known
invocation appears, or the proof is vacuous.

## 2. A rename with a blocked publisher escalates

**What it proves.** Owed work that nothing is carrying is reported as `lost`, not as a healthy queue.

1. Note a profile's current handle, then make the sync owed without letting it publish — the simplest block
   is to set the owed stamp directly:

    ```sql
    UPDATE profiles SET handle_sync_owed_at = now() - interval '1 hour' WHERE user_id = '<ulid>';
    ```

2. Wait for the identity backstop's next run (five minutes).

**Pass:** one Sentry issue in `kitchensink-identity-webhook`, `queueName: identity-handle-sync`, condition
`lost`, carrying counts only. **Fail:** no issue, or an issue carrying the display name or any other text.

3. Clear it when done:

    ```sql
    UPDATE profiles SET handle_sync_owed_at = NULL WHERE user_id = '<ulid>';
    ```

## 3. A stale food lease is not double-claimed

**What it proves.** The fence, which is the one guarantee a passing drain cannot demonstrate: a reclaimed
worker must write nothing rather than overwrite the row its successor now owns.

1. Claim a food through the drainer and capture the fence the claim wrote:

    ```sql
    SELECT food_id, leased_at::text FROM fetch_queue WHERE status = 'in_flight' LIMIT 1;
    ```

2. Simulate the reap and the re-claim:

    ```sql
    UPDATE fetch_queue SET status = 'pending', leased_at = NULL WHERE food_id = '<id>';
    ```

3. Attempt the settle the reclaimed worker would have made, presenting the OLD fence:

    ```sql
    UPDATE fetch_queue SET status = 'tombstone'
     WHERE food_id = '<id>' AND status = 'in_flight' AND leased_at = '<the captured text>'::timestamptz;
    ```

**Pass:** `UPDATE 0`. **Fail:** `UPDATE 1` — the fence is not being presented, or is being presented in a
form that matches.

⚠️ **Capture the fence as `::text`.** A client that parses it to a timestamp loses precision the column
keeps, and the comparison then matches nothing for the wrong reason — which looks exactly like a pass.

## Recording the outcome

⛔ **A skipped run is never reported as a pass.** Write the result on the PR, naming which of the three ran
and what each returned. "The proof was not run" is a complete and acceptable status; "green" over a proof
nobody made is not.
