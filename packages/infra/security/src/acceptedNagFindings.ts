// ⚠️ DELIBERATE — see docs/architecture/decisions/0013-cdk-nag-advisory-iac-security-linting.md.
//
// THE cdk-nag suppression register: every finding this repository has reviewed and ACCEPTED, with the
// justification a reviewer needs in order to disagree.
//
// ⛔ A SUPPRESSION IS A TEMPLATE CHANGE, not an annotation. `NagSuppressions` writes
// `Metadata.cdk_nag.rules_to_suppress` into the CloudFormation resource (ADR-0013, verified — and pinned by
// `__tests__/acceptedNagFindings.test.ts` → 'writes cdk_nag suppression metadata into the template').
// Prod template stability is what ADR-0002 and ADR-0008 stake data safety on, so adding an entry here is a
// reviewed change to production infrastructure and the prod-template parity suites
// (`@kitchensink/infra-global/__tests__/cdk-nag-{template-parity,synth.integration}.test.ts`) name the
// expected suppressions explicitly. If your change makes one of those suites fail, that is the control
// working — update the expectation deliberately, do not delete the assertion.
//
// Patterns: a Registry of accepted findings (one authoritative justification per decision, reused wherever
// the same decision applies), plus one Adapter (`acceptNagFindings`) over cdk-nag's `NagSuppressions` so
// every suppression in the repo goes through a single, greppable, testable seam.
//
// ## Why the justification lives here and the application lives at the construct
//
// The justification is ONE piece of knowledge. ECS2 is accepted on five task definitions across three CDK
// apps; SQS4-style decisions recur likewise. Re-typing the reasoning at each call site would let five copies
// drift until nobody knows which is current. So the reason is defined once, here.
//
// Application, by contrast, is deliberately NOT centralised: `acceptNagFindings(bucket, …)` takes the
// construct, never a string path. `NagSuppressions.addResourceSuppressionsByPath` would put
// `'Global-prod/Data-prod/MediaBucket/Resource'` in a second file, where renaming the construct silently
// stops the suppression matching (and, for stage-templated paths, requires re-deriving the path per stage).
// Passing the object makes a rename a compile error.
import { NagSuppressions } from 'cdk-nag';
import type { IConstruct } from 'constructs';

/** One reviewed, accepted cdk-nag finding. */
export interface AcceptedNagFinding {
    /** The rule this accepts, e.g. `AwsSolutions-EC23`. */
    readonly id: string;
    /**
     * Why the finding is accepted. Must be checkable rather than assertive: cite the ADR, the verified
     * property, or the mechanism that makes the flagged control unnecessary. cdk-nag rejects a reason under
     * 10 characters at synth time; this register's own suite demands a substantially longer one, because
     * the reason is the entire value of a suppression.
     */
    readonly reason: string;
    /**
     * cdk-nag's fine-grained filter for rules that report per finding-detail (IAM4/IAM5): an exact detail
     * string such as `'Resource::*'`, or `{ regex: '/…/g' }` when the detail embeds a per-stage value.
     *
     * ⚠️ SET THIS whenever the rule is granular. Omitting it accepts EVERY occurrence of the rule on the
     * construct forever — so a role with a scoped, reviewed wildcard today would silently keep passing if
     * someone later added `resources: ['*']` to it. A narrow `appliesTo` keeps the accepted finding accepted
     * and leaves anything new reporting.
     */
    readonly appliesTo?: readonly (string | { readonly regex: string })[];
}

/**
 * The closed set of accepted findings. Keys read as the DECISION, not the rule number, so a call site says
 * what it is claiming rather than which lint it is silencing.
 *
 * The key set is pinned by `__tests__/acceptedNagFindings.test.ts` → 'pins the exact set of accepted
 * findings'. That is deliberate friction: a new suppression cannot land without a reviewer seeing the list
 * change.
 */
export const AcceptedNagFindings = {
    /**
     * `AwsSolutions-EC23` on the shared ALB's security group. The ALB is internet-facing BY DESIGN — it is
     * the public front door for identity/food/recipe (ADR-0003), so `0.0.0.0/0` on :80 and :443 is the
     * resource doing its job, not a misconfiguration.
     */
    PUBLIC_ALB_INGRESS_IS_THE_INGRESS_BOUNDARY: [
        {
            id: 'AwsSolutions-EC23',
            reason:
                'ADR-0003: this is the security group of the single SHARED INTERNET-FACING ALB per stage -- the ' +
                'public front door for identity, food and recipe. Public ingress on :80/:443 is the resource ' +
                'fulfilling its purpose; the trust boundary is not this SG but (a) the host-based listener rules, ' +
                'whose default action is a fixed 404 so an unmatched host reaches no service, and (b) Clerk ' +
                'session-token verification with anchored azp enforcement in the services behind it. The tasks ' +
                'themselves are NOT open: serviceSecurityGroup admits :3000 only from this SG.',
        },
    ],

    /**
     * `AwsSolutions-APIG4` + `AwsSolutions-COG4` on `POST /api/v1/webhooks/users`. Unauthenticated at the
     * gateway ON PURPOSE: Clerk signs the request and the Lambda verifies that signature itself.
     */
    CLERK_WEBHOOK_VERIFIES_ITS_OWN_SIGNATURE: [
        {
            id: 'AwsSolutions-APIG4',
            reason:
                'Deliberate: this route receives Clerk webhooks, which are authenticated by an HMAC signature ' +
                '(svix) that the Lambda verifies against the signing secret BEFORE doing any work -- see ' +
                'src/handlers/identityWebhook.ts. A gateway authorizer cannot be used because Clerk is a ' +
                'third-party caller that presents no AWS SigV4 credential and no Clerk session token; adding a ' +
                'gateway authorizer would make the endpoint unreachable, not more secure. Authorization is ' +
                'present, it is just enforced one hop later, inside the function.',
        },
        {
            id: 'AwsSolutions-COG4',
            reason:
                'Deliberate: a Cognito user-pool authorizer is structurally inapplicable. This repository has no ' +
                'Cognito user pool at all -- identity is Clerk (see CLAUDE.md, Authentication architecture) -- and ' +
                'the caller is Clerk itself, not an end user with a pool token. The request is authenticated by ' +
                'svix HMAC signature verification inside the handler.',
        },
    ],

    /**
     * `AwsSolutions-ECS2` on every Fargate task definition. Plaintext container `Environment` entries hold
     * only non-secret material; real secrets go through Secrets Manager (`Secrets`, not `Environment`).
     */
    TASK_ENVIRONMENT_HOLDS_NO_SECRET: [
        {
            id: 'AwsSolutions-ECS2',
            reason:
                'Verified against the synthesized prod templates for all five task definitions: every plaintext ' +
                'Environment entry is non-secret -- literals (NODE_ENV, PORT, STAGE, DB_USERNAME=food_app/' +
                'recipe_app under RDS IAM auth), CloudFormation ImportValue/Ref of hostnames, bucket names, ARNs ' +
                'and queue URLs, a Sentry DSN (a write-only ingestion key, embedded in client bundles by design) ' +
                'and CLERK_JWT_KEY / *_SERVICE_PRINCIPAL_JWT_KEY, which are PUBLIC signing keys used for ' +
                'networkless verification. Every actual secret is injected via ecs.Secret.fromSecretsManager and ' +
                'appears under Secrets, never Environment: DB_PASSWORD, DB_USERNAME (identity), ' +
                'AUTH_PUBLISHABLE_KEY, USDA_API_KEY. THE INVARIANT THIS SUPPRESSION DEPENDS ON: nothing secret ' +
                'may be added to Environment, and nothing secret may be written to the SSM String parameters ' +
                'these entries Ref (an SSM String value is resolved into the template at deploy time). Put new ' +
                'secrets in Secrets Manager and inject them via Secrets.',
        },
    ],

    /**
     * `AwsSolutions-APIG3` on the webhooks REST API stage. A WAFv2 web ACL is an enterprise control with a
     * real monthly floor, not proportionate to a single signature-verified webhook route yet.
     */
    REST_API_EDGE_CONTROLS_NOT_PROPORTIONATE: [
        {
            id: 'AwsSolutions-APIG3',
            reason:
                'Cost-proportionality decision, consistent with the posture ADR-0007 and ADR-0008 establish. A ' +
                'WAFv2 web ACL costs about USD 5/month per ACL plus 1/month per rule and 0.60 per million ' +
                'requests -- a material fraction of the account budget guardrail (300/month, ADR-0008) to protect ' +
                'ONE route whose only caller is Clerk and which rejects anything without a valid svix HMAC ' +
                'signature before doing work. The attack surface a WAF would cover here is a signature check. ' +
                'REVISIT when the API exposes routes that accept untrusted user input, or on first evidence of ' +
                'abuse; the finding is accepted as deferred, not as wrong.',
        },
    ],

    /**
     * `AwsSolutions-CFR1` + `AwsSolutions-CFR2` on the sandbox router distribution. Geo restrictions and WAF
     * are enterprise edge controls; the distribution is a non-prod preview router being retired (ADR-0001).
     */
    CLOUDFRONT_EDGE_CONTROLS_NOT_PROPORTIONATE: [
        {
            id: 'AwsSolutions-CFR1',
            reason:
                'Not applicable as a control: geo restriction would block legitimate viewers of a developer ' +
                'preview router, and the product has no geographic licensing or export constraint that a ' +
                'country allow/deny list would enforce. cdk-nag itself words this rule as "may require", i.e. ' +
                'it is a prompt to decide rather than a defect. Decision recorded: not required.',
        },
        {
            id: 'AwsSolutions-CFR2',
            reason:
                'Cost-proportionality decision, same arithmetic as AwsSolutions-APIG3 above: a WAFv2 web ACL is ' +
                'about USD 5/month per ACL plus per-rule and per-request charges against a 300/month account ' +
                'budget (ADR-0008). This distribution is the SANDBOX preview router, which serves no production ' +
                'traffic and which ADR-0001 records as being retired for previews in favour of resolving ' +
                'pr-{N}.sandbox.commise.app directly to Vercel. Adding a WAF to infrastructure scheduled for ' +
                'deletion is spend without a return. REVISIT if the router ever fronts production.',
        },
    ],

    /**
     * `AwsSolutions-SMG4` on `MigrationPlanSecret`. Not a credential: it holds a static SQL bootstrap
     * string and an owner label, so there is nothing rotation could mean.
     */
    MIGRATION_PLAN_SECRET_HOLDS_NO_CREDENTIAL: [
        {
            id: 'AwsSolutions-SMG4',
            reason:
                'Structurally inapplicable: this secret is not a credential. Its entire contents are two static, ' +
                'non-sensitive values set from source -- bootstrapSql ("CREATE EXTENSION IF NOT EXISTS pg_trgm;") ' +
                'and migrationOwner ("@kitchensink/identity-service") -- see DataStack. Rotation means "replace a ' +
                'credential that may have leaked with a new one the consumer can obtain"; there is no credential ' +
                'here, no authentication path it grants, and a rotation lambda would have nothing to rotate. It ' +
                'lives in Secrets Manager only as a deploy-time carrier for the bootstrap instruction.',
        },
    ],

    /**
     * `AwsSolutions-IAM5` on the recipe-workers S3 roles, for the IRREDUCIBLE object-key wildcard. The
     * actions are narrowed to exactly what the handlers call; the `bucket/recipes/*` resource wildcard is
     * what "operate across every owner's prefix" necessarily means.
     */
    ERASURE_WORKER_OBJECT_PREFIX_WILDCARD: [
        {
            id: 'AwsSolutions-IAM5',
            // Scoped, NOT role-wide. Only an object-level wildcard under the `recipes/` key root is
            // accepted; the bucket name varies per stage, hence a regex rather than a literal detail. Any
            // OTHER wildcard on these roles -- `Resource::*`, an `Action::s3:*`, a wildcard outside
            // `recipes/` -- keeps reporting, which is the point: these are the roles that delete user data.
            // ⚠️ The partition segment must be matched with `.*`, NOT `[^:]+`. CDK renders it as the
            // `<AWS::Partition>` pseudo-parameter for `arnForObjects()`, and that string CONTAINS COLONS —
            // so a colon-excluding class matches a hardcoded `arn:aws:...` (and passes a naive unit test)
            // while silently failing against every real stack. Measured. The security-relevant anchors are
            // `:s3:::` (S3 only) and the exact `/recipes/*` ending; the test below pins the real shape.
            appliesTo: [{ regex: String.raw`/^Resource::arn:.*:s3:::.*\/recipes\/\*$/g` }],
            reason:
                'Irreducible resource wildcard, with the actions narrowed to the exact API calls the handlers ' +
                "make. These roles operate over EVERY owner's objects (GDPR erasure sweeps each removed " +
                "recipe's prefix; the version-archive worker writes one snapshot per version), so the ownerId " +
                'and recipeId path segments cannot be enumerated at synth time and an object-level statement ' +
                'must end in a wildcard. Two things make that wildcard bounded rather than open: the resource is ' +
                'scoped to the authoritative recipes/ key prefix (@kitchensink/recipe-core recipeObjectKeys, ' +
                'which pins the containment invariant), so these roles cannot touch objects outside the recipe ' +
                'media subtree; and the actions are the exact set the code calls -- s3:ListBucket (ListObjectsV2) ' +
                'plus s3:DeleteObject (DeleteObjects) for the erasure paths, s3:PutObject for the archive ' +
                'writer -- with no s3:GetObject*, no s3:*Version, and no s3:Abort*, replacing CDK grantRead/' +
                'grantDelete/grantPut, whose wildcards granted far more than the handlers use.',
        },
    ],
    VERIFICATION_BEDROCK_MODEL_WILDCARD: [
        {
            id: 'AwsSolutions-IAM5',
            // Scoped to Bedrock foundation models only. `Resource::*`, an `Action::bedrock:*`, or a wildcard
            // on any other service keeps reporting — which is the point: this is the ONLY role in the account
            // that may spend money on inference (ADR-0024 layer 4b), and the guard test that asserts it is a
            // set-equality check over the whole infra tree, not a review comment.
            appliesTo: [{ regex: String.raw`/^Resource::arn:.*:bedrock:.*:foundation-model\/\*$/g` }],
            reason:
                'Irreducible resource wildcard on the ONE Bedrock caller (ADR-0024). The model id is read from ' +
                'an SSM parameter at run time -- deliberately, because R23 requires the ceiling and the model to ' +
                'be changeable mid-incident without redeploying this stack, and KTD-4 requires the bake-off to ' +
                'swap models without a code change -- so the exact model ARN cannot be known at synth time. ' +
                'Three things bound it: the resource is scoped to bedrock foundation models in this partition ' +
                'and region (never Resource::*, and never another service); the action list is the single call ' +
                'the code makes, bedrock:InvokeModel, with InvokeModelWithResponseStream deliberately absent ' +
                'because the gate never streams and a streamed response would defeat its single-response ' +
                'settlement; and spend is bounded independently of IAM by the reserve-then-settle counter, ' +
                'which refuses the call before it is made. The real control against a SECOND caller is that ' +
                'this grant exists exactly once, asserted by bedrockInvokeGrantees.test.ts.',
        },
    ],
} as const satisfies Readonly<Record<string, readonly AcceptedNagFinding[]>>;

export interface AcceptNagFindingsOptions {
    /**
     * Also apply to child `CfnResource`s. REQUIRED for rules that land on a construct CDK generates rather
     * than one you named — notably IAM4/IAM5, which report against `<Role>/DefaultPolicy/Resource`.
     */
    readonly applyToChildren?: boolean;
}

/**
 * Record that a reviewed finding from {@link AcceptedNagFindings} is accepted on this construct.
 *
 * The single seam through which every cdk-nag suppression in the repository is applied, so "what do we
 * suppress, and where" is one grep. Takes the construct rather than a path string: a renamed construct then
 * fails to compile instead of silently ceasing to match.
 *
 * @param construct - The construct (or constructs) the finding was reported against.
 * @param findings - An entry from {@link AcceptedNagFindings}. Not free text, by design — the justification
 *   is registry knowledge, not call-site knowledge.
 * @param options - {@link AcceptNagFindingsOptions}.
 * @sideEffect Writes `Metadata.cdk_nag.rules_to_suppress` into the synthesized CloudFormation resource —
 *   i.e. this MUTATES the template. See the file header.
 */
export function acceptNagFindings(
    construct: IConstruct | IConstruct[],
    findings: readonly AcceptedNagFinding[],
    options: AcceptNagFindingsOptions = {},
): void {
    NagSuppressions.addResourceSuppressions(
        construct,
        findings.map((finding) => ({
            id: finding.id,
            reason: finding.reason,
            ...(finding.appliesTo ? { appliesTo: [...finding.appliesTo] } : {}),
        })),
        options.applyToChildren ?? false,
    );
}
