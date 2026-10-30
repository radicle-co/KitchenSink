# Scoped AWS access instead of the root key (owner runbook)

Owner ruling, 2026-10-29: **"Scoped access, keep root key".** This runbook carries it out. Every step is run by the
owner. No workflow runs any of it, and nothing here changes CI.

The result:

- **You** sign in through IAM Identity Center as an admin user, with MFA.
- **Local tools and agents** sign in through IAM Identity Center as a second user that holds ONE permission set,
  `KitchenSinkAgent`. It reaches KitchenSink resources only.
- **The root user** is for account-level emergencies only. It keeps MFA. Its access key stays, but no tool picks it up
  by default.

⛔ This AWS account also hosts another, unrelated production application. Nothing in this runbook acts on the
whole account. Every grant below is scoped by a `kitchensink` name prefix or by a KitchenSink tag. The few grants AWS
cannot scope are listed, with what they can see, in [What the agent role can see account-wide](#what-the-agent-role-can-see-account-wide).

⛔ While you follow this runbook, never touch these three things: the `CDKToolkit` stack, which belongs to the other
application, the root access key itself, and the production RDS instance.

⚠️ This repository is public. Wherever this file says `<ACCOUNT_ID>`, `<START_URL>`, `<OWNER_EMAIL>`,
`<AGENT_EMAIL>`, `<ADMIN_USERNAME>` or `<AGENT_USERNAME>`, put the real value in on your machine only. Never commit it.

## Check the starting point

Run these read-only checks first, with the credentials you use today. Each one tells you which step needs care. Do
not paste their output anywhere public.

```bash
aws sso-admin list-instances --query 'Instances[].Status'            # ACTIVE: Identity Center is already on
aws organizations describe-organization --query 'Organization.MasterAccountId' --output text
aws sts get-caller-identity --query Account --output text            # same number: this is the management account
aws cloudtrail describe-trails --query 'trailList[].Name'            # empty: step 9 must create a trail
aws configure list-profiles                                          # every profile name, no keys
aws --version                                                        # step 0 needs aws-cli/2.9 or later
aws iam list-users --query 'Users[].UserName' --output text \
  | tr '\t' '\n' | while read -r u; do
      echo "$u $(aws iam list-access-keys --user-name "$u" --query 'AccessKeyMetadata[?Status==`Active`].AccessKeyId' --output text | wc -w)"
    done                                                             # users with active keys; see decision 7
```

What the answers mean:

- **Identity Center is on.** Step 1 only checks it and sets MFA. Do not enable it again. If it already has an
  `AdministratorAccess` permission set, step 3 reuses it.
- **This is the management account.** Service control policies do not apply to a management account, so all
  scoping must come from the policy in step 4.
- **No trail.** An alert on root use needs one. Step 9 creates it.
- **A profile whose identity is root.** For each profile name, `aws sts get-caller-identity --profile <name>` shows
  who it is. A profile that answers `:root` is a root key on disk. Step 6 moves it out of `[default]`. Note that `ksnonprod` is
  a CDK bootstrap qualifier (ADR-0065), not a profile.
- **An old CLI.** `sso-session` profiles need AWS CLI v2 **2.9.0 or later**, first on `PATH`. Step 0 fixes it.
- **CDK roles.** Every `cdk-ks*` deploy, lookup and publishing role trusts only a named CI role, by an
  `aws:PrincipalArn` condition (ADR-0065). A person or agent cannot assume them. Step 7 explains how deploys still
  work.
- **CI** signs in through the GitHub OIDC roles in `packages/infra/global/lib/platform/GithubActionsAccessStack.ts`
  (ADR-0063). It uses no key on your machine, and nothing here changes it.

## 0. Before you start

1. Back up both AWS files. This backup is the rollback.

    ```bash
    mkdir -p ~/.aws/backup-2026-10-29
    cp -p ~/.aws/config ~/.aws/credentials ~/.aws/backup-2026-10-29/
    chmod 600 ~/.aws/backup-2026-10-29/*
    ```

2. Install the current AWS CLI v2, and make it the `aws` on your `PATH`.

    ```bash
    cd "$(mktemp -d)"
    curl -sSo awscliv2.zip https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip
    unzip -q awscliv2.zip
    sudo ./aws/install --update
    pip uninstall -y awscli        # removes the v1 in ~/.local/bin, which sits first on PATH
    hash -r
    aws --version                  # must print aws-cli/2.x, with x at least 9
    ```

    `/usr/bin/aws` is another v1 (from apt). It comes after `/usr/local/bin` on `PATH`, so it no longer wins.

## 1. Check Identity Center and set MFA

1. Sign in to the console as root (with MFA), Region `us-east-1`.
2. Open **IAM Identity Center**. The dashboard must show an enabled organization instance. If it does not, stop:
   the facts above are stale.
3. Note the **AWS access portal URL** (Settings → Identity source). This is `<START_URL>`.
4. Settings → **Authentication** → Multi-factor authentication → **Configure**:
    - Prompt users for MFA: **Every time they sign in (always-on context)**.
    - Users can authenticate with: **Security keys and built-in authenticators** and **Authenticator apps**.
    - If a user does not yet have a registered MFA device: **Require them to register an MFA device at sign in**.
    - Save. An older instance keeps its old defaults, so set them now.
5. Settings → Authentication → **Session duration** (the access portal session): set **12 hours**. This is how
   often you sign in again. When it ends, agents stop working. Sign in again to start them.

## 2. Create the two users

You need two users, not one. A sign-in token in `~/.aws/sso/cache` can fetch credentials for **every** permission
set its user is assigned. Suppose your admin user is the one logged in on the machine. Then any agent can ask for
`AdministratorAccess` with that token. A second user that holds only `KitchenSinkAgent` closes that.

1. Users → **Add user**:
    - Username: `<ADMIN_USERNAME>`. Email: `<OWNER_EMAIL>`. Your name.
    - No groups. Add the user.
2. Users → **Add user** again:
    - Username: `<AGENT_USERNAME>`. Email: `<AGENT_EMAIL>` (a plus address such as `you+agent@…` is fine).
    - No groups. Add the user.
3. Accept both invitation emails, set each password, and register an MFA device for each. A passkey or security key is
   best. You can register the same authenticator app for both users.

## 3. Give the admin user AdministratorAccess

1. **AWS accounts** → select this account → **Assign users or groups**.
2. Users → `<ADMIN_USERNAME>` → Next.
3. Permission set: `AdministratorAccess` → Next → Submit.
4. Optional: open Permission sets → `AdministratorAccess` → Edit → keep the session at **1 hour**. Admin work is
   short, and a short session limits a stolen one.

## 4. Create the KitchenSinkAgent permission set

1. **Permission sets** → **Create permission set** → **Custom permission set** → Next.
2. Skip AWS managed and customer managed policies.
3. **Inline policy**: paste the JSON below. First replace every `<ACCOUNT_ID>` with the real account ID, in your
   editor only.
4. Name: `KitchenSinkAgent`. Description: `KitchenSink only: sandbox deploys, reads, Bedrock roster`.
   Session duration: **4 hours**. Relay state: empty.
5. Tag: `kitchensink:access` = `agent`. ⛔ Never use the `kitchensink:tier` tag here. That tag authorizes the CDK
   execution roles (ADR-0065, Decision 5a).
6. Create.

The policy is about 9,000 characters, under the 10,240 limit for a role's inline policy. If you add to it and it goes over,
split it into customer managed policies named `kitchensink-agent-*`.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "WhoAmI",
            "Effect": "Allow",
            "Action": "sts:GetCallerIdentity",
            "Resource": "*"
        },
        {
            "Sid": "ReadKitchenSinkStacks",
            "Effect": "Allow",
            "Action": ["cloudformation:Describe*", "cloudformation:Get*", "cloudformation:List*"],
            "Resource": "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-*/*"
        },
        {
            "Sid": "ListStacksAndValidate",
            "Effect": "Allow",
            "Action": [
                "cloudformation:ListStacks",
                "cloudformation:ListExports",
                "cloudformation:ValidateTemplate",
                "cloudformation:GetTemplateSummary"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ChangeNonprodStacksOnlyThroughExecRole",
            "Effect": "Allow",
            "Action": ["cloudformation:CreateChangeSet", "cloudformation:CreateStack", "cloudformation:UpdateStack"],
            "Resource": [
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-*-sandbox/*",
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-*-pr-*/*"
            ],
            "Condition": {
                "StringEquals": {
                    "cloudformation:RoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-ksnonprod-cfn-exec-role-<ACCOUNT_ID>-us-east-1"
                }
            }
        },
        {
            "Sid": "OperateNonprodStacks",
            "Effect": "Allow",
            "Action": [
                "cloudformation:ExecuteChangeSet",
                "cloudformation:DeleteChangeSet",
                "cloudformation:DeleteStack",
                "cloudformation:RollbackStack",
                "cloudformation:ContinueUpdateRollback",
                "cloudformation:CancelUpdateStack",
                "cloudformation:UpdateTerminationProtection"
            ],
            "Resource": [
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-*-sandbox/*",
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-*-pr-*/*"
            ]
        },
        {
            "Sid": "PassOnlyTheNonprodExecRole",
            "Effect": "Allow",
            "Action": "iam:PassRole",
            "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-ksnonprod-cfn-exec-role-<ACCOUNT_ID>-us-east-1",
            "Condition": { "StringEquals": { "iam:PassedToService": "cloudformation.amazonaws.com" } }
        },
        {
            "Sid": "CdkFileAssets",
            "Effect": "Allow",
            "Action": ["s3:GetObject*", "s3:PutObject*", "s3:GetBucket*", "s3:List*", "s3:AbortMultipartUpload"],
            "Resource": [
                "arn:aws:s3:::cdk-ksnonprod-assets-<ACCOUNT_ID>-us-east-1",
                "arn:aws:s3:::cdk-ksnonprod-assets-<ACCOUNT_ID>-us-east-1/*"
            ]
        },
        {
            "Sid": "CdkImageAssets",
            "Effect": "Allow",
            "Action": [
                "ecr:BatchCheckLayerAvailability",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
                "ecr:PutImage",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
                "ecr:DescribeRepositories",
                "ecr:DescribeImages"
            ],
            "Resource": "arn:aws:ecr:us-east-1:<ACCOUNT_ID>:repository/cdk-ksnonprod-container-assets-<ACCOUNT_ID>-us-east-1"
        },
        {
            "Sid": "ReadServiceImages",
            "Effect": "Allow",
            "Action": [
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
                "ecr:DescribeRepositories",
                "ecr:DescribeImages",
                "ecr:ListImages"
            ],
            "Resource": "arn:aws:ecr:us-east-1:<ACCOUNT_ID>:repository/kitchensink-*"
        },
        {
            "Sid": "EcrLogin",
            "Effect": "Allow",
            "Action": "ecr:GetAuthorizationToken",
            "Resource": "*"
        },
        {
            "Sid": "ReadParameters",
            "Effect": "Allow",
            "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
            "Resource": [
                "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/cdk-bootstrap/ksnonprod/*",
                "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/kitchensink/sandbox/*",
                "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/kitchensink/pr-*",
                "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/kitchensink/global/*"
            ]
        },
        {
            "Sid": "CdkContextLookups",
            "Effect": "Allow",
            "Action": [
                "ec2:DescribeVpcs",
                "ec2:DescribeSubnets",
                "ec2:DescribeRouteTables",
                "ec2:DescribeVpnGateways",
                "ec2:DescribeAvailabilityZones",
                "ec2:DescribeSecurityGroups",
                "route53:ListHostedZones",
                "route53:ListHostedZonesByName",
                "route53:GetHostedZone"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ReadKitchenSinkEcs",
            "Effect": "Allow",
            "Action": ["ecs:DescribeClusters", "ecs:DescribeServices", "ecs:DescribeTasks", "ecs:ListTagsForResource"],
            "Resource": [
                "arn:aws:ecs:us-east-1:<ACCOUNT_ID>:cluster/kitchensink-*",
                "arn:aws:ecs:us-east-1:<ACCOUNT_ID>:service/kitchensink-*/*",
                "arn:aws:ecs:us-east-1:<ACCOUNT_ID>:task/kitchensink-*/*"
            ]
        },
        {
            "Sid": "ListEcs",
            "Effect": "Allow",
            "Action": [
                "ecs:ListClusters",
                "ecs:ListServices",
                "ecs:ListTasks",
                "ecs:ListTaskDefinitions",
                "ecs:DescribeTaskDefinition"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ScaleOrRestartNonprodServices",
            "Effect": "Allow",
            "Action": "ecs:UpdateService",
            "Resource": "arn:aws:ecs:us-east-1:<ACCOUNT_ID>:service/kitchensink-*/*",
            "Condition": { "StringEquals": { "aws:ResourceTag/kitchensink:tier": "nonprod" } }
        },
        {
            "Sid": "UseNonprodFunctions",
            "Effect": "Allow",
            "Action": [
                "lambda:InvokeFunction",
                "lambda:GetFunction",
                "lambda:GetFunctionConfiguration",
                "lambda:GetFunctionUrlConfig"
            ],
            "Resource": "arn:aws:lambda:us-east-1:<ACCOUNT_ID>:function:kitchensink-*",
            "Condition": {
                "StringLike": {
                    "aws:ResourceTag/aws:cloudformation:stack-name": ["kitchensink-*-sandbox", "kitchensink-*-pr-*"]
                }
            }
        },
        {
            "Sid": "ReadRdsMetadata",
            "Effect": "Allow",
            "Action": ["rds:Describe*", "rds:ListTagsForResource"],
            "Resource": "*"
        },
        {
            "Sid": "ReadKitchenSinkSecrets",
            "Effect": "Allow",
            "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
            "Resource": "arn:aws:secretsmanager:us-east-1:<ACCOUNT_ID>:secret:kitchensink/*"
        },
        {
            "Sid": "ReadKitchenSinkLogs",
            "Effect": "Allow",
            "Action": [
                "logs:DescribeLogStreams",
                "logs:GetLogEvents",
                "logs:FilterLogEvents",
                "logs:GetLogGroupFields",
                "logs:StartQuery",
                "logs:StartLiveTail"
            ],
            "Resource": [
                "arn:aws:logs:us-east-1:<ACCOUNT_ID>:log-group:/aws/lambda/kitchensink-*",
                "arn:aws:logs:us-east-1:<ACCOUNT_ID>:log-group:/aws/ecs/containerinsights/kitchensink-*",
                "arn:aws:logs:us-east-1:<ACCOUNT_ID>:log-group:/kitchensink/*",
                "arn:aws:logs:us-east-1:<ACCOUNT_ID>:log-group:kitchensink-*"
            ]
        },
        {
            "Sid": "LogQueryPlumbing",
            "Effect": "Allow",
            "Action": ["logs:DescribeLogGroups", "logs:GetQueryResults", "logs:StopQuery", "logs:DescribeQueries"],
            "Resource": "*"
        },
        {
            "Sid": "InvokeRosterModelsInRegion",
            "Effect": "Allow",
            "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            "Resource": [
                "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0",
                "arn:aws:bedrock:us-east-1:<ACCOUNT_ID>:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
            ]
        },
        {
            "Sid": "HaikuProfileFanOut",
            "Effect": "Allow",
            "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            "Resource": [
                "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
                "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
                "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
            ],
            "Condition": {
                "StringEquals": {
                    "bedrock:InferenceProfileArn": "arn:aws:bedrock:us-east-1:<ACCOUNT_ID>:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
                }
            }
        },
        {
            "Sid": "ReadBedrockCatalog",
            "Effect": "Allow",
            "Action": [
                "bedrock:ListFoundationModels",
                "bedrock:GetFoundationModel",
                "bedrock:ListInferenceProfiles",
                "bedrock:GetInferenceProfile"
            ],
            "Resource": "*"
        },
        {
            "Sid": "ReadCosts",
            "Effect": "Allow",
            "Action": ["ce:Get*", "ce:Describe*", "ce:List*"],
            "Resource": "*"
        },
        {
            "Sid": "ReadKitchenSinkBudgets",
            "Effect": "Allow",
            "Action": "budgets:ViewBudget",
            "Resource": "arn:aws:budgets::<ACCOUNT_ID>:budget/kitchensink-*"
        },
        {
            "Sid": "DenyOwnerAndForeignStacks",
            "Effect": "Deny",
            "Action": [
                "cloudformation:Create*",
                "cloudformation:Update*",
                "cloudformation:Delete*",
                "cloudformation:Execute*",
                "cloudformation:Set*",
                "cloudformation:ContinueUpdateRollback",
                "cloudformation:RollbackStack",
                "cloudformation:CancelUpdateStack"
            ],
            "Resource": [
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/CDKToolkit/*",
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-bootstrap-*/*",
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-ci-policies/*",
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-github-actions-access/*",
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-cost-guardrails/*",
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-*-prod/*",
                "arn:aws:cloudformation:us-east-1:<ACCOUNT_ID>:stack/kitchensink-*-prod-*/*"
            ]
        },
        {
            "Sid": "DenyAnyOtherExecRole",
            "Effect": "Deny",
            "Action": "cloudformation:*",
            "Resource": "*",
            "Condition": {
                "Null": { "cloudformation:RoleArn": "false" },
                "StringNotEquals": {
                    "cloudformation:RoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-ksnonprod-cfn-exec-role-<ACCOUNT_ID>-us-east-1"
                }
            }
        },
        {
            "Sid": "DenyOtherBootstrapRoles",
            "Effect": "Deny",
            "Action": ["sts:AssumeRole", "iam:PassRole"],
            "Resource": [
                "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-*",
                "arn:aws:iam::<ACCOUNT_ID>:role/cdk-ksprod-*",
                "arn:aws:iam::<ACCOUNT_ID>:role/cdk-ksaccount-*"
            ]
        },
        {
            "Sid": "DenyAccountWideFunctionDumps",
            "Effect": "Deny",
            "Action": ["lambda:ListFunctions", "lambda:ListVersionsByFunction"],
            "Resource": "*"
        },
        {
            "Sid": "DenyDatabaseChangesAndLogins",
            "Effect": "Deny",
            "Action": [
                "rds:Create*",
                "rds:Delete*",
                "rds:Modify*",
                "rds:Reboot*",
                "rds:Restore*",
                "rds:Start*",
                "rds:Stop*",
                "rds:Failover*",
                "rds:Promote*",
                "rds:Add*",
                "rds:Remove*",
                "rds:Download*",
                "rds-db:connect",
                "rds-data:*"
            ],
            "Resource": "*"
        },
        {
            "Sid": "DenyDatabaseMasterSecret",
            "Effect": "Deny",
            "Action": "secretsmanager:*",
            "Resource": "arn:aws:secretsmanager:us-east-1:<ACCOUNT_ID>:secret:DatabaseCredentialsSecret*"
        },
        {
            "Sid": "DenySettingTheTierTag",
            "Effect": "Deny",
            "NotAction": "cloudformation:*",
            "Resource": "*",
            "Condition": { "ForAnyValue:StringEquals": { "aws:TagKeys": ["kitchensink:tier"] } }
        }
    ]
}
```

What each part is for:

| Sid                                       | Why                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ReadKitchenSinkStacks`                   | Read any `kitchensink-*` stack, production included.                                                                                                                                                                     |
| `ChangeNonprodStacksOnlyThroughExecRole`  | Create or change sandbox and `pr-{N}` stacks. CloudFormation must act as `cdk-ksnonprod-cfn-exec-role`, or the call is refused. That role carries the scoped execution policies and permissions boundary of ADR-0065.    |
| `OperateNonprodStacks`                    | Run, roll back or delete those same stacks. The names match the `ksnonprod` deploy role's own resource list.                                                                                                             |
| `PassOnlyTheNonprodExecRole`              | Hand that one role to CloudFormation, and to nothing else.                                                                                                                                                               |
| `CdkFileAssets`, `CdkImageAssets`         | Upload CDK assets to the `ksnonprod` bucket and repository. The bucket uses the AWS managed S3 key, so no KMS grant is needed.                                                                                           |
| `ReadServiceImages`                       | Read (never push to) the `kitchensink-*` image repositories. CI pushes service images.                                                                                                                                   |
| `ReadParameters`                          | The bootstrap version CDK checks, and the `/kitchensink/sandbox`, `/kitchensink/pr-*` and `/kitchensink/global` parameters that sandbox stacks resolve. Not `/kitchensink/prod`.                                         |
| `CdkContextLookups`                       | `Vpc.fromLookup` and the hosted-zone lookups that CDK runs at synth time.                                                                                                                                                |
| `ReadKitchenSinkEcs`, `ListEcs`           | See clusters, services and tasks.                                                                                                                                                                                        |
| `ScaleOrRestartNonprodServices`           | `ecs update-service` on a service tagged `kitchensink:tier=nonprod`.                                                                                                                                                     |
| `UseNonprodFunctions`                     | Invoke and read sandbox and `pr-{N}` functions, by CloudFormation's stack-name tag. This is the same fail-closed rule the CI role uses: a function without the tag matches nothing.                                      |
| `ReadRdsMetadata`                         | `describe-*` only. The deny below blocks every change, every login and every log download.                                                                                                                               |
| `ReadKitchenSinkSecrets`                  | `kitchensink/*` secrets, as the ruling says. This includes `kitchensink/prod/*`.                                                                                                                                         |
| `ReadKitchenSinkLogs`, `LogQueryPlumbing` | Read the four KitchenSink log-group name shapes: `/aws/lambda/kitchensink-*`, `/kitchensink/*`, `kitchensink-*` and `/aws/ecs/containerinsights/kitchensink-*`.                                                          |
| `InvokeRosterModelsInRegion` and fan-out  | Nova Micro on demand, and Claude Haiku 4.5 through its `us.` inference profile only. The profile's fan-out to other Regions is allowed only through that profile (`bedrock:InferenceProfileArn`).                        |
| `ReadCosts`, `ReadKitchenSinkBudgets`     | Cost Explorer reads, and the `kitchensink-*` budgets.                                                                                                                                                                    |
| `Deny…` statements                        | Hard stops that no later grant can undo: owner-only stacks, production stacks, other bootstrap roles, account-wide function listings (they return environment variables), RDS changes, the RDS master secret, tier tags. |

## 5. Assign KitchenSinkAgent to the agent user

1. **AWS accounts** → this account → **Assign users or groups**.
2. Users → `<AGENT_USERNAME>` → Next.
3. Permission set: `KitchenSinkAgent` → Next → Submit.
4. Wait for the provisioning status to show **Succeeded**.

Do not assign `AdministratorAccess` to `<AGENT_USERNAME>`, and do not assign `KitchenSinkAgent` to `<ADMIN_USERNAME>`.

## 6. Local profiles, and switching tools and agents

1. Add these blocks to `~/.aws/config`. Keep the `[profile localstack]` block as it is.

    ```ini
    [default]
    region = us-east-1

    [sso-session kitchensink-agent]
    sso_start_url = <START_URL>
    sso_region = us-east-1
    sso_registration_scopes = sso:account:access

    [sso-session kitchensink-admin]
    sso_start_url = <START_URL>
    sso_region = us-east-1
    sso_registration_scopes = sso:account:access

    [profile kitchensink-agent]
    sso_session = kitchensink-agent
    sso_account_id = <ACCOUNT_ID>
    sso_role_name = KitchenSinkAgent
    region = us-east-1

    [profile kitchensink-admin]
    sso_session = kitchensink-admin
    sso_account_id = <ACCOUNT_ID>
    sso_role_name = AdministratorAccess
    region = us-east-1

    [profile root-breakglass]
    region = us-east-1
    ```

    The two `sso-session` blocks keep separate token caches, so the agent token and the admin token never mix.

2. Move the root key out of `[default]`, so a command with no profile fails instead of running as root.
    1. Check that the two root entries hold the same key. This prints only `same` or `different`:

        ```bash
        [ "$(aws configure get aws_access_key_id --profile default)" = \
          "$(aws configure get aws_access_key_id --profile sts-longterm)" ] && echo same || echo different
        ```

    2. If it prints `same`: in `~/.aws/credentials`, rename the section `[default]` to `[root-breakglass]` and delete the
       `[sts-longterm]` section. If it prints `different`, stop and find out what the second key is first.
    3. Check: `aws sts get-caller-identity` with no profile must now fail with `Unable to locate credentials`.

3. Sign in as the agent user. Use the browser where `<AGENT_USERNAME>` is the signed-in portal user.

    ```bash
    aws sso login --sso-session kitchensink-agent        # add --use-device-code if no browser opens under WSL
    AWS_PROFILE=kitchensink-agent aws sts get-caller-identity
    ```

    The ARN must contain `assumed-role/AWSReservedSSO_KitchenSinkAgent_`.

4. Make it the default for every local tool and agent. Agents run commands in a non-interactive zsh, which reads
   `~/.zshenv` and not `~/.zshrc`:

    ```bash
    echo 'export AWS_PROFILE=kitchensink-agent' >> ~/.zshenv
    ```

    The AWS CLI v2, the CDK CLI and the AWS SDK for JavaScript v3 (which this repo's scripts use) all read
    `AWS_PROFILE` and `sso-session` profiles. Nothing in the repo needs to change.

5. When you need to do admin work:

    ```bash
    aws sso login --sso-session kitchensink-admin        # in a private browser window, signed in as <ADMIN_USERNAME>
    AWS_PROFILE=kitchensink-admin aws sts get-caller-identity
    # ... the admin task ...
    aws sso logout                                       # signs out every session. Then log the agent in again.
    ```

    The admin profile replaces "an admin session" in `docs/runbooks/cdkBootstrapQualifiers.md` step 0.

6. When the 12-hour portal session ends, agent commands fail with a message about an expired token. Run step 3 again.

## 7. How CDK deploys keep working

Nothing about the bootstrap changes. The flow for a sandbox or `pr-{N}` stack, as `kitchensink-agent`:

1. CDK tries to assume `cdk-ksnonprod-deploy-role-…`. Its trust names only `kitchensink-gha-nonprod`, so this fails.
   CDK prints a warning that it cannot assume the role, and goes on with your own credentials. This is the same
   path a local deploy takes as root today.
2. CDK uploads assets to `cdk-ksnonprod-assets-…` and `cdk-ksnonprod-container-assets-…` with your credentials
   (`CdkFileAssets`, `CdkImageAssets`).
3. CDK creates the change set and passes `cdk-ksnonprod-cfn-exec-role-…` as the stack's role. CloudFormation then
   does all the work as that role, under its execution policies and boundary. The policy refuses any change set
   that names no role, or names a different one (`ChangeNonprodStacksOnlyThroughExecRole`, `DenyAnyOtherExecRole`).

So the agent can do on the sandbox what the nonprod CI role can do, and no more. To check it after a deploy:

```bash
aws cloudformation describe-stacks --stack-name <a sandbox stack> --query 'Stacks[0].RoleARN' --output text
```

It must end in `cdk-ksnonprod-cfn-exec-role-<ACCOUNT_ID>-us-east-1`.

⛔ Do not "fix" the warning by adding the SSO role to the deploy role's trust. `cdkBootstrapQualifiers.md` (step 4,
item 3) says not to widen it, and doing it changes ADR-0065.

**Production.** The agent role cannot deploy production: it is denied every write to `kitchensink-*-prod` stacks and
`iam:PassRole` on `cdk-ksprod-*`. That role lets CloudFormation replace the production RDS instance.
Production deploys go through `prod-deploy.yml`. When you must deploy production by hand, use `kitchensink-admin`.

**Owner stacks.** The bootstrap stacks, `kitchensink-ci-policies`, `kitchensink-github-actions-access` and
`kitchensink-cost-guardrails` stay owner-only (`kitchensink-admin`), as `cdkBootstrapQualifiers.md` already
requires.

## 8. Prove the scope

### 8a. Before you create anything: simulate the policy document

`iam simulate-custom-policy` reads a policy document and creates nothing. Do these three things.

1. Save the JSON from step 4 as `agentPolicy.json` in a scratch folder. Leave `<ACCOUNT_ID>` in it. The script fills
   it in.
2. Save the script below as `simulateAgentAccess.sh`.
3. Run it with a profile that is allowed to call the IAM simulator:

```bash
AWS_PROFILE=kitchensink-admin bash simulateAgentAccess.sh custom agentPolicy.json
```

### 8b. After step 5: simulate the real role

```bash
export AWS_PROFILE=kitchensink-admin
ROLE=$(aws iam list-roles --path-prefix /aws-reserved/sso.amazonaws.com/ \
  --query "Roles[?starts_with(RoleName,'AWSReservedSSO_KitchenSinkAgent_')].Arn" --output text)
bash simulateAgentAccess.sh principal "$ROLE"
```

Both runs must end with `ALL CHECKS PASS`. The first group is positive controls: if they fail, the check proves
nothing. The simulator does not read tags from real resources, so the script passes the tags as context. All
non-KitchenSink names in it (`other-app-…`) are made up on purpose.

```bash
#!/usr/bin/env bash
# usage: simulateAgentAccess.sh custom <policy.json> | principal <role-arn>
# Read-only: calls only sts:GetCallerIdentity and the IAM policy simulator.
set -u
MODE=$1; SRC=$2
ACC=$(aws sts get-caller-identity --query Account --output text)
R=us-east-1
EXEC="arn:aws:iam::$ACC:role/cdk-ksnonprod-cfn-exec-role-$ACC-$R"
fail=0
check() { # expected-decision action resource [context-entry ...]
  local want=$1 action=$2 resource=$3; shift 3
  local ctx=()
  [ $# -gt 0 ] && ctx=(--context-entries "$@")
  local got
  if [ "$MODE" = custom ]; then
    got=$(aws iam simulate-custom-policy --policy-input-list "$(sed "s/<ACCOUNT_ID>/$ACC/g" "$SRC")" \
      --action-names "$action" --resource-arns "$resource" "${ctx[@]}" \
      --query 'EvaluationResults[0].EvalDecision' --output text)
  else
    got=$(aws iam simulate-principal-policy --policy-source-arn "$SRC" \
      --action-names "$action" --resource-arns "$resource" "${ctx[@]}" \
      --query 'EvaluationResults[0].EvalDecision' --output text)
  fi
  local verdict=PASS
  [ "$got" = "$want" ] || { verdict=FAIL; fail=1; }
  printf '%s  want=%-12s got=%-12s %s %s\n' "$verdict" "$want" "$got" "$action" "${resource//$ACC/<ACCOUNT_ID>}"
}
cfn="arn:aws:cloudformation:$R:$ACC:stack"
role() { echo "ContextKeyName=cloudformation:RoleArn,ContextKeyValues=$1,ContextKeyType=string"; }
tag() { echo "ContextKeyName=$1,ContextKeyValues=$2,ContextKeyType=string"; }

# Positive controls: these MUST be allowed, or the check proves nothing.
check allowed cloudformation:UpdateStack "$cfn/kitchensink-food-service-sandbox/x" "$(role "$EXEC")"
check allowed cloudformation:CreateChangeSet "$cfn/kitchensink-recipe-service-pr-42/x" "$(role "$EXEC")"
check allowed iam:PassRole "$EXEC" "$(tag iam:PassedToService cloudformation.amazonaws.com)"
check allowed s3:PutObject "arn:aws:s3:::cdk-ksnonprod-assets-$ACC-$R/asset.zip"
check allowed secretsmanager:GetSecretValue "arn:aws:secretsmanager:$R:$ACC:secret:kitchensink/sandbox/example-AbCdEf"
check allowed lambda:InvokeFunction "arn:aws:lambda:$R:$ACC:function:kitchensink-example-sandbox-Fn" "$(tag aws:ResourceTag/aws:cloudformation:stack-name kitchensink-example-sandbox)"
check allowed ecs:UpdateService "arn:aws:ecs:$R:$ACC:service/kitchensink-example-sandbox-Cluster/svc" "$(tag aws:ResourceTag/kitchensink:tier nonprod)"
check allowed logs:FilterLogEvents "arn:aws:logs:$R:$ACC:log-group:/aws/lambda/kitchensink-example-sandbox-Fn:*"
check allowed bedrock:InvokeModel "arn:aws:bedrock:$R::foundation-model/amazon.nova-micro-v1:0"
haiku="arn:aws:bedrock:$R:$ACC:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
check allowed bedrock:InvokeModel "$haiku"
check allowed bedrock:InvokeModel "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0" "$(tag bedrock:InferenceProfileArn "$haiku")"

# Non-KitchenSink resources: never allowed.
check implicitDeny cloudformation:UpdateStack "$cfn/other-app-stack/x" "$(role "$EXEC")"
check implicitDeny s3:PutObject "arn:aws:s3:::other-app-bucket/file"
check implicitDeny s3:PutObject "arn:aws:s3:::cdk-hnb659fds-assets-$ACC-$R/asset.zip"
check implicitDeny secretsmanager:GetSecretValue "arn:aws:secretsmanager:$R:$ACC:secret:other-app/key-AbCdEf"
check implicitDeny lambda:InvokeFunction "arn:aws:lambda:$R:$ACC:function:other-app-fn" "$(tag aws:ResourceTag/aws:cloudformation:stack-name other-app)"
check implicitDeny logs:FilterLogEvents "arn:aws:logs:$R:$ACC:log-group:/aws/lambda/other-app-fn:*"
check implicitDeny ecs:UpdateService "arn:aws:ecs:$R:$ACC:service/other-app-cluster/svc" "$(tag aws:ResourceTag/kitchensink:tier nonprod)"
check implicitDeny iam:CreateUser "arn:aws:iam::$ACC:user/someone"
check implicitDeny iam:PassRole "arn:aws:iam::$ACC:role/other-app-role"

# KitchenSink, but out of bounds: shared, owner-only or production.
check explicitDeny cloudformation:UpdateStack "$cfn/CDKToolkit/x" "$(role "$EXEC")"
check explicitDeny cloudformation:DeleteStack "$cfn/kitchensink-bootstrap-ksnonprod/x"
check explicitDeny cloudformation:UpdateStack "$cfn/kitchensink-data-prod/x" "$(role "$EXEC")"
check explicitDeny cloudformation:UpdateStack "$cfn/kitchensink-food-service-sandbox/x" "$(role "arn:aws:iam::$ACC:role/cdk-hnb659fds-cfn-exec-role-$ACC-$R")"
check implicitDeny cloudformation:UpdateStack "$cfn/kitchensink-food-service-sandbox/x"
check explicitDeny iam:PassRole "arn:aws:iam::$ACC:role/cdk-hnb659fds-cfn-exec-role-$ACC-$R"
check explicitDeny iam:PassRole "arn:aws:iam::$ACC:role/cdk-ksprod-cfn-exec-role-$ACC-$R"
check explicitDeny sts:AssumeRole "arn:aws:iam::$ACC:role/cdk-hnb659fds-deploy-role-$ACC-$R"
check implicitDeny lambda:InvokeFunction "arn:aws:lambda:$R:$ACC:function:kitchensink-example-prod-Fn" "$(tag aws:ResourceTag/aws:cloudformation:stack-name kitchensink-example-prod)"
check implicitDeny ecs:UpdateService "arn:aws:ecs:$R:$ACC:service/kitchensink-example-prod-Cluster/svc" "$(tag aws:ResourceTag/kitchensink:tier prod)"
check explicitDeny lambda:ListFunctions "*"
check explicitDeny rds:DeleteDBInstance "arn:aws:rds:$R:$ACC:db:example"
check explicitDeny rds-db:connect "arn:aws:rds-db:$R:$ACC:dbuser:db-EXAMPLE/identity_app"
check explicitDeny secretsmanager:GetSecretValue "arn:aws:secretsmanager:$R:$ACC:secret:DatabaseCredentialsSecret-AbCdEf"
check explicitDeny ec2:CreateTags "arn:aws:ec2:$R:$ACC:instance/i-0example" "ContextKeyName=aws:TagKeys,ContextKeyValues=kitchensink:tier,ContextKeyType=stringList"
check implicitDeny bedrock:InvokeModel "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"

[ $fail -eq 0 ] && echo "ALL CHECKS PASS" || { echo "SOME CHECKS FAILED"; exit 1; }
```

On 2026-10-29 run 8a returned `ALL CHECKS PASS` (36 checks), and IAM Access Analyzer `validate-policy` returned no
findings for the document.

### 8c. Live checks as the agent (all read-only)

```bash
export AWS_PROFILE=kitchensink-agent
aws cloudformation describe-stacks --stack-name kitchensink-data-sandbox --query 'Stacks[0].StackStatus'  # works
aws lambda list-functions        # AccessDenied (explicit deny: it returns every function's environment)
aws iam list-users               # AccessDenied
aws s3 ls                        # AccessDenied (no account-wide bucket listing)
```

Then run one sandbox `cdk diff`, and one sandbox `cdk deploy` through the local deploy loop, and check the stack's
`RoleARN` as in step 7.

## 9. Root hygiene checklist

- [ ] **MFA.** Root MFA is on (credential report: `mfa_active = true`). Add a **second** device, ideally a hardware
      security key, so losing one phone is not a lock-out. Root accepts up to 8 devices.
- [ ] **Password and email.** The root password is long, unique, and in your password manager. The root email
      account has its own MFA. Whoever controls that mailbox can reset root.
- [ ] **Alternate contacts.** Account → Alternate contacts: set Security (and Billing). AWS sends abuse and security
      notices there.
- [ ] **Root key kept, unused.** After step 6 it lives only in `[root-breakglass]`. Use it only as
      `AWS_PROFILE=root-breakglass` for an account-level emergency.
    - Optional, still "kept": set it **Inactive** (IAM → Security credentials, as root), and set it Active again when
      you need it.
    - Optional: rotate it. The credential report shows its age (`access_key_1_last_rotated`).
- [ ] **Prove it is unused.** Once a week, as `kitchensink-admin`:

    ```bash
    aws iam generate-credential-report >/dev/null; sleep 5
    aws iam get-credential-report --query Content --output text | base64 -d \
      | awk -F, 'NR==1 || $1=="<root_account>" {print $1, $5, $8, $11}'
    ```

    It prints `user`, `password_last_used`, `mfa_active` and `access_key_1_last_used_date`. Check the header line
    names those four. The two dates must stop moving after the switch. A date after the switch
    that was not you is an incident.

- [ ] **Alert on any root use.** First make sure a trail logs management events. Create one in step 1 below unless the check at the top found one. Then add a rule that emails you.
    1. CloudTrail → **Create trail**. Name: `kitchensink-account-trail`. New S3 bucket
       `kitchensink-account-trail-<ACCOUNT_ID>`. SSE-S3 encryption (a KMS key adds a monthly fee). Log file
       validation on. It applies to all Regions. Management events: **Read and Write**. No data events, no Insights.
       The first copy of management events is free. You pay only for a small amount of S3 storage.
    2. SNS (`us-east-1`) → Create topic, Standard, name `kitchensink-root-use-alert`. Add an email subscription to
       `<OWNER_EMAIL>` and accept it from the email.
    3. Create the EventBridge rule with the CLI, as `kitchensink-admin`. A plain `ENABLED` rule does not receive
       read-only management events (Get, List, Describe), so a root key used only to read sends no alert. The state
       `ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS` receives them. It needs the trail to log **Read** events, which
       step 1 sets.

        ```bash
        export AWS_PROFILE=kitchensink-admin AWS_REGION=us-east-1
        TOPIC=$(aws sns list-topics --query "Topics[?ends_with(TopicArn,':kitchensink-root-use-alert')].TopicArn" --output text)
        RULE_ARN=$(aws events put-rule --name kitchensink-root-use-alert --event-bus-name default \
          --state ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS \
          --event-pattern '{"detail-type":["AWS API Call via CloudTrail","AWS Console Sign In via CloudTrail"],"detail":{"userIdentity":{"type":["Root"]}}}' \
          --tags Key=kitchensink:access,Value=root-alert --query RuleArn --output text)
        # Let EventBridge publish to the topic, from this rule only.
        aws sns set-topic-attributes --topic-arn "$TOPIC" --attribute-name Policy --attribute-value "$(jq -nc \
          --arg t "$TOPIC" --arg r "$RULE_ARN" '{Version:"2012-10-17",Statement:[{Sid:"RootUseRule",Effect:"Allow",
          Principal:{Service:"events.amazonaws.com"},Action:"sns:Publish",Resource:$t,Condition:{ArnEquals:{"aws:SourceArn":$r}}}]}')"
        aws events put-targets --rule kitchensink-root-use-alert --targets "Id=email,Arn=$TOPIC"
        ```

        The topic policy above replaces the topic's default policy. That is fine for a new topic that only this rule uses.

    4. Test it twice. Each test must send an email within about 15 minutes.
        - Sign in to the console as root once.
        - Make one read-only call with the root key: `AWS_PROFILE=root-breakglass aws sts get-caller-identity`.

    The rule lives in `us-east-1`. It sees root sign-ins and the global services (IAM, STS, Organizations). A root API
    call made in another Region reaches only that Region's EventBridge. To catch those too, add the same rule in
    each Region you use.

    The trail records the whole account, the other application included. It only records. It changes nothing. Once
    this works, move the trail, topic, rule and topic policy into the account app (`packages/infra/global/bin/account.ts`) so they
    are code, not console clicks.

## Rollback

Each step can be undone on its own, and the root key is never removed, so the old way works again at once.

1. Restore the local files and the old default:

    ```bash
    cp -p ~/.aws/backup-2026-10-29/config ~/.aws/backup-2026-10-29/credentials ~/.aws/
    sed -i '/^export AWS_PROFILE=kitchensink-agent$/d' ~/.zshenv
    aws sso logout
    ```

2. In Identity Center (as root or `kitchensink-admin`): AWS accounts → this account → remove the two assignments.
   To remove them for good, then delete the `KitchenSinkAgent` permission set and the two users. Credentials already
   issued stay valid until their session ends (4 hours for the agent, 1 hour for admin).
3. The trail, topic and rule can stay. To remove them, delete the rule, then the topic, then the trail, then empty
   and delete the `kitchensink-account-trail-<ACCOUNT_ID>` bucket.

Nothing in this runbook touches the bootstrap stacks, the CI roles or any deployed stack, so there is nothing to roll
back there.

## What the agent role can see account-wide

These actions take no resource that AWS lets a policy scope, so they are `"Resource": "*"`. None of them can change
anything.

| Grant                                                                                       | What it can see beyond KitchenSink                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudformation:ListStacks`, `ListExports`                                                  | Every stack name, and every stack export's value.                                                                                                                 |
| `ec2:Describe…`, `route53:List…` (CDK lookups)                                              | VPC, subnet, route table, security group and hosted zone metadata.                                                                                                |
| `ecs:List…`, `ecs:DescribeTaskDefinition`                                                   | Any task definition, with its environment variables. On 2026-10-29 every ECS cluster in the account was KitchenSink's. ADR-0063 records the same residual for CI. |
| `rds:Describe*`                                                                             | Metadata of every database instance and snapshot.                                                                                                                 |
| `logs:DescribeLogGroups`, `GetQueryResults`                                                 | Log group names. Query results only for queries it started, and it can start them only on KitchenSink log groups.                                                 |
| `ce:*` reads                                                                                | Account-wide cost, the other application's included. The ruling asks for it.                                                                                      |
| `bedrock:List…`, `Get…` catalog reads, `ecr:GetAuthorizationToken`, `sts:GetCallerIdentity` | Public catalog data, a registry login token, its own identity.                                                                                                    |

Not granted at all, on purpose: `lambda:ListFunctions` (it returns every function's environment variables),
`secretsmanager:ListSecrets`, `s3:ListAllMyBuckets`, any IAM read or write, any tagging call, EventBridge, Step
Functions, SQS and SNS. When an agent really needs one, add a narrow grant then.

## Open decisions for the owner

1. **Bedrock outside the spend ceiling.** The agent role is a second Bedrock grantee. ADR-0024's $100 ceiling and
   `llmSpendGuards.test.ts` cover only roles that CDK creates, so they cannot see this one. This is the same path the
   2026-08 bake-off took under root ($60.52). The difference now: CloudTrail names the role, and only two models are
   allowed. Keep the grant, narrow it, or drop it.
2. **Production secrets.** `kitchensink/*` includes `kitchensink/prod/*`, as the ruling says. To keep agents out of
   production secrets, narrow it to `kitchensink/sandbox/*` and `kitchensink/pr-*`.
3. **SSM parameters.** The ruling did not list SSM, but CDK needs it. The policy reads only the bootstrap version and
   the non-prod `/kitchensink` paths.
4. **Agents and production deploys.** The default here is none (production goes through CI or `kitchensink-admin`).
   Allowing it means `iam:PassRole` on `cdk-ksprod-cfn-exec-role`, which can reach the production RDS instance.
5. **The root key.** Kept in `[root-breakglass]`. Also set it Inactive, or rotate it?
6. **The trail.** It records the whole account. It is required for the root-use alert.
7. **IAM users with keys.** CI no longer needs an IAM user key (ADR-0063). Deactivate any KitchenSink user key that
   the user check above shows as active but unused?
8. **Session lengths.** 12 hours for the portal (how often you sign in again), 4 hours for the agent role, 1 hour for
   admin.
9. **Code, not clicks.** The permission set and the alert are console steps here. Moving them into CDK needs a
   deployer with Identity Center rights in the management account, which no CI role has today.
