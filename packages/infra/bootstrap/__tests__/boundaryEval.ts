/**
 * A small evaluator for the boundary guards: does a policy document ALLOW an (action, resource) pair in a stated
 * request context?
 *
 * It exists because `policyEval.anyAllow` ignores conditions, and the boundary now carries two kinds of conditioned
 * Allow (a CloudFormation stack-name tag on a secret or an instance, an ECS cluster on `RunTask`). A guard that
 * ignored them would call an armoury secret reachable through the tag rule, or would call a kitchensink secret
 * reachable without the tag; both are wrong. So the context is explicit, and a condition key the context does not
 * hold is NOT satisfied (IAM's own rule for a missing key under `StringLike`).
 *
 * Supported operators are exactly those the boundary uses: `StringLike`, `StringEquals`, `ArnLike`.
 */
import { iamLike } from '../src/iamPattern.js';
import type { Condition, PolicyDocument, Statement } from '../src/policyDocument.js';

/** The request context: condition key -> value. */
export type RequestContext = Readonly<Record<string, string>>;

/**
 * Whether two IAM glob patterns can match a common string (`*` is any run, `?` is one character).
 *
 * A role's own policy may name a resource with a wildcard (`stack/kitchensink-*`); what matters is that the boundary
 * leaves some of it reachable, and that a CONCRETE name is inside. For a concrete name this is an exact match.
 */
export function patternsOverlap(left: string, right: string): boolean {
    const memo = new Map<string, boolean>();

    const walk = (i: number, j: number): boolean => {
        const key = `${i}:${j}`;
        const known = memo.get(key);

        if (known !== undefined) {
            return known;
        }

        let result: boolean;

        if (i === left.length && j === right.length) {
            result = true;
        } else if (left[i] === '*') {
            result = walk(i + 1, j) || (j < right.length && walk(i, j + 1));
        } else if (right[j] === '*') {
            result = walk(i, j + 1) || (i < left.length && walk(i + 1, j));
        } else if (i < left.length && j < right.length) {
            result = (left[i] === right[j] || left[i] === '?' || right[j] === '?') && walk(i + 1, j + 1);
        } else {
            result = false;
        }

        memo.set(key, result);

        return result;
    };

    return walk(0, 0);
}

const asList = (value: string | readonly string[]): readonly string[] => (typeof value === 'string' ? [value] : value);

/** Whether every condition of a statement holds in the context. A key the context lacks fails the condition. */
function conditionHolds(condition: Condition | undefined, context: RequestContext): boolean {
    if (condition === undefined) {
        return true;
    }

    return Object.entries(condition).every(([operator, keys]) => {
        if (!['StringLike', 'StringEquals', 'ArnLike'].includes(operator)) {
            throw new Error(`boundaryEval does not evaluate the condition operator ${operator}`);
        }

        return Object.entries(keys).every(([key, expected]) => {
            const actual = context[key];

            if (actual === undefined) {
                return false;
            }

            return asList(expected).some((pattern) =>
                operator === 'StringEquals' ? pattern === actual : iamLike(pattern, actual),
            );
        });
    });
}

const actionCovered = (statement: Statement, action: string): boolean =>
    statement.Action.some((pattern) => iamLike(pattern.toLowerCase(), action.toLowerCase()));

/**
 * An Allow reaches a resource when the two patterns overlap (the role's own wildcard may be wider than the boundary,
 * which then cuts it down). A Deny must COVER the resource to count: a Deny that only overlaps a wildcard resource
 * removes part of it, not the whole, so crediting it would hide a working grant.
 */
const resourceCovered = (statement: Statement, resource: string, resourceIsPattern: boolean): boolean =>
    statement.Resource.some((pattern) =>
        statement.Effect === 'Allow' && resourceIsPattern
            ? patternsOverlap(pattern, resource)
            : iamLike(pattern, resource),
    );

/**
 * Whether the document allows the pair in the context: an Allow applies and no Deny does.
 *
 * `resourceIsPattern` is true when the resource is itself a role policy's wildcard pattern, in which case an Allow
 * reaches it when the two patterns overlap; a CONCRETE resource (the default) is matched literally, so a `*` in an ARN
 * (a log group's `:*` suffix) is a character, not a wildcard.
 */
export function allows(
    document: PolicyDocument,
    action: string,
    resource: string,
    context: RequestContext = {},
    resourceIsPattern = false,
): boolean {
    const applies = (statement: Statement): boolean =>
        actionCovered(statement, action) &&
        resourceCovered(statement, resource, resourceIsPattern) &&
        conditionHolds(statement.Condition, context);

    const allowed = document.Statement.some((statement) => statement.Effect === 'Allow' && applies(statement));
    const denied = document.Statement.some((statement) => statement.Effect === 'Deny' && applies(statement));

    return allowed && !denied;
}
