/**
 * Reference substitution — how an intent that embeds a not-yet-existing row learns its real id.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION, BEFORE THE IMPLEMENTATION EXISTS.
 *
 * ## Why substitution and not a client-minted id
 *
 * The obvious design is to let the client mint the freeform ingredient's id, as it would a recipe's. That is
 * WRONG here, and the reason is in the schema: `ingredients` carries a unique index on `lower(name)` where
 * `is_user_entered`, so freeform rows dedupe BY NAME, GLOBALLY across users. A client-minted id would be
 * ignored the moment any user anywhere already holds that name — the server answers with THEIR row's id.
 *
 * So the client mints a LOCAL REFERENCE, the drainer sends the create, and the server's answer — created or
 * deduped, possibly a stranger's row — is substituted into every intent that pointed at it. The dependency
 * edge carries a VALUE, not merely an ordering constraint.
 */
import { describe, expect, it } from 'vitest';

import { mintLocalRef, resolveRef, substituteRefs, type ResolutionMap } from '../references.js';

describe('mintLocalRef', () => {
    it('produces a distinct reference each time', () => {
        expect(mintLocalRef('ingredient')).not.toBe(mintLocalRef('ingredient'));
    });

    /**
     * ⛔ A LOCAL REF MUST NEVER BE MISTAKEN FOR A SERVER ID. If it were shaped like a uuid it could be sent
     * to the server by a code path that forgot to substitute, and the server would reject it — or worse,
     * accept it as a real foreign key. The prefix makes that mistake visible at a glance and assertable.
     */
    it('⛔ is distinguishable from a server id, so an unsubstituted ref cannot be sent silently', () => {
        expect(mintLocalRef('ingredient')).toMatch(/^local:ingredient:/u);
    });
});

describe('substituteRefs', () => {
    const resolved: ResolutionMap = { 'local:ingredient:abc': 'srv-111' };

    it('rewrites a ref held in a nested payload', () => {
        const payload = { title: 'Stew', ingredients: [{ ingredientId: 'local:ingredient:abc', name: 'gochujang' }] };

        const out = substituteRefs(payload, resolved) as typeof payload;

        expect(out.ingredients[0]?.ingredientId).toBe('srv-111');
    });

    it('leaves unrelated values untouched', () => {
        const payload = { title: 'Stew', servings: 4, tags: ['spicy'] };

        expect(substituteRefs(payload, resolved)).toStrictEqual(payload);
    });

    /**
     * ⛔ AN UNRESOLVED REF IS A THROW, NOT A PASS-THROUGH. Sending a payload still carrying `local:…` would
     * produce a server rejection hours later, attributed to the cook's data rather than to our bug — the
     * worst possible failure attribution. Better to fail loudly at the drain.
     */
    it('⛔ refuses to substitute when a ref it embeds is still unresolved', () => {
        const payload = { ingredients: [{ ingredientId: 'local:ingredient:missing' }] };

        expect(() => substituteRefs(payload, resolved)).toThrow(/unresolved/iu);
    });

    it('is a no-op for a payload holding no refs at all', () => {
        expect(substituteRefs({ title: 'Plain' }, {})).toStrictEqual({ title: 'Plain' });
    });
});

describe('resolveRef', () => {
    it('records the server id a drained intent produced', () => {
        const map = resolveRef({}, 'local:ingredient:abc', 'srv-111');

        expect(map).toStrictEqual({ 'local:ingredient:abc': 'srv-111' });
    });

    /**
     * ⚠️ The server may answer with a DIFFERENT id than any the client imagined — a deduped freeform row
     * belonging to another user. That is the normal case, not an error, and it is exactly why substitution
     * exists rather than a client-minted id.
     */
    it('accepts a server id unrelated to the local reference', () => {
        expect(resolveRef({}, 'local:ingredient:gochujang', 'someone-elses-row')).toStrictEqual({
            'local:ingredient:gochujang': 'someone-elses-row',
        });
    });
});
