/**
 * @module policyDocument — the shape of an IAM policy document, and the few pure operations on it that the
 * execution-policy and boundary modules and their guards share.
 *
 * Policies in this package are DATA TABLES that are rendered into documents; no document is assembled by string
 * concatenation. That is what lets a guard read a document as structure (actions, resources, conditions) instead of
 * grepping text, and lets a test widen one statement and watch the guard fail.
 */

/** A condition block: operator -> key -> value(s). */
export type Condition = Readonly<Record<string, Readonly<Record<string, string | readonly string[]>>>>;

/** One statement. `Sid` is alphanumeric, as IAM requires, and unique within a document. */
export interface Statement {
    readonly Sid: string;
    readonly Effect: 'Allow' | 'Deny';
    readonly Action: readonly string[];
    readonly Resource: readonly string[];
    readonly Condition?: Condition;
}

/** A policy document. */
export interface PolicyDocument {
    readonly Version: '2012-10-17';
    readonly Statement: readonly Statement[];
}

/** The deployment-time values a document is rendered for. Never committed: the account id is a parameter. */
export interface RenderContext {
    readonly account: string;
    readonly region: string;
}

/** The placeholder a table uses for the deploying account in a resource ARN. */
export const ACCOUNT = '<account>';
/** The placeholder a table uses for the deploying region in a resource ARN. */
export const REGION = '<region>';

/** IAM's limit on a managed policy, counted WITHOUT whitespace. */
export const MANAGED_POLICY_LIMIT = 6144;

/**
 * The size IAM measures: the document's characters excluding whitespace.
 *
 * @returns The count. Pure.
 */
export function managedPolicySize(document: PolicyDocument): number {
    return JSON.stringify(document).replace(/\s/gu, '').length;
}

const substitute = (text: string, context: RenderContext): string =>
    text.replaceAll(ACCOUNT, context.account).replaceAll(REGION, context.region);

/**
 * Fills the account and region placeholders.
 *
 * @returns A new document; the table it came from is untouched. Pure.
 */
export function renderDocument(document: PolicyDocument, context: RenderContext): PolicyDocument {
    return JSON.parse(substitute(JSON.stringify(document), context)) as PolicyDocument;
}

/** Every action of every statement with this effect. */
export function actionsOf(document: PolicyDocument, effect: 'Allow' | 'Deny'): string[] {
    return document.Statement.filter((statement) => statement.Effect === effect).flatMap((statement) => [
        ...statement.Action,
    ]);
}

/** The services (`lambda` of `lambda:Create*`) a set of actions touches. */
export const serviceOf = (action: string): string => action.split(':')[0] ?? action;
