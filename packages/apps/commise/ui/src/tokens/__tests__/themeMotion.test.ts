/**
 * The motion half of the emitted theme: the two `--animate-*` tokens and their `@keyframes`, derived from the
 * constants the native leaves already read (`ENTER_DURATION_MS`, `ENTER_RISE_PX`), so web and native cannot drift on
 * the pace or the distance of one gesture.
 */
import { describe, expect, it } from 'vitest';

import { ENTER_DURATION_MS, ENTER_RISE_PX } from '../../motion/enterMotion.js';
import { themeCss } from '../themeCss.js';

const css = themeCss();

/** The text of the first `@theme { … }` block. */
function themeBlock(): string {
    const start = css.indexOf('@theme {');

    return css.slice(start, css.indexOf('\n}\n', start) + 3);
}

/** The body of the named keyframes, whitespace collapsed. */
function keyframesOf(name: string): string | undefined {
    return new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}\\n`, 'u').exec(css)?.[1]?.replace(/\s+/gu, ' ').trim();
}

describe('themeCss — the motion tokens', () => {
    it('emits exactly the animations a component applies, so no dead token ships in the design system', () => {
        const declared = [...themeBlock().matchAll(/--animate-([a-z-]+):/gu)].map((match) => match[1]);
        const keyframes = [...css.matchAll(/@keyframes ([a-z-]+) \{/gu)].map((match) => match[1]);

        expect(declared).toEqual(['section-enter', 'pending-bar-reveal']);
        expect(keyframes).toEqual(['section-enter', 'pending-bar-reveal']);
    });

    it.each([
        ['section-enter', `section-enter ${ENTER_DURATION_MS}ms ease-out both`],
        ['pending-bar-reveal', 'pending-bar-reveal 0s linear both'],
    ])('declares --animate-%s in @theme', (name, value) => {
        expect(themeBlock()).toContain(`    --animate-${name}: ${value};`);
    });

    it('states the enter pace as 400ms, the value the native leaf runs at', () => {
        expect(themeBlock()).toContain('--animate-section-enter: section-enter 400ms ease-out both;');
        expect(ENTER_DURATION_MS).toBe(400);
    });

    it.each(['section-enter'])('rises %s by ENTER_RISE_PX (as rem) while it fades in', (name) => {
        expect(keyframesOf(name)).toBe(
            `from { opacity: 0; transform: translateY(${ENTER_RISE_PX / 16}rem); } to { opacity: 1; transform: none; }`,
        );
    });

    it('reveals the pending bar by opacity alone', () => {
        expect(keyframesOf('pending-bar-reveal')).toBe('from { opacity: 0; } to { opacity: 1; }');
    });

    it('keeps the keyframes OUTSIDE @theme, so they are always emitted and never tree-shaken to used ones', () => {
        expect(themeBlock()).not.toContain('@keyframes');
        expect(css.split('@keyframes ').length - 1).toBe(2);
    });
});
