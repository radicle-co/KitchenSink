/**
 * Which k6 scenarios can run against a DEPLOYED stage, and which are bound to a runner-local substrate.
 *
 * A Specification module: pure verdicts over a script's own source. The verdict is DECLARED in each
 * script's header rather than derived from its code, for the reason recorded in
 * `packages/infra/global/__tests__/loadTierPartition.test.ts` — every derivation tried gives wrong answers,
 * because "my assertion is the substrate" is a fact about what a scenario MEANS, not about what it calls.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The two tiers a scenario can belong to. */
export type LoadTier = 'deployed-capable' | 'substrate-bound';

/**
 * The header declaration, in either comment style this corpus uses:
 *
 *     // @loadTier substrate-bound — the service must be booted trusting a throwaway key
 *      * @loadTier deployed-capable — this IS the deployed probe
 *
 * ⚠️ BOTH forms are accepted because both are present: the twenty-one service scenarios head with `//`
 * lines and `deployedOrigin.load.js` heads with a JSDoc block. A regex that admitted only one silently
 * classified the other as undeclared, which the totality assertion then reports as a missing marker rather
 * than as the parser bug it is.
 *
 * The em dash separator is required, and so is a reason: an unexplained verdict is a guess that survives
 * review by looking like a decision.
 */
export const TIER_MARKER = /^(?:\/\/|\s*\*)\s*@loadTier\s+(deployed-capable|substrate-bound)\s+—\s+(.+)$/mu;

/** The repository root, resolved from this module rather than from the caller's working directory. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** A script's declared tier and the reason for it. */
export interface TierVerdict {
    /** The declared tier. */
    readonly tier: LoadTier;
    /** The stated reason, trimmed. */
    readonly reason: string;
}

/**
 * Read a scenario's declared tier out of its source.
 *
 * @param source - The script's full text.
 * @returns The verdict, or `undefined` when the script declares none.
 */
export function tierOf(source: string): TierVerdict | undefined {
    const match = TIER_MARKER.exec(source);

    if (!match?.[1] || !match[2]) {
        return undefined;
    }

    return { tier: match[1] as LoadTier, reason: match[2].trim() };
}

/**
 * Every committed k6 scenario, repo-relative.
 *
 * ⛔ DISCOVERED from `git ls-files`, never listed. A copy of a list cannot detect that the list is
 * incomplete, and the failure mode here is a scenario that silently belongs to no tier and is therefore
 * run by nothing.
 *
 * @returns The scenario paths, repo-relative.
 * @sideEffect Runs `git ls-files`.
 */
export function allLoadScripts(): readonly string[] {
    return execFileSync('git', ['ls-files', '*.load.js'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((line) => line.length > 0);
}

/**
 * Read a scenario's source from the WORKING TREE.
 *
 * ⚠️ Not `git show HEAD:<path>`, which is what this did first. `allLoadScripts` lists TRACKED paths, so
 * pairing it with a HEAD read means an uncommitted marker is invisible: the totality check (which reads
 * the working tree) passes while the partition reads empty. It would have looked correct in CI, where the
 * tree is always committed, and been undebuggable anywhere else. One source of truth, and it is the tree.
 *
 * @param script - A repo-relative path from {@link allLoadScripts}.
 * @returns Its text.
 * @sideEffect Reads a file.
 */
function sourceOf(script: string): string {
    return readFileSync(join(REPO_ROOT, script), 'utf8');
}

/**
 * The scenarios declaring `tier`.
 *
 * @param tier - The tier to select.
 * @returns Their paths, in discovery order.
 * @sideEffect Runs git.
 */
export function scriptsInTier(tier: LoadTier): readonly string[] {
    return allLoadScripts().filter((script) => tierOf(sourceOf(script))?.tier === tier);
}

/**
 * The scenarios that can be pointed at a deployed stage.
 *
 * @returns Their paths.
 * @sideEffect Runs git.
 */
export function deployedCapableScripts(): readonly string[] {
    return scriptsInTier('deployed-capable');
}

/**
 * The scenarios whose assertion IS the runner-local substrate.
 *
 * @returns Their paths.
 * @sideEffect Runs git.
 */
export function substrateBoundScripts(): readonly string[] {
    return scriptsInTier('substrate-bound');
}
