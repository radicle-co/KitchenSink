/**
 * The contract `local:up` holds a catalog seed bundle to: the module its handler names must export the two core calls,
 * as functions. The bundle is code this package did not build, so a renamed or missing export must stop the start with
 * a message that names the module, not fail later as `undefined is not a function`.
 */
import { describe, expect, it } from 'vitest';

import { readSeedBundleModule } from '../seedBundleModule.js';

const MODULE = '/tmp/asset.abc/lambdas/seed/handler.js';
const describeSeedBundle = async (): Promise<unknown> => ({ action: 'describe', assetSha: 'a', ledgerSha: null });
const applySeedBundle = async (): Promise<unknown> => ({ outcome: 'applied', changes: 1 });

describe('readSeedBundleModule', () => {
    const target = {
        connection: { host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd' },
        bundleDir: '/tmp/asset.abc',
    };

    it('drives the two calls of a module that exports both, passing the caller its arguments', async () => {
        const seen: unknown[] = [];
        const module = readSeedBundleModule(MODULE, {
            describeSeedBundle: async (argument: unknown) => {
                seen.push(argument);

                return describeSeedBundle();
            },
            applySeedBundle,
            handler: () => undefined,
        });

        expect(await module.describeSeedBundle(target)).toEqual({ assetSha: 'a', ledgerSha: null });
        expect(await module.applySeedBundle({ ...target, expectSeedSha: 'a', log: () => undefined })).toEqual({
            outcome: 'applied',
            changes: 1,
        });
        expect(seen).toEqual([target]);
    });

    it.each<[string, Record<string, unknown>, 'describeSeedBundle' | 'applySeedBundle']>([
        ['a description with no asset digest', { ledgerSha: null }, 'describeSeedBundle'],
        ['a description whose ledger digest is a number', { assetSha: 'a', ledgerSha: 1 }, 'describeSeedBundle'],
        ['an apply with no change count', { outcome: 'applied' }, 'applySeedBundle'],
    ])('refuses %s, rather than reporting it', async (_case, answer, call) => {
        const module = readSeedBundleModule(MODULE, {
            describeSeedBundle: call === 'describeSeedBundle' ? async () => answer : describeSeedBundle,
            applySeedBundle: call === 'applySeedBundle' ? async () => answer : applySeedBundle,
        });
        const run =
            call === 'describeSeedBundle'
                ? module.describeSeedBundle(target)
                : module.applySeedBundle({ ...target, expectSeedSha: 'a', log: () => undefined });

        await expect(run).rejects.toThrow(`${call} answered an unexpected shape`);
    });

    it.each<[string, unknown, string]>([
        ['a module with no applySeedBundle', { describeSeedBundle }, 'applySeedBundle'],
        ['a module with no describeSeedBundle', { applySeedBundle }, 'describeSeedBundle'],
        ['an export that is not a function', { describeSeedBundle, applySeedBundle: 'apply' }, 'applySeedBundle'],
        ['a module that is not an object', undefined, 'describeSeedBundle'],
    ])('refuses %s, naming the module and the export', (_case, value, missing) => {
        expect(() => readSeedBundleModule(MODULE, value)).toThrow(MODULE);
        expect(() => readSeedBundleModule(MODULE, value)).toThrow(missing);
    });
});
