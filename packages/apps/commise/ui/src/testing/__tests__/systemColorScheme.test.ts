import { afterEach, describe, expect, it } from 'vitest';

import { role, roleDark } from '../../tokens/colors.js';
import { rgb, rolesFor, systemScheme, withSystemScheme } from '../systemColorScheme.js';

afterEach(() => {
    systemScheme.current = null;
});

describe('withSystemScheme', () => {
    it('adds a useColorScheme that reads the scheme the test set last, on every call', () => {
        const patched = withSystemScheme({ keep: 1 });

        expect(patched.useColorScheme()).toBeNull();

        systemScheme.current = 'dark';
        expect(patched.useColorScheme()).toBe('dark');

        systemScheme.current = 'light';
        expect(patched.useColorScheme()).toBe('light');
    });

    it('keeps everything else on the module and replaces an existing useColorScheme', () => {
        const patched = withSystemScheme({ keep: 1, useColorScheme: () => 'light' as const });

        systemScheme.current = 'dark';

        expect(patched.keep).toBe(1);
        expect(patched.useColorScheme()).toBe('dark');
    });
});

describe('rolesFor', () => {
    it.each([
        ['dark', roleDark],
        ['light', role],
        [null, role],
    ] as const)('answers the %s scheme with its role table (no scheme reads as light)', (scheme, table) => {
        expect(rolesFor(scheme)).toBe(table);
    });
});

describe('rgb', () => {
    it('formats a hex colour the way getComputedStyle reports it', () => {
        expect(rgb('#ff8000')).toBe('rgb(255, 128, 0)');
    });

    it('throws on a value that is not a colour, rather than letting two undefined values compare equal', () => {
        expect(() => rgb('not a colour')).toThrow(/not a colour/u);
    });
});
