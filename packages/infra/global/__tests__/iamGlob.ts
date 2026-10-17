/**
 * IAM's wildcard semantics, for guards that judge a synthesized policy against real resource names.
 *
 * - **Resources** are matched case-sensitively; `*` is any run of characters (including none, `/` and `:`), `?`
 *   is exactly one, and everything else is literal.
 * - **Actions** are matched the same way but case-insensitively, as IAM matches action names.
 *
 * {@link policyAdmits} answers "could this policy let `action` reach `resource`?" with CONDITIONS IGNORED: a
 * conditioned Allow counts as admitting and a conditioned Deny is not counted on to refuse. That is the point —
 * a guard built on it proves a refusal comes from a resource pattern, never from a tag a resource may not carry.
 *
 * @pattern Specification — one predicate over (statements, action, resource), shared by every boundary guard
 */

/** One statement as the synthesized template spells it: each field a string or a list. */
export interface PolicyStatementJson {
    readonly Sid?: string;
    readonly Effect: string;
    readonly Action?: string | readonly string[];
    readonly NotAction?: string | readonly string[];
    readonly Resource?: string | readonly string[];
    readonly NotResource?: string | readonly string[];
    readonly Condition?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const globToRegExp = (pattern: string, flags: string): RegExp =>
    new RegExp(
        `^${[...pattern]
            .map((character) => {
                if (character === '*') {
                    return '.*';
                }

                if (character === '?') {
                    return '.';
                }

                return character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
            })
            .join('')}$`,
        flags,
    );

/** Whether an IAM resource pattern matches `resource`. Case-sensitive. */
export const iamResourceMatches = (pattern: string, resource: string): boolean =>
    globToRegExp(pattern, 'su').test(resource);

/** Whether an IAM action pattern matches `action`. Case-insensitive, as IAM compares action names. */
export const iamActionMatches = (pattern: string, action: string): boolean => globToRegExp(pattern, 'isu').test(action);

const listOf = (value: string | readonly string[] | undefined): readonly string[] =>
    value === undefined ? [] : typeof value === 'string' ? [value] : value;

const coversAction = (statement: PolicyStatementJson, action: string): boolean =>
    statement.NotAction === undefined
        ? listOf(statement.Action).some((pattern) => iamActionMatches(pattern, action))
        : !listOf(statement.NotAction).some((pattern) => iamActionMatches(pattern, action));

const coversResource = (statement: PolicyStatementJson, resource: string): boolean =>
    statement.NotResource === undefined
        ? listOf(statement.Resource).some((pattern) => iamResourceMatches(pattern, resource))
        : !listOf(statement.NotResource).some((pattern) => iamResourceMatches(pattern, resource));

/**
 * Whether `statements` could let `action` reach `resource`, ignoring conditions (see the module comment).
 *
 * @throws Error if an Allow uses `NotAction` or `NotResource`: such a grant reaches everything it does not name,
 * and a guard that quietly evaluated it would be judging a different policy from the one it claims to.
 */
export function policyAdmits(statements: readonly PolicyStatementJson[], action: string, resource: string): boolean {
    for (const statement of statements) {
        if (
            statement.Effect === 'Allow' &&
            (statement.NotAction !== undefined || statement.NotResource !== undefined)
        ) {
            throw new Error(
                `policyAdmits cannot evaluate an Allow with NotAction/NotResource: ${JSON.stringify(statement)}`,
            );
        }
    }

    const matches = (statement: PolicyStatementJson): boolean =>
        coversAction(statement, action) && coversResource(statement, resource);
    const denied = statements.some(
        (statement) => statement.Effect === 'Deny' && statement.Condition === undefined && matches(statement),
    );

    return !denied && statements.some((statement) => statement.Effect === 'Allow' && matches(statement));
}

const RESOURCE_TAG_PREFIX = 'aws:ResourceTag/';

/** Whether one condition block holds for a resource carrying `tags`. Throws on anything it cannot judge. */
function conditionHolds(
    operator: string,
    block: Readonly<Record<string, unknown>>,
    tags: Readonly<Record<string, string>>,
): boolean {
    return Object.entries(block).every(([key, expected]) => {
        if (!key.startsWith(RESOURCE_TAG_PREFIX) || !['StringEquals', 'StringLike', 'Null'].includes(operator)) {
            throw new Error(`policyAdmitsTagged cannot evaluate ${operator} on ${key}`);
        }

        const actual = tags[key.slice(RESOURCE_TAG_PREFIX.length)];
        const values = listOf(expected as string | readonly string[]);

        if (operator === 'Null') {
            return values.some((value) => (value === 'true') === (actual === undefined));
        }

        if (actual === undefined) {
            return false;
        }

        return operator === 'StringEquals'
            ? values.includes(actual)
            : values.some((pattern) => iamResourceMatches(pattern, actual));
    });
}

const conditionsHold = (statement: PolicyStatementJson, tags: Readonly<Record<string, string>>): boolean =>
    Object.entries(statement.Condition ?? {}).every(([operator, block]) => conditionHolds(operator, block, tags));

/**
 * Like {@link policyAdmits}, but EVALUATES `aws:ResourceTag/*` conditions (`StringEquals`, `StringLike`, `Null`)
 * against `tags`, the tags the resource carries. A condition on an absent tag is not met, so an Allow that needs a
 * tag admits nothing untagged, and a Deny that keys on a tag never applies to a resource lacking it.
 *
 * @throws Error on any other operator or condition key — the guard must not judge a policy it cannot read — and,
 * as {@link policyAdmits}, on an Allow with `NotAction`/`NotResource`.
 */
export function policyAdmitsTagged(
    statements: readonly PolicyStatementJson[],
    action: string,
    resource: string,
    tags: Readonly<Record<string, string>>,
): boolean {
    const applies = (statement: PolicyStatementJson, effect: string): boolean => {
        if (statement.Effect !== effect) {
            return false;
        }

        if (effect === 'Allow' && (statement.NotAction !== undefined || statement.NotResource !== undefined)) {
            throw new Error(
                `policyAdmitsTagged cannot evaluate an Allow with NotAction/NotResource: ${JSON.stringify(statement)}`,
            );
        }

        return (
            coversAction(statement, action) && coversResource(statement, resource) && conditionsHold(statement, tags)
        );
    };

    return !statements.some((s) => applies(s, 'Deny')) && statements.some((s) => applies(s, 'Allow'));
}
