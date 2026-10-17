# CDK bootstrap qualifiers (owner runbook)

Decision record: ADR-0065. This runbook is the only place the bootstrap and the policy stack are run from. **No workflow runs any step here.** Every command is run by the owner, from an admin session, in the shared AWS account.

KitchenSink bootstraps CDK three times, under qualifiers of its own, so that no CI role can reach the account-wide `AdministratorAccess` execution role of the default bootstrap (`hnb659fds`, shared with another application).

| Qualifier   | Serves                                    | Toolkit stack                     | Execution policies |
| ----------- | ----------------------------------------- | --------------------------------- | ------------------ |
| `ksnonprod` | sandbox and every `pr-{N}` preview        | `kitchensink-bootstrap-ksnonprod` | 7                  |
| `ksprod`    | production stages                         | `kitchensink-bootstrap-ksprod`    | 7                  |
| `ksaccount` | the stage-less account app (`account.ts`) | `kitchensink-bootstrap-ksaccount` | 3                  |

⛔ Never run `cdk bootstrap` without `--qualifier` and `--toolkit-stack-name`. A bare `cdk bootstrap` rewrites `CDKToolkit`, which the other application owns. Never use qualifier `hnb659fds` or the stack name `CDKToolkit`.

The policy documents, the bootstrap templates and the policy counts all come from `packages/infra/bootstrap`. The counts above are for orientation; the commands below derive the real ARNs.

## 0. Prepare (read-only)

```bash
nvm use 24                                              # Node 24
export AWS_PROFILE=<your admin profile>                 # an administrator session, never a CI role
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export REGION=us-east-1
aws sts get-caller-identity                             # confirm it is YOUR admin identity

# From the repository root. The bootstrap package's tests pin each committed golden template to a fresh render.
npm run test --workspace=@kitchensink/cdk-bootstrap
export CDK=packages/infra/global/node_modules/.bin/cdk

# Validate every policy document with IAM Access Analyzer BEFORE the policy-stack deploy. Read-only: ValidatePolicy takes
# a document and creates nothing. It renders all 20 documents (account and region filled in) and fails on any ERROR or
# SECURITY_WARNING. The offline guards catch the classes we know (invented actions, ARN grammar, size); this catches the
# rest, and CloudFormation's CreatePolicy would otherwise reject them only at the end of the deploy.
npm run bootstrap:validate --workspace=@kitchensink/cdk-bootstrap -- "$ACCOUNT" "$REGION"
```

Do not continue to step 1 unless it ends with `All policies validate.`

## 1. Deploy the owner-only policy stack

The stack `kitchensink-ci-policies` holds every permissions boundary and execution policy for the three qualifiers. It must exist before any bootstrap, because the bootstrap attaches the execution policies by ARN. It uses your CLI credentials directly (no bootstrap role), and is built only under the context flag `ciPoliciesOwnerDeploy`.

```bash
export CDK_DEFAULT_ACCOUNT=$ACCOUNT CDK_DEFAULT_REGION=$REGION
APP="packages/infra/global/node_modules/.bin/tsx packages/infra/global/bin/account.ts"

# Review first: this shows the managed policies that will be created. Nothing is changed.
$CDK diff CiExecutionPolicy -c ciPoliciesOwnerDeploy=true --app "$APP"

$CDK deploy CiExecutionPolicy -c ciPoliciesOwnerDeploy=true --app "$APP" --require-approval never
```

Check the result: 20 managed policies (3 boundaries, 7 + 7 + 3 execution policies), all with the prefix `kitchensink-ci-`.

```bash
aws iam list-policies --scope Local --path-prefix / \
  --query "Policies[?starts_with(PolicyName,'kitchensink-ci-')].PolicyName" --output text | tr '\t' '\n' | sort
```

Print the execution-policy ARNs for one qualifier (used in step 2). They are built from the same module the stack is rendered from:

```bash
exec_arns() {  # $1 = qualifier
  aws iam list-policies --scope Local \
    --query "Policies[?starts_with(PolicyName,'kitchensink-ci-exec-$1-')].Arn" --output text | tr '\t' ','
}
exec_arns ksnonprod
```

The list must have as many ARNs as the table above. A role accepts at most 10 managed policies by default; a qualifier needing more than 10 needs a quota increase, or its parts merged in `executionPolicy.ts`.

## 2. Bootstrap `ksnonprod` first

```bash
$CDK bootstrap aws://$ACCOUNT/$REGION \
  --template packages/infra/bootstrap/golden/ksnonprod.yaml \
  --qualifier ksnonprod \
  --toolkit-stack-name kitchensink-bootstrap-ksnonprod \
  --cloudformation-execution-policies "$(exec_arns ksnonprod)"
```

(`--cloudformation-execution-policies` takes a comma-separated list, which `exec_arns` prints.)

### Verify on the sandbox before going further

1. Roles exist and trust only the named CI roles:
    ```bash
    aws iam get-role --role-name cdk-ksnonprod-deploy-role-$ACCOUNT-$REGION \
      --query 'Role.AssumeRolePolicyDocument' --output json
    ```
    The statement is `AWS: root` plus an `ArnEquals aws:PrincipalArn` condition over `kitchensink-gha-nonprod` only.
2. The execution role has the seven policies and NOT `AdministratorAccess`:
    ```bash
    aws iam list-attached-role-policies --role-name cdk-ksnonprod-cfn-exec-role-$ACCOUNT-$REGION
    ```
3. **Probe the execution-role trust before any real deploy.** One thing cannot be checked offline: that CloudFormation's service trust of the execution role accepts the `aws:SourceAccount` condition the template puts on it (`narrowExecutionRole` in `customizeBootstrapTemplate.ts`). Probe it with a one-topic stack that CloudFormation creates THROUGH the execution role, from your admin session. The name matches the `ksnonprod` stack pattern and the topic name matches its SNS grant, so a healthy role creates it:
    ```bash
    cat > /tmp/trustProbe.json <<'JSON'
    {"Resources":{"Topic":{"Type":"AWS::SNS::Topic","Properties":{"TopicName":"kitchensink-trustprobe-sandbox"}}}}
    JSON
    aws cloudformation create-stack --stack-name kitchensink-trustprobe-sandbox \
      --template-body file:///tmp/trustProbe.json \
      --role-arn arn:aws:iam::$ACCOUNT:role/cdk-ksnonprod-cfn-exec-role-$ACCOUNT-$REGION
    aws cloudformation wait stack-create-complete --stack-name kitchensink-trustprobe-sandbox
    aws cloudformation delete-stack --stack-name kitchensink-trustprobe-sandbox   # also runs through the role
    ```
    - **Pass:** `stack-create-complete`, then the delete completes.
    - **The condition is wrong when** `create-stack` fails at once with `ValidationError: Role arn:aws:iam::<account>:role/cdk-ksnonprod-cfn-exec-role-... is invalid or cannot be assumed`, or the stack events show `... is not authorized to perform: sts:AssumeRole` / `not authorized to assume`. A missing permission looks different: the stack is created and a resource event reads `AccessDenied ... is not authorized to perform: <action>`. That is item 4, not this one.
    - **Rollback (nothing is deployed through the qualifier yet, so it is cheap):** delete any failed probe stack (`aws cloudformation delete-stack --stack-name kitchensink-trustprobe-sandbox`; if it is stuck in `DELETE_FAILED`, delete the topic by hand: `aws sns delete-topic --topic-arn arn:aws:sns:$REGION:$ACCOUNT:kitchensink-trustprobe-sandbox`). Remove the `Condition` from `narrowExecutionRole`, run `npm run bootstrap:golden`, fix the golden-pinning tests to match, commit, and re-run the step 2 `cdk bootstrap` for `ksnonprod`. Do NOT continue to `ksprod` or `ksaccount`: they carry the same condition.
4. Deploy one sandbox stack under `ksnonprod` and run its post-deploy verifier (`verifyDeployment.sh`). An `AccessDenied` in the stack events names the action the execution policy is missing; add it to `packages/infra/bootstrap/src/executionPolicy.ts`, then follow "Changing a policy" below. After a clean deploy, IAM Access Analyzer policy generation over CloudTrail for the execution role is the authoring aid for tightening.
5. Negative probes, as the nonprod CI role (a sandbox workflow run, not your admin session): assuming `cdk-hnb659fds-deploy-role-...` and `cdk-ksprod-deploy-role-...` must both fail with `AccessDenied`.

Do not continue to `ksprod` until 3 and 4 pass. Run the item 3 probe again, with `ksprod` / `kitchensink-trustprobe-prod` / `kitchensink-trustprobe-prod`, after bootstrapping `ksprod`, and with `ksaccount` after bootstrapping it (the account tier's name pattern is exact, so probe it by looking at the role's trust and at its first real deploy in step 4 below).

## 3. Bootstrap `ksprod`, then `ksaccount`

```bash
$CDK bootstrap aws://$ACCOUNT/$REGION \
  --template packages/infra/bootstrap/golden/ksprod.yaml \
  --qualifier ksprod \
  --toolkit-stack-name kitchensink-bootstrap-ksprod \
  --cloudformation-execution-policies "$(exec_arns ksprod)"

$CDK bootstrap aws://$ACCOUNT/$REGION \
  --template packages/infra/bootstrap/golden/ksaccount.yaml \
  --qualifier ksaccount \
  --toolkit-stack-name kitchensink-bootstrap-ksaccount \
  --cloudformation-execution-policies "$(exec_arns ksaccount)"
```

The `ksaccount` deploy role trusts only `kitchensink-gha-prod`, which GitHub issues only to a job bound to the `Production` environment on `main`. Repeat the verification of step 2 for each (role names `cdk-ksprod-...`, `cdk-ksaccount-...`).

## 4. Sequencing with the CI roles (the sandbox order)

The new roles and buckets are additive and the default bootstrap is untouched, so steps 1 to 3 change nothing a workflow uses today. What must NOT happen early is any CI deploy that uses the new qualifiers, and cutting the CI roles' old path, before the owner has done all of this, in this order, on the sandbox:

1. **Deploy the owner-only policy stack** (step 1).
2. **Bootstrap `ksnonprod`, `ksprod` and `ksaccount`** (steps 2 and 3), each with its item 3 probe.
3. **Deploy the account app by hand, with admin credentials, BEFORE any CI deploy uses the new qualifiers.** The account app (`bin/account.ts`) now synthesizes against `ksaccount`, so its first deploy has to be the owner's, after `ksaccount` exists. It carries the CI-role changes (the assume rights for the new qualifiers, ADR-0065 D1) that every later workflow depends on, and `accountDeploy.yml` cannot deploy them: the `ksaccount` deploy role trusts only the production CI role, which does not yet hold those rights.
    ```bash
    # Do NOT pass -c ciPoliciesOwnerDeploy here: the policy stack was step 1 and is not part of this deploy.
    $CDK diff --all --app "$APP"
    $CDK deploy --all --app "$APP" --require-approval never
    ```
    Expect the CDK to warn that it could not assume `cdk-ksaccount-deploy-role-...` (it trusts only `kitchensink-gha-prod`, not your admin session) and to continue with your own credentials; the stack still runs through the `ksaccount` execution role, so confirm in the stack events that the stack's role is `cdk-ksaccount-cfn-exec-role-...`. If your CDK version refuses instead of falling back, stop and report; do not widen the deploy role's trust to get past it.
4. Only then let a workflow deploy through the new qualifiers: sandbox first, production last.

The remaining order (moving the stage stacks onto the new qualifiers and removing the old path) is owned by the access-stack migration in ADR-0065; follow it there.

## Changing a policy or a template

| Change                                                                               | Run                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit an action list or the boundary (`executionPolicy.ts`, `boundary.ts`)            | Step 1 only (`cdk deploy CiExecutionPolicy ...`). The attached ARNs do not change.                                                                                                                    |
| Add or remove a policy PART (a new `PART_NAMES` entry, or a part becomes empty)      | Step 1, then re-run that qualifier's `cdk bootstrap` (step 2 or 3) so its execution role's list matches `exec_arns`.                                                                                  |
| Edit the bootstrap template transform, the CI role trust, or the stack-name patterns | `npm run bootstrap:golden`, commit the golden, then re-run that qualifier's `cdk bootstrap`. Also re-run it after a CDK upgrade that raises the stock `BootstrapVersion` (`npm run bootstrap:stock`). |

Deploy `ksnonprod` first and verify on the sandbox each time. A too-narrow policy fails loudly (an `AccessDenied` in the stack events, with the action named). A too-wide one cannot, which is what the content guards in `packages/infra/bootstrap/__tests__` are for.

Only the owner deploys the policy stack. The CI roles cannot: its name matches no qualifier's deploy-role stack pattern, it is built only under `-c ciPoliciesOwnerDeploy=true`, and `ciPolicyStackOwnerOnly.test.ts` fails if any workflow or script names it.

## Rolling back

The default bootstrap was never changed, so rollback is deleting what this runbook added. Do it per qualifier, `ksaccount` and `ksprod` first, `ksnonprod` last, and only after the CI roles' assume rights for that qualifier are removed:

```bash
for q in ksaccount ksprod ksnonprod; do
  aws cloudformation delete-stack --stack-name kitchensink-bootstrap-$q
  aws cloudformation wait stack-delete-complete --stack-name kitchensink-bootstrap-$q
done
```

- The toolkit stack's file-assets bucket and its repository can be retained by the stock template. If the stack deletes with a retained resource, empty and delete that bucket by hand. Scope it by name: `cdk-<qualifier>-assets-$ACCOUNT-$REGION`. Never touch a `cdk-hnb659fds-*` resource.
- Stacks already deployed under a qualifier keep their stored execution role, so they cannot be updated or deleted once their toolkit stack is gone. Move them back to the default qualifier (or delete them) BEFORE deleting that qualifier's toolkit stack.
- Delete the policy stack last. Deleting a managed policy that is still attached to an execution role fails, which is the safeguard:
    ```bash
    $CDK destroy CiExecutionPolicy -c ciPoliciesOwnerDeploy=true --app "$APP"
    ```
