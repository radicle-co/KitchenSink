/**
 * The redesign (workshop 5, round 9: steel on a cool base, dusk dark mode) pinned VALUE BY VALUE to the design
 * session's own sources, which `__fixtures__/redesignValues.ts` copies by script: every web custom property of
 * `tokens.css` (light and dark) and every native replacement of `nativeTheme.json`.
 *
 * Why a table and not hand-picked assertions: "emit exactly these" is only checked if EVERY source value is
 * checked. The test maps each source name onto the name this package emits, parses the real `themeCss()` artifact
 * for the web half, and reads the real token modules for the native half, so web and native cannot disagree with
 * the design or with each other (one token module, two readers).
 *
 * Mutation lens: change any one hex in `colors.ts`, `covers.ts`, `gradients.ts` or `scale.ts` and exactly the row
 * naming it fails; restore a retired key (`seafoam`, `sand`, `honey`, `premium`) and the rename rows fail.
 *
 * Renamed on purpose (a name that still said teal or sand would mislead the next reader): `seafoam` to `steel`,
 * `seafoam-light` to `steel-light`, `sand` to `fog`, `coral` to `cream`, `white` to `cloud` (the card colour; pure white is
 * `snow`, and the emitted theme must carry no `--color-white`), and the cover tints `seafoam` to `steel`, `coral` to
 * `cream` and `premium` to `peach`. Retired because the
 * redesign made each a copy of another entry: `honey` (now the `charcoal` value) and `premium` (now `slate`).
 *
 * Deliberately NOT here: the display font and `fontWeight.bold` (`redesignFont.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { chart, chartDark, palette, role, roleDark, semantic, semanticDark, tint } from '../colors.js';
import { coverTint, coverTintDark } from '../covers.js';
import { kebab } from '../emit.js';
import { gradient, gradientCss, heroDark } from '../gradients.js';
import { radius as scaleRadius, spacing } from '../scale.js';
import { themeCss } from '../themeCss.js';
import { difficultyTone, difficultyToneDark, proTone, proToneDark } from '../tones.js';
import { NATIVE, NATIVE_LITERALS, WEB_DARK, WEB_LIGHT } from '../__fixtures__/redesignValues.js';

/** The source's palette key to ours. Every other key keeps its name. */
const RENAMED = {
    seafoam: 'steel',
    'seafoam-light': 'steel-light',
    sand: 'fog',
    coral: 'cream',
    white: 'cloud',
} as const;
/** The source's cover tint to ours (`premium` is a RETIRED palette key but a live cover tint, so it has its own map). */
const COVER_RENAMED = { seafoam: 'steel', coral: 'cream', premium: 'peach' } as const;
/** Source palette keys that no longer exist, each a copy of another entry. */
const RETIRED = ['honey', 'premium'] as const;
/**
 * Source custom properties the design session RETUNED after the handoff (the PRO badge, 2026-10-27: grey, not the
 * neutral chip; and the neutral difficulty badge, `componentFixes.md` §7: paper under inkMuted, not surfaceMuted under ink). The fixture keeps the handoff's values byte for byte, so these rows are skipped there and pinned in
 * the "retuned" block at the foot instead, the way the danger colours and chart series are.
 */
const RETUNED_AFTER_HANDOFF = new Set([
    'pro-fill',
    'pro-ink',
    ...(['easy', 'medium', 'hard'] as const).flatMap((level) => [
        `difficulty-${level}-fill`,
        `difficulty-${level}-ink`,
    ]),
]);

/** Our name for a source palette key. */
function ours(key: string): string {
    return (RENAMED as Readonly<Record<string, string>>)[key] ?? key;
}

/** Our name for a source cover tint key. */
function coverOurs(key: string): string {
    return (COVER_RENAMED as Readonly<Record<string, string>>)[key] ?? key;
}

/** A CSS value in the one spelling both sides compare in: single quotes, lower case, `, ` closed up, single spaces. Pure. */
function norm(value: string): string {
    return value
        .replace(/"/g, "'")
        .toLowerCase()
        .replace(/\s*,\s*/g, ',')
        .replace(/\s+/g, ' ')
        .trim();
}

/** A px or rem length as px. Pure. */
function px(value: string): number {
    const n = Number.parseFloat(value);

    return value.endsWith('rem') ? n * 16 : n;
}

/** The custom properties of one block of the emitted CSS; a later declaration wins, as in the cascade. Pure. */
function properties(block: string): Map<string, string> {
    return new Map(
        [...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, norm(m[2] as string)]),
    );
}

const css = themeCss();
const themeBlock = css.slice(css.indexOf('@theme {'), css.indexOf('\n}\n', css.indexOf('@theme {')));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const darkBlock = css.slice(darkStart, css.indexOf('\n}\n', darkStart));
const light = properties(themeBlock);
const dark = properties(darkBlock);

const ROLE_NAMES = new Set(Object.keys(role).map(kebab).concat(['bar', 'pro-fill', 'pro-ink']));

/** The emitted name of a source custom property, or `undefined` when this package deliberately emits none. */
function emittedName(source: string): string | undefined {
    if (ROLE_NAMES.has(source)) {
        return `color-${source}`;
    }

    const brand = /^brand-(.+)$/.exec(source)?.[1];

    if (brand !== undefined) {
        return (RETIRED as readonly string[]).includes(brand) ? undefined : `color-${ours(brand)}`;
    }

    const cover = /^cover-(.+)$/.exec(source)?.[1];

    if (cover !== undefined) {
        return `color-cover-${(COVER_RENAMED as Readonly<Record<string, string>>)[cover] ?? cover}`;
    }

    return source;
}

describe('web: tokens.css, light, every custom property', () => {
    const rows = Object.entries(WEB_LIGHT).filter(
        ([name]) => !name.startsWith('space-') && name !== 'font-display' && !RETUNED_AFTER_HANDOFF.has(name),
    );

    it.each(rows)('--%s', (source, value) => {
        const name = emittedName(source);

        if (name === undefined) {
            expect(light.has(`color-${source.replace(/^brand-/, '')}`), `${source} is retired`).toBe(false);

            return;
        }

        if (source.startsWith('radius-')) {
            expect(px(light.get(name) ?? ''), name).toBe(px(value));

            return;
        }

        expect(light.get(name), `--${name} (from --${source})`).toBe(norm(value));
    });

    it('--space-N is the scale.spacing step', () => {
        for (const [step, size] of Object.entries(spacing)) {
            expect(px(WEB_LIGHT[`space-${step}`] ?? ''), `space-${step}`).toBe(size);
        }
    });
});

describe('web: tokens.css, dark, every custom property', () => {
    it.each(Object.entries(WEB_DARK).filter(([name]) => !RETUNED_AFTER_HANDOFF.has(name)))('--%s', (source, value) => {
        const name = emittedName(source);

        expect(dark.get(name ?? ''), `--${name} (from --${source}) in the dark block`).toBe(norm(value));
    });
});

describe('web: the semantic keys follow the roles in both themes (redesign.css)', () => {
    const pairs = [
        ['background', 'canvas'],
        ['foreground', 'ink'],
        ['card', 'paper'],
        ['primary', 'action'],
        ['secondary', 'surfaceMuted'],
        ['muted', 'surfaceMuted'],
        ['accent', 'selectedFill'],
        ['destructive', 'danger'],
        ['border', 'lineDivider'],
        ['ring', 'focusRing'],
    ] as const;

    it.each(pairs)('%s is the %s role', (key, roleName) => {
        expect(semantic[key]).toBe(role[roleName]);
        expect(semanticDark[key]).toBe(roleDark[roleName]);
        expect(light.get(`color-${key}`)).toBe(norm(role[roleName]));
        expect(dark.get(`color-${key}`)).toBe(norm(roleDark[roleName]));
    });
});

describe('web: difficulty is a neutral chip and PRO a grey one, in both themes (redesign.css, tokens.css)', () => {
    // REWRITTEN for `componentFixes.md` §7 (2026-10-27): the handoff's surfaceMuted-under-ink fill vanished on a
    // surfaceMuted parent, so a neutral badge is paper under inkMuted (its 1 px lineDivider edge is the component's).
    // The six `difficulty-*` source rows moved to the retuned set above and are pinned here instead.
    it.each(['easy', 'medium', 'hard'] as const)('%s is paper under inkMuted', (level) => {
        expect(difficultyTone[level]).toEqual({ fill: role.paper, text: role.inkMuted });
        expect(difficultyToneDark[level]).toEqual({ fill: roleDark.paper, text: roleDark.inkMuted });
        expect(light.get(`color-difficulty-${level}-fill`)).toBe(norm(role.paper));
        expect(light.get(`color-difficulty-${level}-ink`)).toBe(norm(role.inkMuted));
        expect(dark.get(`color-difficulty-${level}-fill`)).toBe(norm(roleDark.paper));
        expect(dark.get(`color-difficulty-${level}-ink`)).toBe(norm(roleDark.inkMuted));
    });

    it('PRO is the retuned grey pair, emitted as pro-fill and pro-ink in each theme', () => {
        expect(proTone).toEqual({ fill: '#5C646E', text: '#FFFFFF' });
        expect(proToneDark).toEqual({ fill: '#A3ACB6', text: '#171B20' });
        expect(light.get('color-pro-fill')).toBe('#5c646e');
        expect(light.get('color-pro-ink')).toBe('#ffffff');
        expect(dark.get('color-pro-fill')).toBe('#a3acb6');
        expect(dark.get('color-pro-ink')).toBe('#171b20');
    });
});

describe('native: nativeTheme.json, every replacement', () => {
    it.each(Object.entries(NATIVE['palette'] ?? {}))('palette.%s', (key, value) => {
        if ((RETIRED as readonly string[]).includes(key)) {
            expect(Object.keys(palette)).not.toContain(key);

            return;
        }

        expect(palette[ours(key) as keyof typeof palette], ours(key)).toBe(value);
    });

    it.each(Object.entries(NATIVE['role'] ?? {}))('role.%s', (key, value) => {
        expect(role[key as keyof typeof role]).toBe(value);
    });

    it.each(Object.entries(NATIVE['roleDark'] ?? {}))('roleDark.%s', (key, value) => {
        const photoChip = /^tint\("(#[0-9A-F]{6})", ([0-9.]+)\)$/.exec(value);
        const expected = photoChip === null ? value : tint(photoChip[1] as string, Number(photoChip[2]));

        expect(roleDark[key as keyof typeof roleDark]).toBe(expected);
    });

    it.each(Object.entries(NATIVE['coverTint'] ?? {}))('coverTint.%s', (key, value) => {
        expect(coverTint[coverOurs(key) as keyof typeof coverTint]).toBe(value);
    });

    it.each(Object.entries(NATIVE['coverTintDark'] ?? {}))('coverTintDark.%s', (key, value) => {
        expect(coverTintDark[coverOurs(key) as keyof typeof coverTintDark]).toBe(value);
    });

    it.each(Object.entries(NATIVE['radius'] ?? {}))('radius.%s', (key, value) => {
        expect(scaleRadius[key as keyof typeof scaleRadius]).toBe(Number(value));
    });

    it('the hero gradient is flat: every literal the source replaces is now the canvas', () => {
        const canvas = Object.values(NATIVE_LITERALS['gradient'] ?? {});

        expect(new Set(canvas).size).toBe(1);
        expect(gradient.hero.stops.map((stop) => stop.color.toUpperCase())).toEqual([
            role.canvas.toUpperCase(),
            role.canvas.toUpperCase(),
        ]);
        expect(new Set(Object.values(NATIVE_LITERALS['heroDark'] ?? {}))).toEqual(new Set([roleDark.canvas]));
        expect(heroDark.stops.map((stop) => stop.color.toUpperCase())).toEqual([
            roleDark.canvas.toUpperCase(),
            roleDark.canvas.toUpperCase(),
        ]);
    });
});

describe('web and native read ONE hero, derived from the canvas role', () => {
    it('is 180 degrees from the canvas to the canvas, in both themes (tokens.css)', () => {
        expect(norm(gradientCss(gradient.hero))).toBe(norm(WEB_LIGHT['background-image-hero'] ?? ''));
        expect(norm(gradientCss(heroDark))).toBe(norm(WEB_DARK['background-image-hero'] ?? ''));
    });
});

// The danger colours and the nutrition series were retuned by the design session after the first handoff (they are not in
// tokens.css's chart set, so they are pinned here to the values the session gave, in the order they were given).
describe('the retuned danger colours and nutrition series', () => {
    it('keeps the light danger fill, deepens the light danger text and lightens the dark danger fill', () => {
        expect(role.danger).toBe('#C05238');
        expect(role.dangerText).toBe('#A53E27');
        expect(roleDark.danger).toBe('#E07A60');
    });

    it('presses the danger fill one step deeper in light and one step darker in dark (dangerPressed)', () => {
        expect(role.dangerPressed).toBe('#A33F2A');
        expect(roleDark.dangerPressed).toBe('#CC6A52');
        expect(light.get('color-danger-pressed')).toBe('#a33f2a');
        expect(dark.get('color-danger-pressed')).toBe('#cc6a52');
        expect(role.dangerPressed).not.toBe(role.danger);
        expect(roleDark.dangerPressed).not.toBe(roleDark.danger);
    });

    it('holds the light and dark series, with no teal and five distinct hues', () => {
        expect(chart).toEqual({
            calories: '#325C7F',
            protein: '#B07000',
            carbs: '#3A8A4F',
            fat: '#C0506E',
            fiber: '#7A5AA6',
        });
        expect(chartDark).toEqual({
            calories: '#96BCDE',
            protein: '#E3A43A',
            carbs: '#6CBF86',
            fat: '#EC8EA4',
            fiber: '#B9A2E6',
        });
        expect(new Set(Object.values(chart)).size).toBe(5);
        expect(new Set(Object.values(chartDark)).size).toBe(5);
    });
});

// Tailwind ships its own `white` (#FFFFFF). The card colour used to be a palette key called `white`, which emitted
// `--color-white: #FCFDFF` and quietly repainted every `bg-white` a hair off pure white. It is `cloud` now, and the
// emitted theme must not declare `--color-white` at all, so Tailwind's own stays pure and `snow` names the pure white.
describe('web: the card colour is cloud and Tailwind’s white is left alone', () => {
    it('emits --color-cloud and --color-snow, and no --color-white, in either theme block', () => {
        expect(light.get('color-cloud')).toBe('#fcfdff');
        expect(light.get('color-snow')).toBe('#ffffff');
        expect(light.has('color-white')).toBe(false);
        expect(dark.has('color-white')).toBe(false);
        expect(css).not.toMatch(/--color-white\s*:/);
    });
});
