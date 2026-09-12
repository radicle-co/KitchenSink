/**
 * U19 — previews stop reporting as production.
 *
 * ⛔ All three Sentry configs read `process.env.NODE_ENV`, and Next sets that to `production` for EVERY
 * production build — including every preview. So every `pr-{N}` deploy reported into the `production`
 * environment, mixed with the events from the deploy real users are on. That is worse than having no
 * environment tag: it makes the production filter untrustworthy in the one direction nobody checks, because
 * a preview's errors look exactly like production's.
 */
import { describe, expect, it } from 'vitest';

import { deployStageFor, releaseFor, tracesSampleRateFor } from '@/lib/sentryStage';

describe('deployStageFor', () => {
    it('⛔ names a PREVIEW by its PR, never `production`', () => {
        expect(deployStageFor({ VERCEL_GIT_PULL_REQUEST_ID: '91', VERCEL_ENV: 'preview' })).toBe('pr-91');
    });

    /**
     * ⛔ THE DEFECT IN ONE CASE. Vercel builds a preview with `NODE_ENV=production`, so the old derivation
     * answered `production` for exactly this environment.
     */
    it('⛔ a preview built with NODE_ENV=production is still a preview', () => {
        expect(deployStageFor({ VERCEL_GIT_PULL_REQUEST_ID: '91', NODE_ENV: 'production' })).toBe('pr-91');
    });

    it('names the real production deploy `prod`', () => {
        expect(deployStageFor({ VERCEL_ENV: 'production' })).toBe('prod');
    });

    it('treats a branch build with no PR as sandbox, not production', () => {
        expect(deployStageFor({ VERCEL_ENV: 'preview' })).toBe('sandbox');
        expect(deployStageFor({})).toBe('sandbox');
    });

    it('honours an explicit override, which is what CI uses for a named stage', () => {
        expect(deployStageFor({ DEPLOY_STAGE: 'dev', VERCEL_ENV: 'production' })).toBe('dev');
    });
});

describe('releaseFor', () => {
    it('is the commit the build came from', () => {
        expect(releaseFor({ VERCEL_GIT_COMMIT_SHA: 'abc123' })).toBe('abc123');
        expect(releaseFor({ GITHUB_SHA: 'def456' })).toBe('def456');
        expect(releaseFor({ SENTRY_RELEASE: 'explicit', VERCEL_GIT_COMMIT_SHA: 'abc123' })).toBe('explicit');
    });

    /**
     * ⚠️ UNDEFINED rather than a placeholder. Sentry associates source maps and regressions with a release,
     * so a made-up value silently groups unrelated deploys together — harder to notice than no release.
     */
    it('⛔ is undefined when unknown — never a placeholder that groups unrelated deploys', () => {
        expect(releaseFor({})).toBeUndefined();
    });
});

describe('tracesSampleRateFor', () => {
    it('samples production down and everything else fully', () => {
        expect(tracesSampleRateFor('prod')).toBe(0.1);
        expect(tracesSampleRateFor('pr-91')).toBe(1.0);
        expect(tracesSampleRateFor('sandbox')).toBe(1.0);
    });

    /**
     * ⚠️ Keyed on the STAGE, not `NODE_ENV`: every preview was sampling at production's rate while being
     * labelled production, so neither number described anything real.
     */
    it("⛔ does not sample a preview at production's rate", () => {
        expect(tracesSampleRateFor('pr-91')).not.toBe(tracesSampleRateFor('prod'));
    });
});
