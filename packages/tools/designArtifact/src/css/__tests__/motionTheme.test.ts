import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postcss, { type AtRule, type Declaration } from 'postcss';
import { describe, expect, it } from 'vitest';

import { COMMISE_ROOT } from '../../config.js';
import { MOTION_THEME_CSS } from '../motionTheme.js';

/** Parses a stylesheet and returns, per animation, its `--animate-*` value and its keyframes, normalised. */
function motionOf(css: string, names: readonly string[]): Record<string, { token: string; keyframes: string }> {
    const root = postcss.parse(css);
    const out: Record<string, { token: string; keyframes: string }> = {};

    for (const name of names) {
        let token = '';
        root.walkDecls(`--animate-${name}`, (decl: Declaration) => {
            token = decl.value;
        });
        let keyframes = '';
        root.walkAtRules('keyframes', (rule: AtRule) => {
            if (rule.params === name) {
                rule.walkComments((comment) => {
                    comment.remove();
                });
                keyframes = rule.toString().replace(/\s+/g, ' ');
            }
        });
        out[name] = { token, keyframes };
    }

    return out;
}

/** The animation names a stylesheet declares as `--animate-*` tokens. */
function declaredNames(css: string): readonly string[] {
    const names: string[] = [];

    postcss.parse(css).walkDecls(/^--animate-/u, (decl) => {
        names.push(decl.prop.replace('--animate-', ''));
    });

    return names;
}

describe('MOTION_THEME_CSS', () => {
    const authority = readFileSync(join(COMMISE_ROOT, 'web/src/app/globals.css'), 'utf8');
    const NAMES = declaredNames(MOTION_THEME_CSS);

    it('declares at least one animation (so the comparison below cannot pass on nothing)', () => {
        const ours = motionOf(MOTION_THEME_CSS, NAMES);

        expect(NAMES.length).toBeGreaterThan(0);

        for (const name of NAMES) {
            expect(ours[name]?.token).not.toBe('');
            expect(ours[name]?.keyframes).toContain('@keyframes');
        }
    });

    it.each(NAMES)('matches the web app globals.css for %s', (name) => {
        expect(motionOf(MOTION_THEME_CSS, NAMES)[name]).toEqual(motionOf(authority, NAMES)[name]);
    });

    it('is detected when the authority drifts', () => {
        const drifted = authority.replace('400ms ease-out both', '900ms ease-out both');

        expect(motionOf(MOTION_THEME_CSS, NAMES)['home-hero-enter']).not.toEqual(
            motionOf(drifted, NAMES)['home-hero-enter'],
        );
    });
});
