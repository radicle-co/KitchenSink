/**
 * Components take colour from ROLES only, so they render in both themes (`docs/design/uiOverhaul/ownerDecisions.md`
 * D15; `darkTheme.md` §6.6 and §7.3). The reader and the six shapes are `colourRoles.ts`.
 *
 * ⛔ IT ENUMERATES NOTHING. Candidates are every app source file on disk; colour names are parsed out of
 * `tokens/colors.ts`. The reader is proven against the fixture table below before it is trusted with the tree.
 *
 * ## The ratchet — it only goes down
 *
 * The design system (`ui/src`, minus the token modules, the theme module and test support) holds at ZERO: every
 * primitive must render in both themes. The one named exemption carries its reason below. Everywhere else, `colourRolesBaseline.json` records each file's count. A file may not exceed its
 * count, a file not listed may not have any, and a file that drops BELOW its count fails until the count is lowered in
 * the same change — so the number recorded is always the number that is true, and it can only fall.
 *
 * ✅ THE FIX FOR A FAILURE: use the role utility (`bg-paper`, `text-ink-muted`, `border-line-control`, `hover:bg-ink/6`)
 * or, on native, a colour from `useTheme()` applied at render, with the `StyleSheet` holding layout only. A colour the
 * roles lack is a design decision for `staff-ux-engineer` (`darkTheme.md` is the table).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

import { colourFindings, realUnthemedColourNames, unthemedColourNames, type ColourFinding } from './colourRoles.js';
import { repoRoot } from './serviceSources.js';

const FIXTURE_COLOURS = `
export const palette = { seafoam: '#31807A', 'ocean-dark': '#2A6B65', white: '#FFFFFF' } as const;
export const semantic = { card: palette.white, border: '#000' } as const;
`;

const names = unthemedColourNames(FIXTURE_COLOURS);

const kinds = (source: string, file = 'fixture.tsx'): readonly ColourFinding['kind'][] =>
    colourFindings(source, file, names).map((finding) => finding.kind);

describe('the colour reader', () => {
    it('reads the colour names out of the colours module, kebab-cased, plus white and black', () => {
        expect([...names].sort()).toEqual(['black', 'border', 'card', 'ocean-dark', 'seafoam', 'white']);
    });

    const cases: readonly (readonly [string, string, readonly ColourFinding['kind'][]])[] = [
        ['a palette class', `const c = 'bg-seafoam px-4';`, ['raw-colour-class']],
        ['a kebab palette class', `const c = 'text-ocean-dark';`, ['raw-colour-class']],
        ['a variant and an opacity', `const c = 'hover:bg-seafoam/10';`, ['raw-colour-class']],
        ['an important, negative-free utility', `const c = '!text-white';`, ['raw-colour-class']],
        ['a semantic class', `const c = 'bg-card ring-border';`, ['raw-colour-class', 'raw-colour-class']],
        ['a Tailwind default scale', `const c = 'text-red-500';`, ['raw-colour-class']],
        ['an arbitrary hex class', `const c = 'bg-[#123456]';`, ['hex-literal', 'raw-colour-class']],
        ['a class in JSX', `const A = () => <div className="border-seafoam" />;`, ['raw-colour-class']],
        ['a class in a template', 'const c = `rounded ${x} text-white`;', ['raw-colour-class']],
        ['a dark variant', `const c = 'dark:bg-paper';`, ['dark-variant']],
        ['a hex string', `const c = { color: '#2D3436' };`, ['hex-literal']],
        ['an rgba string', `const c = 'rgba(0, 0, 0, 0.5)';`, ['rgb-literal']],
        ['a palette import', `import { palette } from '@commise/ui';`, ['palette-import']],
        ['a semantic import', `import { semantic } from '@commise/ui/colors';`, ['palette-import']],
        ['a relative token import', `import { palette } from '../tokens/colors.js';`, ['palette-import']],
        ['a glass import', `import { glass } from '../tokens/gradients.js';`, ['palette-import']],
        ['a themed gradient import', `import { gradient } from '../tokens/gradients.js';`, []],
        ['a static role import', `import { role } from '@commise/ui/colors';`, ['static-role-import']],
        [
            'a colour in a StyleSheet',
            `const s = StyleSheet.create({ a: { backgroundColor: t, padding: 4 }, b: { borderTopColor: x } });`,
            ['static-stylesheet-colour', 'static-stylesheet-colour'],
        ],
        // Shapes that are NOT findings.
        ['a role class', `const c = 'bg-paper text-ink-muted border-line-control hover:bg-ink/6';`, []],
        ['a type-size utility', `const c = 'text-body text-label text-caption';`, []],
        ['a non-colour border or ring', `const c = 'border ring-2 ring-offset-2 border-2 shadow-sm';`, []],
        ['transparent and current', `const c = 'bg-transparent text-current border-current';`, []],
        ['a type-only import', `import type { palette } from '@commise/ui';`, []],
        ['a role type import', `import { type Role } from '@commise/ui/colors';`, []],
        ['an unrelated module', `import { palette } from './myPalette.js';`, []],
        [
            'a transparent StyleSheet colour',
            `const s = StyleSheet.create({ a: { backgroundColor: 'transparent' } });`,
            [],
        ],
        ['a colour outside a StyleSheet', `const style = { backgroundColor: theme.paper };`, []],
        ['a colour named in a comment', `// bg-seafoam #2D3436 rgba(0,0,0,1)\nconst c = 1;`, []],
        ['a URL fragment', `const href = '/recipes#steps';`, []],
        ['an HTML entity', `const t = '&#8230;';`, []],
    ];

    for (const [shape, source, expected] of cases) {
        it(`reads ${shape}`, () => {
            expect(kinds(source)).toEqual(expected);
        });
    }
});

/** The files a component lives in: every app source module but tokens, test support and tests. */
const componentSources = (): readonly string[] =>
    globSync('packages/apps/commise/**/src/**/*.{ts,tsx}', {
        cwd: repoRoot,
        ignore: [
            '**/node_modules/**',
            '**/dist/**',
            '**/__tests__/**',
            '**/__fixtures__/**',
            '**/*.test.ts',
            '**/*.test.tsx',
            '**/*.d.ts',
            'packages/apps/commise/ui/src/tokens/**',
            'packages/apps/commise/ui/src/testing/**',
            'packages/apps/commise/ui/src/theme/**',
            '**/test-utils/**',
        ],
    }).sort();

/** The design system, held at zero. */
const DESIGN_SYSTEM = 'packages/apps/commise/ui/src/';

/**
 * Named design-system exemptions, each with its count, its reason and the slice that discharges it. The count is held
 * exactly, so an exempt file cannot grow; the entry is deleted when its file reaches zero.
 */
const DESIGN_SYSTEM_EXEMPTIONS: Readonly<Record<string, { readonly count: number; readonly reason: string }>> = {
    'packages/apps/commise/ui/src/surface/GlassCard.tsx': {
        count: 1,
        reason: 'D12 takes glass off content cards; slices 3 and 4 rebuild the cards and retire this tier from them.',
    },
    'packages/apps/commise/ui/src/surface/GlassCard.native.tsx': {
        count: 1,
        reason: 'D12 takes glass off content cards; slices 3 and 4 rebuild the cards and retire this tier from them.',
    },
};

const BASELINE_FILE = path.join(import.meta.dirname, 'colourRolesBaseline.json');

/** Each file's current count. */
function measured(): Readonly<Record<string, number>> {
    const colourNames = realUnthemedColourNames();

    return Object.fromEntries(
        componentSources()
            .map(
                (file) =>
                    [
                        file,
                        colourFindings(readFileSync(path.join(repoRoot, file), 'utf8'), file, colourNames).length,
                    ] as const,
            )
            .filter(([, count]) => count > 0),
    );
}

describe('components take colour from roles only', () => {
    const counts = measured();
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Readonly<Record<string, number>>;

    it('discovers the components, including a primitive and a screen (a vacuous pass would hide the rule)', () => {
        expect(componentSources()).toContain('packages/apps/commise/ui/src/button/Button.tsx');
        expect(componentSources()).toContain('packages/apps/commise/mobile/src/screens/RecipeEditorScreen.tsx');
    });

    it('holds the design system at zero, but for its named exemptions', () => {
        expect(
            Object.keys(counts).filter((file) => file.startsWith(DESIGN_SYSTEM) && !(file in DESIGN_SYSTEM_EXEMPTIONS)),
        ).toEqual([]);
    });

    it('holds each exemption at exactly its recorded count — it may not grow, and a drop is written down', () => {
        const drift = Object.entries(DESIGN_SYSTEM_EXEMPTIONS)
            .filter(([file, { count }]) => (counts[file] ?? 0) !== count)
            .map(([file, { count }]) => `${file}: recorded ${count}, now ${counts[file] ?? 0}`);

        expect(drift).toEqual([]);
    });

    it('lets no file exceed its recorded count, and no unrecorded file have any', () => {
        const over = Object.entries(counts)
            .filter(([file, count]) => count > (baseline[file] ?? 0))
            .map(([file, count]) => `${file}: ${count} > ${baseline[file] ?? 0}`);

        expect(over.filter((line) => !line.startsWith(DESIGN_SYSTEM))).toEqual([]);
    });

    it('records no file above its true count — a drop is written down in the same change', () => {
        const stale = Object.entries(baseline)
            .filter(([file, count]) => (counts[file] ?? 0) < count)
            .map(([file, count]) => `${file}: recorded ${count}, now ${counts[file] ?? 0}`);

        expect(stale).toEqual([]);
    });

    it('records no design-system file, which may never be ratcheted', () => {
        expect(Object.keys(baseline).filter((file) => file.startsWith(DESIGN_SYSTEM))).toEqual([]);
    });
});
