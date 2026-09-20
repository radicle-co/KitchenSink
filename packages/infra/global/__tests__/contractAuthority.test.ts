// @vitest-environment node
/**
 * Repo-wide guard: **no file under `packages/` cites a superseded hand-written contract as authority.**
 *
 * ## Why the hand-written document is not the authority
 *
 * ADR-0014 makes the SERVICE own its wire types: zod authored beside the controller it serves, copied to
 * `packages/schemas/recipe`, and an `openapi.yaml` DERIVED from that copy. `specs/001-commise-recipe-app/
 * contracts/api.openapi.yaml` predates it and is retained as the historical record — not deleted, because
 * artefacts under `specs/` still cite it and repointing those belongs to their owners.
 *
 * ⛔ TWO DOCUMENTS BOTH READING AS NORMATIVE IS WORSE THAN EITHER ALONE (§15.2(6) / GR-015 §15-a.7), and
 * only one of them is verified: `contract:verify` regenerates the derived document from the zod and fails
 * on any diff, while the hand-written one has never had that property. A source file citing it sends the
 * next contributor to extend the document that nothing checks.
 *
 * ## Why this is DISCOVERED and not a list
 *
 * The task that repointed these citations carried a file list three times and it was wrong every time —
 * once at twelve, once at seven, once at five — because the count moved as work landed and because a naive
 * glob counts `dist/` and `.next/` build output that no one should hand-edit. A list cannot detect that it
 * is stale; `git ls-files` can, and it also excludes build output for free.
 *
 * ⚠️ SCOPE IS `packages/` DELIBERATELY. Citations under `specs/` and `docs/` are still legitimate — that is
 * where the historical record lives and where the document is discussed as a document. What must not happen
 * is a CONSUMER treating it as the contract.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './roleSplitSources.js';

/**
 * Every hand-written contract that a service's authored zod has superseded, and the derived document that
 * replaced it.
 *
 * ⚠️ TWO SERVICES, ONE RULE. Recipe's (001 T186) and identity's (002 T-091) are the same decision under
 * ADR-0014, so they are one guard rather than two copies — the second was about to be written by hand.
 * Food has no hand-written contract to supersede, which is why it is absent rather than exempt.
 */
const SUPERSEDED_CONTRACTS: readonly { readonly cited: string; readonly derived: string }[] = [
    { cited: 'contracts/api.openapi.yaml', derived: 'packages/schemas/recipe/openapi.yaml' },
    { cited: 'contracts/identityApi.openapi.json', derived: 'packages/schemas/identity/openapi.yaml' },
];

/**
 * This file, which necessarily contains the string it forbids.
 *
 * ⚠️ SELF-REFERENTIAL ON PURPOSE, never a hardcoded path: a guard that must name the token it bans is its
 * own first false positive, and an exclusion written as a literal path goes stale the moment the file
 * moves — silently, in the direction where the guard stops checking the file it was moved to.
 */
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url));

/**
 * Every tracked file under `packages/`.
 *
 * @returns Repo-relative paths, build output excluded by construction.
 * @sideEffect Shells out to `git ls-files`.
 */
function trackedPackageFiles(): readonly string[] {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'packages/*'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    })
        .split('\n')
        .filter((path) => path !== '');
}

describe('contract authority (ADR-0014, 001 T186/T187, 002 T-091)', () => {
    it.each(SUPERSEDED_CONTRACTS)('⛔ no file under packages/ cites $cited', ({ cited, derived }) => {
        const citing = trackedPackageFiles().filter((path) => {
            if (path === SELF) {
                return false;
            }

            try {
                return readFileSync(join(REPO_ROOT, path), 'utf8').includes(cited);
            } catch {
                // A path that cannot be read is not a citation. `--others` can race a file being removed.
                return false;
            }
        });

        expect(
            citing,
            `${citing.join('\n')}\n\ncite ${derived} — or the service's authoring \`*.schema.ts\` where the ` +
                'reference is to a SHAPE rather than to a document',
        ).toEqual([]);
    });

    /**
     * ⛔ Without this, a discovery that stopped finding files would make the gate above pass by finding
     * nothing — the failure every derived-set guard in this directory is most exposed to. The floor is the
     * FILE COUNT rather than a path list, so it cannot rot the way the citation list it replaced did.
     */
    it('is not vacuous — it really reads the tree', () => {
        expect(trackedPackageFiles().length).toBeGreaterThan(1_000);
    });

    /**
     * ⛔ The self-exclusion must be REAL, not aspirational. If `SELF` ever stops naming this file — a move,
     * a rename, a change in how the runner resolves `import.meta.url` — the guard silently reports itself
     * forever and the exclusion hides it. Asserting the path resolves is what keeps that visible.
     */
    it('⛔ excludes exactly this file, by self-reference', () => {
        expect(SELF).toBe('packages/infra/global/__tests__/contractAuthority.test.ts');
        expect(trackedPackageFiles()).toContain(SELF);
    });

    /**
     * ⚠️ The replacement must actually exist. A guard that only forbids the old authority would be
     * satisfied by deleting every citation and naming nothing, which is the same "passes by finding
     * nothing" shape one step over.
     */
    it.each(SUPERSEDED_CONTRACTS)('⛔ the derived document replacing $cited exists', ({ derived }) => {
        expect(() => readFileSync(join(REPO_ROOT, derived), 'utf8')).not.toThrow();
    });
});
