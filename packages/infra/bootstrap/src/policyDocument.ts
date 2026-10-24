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
 * A statement field as IAM receives it: a one-element list is sent as the bare string, as `aws-cdk-lib`'s
 * `PolicyStatement` emits it. The tables keep lists so guards read every field the same way.
 */
const asSent = (values: readonly string[]): string | readonly string[] =>
    values.length === 1 ? (values[0] ?? '') : values;

/**
 * The size IAM measures: the document AS SENT, characters excluding whitespace.
 *
 * The document that reaches IAM is the one `aws-cdk-lib` synthesizes, which sends a one-element `Action` or `Resource`
 * list as a bare string; counting the list form would overstate a document by four characters per such statement.
 * `CiExecutionPolicyStack.test.ts` measures the SYNTHESIZED documents too, so a difference between this model and the
 * real wire form shows up there.
 *
 * @returns The count. Pure.
 */
export function managedPolicySize(document: PolicyDocument): number {
    const sent = {
        ...document,
        Statement: document.Statement.map((statement) => ({
            ...statement,
            Action: asSent(statement.Action),
            Resource: asSent(statement.Resource),
        })),
    };

    return JSON.stringify(sent).replace(/\s/gu, '').length;
}

/** A CDK token for a value only CloudFormation knows (`this.account` of an environment-agnostic stack). */
const CDK_TOKEN = String.raw`\$\{Token\[[A-Za-z0-9_.]+\]\}`;
const ACCOUNT_VALUE = new RegExp(String.raw`^(?:\d{12}|${CDK_TOKEN})$`, 'u');
const REGION_VALUE = new RegExp(String.raw`^(?:[a-z]{2}(?:-[a-z]+)+-\d|${CDK_TOKEN})$`, 'u');

/** Fills the placeholders of one string with replacer FUNCTIONS: a replacement string would read `$&` as a pattern. */
const fillWith =
    (context: RenderContext) =>
    (text: string): string =>
        text.replaceAll(ACCOUNT, () => context.account).replaceAll(REGION, () => context.region);

const fillCondition = (condition: Condition, fill: (text: string) => string): Condition =>
    Object.fromEntries(
        Object.entries(condition).map(([operator, keys]) => [
            fill(operator),
            Object.fromEntries(
                Object.entries(keys).map(([key, value]) => [
                    fill(key),
                    typeof value === 'string' ? fill(value) : value.map(fill),
                ]),
            ),
        ]),
    );

/**
 * Fills the account and region placeholders, field by field. No document is serialized and re-parsed, so a value can
 * only ever replace a placeholder inside one string, never alter the structure around it.
 *
 * @returns A new document; the table it came from is untouched. Pure.
 * @throws When the account is not a twelve-digit id (or a CDK token) or the region is not a region (or a CDK token).
 */
export function renderDocument(document: PolicyDocument, context: RenderContext): PolicyDocument {
    if (!ACCOUNT_VALUE.test(context.account)) {
        throw new Error(`renderDocument: "${context.account}" is not a twelve-digit account id`);
    }

    if (!REGION_VALUE.test(context.region)) {
        throw new Error(`renderDocument: "${context.region}" is not a region`);
    }

    const fill = fillWith(context);

    return {
        ...document,
        Statement: document.Statement.map((statement) => ({
            ...statement,
            Action: statement.Action.map(fill),
            Resource: statement.Resource.map(fill),
            ...(statement.Condition === undefined ? {} : { Condition: fillCondition(statement.Condition, fill) }),
        })),
    };
}

/** Every action of every statement with this effect. */
export function actionsOf(document: PolicyDocument, effect: 'Allow' | 'Deny'): string[] {
    return document.Statement.filter((statement) => statement.Effect === effect).flatMap((statement) => [
        ...statement.Action,
    ]);
}

/** The services (`lambda` of `lambda:Create*`) a set of actions touches. */
export const serviceOf = (action: string): string => action.split(':')[0] ?? action;
