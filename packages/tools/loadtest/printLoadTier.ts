/**
 * Print the k6 scenarios in one tier, one repo-relative path per line.
 *
 * A Facade over {@link scriptsInTier}: stdout is a shell's contract, so the workflow consumes the derived
 * partition instead of restating it. ⛔ The CI job must contain NO `.load.js` literal — a list in YAML
 * cannot detect that it is incomplete, and a scenario missing from it is a performance gate that silently
 * never runs, which is the defect `k6LoadTierWiring.test.ts` exists to catch.
 *
 * Usage: `npx tsx printLoadTier.ts deployed-capable [<service-directory-fragment>] --target <sandbox|prod>`
 *
 * ⛔ `--target` IS REQUIRED — the rule lives in {@link parsePrintLoadTierArgs}, which this file only obeys.
 *
 * @sideEffect Runs `git ls-files`, reads each scenario, writes to stdout.
 */
import { orderedByDeclaration, parsePrintLoadTierArgs, scriptsInTier } from './src/loadTier.js';

const request = parsePrintLoadTierArgs(process.argv.slice(2));

if (request.kind === 'usage') {
    console.error(request.message);
    process.exit(2);
}

for (const script of orderedByDeclaration(scriptsInTier(request.tier, request.target))) {
    if (request.filter === undefined || script.includes(request.filter)) {
        console.log(script);
    }
}
