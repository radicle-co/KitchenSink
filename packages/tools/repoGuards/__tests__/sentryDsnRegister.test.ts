// @vitest-environment node
/**
 * Repo-wide guard: the documented Sentry DSN register and the parameters the infra actually resolves agree.
 *
 * ## The class of defect this exists for
 *
 * ⛔ A MISSING PARAMETER FAILS THE DEPLOY; A PARAMETER NOBODY READS FAILS NOTHING AT ALL. The first is loud
 * and self-correcting — CloudFormation refuses to resolve it. The second is the dangerous direction: the
 * value sits in SSM, someone believes the runtime reports, and it does not. That is not hypothetical here —
 * `/kitchensink/{stage}/sentry/edge-dsn` was populated for both stages while `SENTRY_EDGE_DSN`, the build
 * variable `esbuild.mjs` inlines it from, was set in no workflow, script or action in the repository. Every
 * Lambda@Edge bundle ever shipped carried an empty DSN.
 *
 * ⚠️ AND THE DOCUMENTED REGISTER HAD ALREADY DRIFTED. `docs/SENTRY_OBSERVABILITY_SETUP.md` named three
 * parameters while six more were being resolved at deploy. A register that is only prose is a register that
 * goes stale silently — the same lesson ADR-0004's NAT consumer list and ADR-0042's drain table record, and
 * the reason both of those are guarded rather than trusted.
 *
 * ## Why it is derived, not enumerated
 *
 * The consumers come from the infra sources themselves, so a new runtime is covered the day its stack
 * resolves a parameter and cannot opt out by not being mentioned here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { presentFiles, repoRoot } from './serviceSources.js';

/** The register's fenced region in the setup document. */
const DOC = 'docs/SENTRY_OBSERVABILITY_SETUP.md';
const START = '<!-- sentry-dsn:start -->';
const END = '<!-- sentry-dsn:end -->';

/** A parameter name with its stage placeholder normalised, so `prod`/`sandbox`/a template all compare equal. */
function normalise(name: string): string {
    return name.replace(/\/(prod|sandbox|\{prod,sandbox\}|\$\{[^}]*\})\//u, '/{stage}/');
}

/**
 * Every Sentry DSN parameter the register documents.
 *
 * @returns Normalised parameter names.
 */
function documented(): ReadonlySet<string> {
    const text = readFileSync(path.join(repoRoot, DOC), 'utf8');
    const region = text.slice(text.indexOf(START), text.indexOf(END));

    return new Set(
        [...region.matchAll(/`(\/kitchensink\/[^`]*\/sentry\/[a-z-]+-dsn)`/gu)].map((m) => normalise(m[1] as string)),
    );
}

/**
 * Every Sentry DSN parameter the infra or a workflow actually resolves.
 *
 * ⚠️ Two spellings are in use and both must be read. Most stacks interpolate the path directly; the webhooks
 * stack builds it through `ssmValue('sentry', 'webhook-dsn')` / `ssmParamPath('global', 'sentry', …)`. A
 * reader that knew only the literal form reported the webhook and drain parameters as undocumented, which is
 * a false finding that reads exactly like a real one.
 *
 * @returns Normalised parameter names.
 */
function resolved(): ReadonlySet<string> {
    const files = presentFiles(['packages']).filter(
        (file) =>
            (file.endsWith('.ts') || file.endsWith('.mjs')) && !file.includes('__tests__') && !file.includes('/dist/'),
    );
    const found = new Set<string>();

    for (const file of [...files, ...presentFiles(['.github'])]) {
        const text = readFileSync(path.join(repoRoot, file), 'utf8');

        for (const match of text.matchAll(/\/kitchensink\/[^'"`\s)]*\/sentry\/[a-z-]+-dsn/gu)) {
            found.add(normalise(match[0]));
        }

        for (const match of text.matchAll(/ssmValue\(\s*'sentry',\s*'([a-z-]+-dsn)'/gu)) {
            found.add(`/kitchensink/{stage}/sentry/${match[1] as string}`);
        }

        for (const match of text.matchAll(/ssmParamPath\(\s*'global',\s*'sentry',\s*'([a-z-]+-dsn)'/gu)) {
            found.add(`/kitchensink/global/sentry/${match[1] as string}`);
        }
    }

    return found;
}

describe('the documented Sentry DSN register matches what the infra resolves', () => {
    const inDoc = documented();
    const inCode = resolved();

    it('⛔ documents every parameter something actually resolves', () => {
        expect([...inCode].filter((name) => !inDoc.has(name)).sort()).toEqual([]);
    });

    it('⛔ documents nothing that has no consumer — a DSN nobody reads reports nothing, silently', () => {
        expect([...inDoc].filter((name) => !inCode.has(name)).sort()).toEqual([]);
    });

    /** Non-vacuity: a register or a reader that found nothing would agree with anything. */
    it('has real subjects on both sides', () => {
        expect(inDoc.size).toBeGreaterThanOrEqual(9);
        expect(inCode.size).toBeGreaterThanOrEqual(9);
        expect([...inDoc]).toContain('/kitchensink/global/sentry/log-drain-dsn');
        expect([...inCode]).toContain('/kitchensink/{stage}/sentry/edge-dsn');
    });

    it('⚠️ normalises both stages and a template to one key, so prod and sandbox are not two rows', () => {
        expect(normalise('/kitchensink/prod/sentry/platform-dsn')).toBe('/kitchensink/{stage}/sentry/platform-dsn');
        expect(normalise('/kitchensink/{prod,sandbox}/sentry/platform-dsn')).toBe(
            '/kitchensink/{stage}/sentry/platform-dsn',
        );
        expect(normalise('/kitchensink/${baseStage}/sentry/platform-dsn')).toBe(
            '/kitchensink/{stage}/sentry/platform-dsn',
        );
        // `global` is a real scope, not a stage, and must NOT collapse.
        expect(normalise('/kitchensink/global/sentry/log-drain-dsn')).toBe('/kitchensink/global/sentry/log-drain-dsn');
    });
});
