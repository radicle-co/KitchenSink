/**
 * @module __tests__/alarmPosture — pure predicates over a synthesized CloudFormation template that say where an
 * alarm's POSTURE is wrong: no `Stage` selected, no relay on its topic, no OK transition forwarded.
 *
 * ⛔ These read the synthesized TEMPLATE, never the CDK source. A source reader cannot see a helper that builds a
 * metric (the `emfMetric` helper) or a SEARCH expression assembled from a template string, which is exactly where
 * the dimensionless alarms were hiding.
 *
 * Every predicate answers with the LOGICAL IDS of the violators, sorted, so an empty array is the pass and a
 * failure names what to fix. Each is pure; `prodAlarmPosture.integration.test.ts` feeds them the real synthesis of
 * every app, and `alarmPosture.test.ts` feeds them violating and compliant fixtures so that an empty answer cannot
 * be the answer of a reader that found nothing.
 *
 * @pattern Specification — one predicate per posture rule, composed by the caller
 */

/** A CloudFormation resource, as far as these predicates read one. */
export interface CfnResource {
    readonly Type: string;
    readonly Properties?: Record<string, unknown>;
}

/** A synthesized template, as far as these predicates read one. */
export interface CfnTemplate {
    readonly Resources?: Record<string, CfnResource>;
}

/** An intrinsic reference to another resource in the same template. */
const isRef = (value: unknown): value is { readonly Ref: string } =>
    typeof value === 'object' && value !== null && typeof (value as { Ref?: unknown }).Ref === 'string';

/** Every resource of one type, as `[logicalId, resource]`. Pure. */
function resourcesOfType(template: CfnTemplate, type: string): readonly (readonly [string, CfnResource])[] {
    return Object.entries(template.Resources ?? {}).filter(([, resource]) => resource.Type === type);
}

/** The `Properties` of a resource, never undefined. Pure. */
const propertiesOf = (resource: CfnResource): Record<string, unknown> => resource.Properties ?? {};

/** A list-valued property, or an empty list when absent or not a list. Pure. */
function listOf(properties: Record<string, unknown>, key: string): readonly unknown[] {
    const value = properties[key];

    return Array.isArray(value) ? value : [];
}

/**
 * The text of a template value that is a string or an `Fn::Join` of strings, so a SEARCH expression assembled by CDK
 * from a template literal reads as the string it will be. Anything else falls back to its JSON.
 *
 * @param value - A template value.
 * @returns Its text. Pure.
 */
function textOf(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    const join = (value as { 'Fn::Join'?: unknown } | null)?.['Fn::Join'];

    if (Array.isArray(join) && typeof join[0] === 'string' && Array.isArray(join[1])) {
        return join[1].map(textOf).join(join[0]);
    }

    return JSON.stringify(value);
}

/** A namespace is custom unless AWS owns it. A non-string namespace is treated as custom: it is not AWS's. Pure. */
const isCustomNamespace = (namespace: unknown): boolean =>
    !(typeof namespace === 'string' && namespace.startsWith('AWS/'));

/** Whether a dimension list selects exactly `Stage=<stage>`. Pure. */
function selectsStage(dimensions: readonly unknown[], stage: string): boolean {
    return dimensions.some(
        (dimension) =>
            (dimension as { Name?: unknown } | null)?.Name === 'Stage' &&
            (dimension as { Value?: unknown }).Value === stage,
    );
}

/**
 * Whether one query of a multi-query alarm violates the rule.
 *
 * A `MetricStat` on a custom namespace must select the stage. A `SEARCH()` over a custom namespace must filter on
 * `Stage="<stage>"` as a QUOTED value — declaring `Stage` as a schema key alone would still match every stage's
 * series. A pure math expression references other queries, which are judged on their own.
 */
function queryMissesStage(query: unknown, stage: string): boolean {
    const { MetricStat: stat, Expression: expression } = query as {
        MetricStat?: { Metric?: { Namespace?: unknown; Dimensions?: unknown } };
        Expression?: unknown;
    };

    if (stat !== undefined) {
        const dimensions = Array.isArray(stat.Metric?.Dimensions) ? (stat.Metric.Dimensions as unknown[]) : [];

        return isCustomNamespace(stat.Metric?.Namespace) && !selectsStage(dimensions, stage);
    }

    if (expression === undefined) {
        return false;
    }

    const text = textOf(expression);
    const search = /SEARCH\(\s*'\s*\{?\s*([^,}'\s]+)/u.exec(text);

    if (search === null) {
        return false;
    }

    return isCustomNamespace(search[1]) && !text.includes(`Stage="${stage}"`);
}

/**
 * The alarms on a CUSTOM namespace that do not select `Stage=<stage>`.
 *
 * ⛔ A dimensionless series is shared by every stage that publishes it: prod's alarm read a series every pr-N worker
 * also wrote into, and went ALARM at the hour a preview started. An AWS-namespace alarm is exempt because the
 * platform owns its dimensions.
 *
 * @param template - A synthesized template.
 * @param stage - The stage the template was synthesized for.
 * @returns Logical ids of the violating alarms, sorted. Pure.
 */
export function customAlarmsMissingStage(template: CfnTemplate, stage: string): readonly string[] {
    return resourcesOfType(template, 'AWS::CloudWatch::Alarm')
        .filter(([, alarm]) => {
            const properties = propertiesOf(alarm);
            const queries = listOf(properties, 'Metrics');

            if (queries.length > 0) {
                return queries.some((query) => queryMissesStage(query, stage));
            }

            return isCustomNamespace(properties['Namespace']) && !selectsStage(listOf(properties, 'Dimensions'), stage);
        })
        .map(([id]) => id)
        .sort();
}

/**
 * The SNS topics that carry an alarm transition: any topic an alarm names in `AlarmActions`, `OKActions` or
 * `InsufficientDataActions`, and any topic an EventBridge rule targets (the ECS task-failed-to-start rule publishes
 * to the food alarm topic and is not an alarm).
 *
 * @param template - A synthesized template.
 * @returns Logical ids of the topics, sorted. Pure.
 */
export function alarmTopics(template: CfnTemplate): readonly string[] {
    const topics = new Set(resourcesOfType(template, 'AWS::SNS::Topic').map(([id]) => id));
    const named = new Set<string>();

    for (const [, alarm] of resourcesOfType(template, 'AWS::CloudWatch::Alarm')) {
        for (const key of ['AlarmActions', 'OKActions', 'InsufficientDataActions']) {
            for (const action of listOf(propertiesOf(alarm), key)) {
                if (isRef(action) && topics.has(action.Ref)) {
                    named.add(action.Ref);
                }
            }
        }
    }

    for (const [, rule] of resourcesOfType(template, 'AWS::Events::Rule')) {
        for (const target of listOf(propertiesOf(rule), 'Targets')) {
            const arn = (target as { Arn?: unknown } | null)?.Arn;

            if (isRef(arn) && topics.has(arn.Ref)) {
                named.add(arn.Ref);
            }
        }
    }

    return [...named].sort();
}

/**
 * The alarm topics the relay cannot be reached from: no `lambda` subscription at the relay's endpoint, or no
 * `sns.amazonaws.com` invoke permission scoped to THAT topic. Either half missing is silence — a subscription
 * without the permission is refused at delivery, and a permission without the subscription is never invoked.
 *
 * @param template - A synthesized template.
 * @param isRelayEndpoint - Whether a subscription endpoint / permission function name is the relay.
 * @returns Logical ids of the topics, sorted. Pure.
 */
export function topicsWithoutRelay(
    template: CfnTemplate,
    isRelayEndpoint: (endpoint: unknown) => boolean,
): readonly string[] {
    const subscribed = new Set(
        resourcesOfType(template, 'AWS::SNS::Subscription')
            .map(([, subscription]) => propertiesOf(subscription))
            .filter((properties) => properties['Protocol'] === 'lambda' && isRelayEndpoint(properties['Endpoint']))
            .map((properties) => properties['TopicArn'])
            .filter(isRef)
            .map((ref) => ref.Ref),
    );
    const permitted = new Set(
        resourcesOfType(template, 'AWS::Lambda::Permission')
            .map(([, permission]) => propertiesOf(permission))
            .filter(
                (properties) =>
                    properties['Principal'] === 'sns.amazonaws.com' &&
                    properties['Action'] === 'lambda:InvokeFunction' &&
                    isRelayEndpoint(properties['FunctionName']),
            )
            .map((properties) => properties['SourceArn'])
            .filter(isRef)
            .map((ref) => ref.Ref),
    );

    return alarmTopics(template).filter((topic) => !(subscribed.has(topic) && permitted.has(topic)));
}

/** A list of actions as an order-insensitive canonical form. Pure. */
const canonicalActions = (actions: readonly unknown[]): readonly string[] =>
    actions.map((action) => JSON.stringify(action)).sort();

/**
 * The alarms whose OK transition does not go where their ALARM transition goes. An OK that is not forwarded leaves
 * the relay unable to say an incident ended, and an `OKActions` that differs is a second, unreviewed route.
 *
 * @param template - A synthesized template.
 * @returns Logical ids of the violating alarms, sorted. Pure.
 */
export function alarmsWithoutOkActions(template: CfnTemplate): readonly string[] {
    return resourcesOfType(template, 'AWS::CloudWatch::Alarm')
        .filter(([, alarm]) => {
            const properties = propertiesOf(alarm);

            return (
                JSON.stringify(canonicalActions(listOf(properties, 'AlarmActions'))) !==
                JSON.stringify(canonicalActions(listOf(properties, 'OKActions')))
            );
        })
        .map(([id]) => id)
        .sort();
}
