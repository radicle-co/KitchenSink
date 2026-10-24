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
import { iamLike, patternsOverlap } from '../src/iamPattern.js';
import type { Condition, PolicyDocument, Statement } from '../src/policyDocument.js';

/** The request context: condition key -> value. */
export type RequestContext = Readonly<Record<string, string>>;

const asList = (value: string | readonly string[]): readonly string[] => (typeof value === 'string' ? [value] : value);

/** Whether every condition of a statement holds in the context. A key the context lacks fails the condition. */
function conditionHolds(condition: Condition | undefined, context: RequestContext): boolean {
    if (condition === undefined) {
        return true;
    }

    return Object.entries(condition).every(([qualified, keys]) => {
        // A multi-valued key is given here as its one value. IAM: `ForAllValues` holds over an absent key (the empty
        // set), `ForAnyValue` does not.
        const [setOperator, qualifiedOperator = ''] = qualified.includes(':')
            ? qualified.split(':')
            : [undefined, qualified];
        // `…IfExists`: the condition holds when the key is absent.
        const ifExists = qualifiedOperator.endsWith('IfExists');
        const operator = ifExists ? qualifiedOperator.slice(0, -'IfExists'.length) : qualifiedOperator;

        if (
            !['StringLike', 'StringEquals', 'ArnLike'].includes(operator) ||
            (setOperator !== undefined && !['ForAllValues', 'ForAnyValue'].includes(setOperator))
        ) {
            throw new Error(`boundaryEval does not evaluate the condition operator ${qualified}`);
        }

        return Object.entries(keys).every(([key, expected]) => {
            const actual = context[key];

            if (actual === undefined) {
                return ifExists || setOperator === 'ForAllValues';
            }

            return asList(expected).some((pattern) =>
                operator === 'StringEquals' ? pattern === actual : iamLike(pattern, actual),
            );
        });
    });
}

/** The ARN service an action's resources live under, where it is not the action's own prefix. */
const ARN_SERVICE_OF_PREFIX: Readonly<Record<string, string>> = {
    'cloudfront-keyvaluestore': 'cloudfront',
    sts: 'iam',
};

/**
 * An action only ever meets a resource of its own service, so one statement can list resources of several services
 * (the boundary does, to save its size budget) without granting any action on another service's resource.
 */
function actionMeetsResource(action: string, resourcePattern: string): boolean {
    const prefix = action.split(':')[0]?.toLowerCase() ?? '';

    return (
        !resourcePattern.startsWith('arn:') ||
        resourcePattern.split(':')[2] === (ARN_SERVICE_OF_PREFIX[prefix] ?? prefix)
    );
}

const actionCovered = (statement: Statement, action: string): boolean =>
    statement.Action.some((pattern) => iamLike(pattern.toLowerCase(), action.toLowerCase()));

/**
 * An Allow reaches a resource when the two patterns overlap (the role's own wildcard may be wider than the boundary,
 * which then cuts it down). A Deny must COVER the resource to count: a Deny that only overlaps a wildcard resource
 * removes part of it, not the whole, so crediting it would hide a working grant.
 */
const resourceCovered = (statement: Statement, action: string, resource: string, resourceIsPattern: boolean): boolean =>
    statement.Resource.some(
        (pattern) =>
            actionMeetsResource(action, pattern) &&
            (statement.Effect === 'Allow' && resourceIsPattern
                ? patternsOverlap(pattern, resource)
                : iamLike(pattern, resource)),
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
        resourceCovered(statement, action, resource, resourceIsPattern) &&
        conditionHolds(statement.Condition, context);

    const allowed = document.Statement.some((statement) => statement.Effect === 'Allow' && applies(statement));
    const denied = document.Statement.some((statement) => statement.Effect === 'Deny' && applies(statement));

    return allowed && !denied;
}
