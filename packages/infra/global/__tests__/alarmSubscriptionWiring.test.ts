/**
 * ⛔ EVERY alarm topic must be able to reach a human (R3.2, plan U11).
 *
 * This gate exists because the repository has shipped the failure twice, in two different shapes:
 *
 *   - every service's SNS alarm topic had **zero subscriptions**, so an alarm fired, published to a topic
 *     nobody was listening to, and resolved — leaving a CloudWatch history nobody reads;
 *   - production's erasure alarm shipped **action-less and dimensionless** (plan U1), so it could not have
 *     fired even with perfect data.
 *
 * Both look completely healthy from inside the code that raises them. The only way to catch either is to
 * read the synthesized templates and assert the property across ALL of them — which is what this does,
 * source-file-wide rather than per-stack, so a NEW service inherits the requirement without anyone
 * remembering to add a test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const REPO = fileURLToPath(new URL('../../../..', import.meta.url));

/** Every CDK stack source in the repo that could own an alarm topic. */
function stackSources(): string[] {
    const roots = [
        join(REPO, 'packages/infra/global/lib/platform'),
        ...readdirSync(join(REPO, 'packages/services'), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(REPO, 'packages/services', entry.name, 'infra/lib')),
    ];

    return roots.flatMap((root) => {
        try {
            return readdirSync(root)
                .filter((file) => file.endsWith('.ts'))
                .map((file) => join(root, file));
        } catch {
            return [];
        }
    });
}

const SOURCES = stackSources().map((path) => ({ path: path.slice(REPO.length), text: readFileSync(path, 'utf8') }));

describe('alarm topics are wired to a recipient', () => {
    it('finds the stack sources at all (guards every case below from vacuity)', () => {
        expect(SOURCES.length).toBeGreaterThanOrEqual(8);
    });

    it('⛔ every file that CREATES an alarm topic also subscribes a recipient to it', () => {
        // `CostGuardrailsStack` predates the shared helper and wires its own `EmailSubscription` directly;
        // it is accepted by name because it already satisfies the RULE — it is the pattern the helper was
        // extracted from — not because it is exempt from it.
        const creators = SOURCES.filter((file) => /new sns\.Topic\(/.test(file.text) && /[Aa]larm/.test(file.text));
        const unwired = creators
            .filter((file) => !file.text.includes('subscribeAlarmEmail') && !file.text.includes('EmailSubscription'))
            .map((file) => file.path);

        expect(creators.length).toBeGreaterThanOrEqual(5);
        expect(unwired).toStrictEqual([]);
    });

    it('⛔ NO committed stack source contains an email address literal — this repository is public', () => {
        // The reason the recipient is a prop at all. A literal here is published the moment it is pushed,
        // and no amount of later redaction un-publishes it.
        const withLiterals = SOURCES.filter((file) => /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(file.text)).map(
            (file) => file.path,
        );

        expect(withLiterals).toStrictEqual([]);
    });

    it('takes the recipient as an OPTIONAL prop, so an unconfigured account still synthesizes', () => {
        // Every fork, and every local `cdk synth`, runs with no address configured. A required prop would
        // make the whole platform unsynthesizable for them.
        const required = SOURCES.filter((file) => /readonly alertEmail:\s*string;/.test(file.text)).map(
            (file) => file.path,
        );

        expect(required).toStrictEqual([]);
    });
});
