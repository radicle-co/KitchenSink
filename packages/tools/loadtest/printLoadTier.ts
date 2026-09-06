/**
 * Print the k6 scenarios in one tier, one repo-relative path per line.
 *
 * A Facade over {@link scriptsInTier}: stdout is a shell's contract, so the workflow consumes the derived
 * partition instead of restating it. ⛔ The CI job must contain NO `.load.js` literal — a list in YAML
 * cannot detect that it is incomplete, and a scenario missing from it is a performance gate that silently
 * never runs, which is the defect `k6LoadTierWiring.test.ts` exists to catch.
 *
 * Usage: `npx tsx printLoadTier.ts deployed-capable [<service-directory-fragment>]`
 *
 * @sideEffect Runs `git ls-files`, reads each scenario, writes to stdout.
 */
import { orderedByDeclaration, scriptsInTier, type LoadTier } from './src/loadTier.js';

const TIERS: readonly LoadTier[] = ['deployed-capable', 'substrate-bound'];

const [tier, filter] = process.argv.slice(2);

if (!tier || !TIERS.includes(tier as LoadTier)) {
    console.error(`usage: printLoadTier.ts <${TIERS.join('|')}> [<path-fragment>]`);
    process.exit(2);
}

for (const script of orderedByDeclaration(scriptsInTier(tier as LoadTier))) {
    if (filter === undefined || script.includes(filter)) {
        console.log(script);
    }
}
