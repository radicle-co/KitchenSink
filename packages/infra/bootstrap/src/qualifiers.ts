/**
 * @module qualifiers — the ONE authority for KitchenSink's CDK bootstrap qualifiers (ADR-0065).
 *
 * The AWS account also hosts an unrelated application that bootstrapped CDK under the default qualifier
 * (`hnb659fds`) with an `AdministratorAccess` execution role. KitchenSink therefore bootstraps under qualifiers of
 * its own, so that no principal that can reach the shared roles can reach ours, and the reverse.
 *
 * CDK-free on purpose: this module is imported by CDK apps, by the access stack, by policy modules and by tests,
 * and must not drag `aws-cdk-lib` into any of them.
 *
 * ⛔ A rename is a one-way door. The qualifier is baked into every bootstrap role name, the asset bucket, the
 * toolkit stack and every synthesized template's asset references; changing one means re-bootstrapping and
 * re-deploying every stage. `qualifiers.test.ts` pins the values for that reason.
 *
 * @pattern Strategy by stage — `qualifierForStage` selects the bootstrap tier a stage deploys through
 * @pattern Registry — one table of who may assume which bootstrap role
 */

/** The qualifiers, keyed by the tier they serve. */
export const QUALIFIERS = {
    /** Sandbox and every `pr-{N}` preview. */
    nonprod: 'ksnonprod',
    /** Production stages. */
    prod: 'ksprod',
    /**
     * The stage-less account app (the CI roles themselves and the cost guardrails). Its deploy role trusts only
     * the production CI role, which GitHub only issues to a job bound to the `Production` environment on `main`.
     */
    account: 'ksaccount',
} as const;

/** One of the three qualifier strings. */
export type QualifierName = (typeof QUALIFIERS)[keyof typeof QUALIFIERS];

/**
 * The default qualifier, bootstrapped by the other application in this account. KitchenSink never deploys
 * through it and never re-bootstraps it; CI roles are explicitly denied it.
 */
export const DEFAULT_QUALIFIER = 'hnb659fds';

/** The rule the bootstrap template enforces on its `Qualifier` parameter (`AllowedPattern`). */
const QUALIFIER_PATTERN = /^[A-Za-z0-9_-]{1,10}$/u;

/**
 * Whether a string is a qualifier CloudFormation will accept.
 *
 * @param candidate - Any string.
 * @returns True when it matches `[A-Za-z0-9_-]{1,10}`. Pure.
 */
export function isValidQualifier(candidate: string): boolean {
    return QUALIFIER_PATTERN.test(candidate);
}

/**
 * The qualifier a stage deploys through.
 *
 * Only the exact token `prod` selects the production qualifier. Any other spelling lands on the nonprod
 * qualifier, whose execution role cannot touch production names, so a typo fails closed (AccessDenied) rather
 * than deploying production through a broad role.
 *
 * @param stage - The CDK stage (`prod`, `sandbox`, `pr-{N}`, ...).
 * @returns The qualifier. Pure.
 * @throws When the stage is empty.
 */
export function qualifierForStage(stage: string): QualifierName {
    if (stage.length === 0) {
        throw new Error('qualifierForStage: stage must be a non-empty string');
    }

    return stage === 'prod' ? QUALIFIERS.prod : QUALIFIERS.nonprod;
}

/**
 * The CloudFormation stack that holds one qualifier's bootstrap resources. Never `CDKToolkit`, which belongs
 * to the other application.
 */
export function toolkitStackName(qualifier: QualifierName): string {
    return `kitchensink-bootstrap-${qualifier}`;
}

/** The bootstrap roles a CI job may be allowed to assume. */
export const ASSUMABLE_ROLE_KINDS = ['deploy', 'file-publishing', 'image-publishing', 'lookup'] as const;

/** One of {@link ASSUMABLE_ROLE_KINDS}. */
export type AssumableRoleKind = (typeof ASSUMABLE_ROLE_KINDS)[number];

/** Every role the bootstrap stack creates. `cfn-exec` is the execution role, which only CloudFormation assumes. */
export const BOOTSTRAP_ROLE_KINDS = [...ASSUMABLE_ROLE_KINDS, 'cfn-exec'] as const;

/** One of {@link BOOTSTRAP_ROLE_KINDS}. */
export type BootstrapRoleKind = (typeof BOOTSTRAP_ROLE_KINDS)[number];

/** Inputs to {@link bootstrapRoleArn}. */
export interface BootstrapRoleArnInput {
    readonly account: string;
    readonly region: string;
    readonly qualifier: QualifierName;
    readonly kind: BootstrapRoleKind;
}

/**
 * The ARN of a bootstrap role, spelled the way the bootstrap template names it.
 *
 * @returns The ARN. Pure.
 */
export function bootstrapRoleArn(input: BootstrapRoleArnInput): string {
    const { account, region, qualifier, kind } = input;

    return `arn:aws:iam::${account}:role/cdk-${qualifier}-${kind}-role-${account}-${region}`;
}

/** The GitHub Actions role tiers (mirrors `GITHUB_OIDC_TIERS` in `GithubActionsAccessStack`). */
export const CI_TIERS = ['nonprod', 'prod-read', 'prod'] as const;

/** One of {@link CI_TIERS}. */
export type CiTier = (typeof CI_TIERS)[number];

/**
 * The ARN of a GitHub Actions CI role.
 *
 * @returns The ARN, which is also what `aws:PrincipalArn` carries for a session of that role. Pure.
 */
export function ciRoleArn(account: string, tier: CiTier): string {
    return `arn:aws:iam::${account}:role/kitchensink-gha-${tier}`;
}

/**
 * Which CI tiers each bootstrap role trusts, per qualifier.
 *
 * `image-publishing` mirrors `file-publishing`: no docker assets exist (a guard asserts it), so no CI role is
 * granted `sts:AssumeRole` on it, and the trust is what stays if one is ever added deliberately. The execution
 * role is absent: CloudFormation assumes it, not a person or a job.
 *
 * Only the production role reaches the production and account qualifiers. The read-only production role reaches
 * the production LOOKUP role and nothing else.
 */
export const BOOTSTRAP_TRUST: Readonly<Record<QualifierName, Readonly<Record<AssumableRoleKind, readonly CiTier[]>>>> =
    {
        ksnonprod: {
            deploy: ['nonprod'],
            'file-publishing': ['nonprod'],
            'image-publishing': ['nonprod'],
            lookup: ['nonprod'],
        },
        ksprod: {
            deploy: ['prod'],
            'file-publishing': ['prod'],
            'image-publishing': ['prod'],
            lookup: ['prod', 'prod-read'],
        },
        ksaccount: {
            deploy: ['prod'],
            'file-publishing': ['prod'],
            'image-publishing': ['prod'],
            lookup: ['prod'],
        },
    };

/**
 * The CloudFormation stack names each qualifier may deploy, as IAM `StringLike` patterns.
 *
 * The nonprod and prod sets must stay DISJOINT: `manifestCoverage.test.ts` judges every stack name the apps
 * synthesize against both lists, in both directions. The patterns end in the stage token on purpose:
 * `kitchensink-*-pr-*` cannot match `...-prod` because `pr-` needs a hyphen after the `r`.
 *
 * The account qualifier lists EXACT names. A new account-scoped stack must be added here deliberately.
 */
export const STACK_NAME_PATTERNS: Readonly<Record<QualifierName, readonly string[]>> = {
    ksnonprod: ['kitchensink-*-sandbox', 'kitchensink-*-pr-*'],
    ksprod: ['kitchensink-*-prod'],
    ksaccount: ['kitchensink-cost-guardrails', 'kitchensink-github-actions-access'],
};

/**
 * The patterns CloudFormation's `aws:cloudformation:stack-name` resource tag is judged against. A NESTED stack's
 * name is `<parent>-<LogicalId>-<hash>`, so it no longer ends in the stage token; these patterns therefore allow
 * a suffix. They are used for tag conditions only, never for the deploy role's stack ARNs.
 *
 * The stage token is matched as a whole hyphen-delimited word (`-prod` or `-prod-*`, never the prefix `-prod*`),
 * so a service whose name merely contains it (`x-product-search`) is not claimed by the wrong tier. A glob cannot go
 * further: a service named with the word `prod`, `sandbox` or `pr` as a token is ambiguous and is excluded by naming
 * rule (`qualifiers.test.ts` states it).
 */
export const STACK_TAG_PATTERNS: Readonly<Record<QualifierName, readonly string[]>> = {
    ksnonprod: ['kitchensink-*-sandbox', 'kitchensink-*-sandbox-*', 'kitchensink-*-pr-*'],
    ksprod: ['kitchensink-*-prod', 'kitchensink-*-prod-*'],
    ksaccount: STACK_NAME_PATTERNS.ksaccount,
};

/**
 * The tag every KitchenSink resource carries and the execution role authorizes by (ADR-0065).
 *
 * It replaces CloudFormation's `aws:cloudformation:stack-name`, which CloudFormation does not put on ACM
 * certificates, ECS task definitions and services, DynamoDB tables, CloudFront distributions and some older SQS
 * queues. App-level user tags DO reach those resources, so an app-level tag is the one ownership signal that holds
 * for every type. ⛔ `Environment` is never used to authorize: the other application in the account sets it too.
 */
export const TIER_TAG_KEY = 'kitchensink:tier';

/** The value the tier tag takes, one per qualifier. */
export type TierTagValue = 'nonprod' | 'prod' | 'account';

const TIER_TAG_VALUES: Readonly<Record<QualifierName, TierTagValue>> = {
    ksnonprod: 'nonprod',
    ksprod: 'prod',
    ksaccount: 'account',
};

/**
 * The tier tag value of a qualifier.
 *
 * @returns `nonprod`, `prod` or `account`. Pure.
 */
export function tierTagValue(qualifier: QualifierName): TierTagValue {
    return TIER_TAG_VALUES[qualifier];
}

/**
 * The tier tag value a CDK app applies for its stage, by the same rule as {@link qualifierForStage}: only the exact
 * token `prod` is `prod`, so a typo fails closed onto the tier whose execution role cannot touch production.
 *
 * @throws When the stage is empty.
 * @returns The value for `Tags.of(app).add(TIER_TAG_KEY, ...)`. Pure.
 */
export function tierTagValueForStage(stage: string): TierTagValue {
    return tierTagValue(qualifierForStage(stage));
}

/** The tier tag value of the stage-less account app (`bin/account.ts`). */
export function accountTierTagValue(): TierTagValue {
    return tierTagValue(QUALIFIERS.account);
}

/** The name of one customer-managed policy that makes up a qualifier's execution role. */
export const executionPolicyName = (qualifier: QualifierName, part: string): string =>
    `kitchensink-ci-exec-${qualifier}-${part}`;

/** The permissions boundary applied to every role a qualifier's stacks create. */
export const boundaryPolicyName = (qualifier: QualifierName): string => `kitchensink-ci-boundary-${qualifier}`;
