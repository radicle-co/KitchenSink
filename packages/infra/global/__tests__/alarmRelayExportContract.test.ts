// @vitest-environment node
/**
 * ⛔ EVERY COPY OF THE ALARM RELAY SUBSCRIPTION IMPORTS THE EXPORT THE RELAY STACK ACTUALLY MAKES (ADR-0062).
 *
 * The subscription module is mirrored into every app that owns an alarm topic, and `mirroredModuleParity.test.ts` holds
 * the copies identical to each other. That proves they agree among themselves, not that they agree with the stack that
 * exports the name. If the export's spelling changed in the stack and in no copy, every service deploy would fail at
 * `Fn::ImportValue` — late, in a pipeline, one app at a time. This test reads both ends.
 *
 * The export is the ONE name here that is a one-way door: once imported, the relay function cannot be replaced without
 * detaching every subscriber.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { AlarmRelayStack } from '../lib/platform/AlarmRelayStack.js';
import { productionSources, REPO_ROOT } from './roleSplitSources.js';
import { testApp } from './testApp.js';

/** Every copy of the subscription module, discovered. */
const COPIES = productionSources().filter(
    (file) =>
        file.endsWith('/lib/alarmRelaySubscription.ts') || file.endsWith('/lib/platform/alarmRelaySubscription.ts'),
);

/** The export name the relay stack makes for a stage. */
function exportedName(stage: string): string | undefined {
    const stack = new AlarmRelayStack(testApp(), `AlarmRelay-${stage}`, {
        env: { account: '123456789012', region: 'us-east-1' },
        stackName: `kitchensink-alarm-relay-${stage}`,
        stage,
        alarmsEnabled: false,
    });
    const outputs = Object.values(Template.fromStack(stack).findOutputs('*')) as { Export?: { Name?: string } }[];

    return outputs.map((output) => output.Export?.Name).find((name) => name?.endsWith(':AlarmRelayFunctionArn'));
}

describe('the alarm relay export contract', () => {
    it('finds a copy in the global app and in every app that owns an alarm topic', () => {
        // Non-vacuity: a discovery that found one file would compare nothing. The apps are the global app and the five
        // service apps that build an alarm topic.
        expect(COPIES.map((file) => file.split('/').slice(0, 3).join('/')).sort()).toEqual([
            'packages/infra/global',
            'packages/services/food-service',
            'packages/services/identity',
            'packages/services/identity-webhooks',
            'packages/services/recipe-workers',
            'packages/services/remote-search',
        ]);
    });

    it.each(['prod', 'sandbox'])('the stack exports `kitchensink-alarm-relay-%s:AlarmRelayFunctionArn`', (stage) => {
        expect(exportedName(stage)).toBe(`kitchensink-alarm-relay-${stage}:AlarmRelayFunctionArn`);
    });

    it('every copy imports exactly that name: prod imports prod, every other stage imports sandbox', () => {
        for (const file of COPIES) {
            const text = readFileSync(join(REPO_ROOT, file), 'utf8');

            expect(text, file).toContain("export const ALARM_RELAY_EXPORT = 'AlarmRelayFunctionArn';");
            expect(text, file).toContain(
                "Fn.importValue(`kitchensink-alarm-relay-${stage === 'prod' ? 'prod' : 'sandbox'}:${ALARM_RELAY_EXPORT}`)",
            );
        }
    });
});
