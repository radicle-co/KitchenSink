/**
 * A module that reaches `node:crypto` in the ONE form the browser-safety walk used to miss.
 *
 * ⛔ THIS IS A NEGATIVE-CONTROL FIXTURE, NOT PRODUCTION CODE, and nothing imports it but the guard. It
 * exists because `browserSafety.test.ts` once passed with `node:crypto` in `core.ts`'s transitive graph: the
 * graph walk had been widened to follow side-effect and dynamic imports while `bareSpecifiers` — the half
 * that names the built-in — still read `from '…'` only. A guard that has never failed is not a guard, and
 * the real tree is clean, so the only way to know the detector still detects is to hand it this shape.
 *
 * ⚠️ `await import('node:crypto')` is not exotic: it is the canonical way to keep a module browser-safe
 * while still hashing on Node, which is exactly how this defect would actually arrive.
 */
export const lazyHash = async (value: string): Promise<string> => {
    const { createHash } = await import('node:crypto');

    return createHash('sha256').update(value).digest('hex');
};
