// @vitest-environment node
/**
 * The nightly stop's two constants live HERE, in the scheduler's own directory, and nowhere else.
 *
 * ## Why they moved (owner ruling 2026-10-12)
 *
 * `NIGHTLY_STOP_HOUR` and the timezone used to be exported by `@kitchensink/queue-check`, next to `isAwake`,
 * `awakeLocalHours` and `NIGHTLY_START_HOUR`. Those three described a CLOCK that decided whether a backstop ran,
 * and the clock is deleted: a scheduled job now runs while the sandbox is up for its PR, not between 09:00 and
 * 00:00. What survives is the one thing that really is a clock, the 00:00 stop, and its only reader is the
 * scheduler stack. A shared runtime package should not export a constant for infrastructure alone.
 *
 * ## What is held
 *
 * 1. The values, written out as literals (a test that rebuilt them from the constants would agree with any bug).
 * 2. The stack's synthesized stop schedule is built FROM them, hour and zone, so editing the module moves the
 *    schedule and nothing else can.
 * 3. `@kitchensink/queue-check` no longer exports any of the clock.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Stack, aws_sns as sns } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';
import { NIGHTLY_STOP_HOUR, NIGHTLY_TIMEZONE } from '../lib/sandbox-scheduler/nightlyStop.js';
import { testApp } from './testApp.js';

const QUEUE_CHECK_INDEX = fileURLToPath(new URL('../../../shared/queue-check/src/index.ts', import.meta.url));

describe('the nightly stop constants', () => {
    it('are 00:00 in America/New_York, as literals', () => {
        expect(NIGHTLY_STOP_HOUR).toBe(0);
        expect(NIGHTLY_TIMEZONE).toBe('America/New_York');
    });

    it('⛔ drive the synthesized stop schedule, hour and zone', () => {
        const app = testApp();
        const stack = new SandboxSchedulerStack(app, 'SandboxScheduler-sandbox', {
            env: { account: '123456789012', region: 'us-east-1' },
            stage: 'sandbox',
            alarmsEnabled: false,
            alarmTopic: sns.Topic.fromTopicArn(
                new Stack(app, 'AlarmTopicHost'),
                'AlarmTopic',
                'arn:aws:sns:us-east-1:123456789012:kitchensink-alarms-sandbox',
            ),
        });
        const schedules = Object.values(Template.fromStack(stack).findResources('AWS::Scheduler::Schedule')) as {
            Properties: { ScheduleExpression: string; ScheduleExpressionTimezone: string };
        }[];

        expect(schedules).toHaveLength(1);
        expect(schedules[0]?.Properties.ScheduleExpression).toBe(`cron(0 ${String(NIGHTLY_STOP_HOUR)} * * ? *)`);
        expect(schedules[0]?.Properties.ScheduleExpressionTimezone).toBe(NIGHTLY_TIMEZONE);
    });
});

describe('@kitchensink/queue-check no longer exports a clock', () => {
    it.each([
        'isAwake',
        'awakeLocalHours',
        'nightlyLocalHour',
        'NIGHTLY_START_HOUR',
        'NIGHTLY_STOP_HOUR',
        'NIGHTLY_TIMEZONE',
    ])('does not export %s', (name) => {
        expect(readFileSync(QUEUE_CHECK_INDEX, 'utf8')).not.toContain(name);
    });
});
