/**
 * No mobile screen may paint an OPAQUE canvas of its own — doing so hides the root beach-glow gradient.
 *
 * The gradient fix (issue #145) works only if the root `AppCanvas` is actually visible: a screen whose
 * outermost container still sets `backgroundColor: palette.sand` covers the ramp completely and renders the
 * flat page the wireframes never had. That failure is invisible to a rendering test — the gradient IS in the
 * tree, just occluded — and jsdom has no compositor to catch it, so the invariant is asserted against the
 * SOURCES instead.
 *
 * This mirrors `tests/intlPolyfills.test.ts`, which likewise pins a list against what the shared sources
 * actually call rather than trusting a comment to stay true. Mutation lens: reintroduce the flat fill on any
 * screen and this fails, naming the file.
 *
 * Scope note — only the CANVAS is banned. Cards, chips, pills, sheets and skeletons legitimately paint solid
 * fills over the gradient, so the check targets the opaque page-background colour on a full-bleed container,
 * not every use of a palette colour.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Mobile sources whose outermost view is a full-screen container. */
const SCREEN_DIRS = ['src/screens', 'src/components/home'] as const;

/** The opaque page-background fills that must never dress a screen-level container again. */
const OPAQUE_CANVAS_FILLS = ['palette.sand', 'palette.pearl', 'palette.white'] as const;

/**
 * Every `.tsx` source directly under the given directories, as `[relativePath, contents]`.
 *
 * @sideEffect Reads the mobile sources from disk.
 */
function screenSources(): readonly (readonly [string, string])[] {
    return SCREEN_DIRS.flatMap((dir) =>
        readdirSync(dir)
            .filter((name) => name.endsWith('.tsx'))
            .map((name) => [join(dir, name), readFileSync(join(dir, name), 'utf8')] as const),
    );
}

describe('mobile canvas — the root gradient is never occluded by a screen', () => {
    it('finds the screen sources it claims to guard (a silent empty sweep would pass vacuously)', () => {
        const sources = screenSources();

        expect(sources.length).toBeGreaterThan(8);
        expect(sources.map(([path]) => path)).toContain(join('src', 'screens', 'HomeScreen.tsx'));
    });

    it('has no screen-level container painting an opaque page background', () => {
        // A container is the full-bleed one: `flex: 1` in the same style object as the fill.
        const containerFill = /\{[^{}]*\bflex:\s*1\b[^{}]*\}/g;
        const offenders: string[] = [];

        for (const [path, source] of screenSources()) {
            for (const style of source.match(containerFill) ?? []) {
                if (OPAQUE_CANVAS_FILLS.some((fill) => style.includes(`backgroundColor: ${fill}`))) {
                    offenders.push(`${path}: ${style.replace(/\s+/g, ' ').trim()}`);
                }
            }
        }

        expect(offenders, 'these full-bleed containers occlude the root beach-glow canvas').toEqual([]);
    });
});
