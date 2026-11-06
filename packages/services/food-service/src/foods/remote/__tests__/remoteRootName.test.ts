/**
 * The name a remote item's root carries (ADR-0055 point 10; `rowEditorOpenDecisions.md` system change 13): the
 * source's name in the catalog's own display form, so the hit the cook picks and the root it becomes read the same.
 */
import { describe, expect, it } from 'vitest';

import { normalizeName } from '../../foodName.js';
import { remoteRootKeyOf, remoteRootNameOf } from '../remoteRootName.js';

describe('remoteRootNameOf', () => {
    it.each<[string, string, string]>([
        ['a plain name', 'Kale, raw', 'Kale, raw'],
        ['surrounding space', '  Kale, raw ', 'Kale, raw'],
        ['an invisible character', 'Kale,​ raw', 'Kale, raw'],
        ['a decomposed accent, composed', 'Crème fraiche', 'Crème fraiche'],
    ])('keeps %s readable as the catalog stores it', (_label, source, root) => {
        expect(remoteRootNameOf(source)).toBe(root);
    });

    /**
     * The catalog writes food names lowercase (`namingRules.md` rule 14), and USDA's Branded names arrive in capitals.
     * A name with no lower-case letter carries no case information, so it is folded; one that has any keeps its case,
     * because there the capitals may be proper nouns ("Cheese, Swiss").
     */
    it.each<[string, string, string]>([
        ['a Branded name in capitals', 'SPAGHETTI', 'spaghetti'],
        ['a Branded name of two words', 'CHEDDAR CHEESE', 'cheddar cheese'],
        ['capitals with digits and punctuation', '100% WHOLE WHEAT BREAD, SLICED', '100% whole wheat bread, sliced'],
        ['capitals with an accent', 'CRÈME FRAÎCHE', 'crème fraîche'],
        ['a name with a proper noun in it', 'Cheese, Swiss', 'Cheese, Swiss'],
        ['a mixed-case brand', "McDONALD'S, Hamburger", "McDONALD'S, Hamburger"],
        ['a capitals name that starts with a digit', '7 UP', '7 up'],
    ])('writes %s as the catalog does', (_label, source, root) => {
        expect(remoteRootNameOf(source)).toBe(root);
    });

    it('is idempotent, because adoption applies it again to the name the search sealed', () => {
        expect(remoteRootNameOf(remoteRootNameOf('  KALE,\u200B RAW '))).toBe('kale, raw');
    });

    it('answers nothing for a name with nothing visible, which no root can carry', () => {
        expect(remoteRootNameOf('​‍ ')).toBe('');
    });
});

describe('remoteRootKeyOf', () => {
    it('keys to the catalog’s dedup key, so a remote name collides with the root that already carries it', () => {
        expect(remoteRootKeyOf('  KALE,\u200B RAW ')).toBe(normalizeName('Kale, raw'));
    });

    it('keys a name with nothing visible to nothing, which no root carries', () => {
        expect(remoteRootKeyOf('\u200B\u200D ')).toBe('');
    });
});
