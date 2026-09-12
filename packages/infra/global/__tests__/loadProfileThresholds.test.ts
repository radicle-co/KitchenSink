/**
 * ⛔ A DEPLOYED k6 RUN GATES ON CORRECTNESS AND ONLY REPORTS LATENCY.
 *
 * Every latency budget in these scripts was calibrated against a dedicated runner container with its own
 * Postgres and no rate limiter. A per-PR preview is a different machine: half a reclaimable vCPU of
 * `FARGATE_SPOT` at `desiredCount=1`, on a `db.t4g.micro` shared with every other open PR's logical
 * database (ADR-0006), behind an ALB shared with every other service (ADR-0003). Carrying those numbers
 * across produces a gate that reddens on the NEIGHBOURS' traffic — and the predictable next step is
 * somebody switching it off, which costs more than never having had it.
 *
 * So a script's thresholds split in two, and the split is asserted here rather than left to each author:
 *
 *   - **correctness** — status codes, envelope shapes, `http_req_failed`. A slow, contended or preempted
 *     machine cannot turn a 200 into a 500 or reorder a response body. These are CARRIED and GATED.
 *   - **latency** — every `p(95)`/`p(99)` over a duration. REPORTED on the deployed profile, never gated.
 *
 * ⛔ NOT an env-tunable budget set to a huge number. That leaves a threshold that LOOKS gated and can
 * never fire, which is the coverage theatre `docs/CODING_STANDARDS.md` §7.1 forbids. The de-gated metrics
 * still appear in the summary, so the numbers are produced and a human can read the trend.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deployedCapableScripts } from '@kitchensink/loadtest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');

/** Every `lib/common.js` a deployed-capable script imports from. */
function commonLibs(): readonly string[] {
    return [...new Set(deployedCapableScripts().map((script) => script.replace(/[^/]+$/u, 'lib/common.js')))].filter(
        (lib) => !lib.includes('tools/loadtest'),
    );
}

/**
 * A threshold whose outcome the MACHINE decides, not the code.
 *
 * Percentiles are the obvious half. `dropped_iterations` is the half that hides: an arrival-rate executor
 * drops iterations precisely BECAUSE the box could not keep up, so on a contended preview it fails for the
 * reason this whole split exists to stop gating on.
 */
const MACHINE_DECIDED = /p\(9\d\)|dropped_iterations/u;

describe('the deployed load profile', () => {
    it('is not vacuous: deployed-capable scripts exist and share three common libs', () => {
        expect(deployedCapableScripts().length).toBeGreaterThan(0);
        expect(commonLibs().length).toBe(3);
    });

    it('⛔ every service load lib exports the profile seam', () => {
        for (const lib of commonLibs()) {
            const source = read(lib);

            expect(source, `${lib} has no LOAD_PROFILE`).toContain('LOAD_PROFILE');
            expect(source, `${lib} has no whenSubstrate`).toContain('export function whenSubstrate');
        }
    });

    it('⛔ no deployed-capable script GATES a machine-decided threshold', () => {
        // The check that actually protects the run: a `p(95)` sitting outside a `whenSubstrate(...)` call
        // is a budget that will fire on a neighbour's traffic.
        const offenders: string[] = [];

        for (const script of deployedCapableScripts()) {
            if (script.includes('tools/loadtest')) {
                continue; // the deployed probe already gates only status facts, by construction
            }

            const source = read(script);
            const block = source.slice(
                source.indexOf('thresholds:'),
                source.indexOf('};', source.indexOf('thresholds:')),
            );
            const gated = block.split('whenSubstrate')[0] ?? '';

            if (MACHINE_DECIDED.test(gated)) {
                offenders.push(script);
            }
        }

        expect(
            offenders,
            `these gate a machine-decided threshold on the deployed profile: ${offenders.join(', ')}`,
        ).toStrictEqual([]);
    });
});
