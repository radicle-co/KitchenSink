/**
 * @module policyEval — a deliberately small reading of a policy document, for guards.
 *
 * It answers one question: does a statement's ACTION and RESOURCE section cover a given (action, resource) pair?
 * It does not evaluate conditions, and says so in its API: `unconditionalDeny` credits only Deny statements with no
 * `Condition`, because a guard that credited a conditional Deny it cannot evaluate would pass on a policy that does
 * not actually stop the call. `anyAllow` ignores conditions in the other direction (it can only over-report an
 * Allow), which is the conservative side for a claim like "this name is not reachable".
 */
import { iamLike } from './iamPattern.js';
import type { PolicyDocument, Statement } from './policyDocument.js';

/** IAM action names are case-insensitive. */
const actionMatches = (patterns: readonly string[], action: string): boolean =>
    patterns.some((pattern) => iamLike(pattern.toLowerCase(), action.toLowerCase()));

const resourceMatches = (patterns: readonly string[], resource: string): boolean =>
    patterns.some((pattern) => iamLike(pattern, resource));

/** Whether a statement's Action and Resource sections cover the pair (conditions ignored). */
export function covers(statement: Statement, action: string, resource: string): boolean {
    return actionMatches(statement.Action, action) && resourceMatches(statement.Resource, resource);
}

/** Whether a Deny with NO condition covers the pair, i.e. a Deny that holds whatever the request looks like. */
export function unconditionalDeny(documents: readonly PolicyDocument[], action: string, resource: string): boolean {
    return documents.some((document) =>
        document.Statement.some(
            (statement) =>
                statement.Effect === 'Deny' && statement.Condition === undefined && covers(statement, action, resource),
        ),
    );
}

/** Whether any Allow (condition ignored) covers the pair. */
export function anyAllow(documents: readonly PolicyDocument[], action: string, resource: string): boolean {
    return documents.some((document) =>
        document.Statement.some((statement) => statement.Effect === 'Allow' && covers(statement, action, resource)),
    );
}
