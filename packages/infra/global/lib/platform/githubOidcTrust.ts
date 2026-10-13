/**
 * The trust policy of the GitHub Actions roles (ADR-0063), as a pure module that knows nothing about workflows,
 * CDK or IAM resources.
 *
 * A role's trust policy is what decides WHO may become it. For a role a CI job assumes through OIDC that is a
 * set of claims in GitHub's token, and the failure that matters is not a wrong claim but an ABSENT one: a
 * condition that is not written matches every token the provider issues, including those of any other
 * repository on GitHub. So this module does two jobs, and keeps them apart.
 *
 * - `githubTrustConditions` BUILDS the conditions a tier is defined by.
 * - `assertSafeTrust` JUDGES a set of conditions and throws on any that could admit a token this tier
 *   must refuse. The builder runs its own output through the judge, so a loosened builder cannot ship; and the
 *   judge is exported so its refusals are a table in a test rather than an inference from the builder.
 *
 * ## The subject has two spellings, and both are trusted
 *
 * GitHub's `sub` claim is `repo:{owner}/{repo}:…` today and may become
 * `repo:{owner}@{owner_id}/{repo}@{repo_id}:…`, and an owner can opt in per repository. Trusting only the
 * classic form turns every job off the day that changes; trusting a pattern wide enough to cover both would
 * admit more than this repository. So both exact prefixes are written out, and the numeric ids are ALSO
 * required as separate claims, so a repository that is deleted and re-created under the same name does not
 * inherit the trust.
 *
 * @pattern Policy — the rule for what a tier may trust is one function, not a convention at each call site
 * @pattern Factory — a tier in, its trust conditions out
 * @see docs/architecture/decisions/0063-github-actions-aws-oidc-roles.md
 */

/** The three trust tiers. Named ONCE: the stack's registry is a `Record` over this union. */
export const GITHUB_OIDC_TIERS = ['nonprod', 'prod-read', 'prod'] as const;

/** One of {@link GITHUB_OIDC_TIERS}. */
export type GithubOidcTier = (typeof GITHUB_OIDC_TIERS)[number];

/** GitHub's OIDC issuer host, which is also the prefix of every condition key. */
export const GITHUB_OIDC_ISSUER = 'token.actions.githubusercontent.com';

/** The `aud` every token must carry, and the client id the provider is registered with. */
export const GITHUB_OIDC_AUDIENCE = 'sts.amazonaws.com';

/** The repository this account's CI belongs to. */
export const GITHUB_REPOSITORY_OWNER = 'radicle-co';
/** The repository this account's CI belongs to. */
export const GITHUB_REPOSITORY_NAME = 'KitchenSink';
/** `repository_id` of radicle-co/KitchenSink: survives a rename and is not inherited by a re-created repo. */
export const GITHUB_REPOSITORY_ID = '1203438406';
/** `repository_owner_id` of radicle-co. */
export const GITHUB_REPOSITORY_OWNER_ID = '69129769';

/** The only branch a production role trusts. */
export const PRODUCTION_REF = 'refs/heads/main';
/** The only environment the production deploy role trusts. */
export const PRODUCTION_ENVIRONMENT = 'Production';

/** The classic and the id-bearing `sub` prefixes, each ending at the colon that precedes the job context. */
const SUB_PREFIXES: readonly string[] = [
    `repo:${GITHUB_REPOSITORY_OWNER}/${GITHUB_REPOSITORY_NAME}:`,
    `repo:${GITHUB_REPOSITORY_OWNER}@${GITHUB_REPOSITORY_OWNER_ID}/${GITHUB_REPOSITORY_NAME}@${GITHUB_REPOSITORY_ID}:`,
];

/** A condition value: IAM treats an array as OR. */
type ConditionValue = string | readonly string[];

/** The two condition operators trust uses. Keys are issuer-prefixed claim names. */
export interface TrustConditions {
    readonly StringEquals?: Readonly<Record<string, ConditionValue>>;
    readonly StringLike?: Readonly<Record<string, ConditionValue>>;
}

/** The issuer-prefixed condition key of a token claim. */
export const claimKey = (claim: string): string => `${GITHUB_OIDC_ISSUER}:${claim}`;

const values = (value: ConditionValue | undefined): readonly string[] =>
    value === undefined ? [] : typeof value === 'string' ? [value] : value;

/**
 * Builds the trust conditions a tier is defined by, and refuses to return any the judge would refuse.
 *
 * - `nonprod`: any job of this repository (pull requests, branches, environments). The non-prod role cannot
 *   require an environment, because teardown jobs deliberately bind none.
 * - `prod-read`: a job on `main` that binds no environment.
 * - `prod`: a job bound to the `Production` environment, on `main`. Exact strings only, no wildcard.
 *
 * @param tier - The tier to build for.
 * @returns The conditions, to be passed to a web-identity principal.
 * @throws If the result would be unsafe, which a correct builder never does.
 */
export function githubTrustConditions(tier: GithubOidcTier): TrustConditions {
    const pinned = {
        [claimKey('aud')]: GITHUB_OIDC_AUDIENCE,
        [claimKey('repository_id')]: GITHUB_REPOSITORY_ID,
        [claimKey('repository_owner_id')]: GITHUB_REPOSITORY_OWNER_ID,
    };

    const conditions: TrustConditions = (() => {
        switch (tier) {
            case 'nonprod':
                return {
                    StringEquals: pinned,
                    StringLike: { [claimKey('sub')]: SUB_PREFIXES.map((prefix) => `${prefix}*`) },
                };
            case 'prod-read':
                return {
                    StringEquals: {
                        ...pinned,
                        [claimKey('ref')]: PRODUCTION_REF,
                        [claimKey('sub')]: SUB_PREFIXES.map((prefix) => `${prefix}ref:${PRODUCTION_REF}`),
                    },
                };
            case 'prod':
                return {
                    StringEquals: {
                        ...pinned,
                        [claimKey('ref')]: PRODUCTION_REF,
                        [claimKey('environment')]: PRODUCTION_ENVIRONMENT,
                        [claimKey('sub')]: SUB_PREFIXES.map(
                            (prefix) => `${prefix}environment:${PRODUCTION_ENVIRONMENT}`,
                        ),
                    },
                };
        }
    })();

    assertSafeTrust(tier, conditions);

    return conditions;
}

/**
 * Throws unless `conditions` admit only the tokens `tier` is meant for.
 *
 * Refuses: a missing or wrong `aud`, `repository_id` or `repository_owner_id`; no `sub`, or any `sub` value
 * that is not one of the two exact repository prefixes (so `repo:*`, `repo:radicle-co/*`, `*`, another
 * repository and a prefix lookalike all fail); and, for the production tiers, a `sub` that is wildcarded,
 * is in `StringLike`, or is not the exact context the tier is for, plus a missing or wrong `ref` (and, for
 * `prod`, `environment`). `prod-read` must not name an environment at all.
 *
 * @param tier - The tier being judged.
 * @param conditions - The trust conditions to judge.
 * @throws Error naming the first rule broken.
 */
export function assertSafeTrust(tier: GithubOidcTier, conditions: TrustConditions): void {
    const equals = conditions.StringEquals ?? {};
    const like = conditions.StringLike ?? {};

    const refuse = (reason: string): never => {
        throw new Error(`Unsafe GitHub OIDC trust for tier '${tier}': ${reason}`);
    };

    const exactly = (claim: string, expected: string): void => {
        const found = values(equals[claimKey(claim)]);

        if (found.length !== 1 || found[0] !== expected) {
            refuse(`'${claim}' must be pinned by StringEquals to exactly '${expected}'`);
        }
    };

    exactly('aud', GITHUB_OIDC_AUDIENCE);
    exactly('repository_id', GITHUB_REPOSITORY_ID);
    exactly('repository_owner_id', GITHUB_REPOSITORY_OWNER_ID);

    const subs = [...values(equals[claimKey('sub')]), ...values(like[claimKey('sub')])];

    if (subs.length === 0) {
        refuse(`no 'sub' condition, which would admit a token from any repository`);
    }

    for (const sub of subs) {
        if (!SUB_PREFIXES.some((prefix) => sub.startsWith(prefix))) {
            refuse(`'sub' value '${sub}' is not scoped to ${SUB_PREFIXES.join(' or ')}`);
        }
    }

    if (tier === 'nonprod') {
        return;
    }

    if (values(like[claimKey('sub')]).length > 0) {
        refuse(`'sub' must not be a StringLike pattern`);
    }

    if (subs.some((sub) => sub.includes('*') || sub.includes('?'))) {
        refuse(`'sub' must not contain a wildcard`);
    }

    exactly('ref', PRODUCTION_REF);

    if (tier === 'prod') {
        exactly('environment', PRODUCTION_ENVIRONMENT);

        const context = `environment:${PRODUCTION_ENVIRONMENT}`;

        if (!subs.every((sub) => SUB_PREFIXES.some((prefix) => sub === `${prefix}${context}`))) {
            refuse(`'sub' must be exactly the '${context}' context`);
        }

        return;
    }

    if (equals[claimKey('environment')] !== undefined || like[claimKey('environment')] !== undefined) {
        refuse(`must not name an environment`);
    }

    const context = `ref:${PRODUCTION_REF}`;

    if (!subs.every((sub) => SUB_PREFIXES.some((prefix) => sub === `${prefix}${context}`))) {
        refuse(`'sub' must be exactly the '${context}' context`);
    }
}
