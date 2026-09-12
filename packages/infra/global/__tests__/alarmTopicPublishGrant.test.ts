// @vitest-environment node
/**
 * ⛔ EVERY SNS TOPIC AN ALARM PUBLISHES TO MUST EXPLICITLY ALLOW `cloudwatch.amazonaws.com` TO PUBLISH.
 *
 * ## ⚠️ THE RULE IS APPLIED AT FIVE SITES BY COPY-PASTE, AND THIS TEST IS WHAT HOLDS IT (2026-09-19)
 *
 * `MessageSubstrateStack`, `WebhooksStack`, `IdentityServiceStack`, `RecipeWorkersStack` and
 * `FoodServiceStack` each carry a byte-identical `addToResourcePolicy` block — the same statement, the same
 * confused-deputy `aws:SourceAccount` condition, the same rationale. That is duplicated KNOWLEDGE, and the
 * obvious repair is a `grantCloudWatchAlarmPublish(topic, account)` helper beside `subscribeAlarmEmail`,
 * which every one of those five stacks already imports from `@radicle-co/infra-shared/security`.
 *
 * ⛔ It is NOT extracted, and the reason is a fact about that package rather than an estimate of effort:
 * `infra-shared` is a SEPARATELY VERSIONED, PUBLISHED dependency (the five consumers pin
 * `0.1.0-alpha.897`), not a workspace they resolve from source. Adding a function to it means cutting a
 * release and bumping five `package.json` files — a change to the dependency graph, landing in the same
 * commit as an outage fix. Deferred deliberately.
 *
 * ⚠️ What that costs, stated so the next reader can price it: this test asserts the grant is PRESENT at
 * every site, so a missing copy fails. It does not stop the five copies DRIFTING in their condition or
 * principal — five representations of one rule, and the fixture cases below test the detector, not the
 * agreement between the copies. Extract it when `infra-shared` is next released for another reason.
 *
 * ## The outage this was measured from, not reasoned toward
 *
 * Production identity and food were unreachable from 2026-09-04 22:36 UTC to 2026-09-19 04:20 UTC. The
 * detector was not missing: `IdentityServiceCrashLoopAlarm` went `OK -> ALARM` at 22:36:53 UTC, three
 * minutes after the last task died, and stayed there for 14.2 days. CloudWatch's own alarm history records
 * what happened next, on the same second:
 *
 *     1788561413.755  Action  Failed to execute action
 *                             arn:aws:sns:us-east-1:…:kitchensink-identity-service-prod-IdentityAlarmTopic…
 *
 * Every state change on every food alarm carries the same line. The alarm fleet fired correctly and reached
 * nobody, for a reason no alarm review would surface: the fault is in the TOPIC, not the alarm.
 *
 * ## The mechanism, and why it is invisible in review
 *
 * A bare `sns.Topic` has no resource policy of its own; SNS supplies a DEFAULT document whose
 * `__default_statement_ID` statement allows the owning account — which is what lets a same-account
 * CloudWatch alarm publish with no configuration at all. `new sns.Topic({ enforceSSL: true })` makes CDK
 * emit an `AWS::SNS::TopicPolicy`, and that resource maps onto `SetTopicAttributes(Policy=…)`, which
 * REPLACES the document wholesale. The replacement contains one statement — the SSL `Deny` — so the implicit
 * `Allow` is gone and every publish is denied by default.
 *
 * Nothing fails. The topic exists, the alarm exists, the action is attached, `cdk diff` is clean, and the
 * only symptom is an `Action` line in an alarm history nobody reads. The account's own controlled comparison
 * proves the mechanism: `kitchensink-recipe-workers-prod` carries NO `AWS::SNS::TopicPolicy` resource, still
 * shows `Allow:__default_statement_ID`, and has no failed actions; every topic built with `enforceSSL: true`
 * has a deny-only document and has never successfully published.
 *
 * ⚠️ `CostGuardrailsStack` already knew this. Its `AllowBudgetsPublish` / `AllowCostAnomalyDetectionPublish`
 * statements exist because "AWS services that publish to the topic on the account's behalf" need an explicit
 * grant once a document is attached. The alarm topics are the same shape with a different principal, and
 * they simply never got the statement.
 *
 * ## Why a source gate rather than a shared helper
 *
 * The rule spans six CDK apps that CANNOT import from one another — each installs its own `aws-cdk-lib` and
 * pins `rootDir` to its own `infra/` directory. This repository already answers that shape with a guard over
 * the sources (`alarmFeatureFlag`, `natEgressConsumers`, `alarmSubscriptionWiring`): the knowledge is
 * repeated in code because the boundary forces it, and a test is what keeps the copies identical.
 *
 * ⚠️ It reads the AST, never the text. The comment beside each grant necessarily names the principal, the
 * action and the condition key, so a text search would be satisfied by the prose explaining a grant that is
 * not there.
 *
 * ⚠️ It does NOT assert the SSL `Deny` is gone — that deny is correct and `cdk-nag`'s `AwsSolutions-SNS3`
 * wants it. Both statements belong in the one document, which is exactly what the shape asserted here
 * produces (verified by synth: `enforceSSL` and `addToResourcePolicy` share CDK's single lazily-created
 * `Topic/Policy` construct, so the result is ONE `AWS::SNS::TopicPolicy` carrying both).
 *
 * DESIGN PATTERN: Specification module — pure predicates over parsed sources, fired at the real tree AND at
 * in-memory violating fixtures so a gate that stops matching fails here instead of passing vacuously.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { type SourceFile, parse, repoRoot, trackedFiles, visit } from './serviceSources.js';

/**
 * The service principal CloudWatch publishes alarm notifications as.
 *
 * ⛔ Not `alarms.cloudwatch.amazonaws.com` and not the account root: CloudWatch's alarm action calls SNS as
 * `cloudwatch.amazonaws.com`, and the account-root `Allow` this replaces was only ever incidental.
 */
const ALARM_PUBLISHER_PRINCIPAL = 'cloudwatch.amazonaws.com';

/**
 * The confused-deputy condition key every grant must carry.
 *
 * Without it, ANY account's CloudWatch could be pointed at our alarm topic — a spam and cost vector rather
 * than a data leak, but the repository already answers this exact shape in `CostGuardrailsStack` and an
 * inconsistent posture is the thing that drifts.
 */
const SOURCE_ACCOUNT_CONDITION_KEY = 'aws:SourceAccount';

/** The CDK class that binds an alarm to a topic. A topic passed to one of these is an ALARM topic. */
const ALARM_ACTION_CLASS = 'SnsAction';

// ───────────────────────────────── discovery ─────────────────────────────────

/**
 * Every CDK stack library source in the repository.
 *
 * Discovered from the git index rather than listed, so a service that grows its first alarm topic tomorrow
 * inherits the rule the day it is committed — and so an untracked scratch file cannot satisfy it.
 *
 * @returns One entry per tracked stack source. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function stackSources(): readonly SourceFile[] {
    const candidates = [...trackedFiles('packages/services'), ...trackedFiles('packages/infra/global')];

    return candidates
        .filter((file) => /(?:^|\/)(?:infra\/)?lib\/.*\.ts$/u.test(file) && !file.endsWith('.d.ts'))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

// ───────────────────────────── pure predicates ─────────────────────────────

/**
 * The name a `new sns.Topic(…)` initialiser is bound to, if this declaration is one.
 *
 * @param node - A variable declaration to inspect.
 * @returns The bound identifier, or `undefined` when the declaration is not an SNS topic. Pure.
 */
function topicBinding(node: ts.VariableDeclaration): string | undefined {
    const { initializer, name } = node;

    if (initializer === undefined || !ts.isNewExpression(initializer) || !ts.isIdentifier(name)) {
        return undefined;
    }

    const callee = initializer.expression;
    const constructed = ts.isPropertyAccessExpression(callee)
        ? `${ts.isIdentifier(callee.expression) ? callee.expression.text : ''}.${callee.name.text}`
        : '';

    return constructed.endsWith('.Topic') ? name.text : undefined;
}

/**
 * Every topic identifier in a source, and every topic identifier handed to an alarm action.
 *
 * A property assignment (`this.alertTopic = new sns.Topic(…)`) is read too: `CostGuardrailsStack` owns its
 * topic that way, and a gate that only understood `const` would skip the one stack that already gets this
 * right — leaving the rule unasserted exactly where its precedent lives.
 *
 * @param source - The stack source to read.
 * @returns The declared topics and the subset bound to an alarm action. Pure.
 */
function topicsIn(source: SourceFile): {
    readonly declared: ReadonlySet<string>;
    readonly alarming: ReadonlySet<string>;
} {
    const declared = new Set<string>();
    const alarming = new Set<string>();
    const root = parse(source);

    visit(root, (node) => {
        if (ts.isVariableDeclaration(node)) {
            const bound = topicBinding(node);

            if (bound !== undefined) {
                declared.add(bound);
            }

            return;
        }

        // `this.alertTopic = new sns.Topic(…)` — the property form.
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left) &&
            node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
            ts.isNewExpression(node.right)
        ) {
            const callee = node.right.expression;
            const constructed = ts.isPropertyAccessExpression(callee) ? callee.name.text : '';

            if (constructed === 'Topic') {
                declared.add(`this.${node.left.name.text}`);
            }
        }
    });

    visit(root, (node) => {
        if (!ts.isNewExpression(node)) {
            return;
        }

        const callee = node.expression;
        const constructed = ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : ts.isIdentifier(callee)
              ? callee.text
              : '';

        if (constructed !== ALARM_ACTION_CLASS) {
            return;
        }

        const argument = node.arguments?.[0];

        if (argument === undefined) {
            return;
        }

        const reference = ts.isIdentifier(argument)
            ? argument.text
            : ts.isPropertyAccessExpression(argument) && argument.expression.kind === ts.SyntaxKind.ThisKeyword
              ? `this.${argument.name.text}`
              : undefined;

        if (reference !== undefined && declared.has(reference)) {
            alarming.add(reference);
        }
    });

    return { declared, alarming };
}

/**
 * Does this object literal grant {@link ALARM_PUBLISHER_PRINCIPAL} `sns:Publish` with the source-account
 * guard?
 *
 * All three halves are required together. A grant to the right principal with the wrong action does not
 * publish; the right action to a `ServicePrincipal` named in a comment is not a grant at all; and a grant
 * without the condition is the confused-deputy shape `CostGuardrailsStack` already refuses.
 *
 * @param literal - The `PolicyStatement` properties object.
 * @returns True when the statement is the grant this gate requires. Pure.
 */
function isCloudWatchPublishGrant(literal: ts.ObjectLiteralExpression): boolean {
    let principal = false;
    let action = false;
    let sourceAccount = false;
    let allowed = false;

    visit(literal, (node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            if (node.text === ALARM_PUBLISHER_PRINCIPAL) {
                principal = true;
            }

            if (node.text === 'sns:Publish') {
                action = true;
            }

            if (node.text === SOURCE_ACCOUNT_CONDITION_KEY) {
                sourceAccount = true;
            }
        }

        // `effect: iam.Effect.ALLOW` — a DENY statement naming the principal must not satisfy the gate.
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'ALLOW') {
            allowed = true;
        }
    });

    return principal && action && sourceAccount && allowed;
}

/**
 * Which alarm topics in a source are missing the CloudWatch publish grant.
 *
 * The grant is matched to its topic by the RECEIVER of `addToResourcePolicy`, so a stack that owns two
 * topics and grants one of them is reported for the other — which is the realistic way this regresses once a
 * second topic is added beside a correct one.
 *
 * @param source - The stack source to read.
 * @returns `<file>: <topic>` for every alarm topic with no grant, sorted. Pure.
 */
function ungrantedAlarmTopics(source: SourceFile): readonly string[] {
    const { alarming } = topicsIn(source);

    if (alarming.size === 0) {
        return [];
    }

    const granted = new Set<string>();

    visit(parse(source), (node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
            return;
        }

        if (node.expression.name.text !== 'addToResourcePolicy') {
            return;
        }

        const receiver = node.expression.expression;
        const reference = ts.isIdentifier(receiver)
            ? receiver.text
            : ts.isPropertyAccessExpression(receiver) && receiver.expression.kind === ts.SyntaxKind.ThisKeyword
              ? `this.${receiver.name.text}`
              : undefined;

        if (reference === undefined) {
            return;
        }

        const statement = node.arguments[0];

        if (statement === undefined || !ts.isNewExpression(statement)) {
            return;
        }

        const properties = statement.arguments?.[0];

        if (
            properties !== undefined &&
            ts.isObjectLiteralExpression(properties) &&
            isCloudWatchPublishGrant(properties)
        ) {
            granted.add(reference);
        }
    });

    return [...alarming]
        .filter((topic) => !granted.has(topic))
        .map(
            (topic) =>
                `${source.file}: ${topic} receives alarm actions but does not grant ${ALARM_PUBLISHER_PRINCIPAL}`,
        )
        .toSorted();
}

// ───────────────────────────── the discovered tree ─────────────────────────────

const STACK_SOURCES = stackSources();

/** Every stack source that binds at least one topic to an alarm action. */
const ALARM_TOPIC_SOURCES = STACK_SOURCES.filter((source) => topicsIn(source).alarming.size > 0);

// ───────────────────────────── violating fixtures ─────────────────────────────

/** A stack whose alarm topic carries only the SSL deny — the shape that shipped the 14-day silence. */
const UNGRANTED_STACK: SourceFile = {
    file: '(fixture)/UngrantedStack.ts',
    contents: `
        export class UngrantedStack {
            public constructor() {
                // The grant belongs here: cloudwatch.amazonaws.com needs sns:Publish with aws:SourceAccount.
                // Prose naming every literal must not satisfy the gate.
                const alarmTopic = new sns.Topic(this, 'AlarmTopic', { enforceSSL: true });
                const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);
                alarm.addAlarmAction(alarmAction);
            }
        }
    `,
};

/** A stack that grants the principal but with no confused-deputy condition. */
const UNCONDITIONED_STACK: SourceFile = {
    file: '(fixture)/UnconditionedStack.ts',
    contents: `
        export class UnconditionedStack {
            public constructor() {
                const alarmTopic = new sns.Topic(this, 'AlarmTopic', { enforceSSL: true });
                alarmTopic.addToResourcePolicy(
                    new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
                        actions: ['sns:Publish'],
                        resources: [alarmTopic.topicArn],
                    }),
                );
                const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);
            }
        }
    `,
};

/** A stack that DENIES the principal — the inverted statement a copy-paste produces. */
const DENYING_STACK: SourceFile = {
    file: '(fixture)/DenyingStack.ts',
    contents: `
        export class DenyingStack {
            public constructor() {
                const alarmTopic = new sns.Topic(this, 'AlarmTopic', { enforceSSL: true });
                alarmTopic.addToResourcePolicy(
                    new iam.PolicyStatement({
                        effect: iam.Effect.DENY,
                        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
                        actions: ['sns:Publish'],
                        resources: [alarmTopic.topicArn],
                        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
                    }),
                );
                const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);
            }
        }
    `,
};

/** A stack that grants ONE of its two alarm topics — the realistic regression once a second topic lands. */
const HALF_GRANTED_STACK: SourceFile = {
    file: '(fixture)/HalfGrantedStack.ts',
    contents: `
        export class HalfGrantedStack {
            public constructor() {
                const firstTopic = new sns.Topic(this, 'First', { enforceSSL: true });
                firstTopic.addToResourcePolicy(
                    new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
                        actions: ['sns:Publish'],
                        resources: [firstTopic.topicArn],
                        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
                    }),
                );
                const secondTopic = new sns.Topic(this, 'Second', { enforceSSL: true });
                const a = new cloudwatch_actions.SnsAction(firstTopic);
                const b = new cloudwatch_actions.SnsAction(secondTopic);
            }
        }
    `,
};

/** The compliant shape, so a gate that reports everything fails here rather than passing as strictness. */
const GRANTED_STACK: SourceFile = {
    file: '(fixture)/GrantedStack.ts',
    contents: `
        export class GrantedStack {
            public constructor() {
                const alarmTopic = new sns.Topic(this, 'AlarmTopic', { enforceSSL: true });
                alarmTopic.addToResourcePolicy(
                    new iam.PolicyStatement({
                        sid: 'AllowCloudWatchAlarmPublish',
                        effect: iam.Effect.ALLOW,
                        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
                        actions: ['sns:Publish'],
                        resources: [alarmTopic.topicArn],
                        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
                    }),
                );
                const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);
            }
        }
    `,
};

/** A topic nothing alarms on — out of scope, and a gate that reports it is over-reaching. */
const NON_ALARM_TOPIC_STACK: SourceFile = {
    file: '(fixture)/NonAlarmTopicStack.ts',
    contents: `
        export class NonAlarmTopicStack {
            public constructor() {
                const notificationTopic = new sns.Topic(this, 'Notifications', { enforceSSL: true });
                bucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.SnsDestination(notificationTopic));
            }
        }
    `,
};

describe('every alarm topic grants CloudWatch permission to publish to it', () => {
    it('finds alarm topics to check — the gate is not vacuous', () => {
        // Five stacks own an alarm topic today (identity, food, recipe-workers, identity-webhooks, the
        // message substrate) plus cost-guardrails' own. A floor rather than an equality: a sixth service
        // growing an alarm topic must inherit the rule, not fail an arithmetic assertion.
        expect(ALARM_TOPIC_SOURCES.length).toBeGreaterThanOrEqual(5);
    });

    it('reports no ungranted alarm topic anywhere in the tree', () => {
        const violations = ALARM_TOPIC_SOURCES.flatMap((source) => ungrantedAlarmTopics(source));

        expect(violations).toEqual([]);
    });

    describe('the gate itself', () => {
        it('catches the deny-only topic that shipped the 14-day silence', () => {
            expect(ungrantedAlarmTopics(UNGRANTED_STACK)).toHaveLength(1);
        });

        it('catches a grant with no confused-deputy condition', () => {
            expect(ungrantedAlarmTopics(UNCONDITIONED_STACK)).toHaveLength(1);
        });

        it('catches an inverted DENY statement naming the right principal', () => {
            expect(ungrantedAlarmTopics(DENYING_STACK)).toHaveLength(1);
        });

        it('catches the second topic when only the first is granted', () => {
            const violations = ungrantedAlarmTopics(HALF_GRANTED_STACK);

            expect(violations).toHaveLength(1);
            expect(violations[0]).toContain('secondTopic');
        });

        it('accepts the compliant shape', () => {
            expect(ungrantedAlarmTopics(GRANTED_STACK)).toEqual([]);
        });

        it('ignores a topic no alarm publishes to', () => {
            expect(ungrantedAlarmTopics(NON_ALARM_TOPIC_STACK)).toEqual([]);
        });
    });
});
