/**
 * Guard: `sandbox-web-preview.yml`'s `route` job runs a credentialed step only for a run that can hold credentials.
 *
 * ## The defect this exists to prevent
 *
 * GitHub gives a Dependabot run only Dependabot secrets, and a fork's pull request none. So on every Dependabot pull
 * request the job deployed a Vercel preview with an EMPTY `VERCEL_TOKEN`, Vercel answered "The request is missing an
 * authentication token", and the check went red on a pull request that had nothing wrong with it (#111 to #115). The
 * same run printed "Sandbox router missing" because its unsigned AWS call found nothing, and it published a "View
 * deployment" link to a preview that could never exist.
 *
 * The preview is a sandbox surface, so skipping it is allowed (owner rule: skip only what depends on the sandbox).
 * Whether a run can hold credentials is decided ONCE, by `awsAuth`'s `authenticated` output (ADR-0063), which is
 * `false` only for a fork or a Dependabot run and red for any other run that cannot sign in. This guard holds the job
 * to that one answer instead of a second actor test.
 *
 * ## What it checks
 *
 *   1. A step that reads a secret, calls AWS, or publishes the preview deployment is gated on the sign-in step's
 *      `authenticated` output, directly or through the output of a step that is itself gated that way.
 *   2. The preview deployment is published only after the sign-in step, because its gate reads that step.
 *   3. The close-time cleanup of deployment records is NOT gated, so records left by pull requests opened before this
 *      gate existed are still deactivated when those pull requests close.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';

const FILE = join(repoRoot, '.github', 'workflows', 'sandbox-web-preview.yml');
const SIGN_IN_ID = 'aws';
const SIGNED_IN = `steps.${SIGN_IN_ID}.outputs.authenticated == 'true'`;
const PUBLISH = 'Publish sandbox preview deployment';
const DEACTIVATE = 'Deactivate path-routed preview deployment on close';

interface Step {
    readonly id?: string;
    readonly name?: string;
    readonly if?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Workflow {
    readonly jobs?: Readonly<Record<string, { readonly steps?: readonly Step[] }>>;
}

const steps = (): readonly Step[] => (parse(readFileSync(FILE, 'utf8')) as Workflow).jobs?.['route']?.steps ?? [];

const label = (step: Step): string => step.name ?? step.id ?? step.uses ?? '?';

/** True when the step reads a repository secret anywhere in its inputs or environment. */
const readsSecret = (step: Step): boolean => /secrets\./u.test(JSON.stringify({ env: step.env, with: step.with }));

/** True when the step's shell calls AWS, directly or through the route script that writes the router's KVS. */
const callsAws = (step: Step): boolean => /(^|\s)aws\s|registerPreview\.ts/u.test(step.run ?? '');

/**
 * True when the step only runs for a signed-in run: its `if:` reads the sign-in step's answer, or the output of an
 * earlier step that is itself gated that way.
 */
function isGated(step: Step, all: readonly Step[]): boolean {
    const condition = step.if ?? '';

    if (condition.includes(SIGNED_IN)) {
        return true;
    }

    return [...condition.matchAll(/steps\.([A-Za-z0-9_-]+)\.outputs\./gu)].some(([, id]) => {
        const source = all.find((candidate) => candidate.id === id);

        return id !== SIGN_IN_ID && source !== undefined && source !== step && isGated(source, all);
    });
}

describe('sandbox-web-preview.yml runs credentialed steps only for a run that can hold credentials', () => {
    it('has the awsAuth sign-in step every gate reads', () => {
        const signIn = steps().find((step) => step.id === SIGN_IN_ID);

        expect(signIn?.uses).toBe('./.github/actions/awsAuth');
    });

    it('⛔ gates every step that reads a secret or calls AWS on the sign-in answer', () => {
        const all = steps();
        const credentialed = all.filter((step) => readsSecret(step) || callsAws(step));

        expect(credentialed.length, 'no credentialed step found — the scan read nothing').toBeGreaterThan(2);
        expect(credentialed.filter((step) => !isGated(step, all)).map(label)).toEqual([]);
    });

    it('⛔ publishes the preview deployment only after sign-in, and only for a signed-in run', () => {
        const all = steps();
        const publish = all.findIndex((step) => step.name === PUBLISH);
        const signIn = all.findIndex((step) => step.id === SIGN_IN_ID);

        expect(publish, `no "${PUBLISH}" step`).toBeGreaterThanOrEqual(0);
        expect(publish).toBeGreaterThan(signIn);
        expect(all[publish]?.if ?? '').toContain(SIGNED_IN);
    });

    it('keeps the close-time cleanup ungated, so earlier records are still deactivated', () => {
        const deactivate = steps().find((step) => step.name === DEACTIVATE);

        expect(deactivate, `no "${DEACTIVATE}" step`).toBeDefined();
        expect(deactivate?.if ?? '').not.toContain('steps.');
    });
});
