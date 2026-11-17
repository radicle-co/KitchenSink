/**
 * G3 (ADR-0080): the theme-colour read detector, proven shape by shape. A colour read through `useTheme()` is a colour
 * a component applies by hand at render. Under Tamagui it is a theme token (`$paper`), which follows the scheme with no
 * hook, so these reads are counted down to zero. A press fill (`theme.press`) is counted apart, because it becomes the
 * surface tone's `$…Press` token rather than a role.
 *
 * Not counted: `covers`, `hero`, `status`, `pro` and `scheme`, which stay in `useTheme` by decision.
 */
import { describe, expect, it } from 'vitest';

import { themeColourReads } from './themeColourReads.js';

const NATIVE = 'packages/apps/commise/features/recipes/src/thing/Thing.native.tsx';

const importTheme = `import { useTheme } from '@commise/ui/theme';\n`;

describe('themeColourReads', () => {
    it.each([
        [
            'each member of destructured colors',
            `const { colors } = useTheme();\nconst a = colors.ink;\nconst b = colors.paper;`,
            2,
            0,
        ],
        ['a renamed destructure', `const { colors: c } = useTheme();\nconst a = c.ink;`, 1, 0],
        ['a computed member', `const { colors } = useTheme();\nconst a = colors[role];`, 1, 0],
        ['colors passed whole', `const { colors } = useTheme();\nconst s = stylesFor(colors);`, 1, 0],
        [
            'through a bound theme',
            `const theme = useTheme();\nconst a = theme.colors.ink;\nconst p = theme.press.paper;`,
            1,
            1,
        ],
        ['straight off the call', `const a = useTheme().colors.ink;\nconst p = useTheme().press;`, 1, 1],
        ['a destructured press', `const { press } = useTheme();\nconst p = press.paper;`, 0, 1],
        ['the theme handed on straight off the call', `const s = stylesFor(useTheme());`, 1, 0],
        [
            'a rest binding read as a theme',
            `const { colors, ...rest } = useTheme();\nconst p = rest.press.paper;`,
            0,
            1,
        ],
        ['a nested destructure of colors', `const { colors: { ink, paper } } = useTheme();\nconst a = ink;`, 2, 0],
        ['the whole theme passed to a helper', `const theme = useTheme();\nconst s = fieldStyle(theme);`, 1, 0],
        [
            'colors destructured from a bound theme',
            `const theme = useTheme();\nconst { colors } = theme;\nconst a = colors.ink;`,
            1,
            0,
        ],
        ['a member that stays, off a bound theme', `const theme = useTheme();\nconst a = theme.covers.sage;`, 0, 0],
        [
            'the reads that stay are not counted',
            `const { covers, scheme, hero } = useTheme();\nconst a = covers.sage;`,
            0,
            0,
        ],
        ['the destructuring itself is not a read', `const { colors } = useTheme();`, 0, 0],
        [
            'a useTheme from elsewhere is not the design system’s',
            `import { useTheme } from 'tamagui';\nconst { colors } = useTheme();\nconst a = colors.ink;`,
            0,
            0,
        ],
    ] as const)('%s', (_shape, body, colours, presses) => {
        const source = body.startsWith('import') ? body : importTheme + body;
        const reads = themeColourReads(source, NATIVE);

        expect(reads.colour).toHaveLength(colours);
        expect(reads.press).toHaveLength(presses);
    });

    it('reads the design system’s own relative import of the hook', () => {
        const reads = themeColourReads(
            `import { useTheme } from '../theme/useTheme.js';\nconst { colors } = useTheme();\nconst a = colors.ink;`,
            'packages/apps/commise/ui/src/button/Button.native.tsx',
        );

        expect(reads.colour).toHaveLength(1);
    });
});
