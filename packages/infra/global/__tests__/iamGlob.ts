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
