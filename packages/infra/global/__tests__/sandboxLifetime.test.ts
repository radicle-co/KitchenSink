/**
 * Repo-wide guard: the on-demand sandbox's expiry clock (`.github/scripts/sandbox-lifetime.sh`).
 *
 * ## The invariant this protects
 *
 * A sandbox started from the GitHub button is torn down at **midnight America/New_York of the day it was
 * started**. The expiry is computed ONCE, at start, and stamped on every `pr-{N}` stack as an absolute
 * `SandboxExpiresAt` epoch. The reaper then only ever asks "is now past this number" — it never does
 * timezone arithmetic, so it cannot disagree with the workflow that created the environment.
 *
 * ## Why the timezone cannot be hand-rolled as a fixed offset
 *
 * America/New_York is UTC-4 for eight months and UTC-5 for four, and the changeover is what a naive
 * `midnight_utc - 4h` gets wrong twice a year: for a week in November every sandbox would die an hour
 * early, and in March an hour late. Both directions are asserted below against instants that straddle the
 * 2026 transitions (2026-03-08 and 2026-11-01), so a refactor to arithmetic offsets fails here.
 *
 * ## Why a minimum lifetime exists
 *
 * "Midnight of the day created" read literally hands someone who presses the button at 23:50 a ten-minute
 * environment — a full deploy cycle for less time than the deploy takes. Under
 * {@link MIN_LIFETIME_SECONDS} the expiry rolls to the FOLLOWING midnight instead. That is a real rule
 * about how long a preview is useful, not a rounding convenience, so it is asserted at its boundary.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandbox-lifetime.sh', import.meta.url));

/** The minimum useful life of a preview; below it, expiry rolls to the next midnight. */
const MIN_LIFETIME_SECONDS = 2 * 60 * 60;

/** Seconds since the epoch for a UTC instant, so expectations never reuse the script's own maths. */
const utc = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

interface Run {
    readonly out: string;
    readonly status: number;
}

/**
 * Run one subcommand of the real script.
 *
 * @param args - Subcommand and its arguments.
 * @returns stdout plus the exit status.
 * @sideEffect Spawns `bash`.
 */
const run = (...args: readonly string[]): Run => {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    return { out: result.stdout ?? '', status: result.status ?? -1 };
};

/**
 * The `expires-at` verdict for a start instant.
 *
 * @param startedIso - UTC ISO instant the sandbox was started.
 * @returns Epoch seconds the sandbox expires at.
 * @sideEffect Spawns `bash`.
 */
const expiresAt = (startedIso: string): number => {
    const { out, status } = run('expires-at', String(utc(startedIso)));

    expect(status, `expires-at ${startedIso} failed: ${out}`).toBe(0);

    return Number(/^expiresAt=(\d+)$/m.exec(out)?.[1]);
};

describe('sandbox-lifetime.sh', () => {
    it('ships as an executable script', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    describe('expires-at — midnight America/New_York of the day started', () => {
        it('expires at the midnight that ends the day it started', () => {
            // 2026-08-27 15:00 EDT (UTC-4) -> midnight ending 27 Aug ET = 2026-08-28T04:00Z
            expect(expiresAt('2026-08-27T19:00:00Z')).toBe(utc('2026-08-28T04:00:00Z'));
        });

        it('gives a sandbox started just after midnight the whole day', () => {
            // 2026-08-27 00:05 EDT -> still expires at the midnight ENDING 27 Aug
            expect(expiresAt('2026-08-27T04:05:00Z')).toBe(utc('2026-08-28T04:00:00Z'));
        });

        it('uses EDT (UTC-4) for a summer start', () => {
            expect(expiresAt('2026-07-04T16:00:00Z')).toBe(utc('2026-07-05T04:00:00Z'));
        });

        it('uses EST (UTC-5) for a winter start', () => {
            // 2026-12-10 12:00 EST -> midnight ET = 2026-12-11T05:00Z, an hour later in UTC than summer
            expect(expiresAt('2026-12-10T17:00:00Z')).toBe(utc('2026-12-11T05:00:00Z'));
        });

        it('tracks the autumn changeover rather than a fixed offset', () => {
            // 31 Oct is EDT: midnight = 04:00Z. 1 Nov is EST: midnight = 05:00Z.
            expect(expiresAt('2026-10-31T20:00:00Z')).toBe(utc('2026-11-01T04:00:00Z'));
            expect(expiresAt('2026-11-01T20:00:00Z')).toBe(utc('2026-11-02T05:00:00Z'));
        });

        it('tracks the spring changeover rather than a fixed offset', () => {
            // 7 Mar is EST: midnight = 05:00Z. 8 Mar (clocks jumped at 02:00) is EDT: midnight = 04:00Z.
            expect(expiresAt('2026-03-07T18:00:00Z')).toBe(utc('2026-03-08T05:00:00Z'));
            expect(expiresAt('2026-03-08T18:00:00Z')).toBe(utc('2026-03-09T04:00:00Z'));
        });
    });

    describe('expires-at — minimum lifetime', () => {
        it('rolls to the following midnight when started too close to one', () => {
            // 23:50 EDT -> 10 minutes of life; roll forward a full day instead.
            const started = '2026-08-27T03:50:00Z'; // 26 Aug 23:50 EDT
            expect(expiresAt(started)).toBe(utc('2026-08-28T04:00:00Z'));
        });

        it('does not roll when the remaining time is exactly the minimum', () => {
            // 22:00 EDT -> exactly 2h remain, which is enough.
            expect(expiresAt('2026-08-28T02:00:00Z')).toBe(utc('2026-08-28T04:00:00Z'));
        });

        it('rolls one second below the minimum', () => {
            const started = utc('2026-08-28T04:00:00Z') - MIN_LIFETIME_SECONDS + 1;
            const { out } = run('expires-at', String(started));

            expect(Number(/^expiresAt=(\d+)$/m.exec(out)?.[1])).toBe(utc('2026-08-29T04:00:00Z'));
        });

        it('never returns an expiry in the past', () => {
            for (const iso of ['2026-08-27T03:59:59Z', '2026-01-15T04:59:00Z', '2026-06-30T03:00:00Z']) {
                expect(expiresAt(iso)).toBeGreaterThan(utc(iso));
            }
        });
    });

    describe('expires-at — output shape', () => {
        it('also prints an ISO form for the stack tag', () => {
            const { out } = run('expires-at', String(utc('2026-08-27T19:00:00Z')));

            expect(out).toMatch(/^expiresAtIso=2026-08-28T04:00:00Z$/m);
        });
    });

    describe('is-expired', () => {
        it('is false before the expiry', () => {
            expect(run('is-expired', '2000', '1999').out).toMatch(/^expired=false$/m);
        });

        it('is true at and after the expiry', () => {
            expect(run('is-expired', '2000', '2000').out).toMatch(/^expired=true$/m);
            expect(run('is-expired', '2000', '2001').out).toMatch(/^expired=true$/m);
        });
    });

    describe('misuse exits 2 without a verdict', () => {
        it.each([
            ['no subcommand', [] as string[]],
            ['unknown subcommand', ['reap-everything']],
            ['expires-at with no argument', ['expires-at']],
            ['expires-at with a non-numeric start', ['expires-at', 'yesterday']],
            ['expires-at with a negative start', ['expires-at', '-5']],
            ['is-expired missing an argument', ['is-expired', '2000']],
            ['is-expired with a non-numeric now', ['is-expired', '2000', 'now']],
        ])('%s', (_label, args) => {
            const { out, status } = run(...args);

            expect(status).toBe(2);
            expect(out).not.toMatch(/^(expiresAt|expired)=/m);
        });
    });
});
