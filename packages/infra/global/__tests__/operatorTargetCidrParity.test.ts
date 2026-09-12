// @vitest-environment node
/**
 * The destructive CLIs decide which ENVIRONMENT they reached from the server's own IP address, and this pins
 * that decision to the CDK table the addresses actually come from.
 *
 * ⛔ WHY THIS GUARD EXISTS. `operatorIntent.ts` (food) and `unlinkCli.ts` (recipe) each refuse a run whose
 * declared stage is on the other side of the production boundary from the database it opened — the check that
 * stops a production catalog being cleared under `--stage sandbox`, where every other production protection
 * is switched off because they all key off the stage the operator DECLARED. That check works ONLY because
 * ADR-0002 gives each stage a disjoint VPC CIDR, so `10.0.x.x` means production and nothing else does.
 *
 * That is a coupling between two service CLIs and a CDK constant none of them imports, in three separate
 * packages. Nothing else would notice if `cidrForStage` moved: no synthesized template carries a real server
 * address, and every unit fixture writes its own. The failure would be silent and one-directional — the
 * guard would simply stop refusing.
 *
 * ⚠️ It reads the CONSTANTS out of both sources rather than importing them, for two reasons: the values are
 * module-private in the CLIs (exporting them purely to be asserted would widen an API for a test), and
 * reading the text is what catches a prefix that was edited to something the CDK no longer produces.
 *
 * ⛔ The direction that matters is "production is exactly `10.0.`". A prefix that is too NARROW stops
 * refusing, which is the dangerous direction; a prefix that is too WIDE refuses legitimate runs, which is
 * merely annoying. Both are failures, and both fail here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cidrForStage } from '../lib/platform/NetworkStack.js';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The two modules that decide the production boundary from an address. */
const POLICY_MODULES = [
    'packages/services/food-service/src/foods/seed/operatorIntent.ts',
    'packages/services/recipe-service/src/ingredients/unlinkCli.ts',
] as const;

/** `const PRODUCTION_VPC_PREFIX = '10.0.';` → `10.0.` */
const PRODUCTION_PREFIX = /const PRODUCTION_VPC_PREFIX = '(?<prefix>[^']+)';/u;

/** `const NON_PRODUCTION_VPC_PREFIXES = ['10.1.', '10.2.'] as const;` → the listed prefixes */
const NON_PRODUCTION_PREFIXES = /const NON_PRODUCTION_VPC_PREFIXES = \[(?<list>[^\]]+)\]/u;

/** Turn a CIDR into the dotted prefix an `inet_server_addr()` value would start with. */
function addressPrefixOf(cidr: string): string {
    const [network] = cidr.split('/');

    return `${(network ?? '').split('.').slice(0, 2).join('.')}.`;
}

/** Read one policy module's two constants. */
function prefixesDeclaredBy(modulePath: string): { production: string; nonProduction: string[] } {
    const source = readFileSync(path.join(repoRoot, modulePath), 'utf8');
    const production = PRODUCTION_PREFIX.exec(source)?.groups?.['prefix'];
    const listed = NON_PRODUCTION_PREFIXES.exec(source)?.groups?.['list'];

    // Anti-vacuity: a renamed constant must fail here rather than silently match nothing.
    expect(production, `${modulePath} declares no PRODUCTION_VPC_PREFIX`).toBeDefined();
    expect(listed, `${modulePath} declares no NON_PRODUCTION_VPC_PREFIXES`).toBeDefined();

    return {
        production: production ?? '',
        nonProduction: [...(listed ?? '').matchAll(/'(?<value>[^']+)'/gu)].map((match) => match[1] ?? ''),
    };
}

describe('the destructive CLIs classify an address the way ADR-0002 assigns it', () => {
    it.each([...POLICY_MODULES])('%s calls exactly the prod VPC production', (modulePath) => {
        expect(prefixesDeclaredBy(modulePath).production).toBe(addressPrefixOf(cidrForStage('prod')));
    });

    it.each([...POLICY_MODULES])('%s calls every other assigned range non-production', (modulePath) => {
        // `cidrForStage` answers the sandbox range for `sandbox` and one shared fallback for every other
        // stage, so those two are the whole non-production space the scheme can produce.
        const assigned = [cidrForStage('sandbox'), cidrForStage('dev')].map(addressPrefixOf);

        expect([...prefixesDeclaredBy(modulePath).nonProduction].sort()).toStrictEqual([...new Set(assigned)].sort());
    });

    it.each([...POLICY_MODULES])('%s never classifies one range as both', (modulePath) => {
        const { production, nonProduction } = prefixesDeclaredBy(modulePath);

        expect(nonProduction).not.toContain(production);
    });

    // The two services deliberately do not share this policy (each module says why), which makes them free to
    // drift — so the agreement they DO need is asserted here rather than left to two docstrings.
    it('has both services agreeing on where the boundary is', () => {
        const [food, recipe] = POLICY_MODULES.map(prefixesDeclaredBy);

        expect(food).toStrictEqual(recipe);
    });

    // The whole point of the coupling: production is separable from sandbox by address alone. If ADR-0002's
    // ranges were ever collapsed, this fails and the guard's docstrings stop being true.
    it('keeps production and sandbox in ranges that cannot be confused', () => {
        expect(addressPrefixOf(cidrForStage('prod'))).not.toBe(addressPrefixOf(cidrForStage('sandbox')));
    });
});
