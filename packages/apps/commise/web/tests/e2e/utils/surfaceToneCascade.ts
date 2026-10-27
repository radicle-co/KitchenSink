/**
 * The fixtures and readings behind `surfaceToneCascade.spec.ts`: a real-browser proof of the surface-tone cascade
 * (`componentFixes.md` §10, §10a). jsdom has no stylesheet and so cannot compute an inherited custom property; only a
 * browser can say what colour a focus ring's gap and a press really paint on each surface.
 *
 * The fixtures are built from the very class literals the apps ship (`SURFACE_TONE_CLASS`, `FOCUS_RING_CLASS`,
 * `PRESS_FILL_CLASS`), so a change to a recipe moves the fixture with it and Tailwind has compiled the same strings from
 * the sources. They are injected into a page that already loads the app's stylesheet, so no test route exists.
 */
import type { Locator, Page } from '@playwright/test';

import { role, roleDark } from '@commise/ui/colors';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import {
    pressFillsOf,
    PRESS_FILL_CLASS,
    SURFACE_TONE_CLASS,
    SURFACE_TONE_NAMES,
    SURFACE_TONES,
    type SurfaceTone,
} from '@commise/ui/surface-tone';

/** The scheme the browser is emulating. */
export type Scheme = 'light' | 'dark';

/** What a control on a surface must paint: its focus-ring gap and its pressed background, as `#rrggbb`. */
export interface Expected {
    readonly gap: string;
    readonly press: string;
}

/** The class every fixture control wears: the shipped focus ring and the shipped press, nothing else. */
const CONTROL = `inline-flex min-h-11 items-center rounded-full px-3 text-ink ${FOCUS_RING_CLASS.offset} ${PRESS_FILL_CLASS.pointer}`;

/** The control a fixture holds. */
const control = (name: string): string => `<button type="button" class="${CONTROL}">${name}</button>`;

/** A fixture block: padded, so its own background is visible around the control. */
const block = (classes: string, inner: string): string =>
    `<div class="${classes}" style="margin:8px;padding:12px;width:240px">${inner}</div>`;

/** The names of the fixture controls, by what they sit on. */
export const NAMES = {
    bare: 'Bare control',
    tone: (tone: SurfaceTone): string => `On ${tone} surface`,
    nestedInner: 'Nested in muted',
    nestedOuter: 'After the nested surface',
    inherits: 'Inside a container that states nothing',
    portal: 'In a portal root',
} as const;

/**
 * Inject every fixture into the page: a bare control, one per tone, a muted surface nested in a paper one, a container
 * that states nothing under a paper one, and a popup root appended straight to `<body>` (a portal) beside a muted opener.
 *
 * @param page - A page that loads the app's stylesheet.
 */
export async function mountFixtures(page: Page): Promise<void> {
    const html = [
        block('', control(NAMES.bare)),
        ...SURFACE_TONE_NAMES.map((tone) => block(SURFACE_TONE_CLASS[tone], control(NAMES.tone(tone)))),
        block(
            SURFACE_TONE_CLASS.paper,
            `<div><div>${control(NAMES.inherits)}</div></div><section><div class="${SURFACE_TONE_CLASS.muted}" style="padding:8px">${control(NAMES.nestedInner)}</div></section>${control(NAMES.nestedOuter)}`,
        ),
        block(SURFACE_TONE_CLASS.muted, '<p>The opener of the popup below.</p>'),
    ].join('');

    await page.evaluate(
        ({ markup, portal }) => {
            const host = document.createElement('div');
            host.id = 'surface-tone-fixtures';
            host.setAttribute('style', 'position:fixed;inset:0 auto 0 0;z-index:2147483646;overflow:auto;width:300px');
            host.innerHTML = markup;
            document.body.append(host);

            // A popup root portalled to <body>: outside the muted opener in the DOM, as Radix puts it.
            const root = document.createElement('div');
            root.id = 'surface-tone-portal';
            root.setAttribute('class', portal.classes);
            root.setAttribute('style', 'position:fixed;top:8px;left:320px;z-index:2147483647;padding:12px;width:240px');
            root.innerHTML = portal.inner;
            document.body.append(root);
        },
        { markup: html, portal: { classes: SURFACE_TONE_CLASS.paperOverlay, inner: control(NAMES.portal) } },
    );
}

/** Remove what {@link mountFixtures} added. */
export async function unmountFixtures(page: Page): Promise<void> {
    await page.evaluate(() => {
        document.querySelector('#surface-tone-fixtures')?.remove();
        document.querySelector('#surface-tone-portal')?.remove();
    });
}

/**
 * The expected gap and press for a tone in a scheme, from the same table the apps read. Pure.
 *
 * @param scheme - The emulated scheme.
 * @param tone - The surface.
 */
export function expectedFor(scheme: Scheme, tone: SurfaceTone): Expected {
    const colors = scheme === 'dark' ? roleDark : role;

    return { gap: colors[SURFACE_TONES[tone].fill], press: pressFillsOf(colors, scheme)[tone] };
}

/** `#RRGGBB` as the `rgb(r, g, b)` spelling a computed style uses. */
export function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

/**
 * A hex colour in one spelling: lower case, six digits. A computed custom property keeps the text the stylesheet was
 * minified to (`#fff`), where a token is written `#FFFFFF`; the spec compares colours, not spellings. Pure.
 *
 * @param value - A computed or token colour. Anything that is not a 3- or 6-digit hex colour comes back trimmed.
 */
export function canonicalHex(value: string): string {
    const text = value.trim();
    const short = /^#([\da-f])([\da-f])([\da-f])$/iu.exec(text);

    if (short !== null) {
        return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
    }

    return /^#[\da-f]{6}$/iu.test(text) ? text.toLowerCase() : text;
}

/**
 * Focus a control the way a keyboard does (so `:focus-visible` matches), and read its focus-ring gap: the computed
 * `--tw-ring-offset-color`, and the offset band the browser actually paints in `box-shadow`.
 *
 * @param page - The page.
 * @param control - The control.
 */
export async function readFocusGap(
    page: Page,
    control: Locator,
): Promise<{ readonly offsetColor: string; readonly boxShadow: string; readonly focusVisible: boolean }> {
    await control.scrollIntoViewIfNeeded();
    await control.focus();
    // A programmatic focus after a keyboard event matches :focus-visible; Shift+Tab then Tab lands there by keyboard.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');

    const read = await control.evaluate((element) => {
        const style = getComputedStyle(element);

        return {
            offsetColor: style.getPropertyValue('--tw-ring-offset-color'),
            boxShadow: style.boxShadow,
            focusVisible: element.matches(':focus-visible'),
        };
    });

    return { ...read, offsetColor: canonicalHex(read.offsetColor) };
}

/**
 * Press a control with the mouse and read its background while `:active` and `:hover` hold, then release.
 *
 * @param page - The page.
 * @param control - The control.
 * @returns The computed `background-color` while pressed.
 */
export async function readPressFill(page: Page, control: Locator): Promise<string> {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();

    if (box === null) {
        throw new Error('The fixture control has no box to press.');
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    try {
        return await control.evaluate((element) => getComputedStyle(element).backgroundColor);
    } finally {
        await page.mouse.up();
        await page.mouse.move(0, 0);
    }
}
