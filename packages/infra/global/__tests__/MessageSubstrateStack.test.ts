/**
 * `MessageSubstrateStack` — the durable per-group message store for the BASE stages (R1, plan U5).
 *
 * ⚠️ **Almost everything asserted here is immutable after the table is created.** A DynamoDB partition key,
 * sort key, and stream view type cannot be changed in place: altering one replaces the table, which for the
 * base stages means losing every message and re-pointing two producer stacks. PR 91 also ships the producer
 * half ONLY, so nothing in this repository exercises the read path these choices exist to serve — the first
 * consumer arrives with feature 014, by which time the schema is long frozen.
 *
 * That is why these are pinned rather than sampled: the tests are the only thing standing between a
 * plausible-looking edit and a migration across two deployables.
 */
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it, expect } from 'vitest';

import { MessageSubstrateStack } from '../lib/platform/MessageSubstrateStack.js';
import { messageTableNameForStage } from '@radicle-co/infra-shared/messaging';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };

const substrateTemplate = (stage: string, alarmsEnabled = true): Template =>
    Template.fromStack(
        new MessageSubstrateStack(testApp(), `Substrate-${stage}`, {
            env,
            stackName: `kitchensink-messaging-${stage}`,
            stage,
            alarmsEnabled,
        }),
    );

describe('MessageSubstrateStack — the key schema (KTD-2, immutable after creation)', () => {
    it('partitions on PK and sorts on SK, both strings', () => {
        // `PK = <groupType>#<groupId>` and `SK = <ISO-8601 ms>#<ULID>`. Both are composed strings, so both
        // attribute types are S — a Number sort key here would reject every timestamp the producer writes.
        substrateTemplate('prod').hasResourceProperties('AWS::DynamoDB::Table', {
            KeySchema: [
                { AttributeName: 'PK', KeyType: 'HASH' },
                { AttributeName: 'SK', KeyType: 'RANGE' },
            ],
            AttributeDefinitions: Match.arrayWith([
                { AttributeName: 'PK', AttributeType: 'S' },
                { AttributeName: 'SK', AttributeType: 'S' },
            ]),
        });
    });

    it('declares NO attribute beyond the two keys — the table is schemaless past its key', () => {
        // A stray AttributeDefinition is not cosmetic: DynamoDB rejects a definition that no key or index
        // uses, so this catches an attribute added in the belief that it needs declaring.
        const table = Object.values(substrateTemplate('prod').findResources('AWS::DynamoDB::Table'))[0] as {
            Properties: { AttributeDefinitions: Array<{ AttributeName: string }> };
        };

        expect(table.Properties.AttributeDefinitions.map((a) => a.AttributeName).sort()).toEqual(['PK', 'SK']);
    });

    it('creates NO local secondary index', () => {
        // An LSI can only be added AT creation and permanently caps the partition at 10 GB. The doorbell
        // pattern queries a group by its key alone, so an LSI would buy nothing and cost that ceiling.
        const table = Object.values(substrateTemplate('prod').findResources('AWS::DynamoDB::Table'))[0] as {
            Properties: Record<string, unknown>;
        };

        expect(table.Properties['LocalSecondaryIndexes']).toBeUndefined();
    });
});

describe('MessageSubstrateStack — TTL, billing, and the stream', () => {
    it('enables TTL on a dedicated attribute', () => {
        substrateTemplate('prod').hasResourceProperties('AWS::DynamoDB::Table', {
            TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
        });
    });

    it('bills on demand, so an idle per-PR-sized table costs essentially nothing', () => {
        substrateTemplate('prod').hasResourceProperties('AWS::DynamoDB::Table', {
            BillingMode: 'PAY_PER_REQUEST',
        });
    });

    it('enables the stream as KEYS_ONLY', () => {
        // KEYS_ONLY is the right view BECAUSE of the doorbell pattern (KTD-2): a consumer is woken and then
        // re-queries the group, which is ordered, rather than reading record contents, which are not.
        // Enabling it now means feature 014 attaches WITHOUT a table change — enabling a stream later is
        // not free, and this table cannot be replaced by then.
        substrateTemplate('prod').hasResourceProperties('AWS::DynamoDB::Table', {
            StreamSpecification: { StreamViewType: 'KEYS_ONLY' },
        });
    });

    it('attaches NO consumer to the stream — PR 91 ships the producer half only', () => {
        const template = substrateTemplate('prod');

        template.resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
    });
});

describe('MessageSubstrateStack — alarms reach somewhere', () => {
    it('gives every alarm an action, so none of them fires into the void', () => {
        // The repo has shipped an action-less alarm to production before (the erasure alarm, plan U1), so
        // this asserts the property across EVERY alarm rather than naming one.
        const alarms = Object.values(substrateTemplate('prod').findResources('AWS::CloudWatch::Alarm')) as Array<{
            Properties: { AlarmActions?: unknown[] };
        }>;

        expect(alarms.length).toBeGreaterThan(0);

        for (const alarm of alarms) {
            expect(alarm.Properties.AlarmActions ?? []).not.toHaveLength(0);
        }
    });

    it('publishes its alarms to an SSL-enforcing topic', () => {
        substrateTemplate('prod').hasResourceProperties('AWS::SNS::TopicPolicy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
                ]),
            }),
        });
    });
});

describe('messageTableNameForStage — the teardown boundary', () => {
    it('names the table per stage', () => {
        expect(messageTableNameForStage('prod')).toBe('kitchensink-messages-prod');
        expect(messageTableNameForStage('sandbox')).toBe('kitchensink-messages-sandbox');
        expect(messageTableNameForStage('pr-7')).toBe('kitchensink-messages-pr-7');
    });

    it('⛔ keeps pr-1 and pr-15 distinguishable under the pr-scope DELIMITER rule', () => {
        // ADR-0005: the teardown has no denylist, so its whole safety is `pr-scope.sh`'s delimiter rule —
        // a token matches a name that IS the token or is prefixed `<token>-`. The property a stage-suffixed
        // name must therefore hold is that the token appears as a COMPLETE trailing segment, never as a
        // prefix of a longer number.
        //
        // ⚠️ The obvious assertion here — `fifteen.startsWith(one)` is false — is WRONG, and asserting it
        // would have encoded a rule the repo does not use: `kitchensink-messages-pr-15` genuinely does
        // start with `kitchensink-messages-pr-1`, and that is harmless precisely BECAUSE matching is
        // delimiter-aware rather than prefix-based. Pin the real rule, not a stricter-looking one.
        const one = messageTableNameForStage('pr-1');
        const fifteen = messageTableNameForStage('pr-15');

        expect(one.endsWith('-pr-1')).toBe(true);
        expect(fifteen.endsWith('-pr-1')).toBe(false);
        expect(fifteen.includes('-pr-1-')).toBe(false);
    });

    it('never produces a name a GLOBAL sweep would mistake for a per-PR resource', () => {
        for (const stage of ['prod', 'sandbox']) {
            expect(messageTableNameForStage(stage)).not.toMatch(/pr-\d/);
        }
    });
});

describe('⛔ the alarm feature flag (default OFF)', () => {
    it('creates NO alarm when the flag is off — the state every sandbox and pr-{N} deploy is in', () => {
        // The whole point of the change: a preview provisions the table, the topic and the stream, and
        // nothing that costs an alarm slot. `resourceCountIs` reads the SYNTHESIZED template, so it cannot
        // be satisfied by a construct that was created and then ignored.
        substrateTemplate('pr-91', false).resourceCountIs('AWS::CloudWatch::Alarm', 0);
    });

    it('creates both substrate alarms when the flag is on', () => {
        // Non-vacuity for the case above: the alarms still exist in the code, gated rather than deleted.
        substrateTemplate('prod', true).resourceCountIs('AWS::CloudWatch::Alarm', 2);
    });

    it('keeps the alarm TOPIC in both states, so the stack exposes the same seam either way', () => {
        // Deliberate, and stated rather than assumed: SNS bills per publish, so a topic with no alarms
        // publishing to it and no subscriber costs nothing. `alarmTopic` is a `public readonly` field —
        // gating it would make it `| undefined` and push an optional through every consumer for $0.
        substrateTemplate('pr-91', false).resourceCountIs('AWS::SNS::Topic', 1);
        substrateTemplate('prod', true).resourceCountIs('AWS::SNS::Topic', 1);
    });
});
