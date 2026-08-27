/**
 * Repo-wide guard: the RDS storage decision — how much is provisioned, per stage, and whether it can grow.
 *
 * ## What this was measured against (2026-08-27)
 *
 * Both instances were provisioned at **100 GB and holding ~nothing**: `FreeStorageSpace` reported ~101.9 GB
 * free of 100 GB allocated on each. That is ~$23/month of storage for two empty databases, and it was
 * invisible because `allocatedStorage` was a hardcoded literal rather than a stage-derived value like
 * `dbInstanceSize` two lines above it.
 *
 * Sized against the *full* intended scope — all of USDA FoodData Central including Branded (~1.9M foods,
 * ~30M `food_nutrients` rows) plus 10,000 recipes — the database models to **~10–11 GB**, using the bloaty
 * end of the published pg_trgm index ratios. The RDS minimum is 20 GB, so even the maximal case cannot fill
 * a small instance. 50 GB for non-prod is generous; prod stays at 100 GB by owner ruling, which also means
 * prod needs no instance replacement.
 *
 * ## Why `maxAllocatedStorage` matters more than the number
 *
 * The sizing above is a MODEL, not a measurement — nothing has ingested the Branded dataset yet, and
 * `usdaBulk.parser.ts` does not even seed it today. Storage autoscaling is what makes being wrong survivable:
 * it costs nothing until used, and it converts "ran out of disk at 3am" into "grew". It was OFF on both
 * instances (`MaxAllocatedStorage: null`), which is the actual defect here — the 100 GB was papering over it.
 *
 * ⚠️ RDS cannot SHRINK allocated storage in place, and restoring a snapshot requires allocated storage >= the
 * snapshot's. So changing the number here does not resize a live instance; it governs the next one built.
 * Sandbox reaches it by being rebuilt (ADR-0028), prod deliberately never does.
 */
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';

const env = { account: '123456789012', region: 'us-east-1' };

const dbProps = (stage: string): Record<string, unknown> => {
    const app = new App();
    const network = new NetworkStack(app, `Network-${stage}`, { env, stage });
    const data = new DataStack(app, `Data-${stage}`, { env, network, stage });
    const instances = Object.values(Template.fromStack(data).findResources('AWS::RDS::DBInstance'));

    expect(instances).toHaveLength(1);

    return (instances[0] as { Properties: Record<string, unknown> }).Properties;
};

describe('RDS storage sizing', () => {
    it('keeps prod at 100 GB — owner ruling, and prod is never rebuilt to reach a new number', () => {
        expect(dbProps('prod')['AllocatedStorage']).toBe('100');
    });

    it('provisions non-prod at 50 GB rather than copying prod', () => {
        for (const stage of ['sandbox', 'dev']) {
            expect(dbProps(stage)['AllocatedStorage']).toBe('50');
        }
    });

    it('is derived from the stage, not a shared literal', () => {
        expect(dbProps('prod')['AllocatedStorage']).not.toBe(dbProps('sandbox')['AllocatedStorage']);
    });

    it('enables storage autoscaling on every stage, so a wrong estimate grows instead of failing', () => {
        for (const stage of ['prod', 'sandbox']) {
            const max = Number(dbProps(stage)['MaxAllocatedStorage']);

            expect(Number.isFinite(max)).toBe(true);
            expect(max).toBeGreaterThan(Number(dbProps(stage)['AllocatedStorage']));
        }
    });

    it('leaves enough headroom above the modelled full-scope size (~11 GB) to be uninteresting', () => {
        // Not a tautology: it fails if anyone "optimises" non-prod down toward the 20 GB RDS minimum, where
        // a Branded ingest's index-build high-water mark would sit uncomfortably close.
        expect(Number(dbProps('sandbox')['AllocatedStorage'])).toBeGreaterThanOrEqual(50);
    });
});
