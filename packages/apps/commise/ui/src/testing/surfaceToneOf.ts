/**
 * @module @commise/ui/testing — the web component tests' reader of the surface a control sits on. jsdom loads no
 * stylesheet, so the inherited `--cm-surface` cannot be computed there; this reads what the cascade reads: the nearest
 * ancestor (the element itself included) whose classes state a tone (`surfaceToneClass`). A bare `bg-*` class states
 * nothing, which is the point: only a surface that STATES itself is read by the controls on it.
 */
import { DEFAULT_SURFACE_TONE, SURFACE_TONE_NAMES, SURFACE_VAR, type SurfaceTone } from '../surfaceTone/surfaceTone.js';
import { surfaceToneClass } from '../surfaceTone/surfaceToneClass.js';

/** The class that sets `--cm-surface`, per tone: the one token that identifies a stated tone. */
const STATING_TOKEN = new Map<string, SurfaceTone>(
    SURFACE_TONE_NAMES.map((tone) => [
        surfaceToneClass(tone)
            .split(/\s+/u)
            .find((token) => token.startsWith(`[${SURFACE_VAR}:`)) as string,
        tone,
    ]),
);

/**
 * The tone of the nearest surface above an element. Pure over the DOM it is given.
 *
 * @param element - The control.
 * @returns The tone it reads; the canvas when no ancestor states one.
 */
export function surfaceToneOf(element: Element): SurfaceTone {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        for (const token of node.className.toString().split(/\s+/u)) {
            const tone = STATING_TOKEN.get(token);

            if (tone !== undefined) {
                return tone;
            }
        }
    }

    return DEFAULT_SURFACE_TONE;
}
