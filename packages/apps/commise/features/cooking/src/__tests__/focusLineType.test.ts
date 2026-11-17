import { webTypeRoles } from '@commise/ui/tokens/typography';
import { describe, expect, it } from 'vitest';

import { FOCUS_LINE_TYPE, LINE_TYPE } from '../focusLineType.js';

/** The camelCase role name as a kebab-case class stem: `largeTitle` is `large-title`. */
const kebab = (role: string): string => role.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * The focus line's type, in the one place both platforms read it (both values are `readingLarge`). The web class is the native role's own name, so the two cannot drift.
 */
describe('FOCUS_LINE_TYPE', () => {
    it('names the readingLarge role on the native side', () => {
        expect(FOCUS_LINE_TYPE.nativeTypeRole).toBe('readingLarge');
    });

    it('names a web size class the design system emits for that same role', () => {
        const stem = FOCUS_LINE_TYPE.webClassName.slice('text-'.length);

        expect(Object.keys(webTypeRoles)).toContain(stem);
        expect(stem).toBe(kebab(FOCUS_LINE_TYPE.nativeTypeRole));
    });

    it('starts its web class with text- and the kebab-case of the native role', () => {
        const [sizeClass] = FOCUS_LINE_TYPE.webClassName.split(' ');

        expect(sizeClass).toBe(`text-${kebab(FOCUS_LINE_TYPE.nativeTypeRole)}`);
    });

    it('turns camelCase into kebab-case the way the check expects, so a future role keeps the pairing', () => {
        expect(kebab('readingLarge')).toBe('reading-large');
        expect(kebab('largeTitle')).toBe('large-title');
    });
});

/**
 * The one map from a line's emphasis to its type, which both cooking rows read: the native role and the web class it
 * pairs with. A row passes the native role to its check box too, so the box and its slot are drawn for the text.
 */
describe('LINE_TYPE', () => {
    it('sets the focus line in the focus type and every other line in readingBody', () => {
        expect(LINE_TYPE.focus).toBe(FOCUS_LINE_TYPE);
        expect(LINE_TYPE.other.nativeTypeRole).toBe('readingBody');
    });

    it.each(Object.entries(LINE_TYPE))(
        "pairs the %s line's web class with the kebab-case of its native role, and the design system emits it",
        (_emphasis, { nativeTypeRole, webClassName }) => {
            const stem = webClassName.slice('text-'.length);

            expect(webClassName.startsWith('text-')).toBe(true);
            expect(stem).toBe(kebab(nativeTypeRole));
            expect(Object.keys(webTypeRoles)).toContain(stem);
        },
    );
});
