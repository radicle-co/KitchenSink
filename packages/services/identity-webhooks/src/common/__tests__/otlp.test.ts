import { describe, expect, it } from 'vitest';

import { cloudWatchToOtlp, parseLogDrainDsn, sanitizeAccessLogMessage, stageFromLogGroup } from '../otlp.js';

describe('otlp', () => {
    describe('parseLogDrainDsn', () => {
        it('derives the OTLP endpoint and auth header from a DSN', () => {
            const target = parseLogDrainDsn('https://abc123@o863367.ingest.us.sentry.io/4511549304930304');

            expect(target.url).toBe(
                'https://o863367.ingest.us.sentry.io/api/4511549304930304/integration/otlp/v1/logs',
            );
            expect(target.authHeader).toBe('sentry sentry_key=abc123');
        });

        it('throws on a DSN with no project id', () => {
            expect(() => parseLogDrainDsn('https://abc123@o1.ingest.us.sentry.io/')).toThrow();
        });
    });

    describe('cloudWatchToOtlp', () => {
        it('maps each event to a record with source attributes, ns timestamps, and severity', () => {
            const payload = cloudWatchToOtlp({
                logGroup: '/aws/lambda/x',
                logStream: 'stream-1',
                logEvents: [
                    { timestamp: 1000, message: 'hello' },
                    { timestamp: 2000, message: 'ERROR boom' },
                ],
            });

            const records = payload.resourceLogs[0]?.scopeLogs[0]?.logRecords ?? [];
            expect(records).toHaveLength(2);
            expect(records[0]?.timeUnixNano).toBe('1000000000');
            expect(records[0]?.attributes.find((a) => a.key === 'log_group')?.value.stringValue).toBe('/aws/lambda/x');
            expect(records[0]?.attributes.find((a) => a.key === 'log_stream')?.value.stringValue).toBe('stream-1');
            expect(records[1]?.severityText).toBe('ERROR');
        });

        it('tags the resource and each record with the stage derived from the log group', () => {
            const payload = cloudWatchToOtlp({
                logGroup: 'kitchensink-identity-webhooks-prod-WebhooksLogGroupA05F4FC6-mlSeUWgcNEJf',
                logStream: 'stream-1',
                logEvents: [{ timestamp: 1000, message: 'hello' }],
            });

            const resourceAttrs = payload.resourceLogs[0]?.resource.attributes ?? [];
            const record = payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];

            expect(resourceAttrs.find((a) => a.key === 'deployment.environment')?.value.stringValue).toBe('prod');
            expect(record?.attributes.find((a) => a.key === 'sentry.environment')?.value.stringValue).toBe('prod');
        });
    });

    describe('stageFromLogGroup', () => {
        /**
         * ⛔ REWRITTEN for U15, and the first case it used to make was about a group that receives NOTHING:
         * `kitchensink-identity-service-prod-IdentityServiceLogGroup…` is the RETIRED group ADR-0035's
         * expand-first rule keeps alive until its export stops being imported. The live one is
         * `/kitchensink/identity-service/<stage>` — slashes, not hyphens — which the old regex could not
         * match at all, so every log line from the service that serves real users arrived in Sentry tagged
         * `environment:unknown`. The suite passed the whole time, because it asked about the wrong group.
         */
        it('⛔ reads the LIVE identity ECS group, whose slash-path name the old regex could not match', () => {
            expect(stageFromLogGroup('/kitchensink/identity-service/prod')).toBe('prod');
            expect(stageFromLogGroup('/kitchensink/identity-service/pr-91')).toBe('pr-91');
        });

        /**
         * ⛔ The second silent defect. A CDK-generated group name is `<stack>-<ConstructId><hash>`, and the
         * old pattern's `sandbox-[a-z0-9]+` arm swallowed the construct id — so a sandbox webhook group
         * reported an environment called `sandbox-webhookslogroup`, which nobody filters on. The stage
         * capture is now bounded by a literal on BOTH sides.
         */
        it('⛔ stops a CONSTRUCT ID being read as part of the stage', () => {
            expect(stageFromLogGroup('kitchensink-identity-webhooks-sandbox-WebhooksLogGroupA05F4FC6-Rwj')).toBe(
                'sandbox',
            );
            expect(stageFromLogGroup('kitchensink-identity-webhooks-pr-15-WebhooksLogGroupA05F4FC6-x')).toBe('pr-15');
        });

        it('reads every other registered group', () => {
            expect(stageFromLogGroup('/aws/lambda/kitchensink-recipe-workers-prod')).toBe('prod');
            expect(stageFromLogGroup('/aws/lambda/kitchensink-ingredient-parser-sandbox')).toBe('sandbox');
            expect(stageFromLogGroup('kitchensink-food-prod-FoodWorkerLogGroupABC123-x')).toBe('prod');
            expect(stageFromLogGroup('kitchensink-recipe-pr-91-RecipeApiLogGroupABC123-x')).toBe('pr-91');
        });

        /**
         * ⚠️ `unknown` survives, and only here. The register itself refuses to guess; this forwarder's first
         * duty is not to drop logs, so an unregistered group is forwarded mislabelled rather than discarded.
         * What changed is that `unknown` now means "nobody registered this group" instead of "the regex did
         * not fit a group we own" — which is what let two whole services sit mislabelled.
         */
        it('falls back to unknown ONLY for a genuinely unregistered group', () => {
            expect(stageFromLogGroup('/aws/lambda/some-other-function')).toBe('unknown');
        });
    });

    describe('sanitizeAccessLogMessage', () => {
        it('redacts sensitive keys and id path segments in a JSON access log', () => {
            const message = JSON.stringify({
                ip: '1.2.3.4',
                caller: 'someone',
                resourcePath: '/users/550e8400-e29b-41d4-a716-446655440000/avatar',
                status: '200',
            });

            const out = JSON.parse(sanitizeAccessLogMessage(message)) as Record<string, string>;

            expect(out['ip']).toBe('[redacted]');
            expect(out['caller']).toBe('[redacted]');
            expect(out['resourcePath']).toBe('/users/:id/avatar');
            expect(out['status']).toBe('200');
        });

        it('passes non-JSON messages through unchanged', () => {
            expect(sanitizeAccessLogMessage('plain log line')).toBe('plain log line');
        });
    });

    /**
     * ⛔ THE KEYS COME FROM A PARSED LOG LINE, which is the most data-derived source in this repository:
     * whatever an access log happens to contain. Rebuilding onto an object LITERAL meant a field named
     * `__proto__` hit `Object.prototype`'s inherited setter instead of defining a property, so the field
     * was silently DROPPED from the sanitized line — a sanitizer that deletes evidence rather than
     * redacting it.
     */
    it('⛔ keeps a `__proto__` field as DATA rather than dropping it into the prototype', () => {
        // ⚠️ A STRING LITERAL, not an object literal with a computed key. This function receives a LINE, so
        // parsing is what it really does — and an object literal naming `__proto__` reads to a static
        // analyser as an attempt to set a prototype, which is a different thing from the data this asserts.
        const sanitized = sanitizeAccessLogMessage('{"__proto__":"x","path":"/health"}');

        expect(JSON.parse(sanitized)).toHaveProperty('__proto__');
        expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    });

    /**
     * ⚠️ THE CONSEQUENCE OF KEEPING IT, stated as a test rather than left to a reader. Preserving the field
     * means the EMITTED line can carry a `__proto__` key — that is the point, since dropping it was the
     * defect — and this forwarder hands that line to a third party. The exposure does not end at our
     * process boundary, so the fact is pinned here: a consumer that rebuilds an object from this JSON with
     * `obj[key] = …` rather than `JSON.parse` is the one that would be polluted.
     *
     * ⛔ It is NOT a licence to start stripping the field. A sanitizer that deletes evidence is the defect
     * above; a sanitizer that emits exactly what it was given, minus the secrets, is the contract.
     */
    it('⛔ emits the field, so a downstream consumer is told rather than surprised', () => {
        const sanitized = sanitizeAccessLogMessage('{"__proto__":"x","path":"/health"}');

        expect(sanitized).toContain('"__proto__"');

        // The safe read — which is what this module and its consumer both do — is inert.
        const round = JSON.parse(sanitized) as Record<string, unknown>;

        expect(Object.hasOwn(round, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(round)).toBe(Object.prototype);
        expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    });
});
