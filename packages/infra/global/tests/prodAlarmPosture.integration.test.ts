/**
 * ⛔ THE PRODUCTION ALARM POSTURE, MEASURED ON THE TEMPLATES PRODUCTION WOULD DEPLOY WITH ITS ALARMS ON.
 *
 * ADR-0062. Three facts have to hold for a page to mean what it says, and each is read here off the synthesized
 * CloudFormation of EVERY CDK app, at `STAGE=prod` and `ALARMS_ENABLED=true`:
 *
 * | Invariant                                                                  | Test                                                      |
 * | -------------------------------------------------------------------------- | --------------------------------------------------------- |
 * | The synthesis is not vacuous: the alarms the source declares exist         | 'synthesizes at least every alarm the source declares'    |
 * | A custom-namespace alarm reads ITS stage's series, not everyone's          | 'every custom-namespace alarm selects Stage=prod'         |
 * | Every runtime that emits a stage-scoped metric knows its stage             | 'every emitting Lambda and container sets STAGE=prod'     |
 * | Every alarm topic reaches the relay, with a topic-scoped invoke permission | 'every alarm topic has the relay subscription …'          |
 * | An OK goes where an ALARM goes                                             | 'every alarm forwards OK to the same place as ALARM'      |
 *
 * ## Why `nagRulesAtZero` could not host this
 *
 * Its environment does not set `ALARMS_ENABLED`, so it synthesizes ZERO alarms (the switch fails closed). A posture
 * check run against that output passes on a template that has no alarm in it — the vacuity the first test exists to
 * refuse, by counting the alarm construction sites in the source and requiring the synthesis to hold at least that
 * many.
 *
 * ⚠️ The count is a floor, not an equality: one `new cloudwatch.Alarm` site inside a loop synthesizes several. The
 * sites it does NOT expect are named: `SandboxSchedulerStack`'s alarm exists only off prod, and `ingredient-parser`
 * cannot synthesize here at all (ADR-0025) and constructs no alarm or topic.
 *
 * @pattern Specification — the predicates in `__tests__/alarmPosture.ts` over `everyAppSynthesis`'s Repository
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    alarmTopics,
    alarmsWithoutOkActions,
    customAlarmsMissingStage,
    topicsWithoutRelay,
    type CfnTemplate,
} from '../__tests__/alarmPosture.js';
import { parseSource, productionSources } from '../__tests__/roleSplitSources.js';
import { repoRoot } from '../__tests__/serviceSources.js';
import {
    prepareWorkspace,
    removeSynthesisScratch,
    stackTemplates,
    synthesizeEveryApp,
    type AppSynthesis,
} from './common/everyAppSynthesis.js';

const STAGE = 'prod';

/** The published language every emitter links (ADR-0062). An app that declares it emits stage-scoped metrics. */
const METRIC_DIMENSIONS_PACKAGE = '@kitchensink/metric-dimensions';

/** The alarm sites that cannot synthesize at prod: the scheduler's alarm is off-prod only. */
const ALARM_SITES_ABSENT_AT_PROD = ['packages/infra/global/lib/platform/SandboxSchedulerStack.ts'];

/** The relay's export, as every consumer imports it (ADR-0062). */
const RELAY_EXPORT = `kitchensink-alarm-relay-${STAGE}:AlarmRelayFunctionArn`;

/**
 * Whether a subscription endpoint or permission function name is the relay.
 *
 * Service stacks import the export by name. The global app's own stacks hold the relay as an in-app reference, which
 * CloudFormation renders as an `Fn::ImportValue` of an auto-named export or an `Fn::GetAtt` inside the relay stack.
 */
const isRelayEndpoint = (endpoint: unknown): boolean => {
    const text = JSON.stringify(endpoint);

    return text.includes(RELAY_EXPORT) || text.includes('AlarmRelayFunction');
};

/** The number of `new <cloudwatch>.Alarm(` construction sites in production CDK sources. Read from the AST. */
function alarmSiteCount(): number {
    let count = 0;

    for (const file of productionSources()) {
        if (!/\/(?:infra\/)?lib\//u.test(file) || ALARM_SITES_ABSENT_AT_PROD.includes(file)) {
            continue;
        }

        const source = parseSource(file, readFileSync(path.join(repoRoot, file), 'utf8'));

        const visit = (node: ts.Node): void => {
            if (ts.isNewExpression(node) && /(?:^|\.)Alarm$/u.test(node.expression.getText(source))) {
                count += 1;
            }

            ts.forEachChild(node, visit);
        };

        visit(source);
    }

    return count;
}

let syntheses: readonly AppSynthesis[] = [];
/** Every stack template of every app, keyed `app::stack`. */
let templates: ReadonlyMap<string, CfnTemplate> = new Map();

beforeAll(() => {
    prepareWorkspace();
    syntheses = synthesizeEveryApp({ STAGE, ALARMS_ENABLED: 'true' });
    templates = new Map(
        syntheses.flatMap(({ app, outdir, failure }) =>
            failure === undefined
                ? [...stackTemplates(outdir)].map(
                      ([stack, template]) => [`${app}::${stack}`, template as CfnTemplate] as const,
                  )
                : [],
        ),
    );
}, 900_000);

afterAll(removeSynthesisScratch);

/** Every alarm, across every template. */
const alarmCount = (): number =>
    [...templates.values()].reduce(
        (total, template) =>
            total + Object.values(template.Resources ?? {}).filter((r) => r.Type === 'AWS::CloudWatch::Alarm').length,
        0,
    );

/** Violations of one predicate across every template, as `app::stack::logicalId`. */
const violations = (judge: (template: CfnTemplate) => readonly string[]): readonly string[] =>
    [...templates].flatMap(([key, template]) => judge(template).map((id) => `${key}::${id}`));

describe('the production alarm posture, across every CDK app, alarms ON', () => {
    it('synthesizes every app', () => {
        expect(syntheses.filter((s) => s.failure !== undefined)).toEqual([]);
    });

    it('synthesizes at least every alarm the source declares', () => {
        const declared = alarmSiteCount();

        expect(declared).toBeGreaterThan(0);
        expect(alarmCount(), `source declares ${declared} alarm sites`).toBeGreaterThanOrEqual(declared);
    });

    it('every custom-namespace alarm selects Stage=prod', () => {
        expect(violations((template) => customAlarmsMissingStage(template, STAGE))).toEqual([]);
    });

    /**
     * An emitter learns its stage from `STAGE`, and an unset one publishes under `unknown` — a series no alarm selects,
     * so the alarm sits in a confident OK. Which apps emit is DISCOVERED: an app whose package links the published
     * language. Every Lambda handler and container of such an app must set it, not only the ones that call an emitter,
     * because "which handlers emit" is a property of source nobody keeps a list of.
     */
    it('every emitting Lambda and container sets STAGE=prod', () => {
        const serviceOf = (app: string): string => /^packages\/services\/([^/]+)\//u.exec(app)?.[1] ?? '';
        const emitters = syntheses.filter(({ app }) => {
            if (serviceOf(app) === '') {
                return false;
            }

            const manifest = JSON.parse(
                readFileSync(path.join(repoRoot, 'packages/services', serviceOf(app), 'package.json'), 'utf8'),
            ) as { dependencies?: Record<string, string> };

            return manifest.dependencies?.[METRIC_DIMENSIONS_PACKAGE] !== undefined;
        });

        // Non-vacuity: the four runtimes that publish a custom metric.
        expect(emitters.map(({ app }) => serviceOf(app)).sort()).toEqual([
            'food-service',
            'identity-webhooks',
            'recipe-service',
            'recipe-workers',
        ]);

        const missing: string[] = [];

        for (const { app } of emitters) {
            for (const [key, template] of templates) {
                if (!key.startsWith(`${app}::`)) {
                    continue;
                }

                for (const [id, resource] of Object.entries(template.Resources ?? {})) {
                    const properties = resource.Properties ?? {};

                    if (resource.Type === 'AWS::Lambda::Function') {
                        const handler = String(properties['Handler']);

                        // CDK's own custom-resource providers are not ours and emit nothing.
                        if (handler === 'index.handler' || handler.startsWith('framework.')) {
                            continue;
                        }

                        const variables = (
                            properties['Environment'] as { Variables?: Record<string, unknown> } | undefined
                        )?.Variables;

                        if (variables?.['STAGE'] !== STAGE) {
                            missing.push(`${key}::${id}`);
                        }
                    }

                    if (resource.Type === 'AWS::ECS::TaskDefinition') {
                        for (const container of (properties['ContainerDefinitions'] ?? []) as {
                            Name: string;
                            Environment?: { Name: string; Value: unknown }[];
                        }[]) {
                            const stage = container.Environment?.find((entry) => entry.Name === 'STAGE');

                            if (stage?.Value !== STAGE) {
                                missing.push(`${key}::${id}::${container.Name}`);
                            }
                        }
                    }
                }
            }
        }

        expect(missing).toEqual([]);
    });

    it('every alarm topic has the relay subscription and a topic-scoped sns.amazonaws.com permission', () => {
        // Non-vacuity: the platform's two topics and each service app's, so an empty answer is not "no topics found".
        expect(violations((template) => alarmTopics(template)).length).toBeGreaterThanOrEqual(7);
        expect(violations((template) => topicsWithoutRelay(template, isRelayEndpoint))).toEqual([]);
    });

    it('every alarm forwards OK to the same place as ALARM', () => {
        expect(violations((template) => alarmsWithoutOkActions(template))).toEqual([]);
    });
});
