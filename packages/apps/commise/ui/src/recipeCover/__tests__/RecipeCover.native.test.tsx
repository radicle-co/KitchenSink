import { act, cleanup, render, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCover } from '../RecipeCover.native.js';
import { coverTintOf } from '../coverTint.js';
import { coverTint, coverTintDark } from '../../tokens/covers.js';

/** The system colour scheme the next render sees. */
const scheme = vi.hoisted(() => ({ current: null as 'light' | 'dark' | null }));

vi.mock('react-native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-native')>()),
    useColorScheme: () => scheme.current,
}));
import { nativeTokens } from '../../tokens/native.js';

/**
 * RecipeCover (native) — the native half of spec §1.8: the photo through `expo-image`, else the monogram on the
 * recipe's tint, the letter at 40% of the measured height, the cuisine as an overline only from 96 pt tall.
 */

afterEach(cleanup);

/**
 * Report a laid-out size to a view, the way react-native-web's ResizeObserver does: it calls the handler it parks
 * on the DOM node (`__reactLayoutHandler`), which jsdom never triggers because it lays nothing out.
 */
function layOut(element: Element, width: number, height: number): void {
    const handler = (element as Element & { __reactLayoutHandler?: (event: unknown) => void }).__reactLayoutHandler;

    if (handler === undefined) {
        throw new Error('the view has no layout handler');
    }

    act(() => handler({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
}

describe('RecipeCover (native) — a photo', () => {
    it('draws the photo through expo-image, covering the box, hidden from assistive tech', () => {
        const { container } = render(
            <RecipeCover recipeId="rec_1" title="Lemon tart" photoUrl="https://img.example/tart.jpg" aspect="4:3" />,
        );
        const image = container.querySelector('img');

        expect(image?.getAttribute('src')).toBe('https://img.example/tart.jpg');
        expect(image?.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(screen.queryByText('L')).toBeNull();
    });
});

describe('RecipeCover (native) — a monogram', () => {
    it('grounds the cover in the recipe’s tint and shows the first letter, hidden from assistive tech', () => {
        const { container } = render(<RecipeCover recipeId="rec_42" title="lemon tart" aspect="4:3" />);
        const cover = container.firstElementChild as HTMLElement;

        expect(getComputedStyle(cover).backgroundColor).toBe(formatRgb(coverTint[coverTintOf('rec_42')]));
        expect(cover.getAttribute('aria-hidden')).toBe('true');
        expect(screen.getByText('L')).toBeTruthy();
    });

    it('sets the letter in the display face at 40% of the measured height', () => {
        const { container } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="4:3" />);

        layOut(container.firstElementChild as Element, 160, 120);

        const letter = getComputedStyle(screen.getByText('L'));

        expect(letter.fontFamily).toBe(nativeTokens.fontFace.display.bold);
        expect(letter.fontSize).toBe('48px');
    });

    it('shows the cuisine overline from 96pt tall, and not below', () => {
        const { container } = render(
            <RecipeCover recipeId="rec_42" title="Lemon tart" cuisine="French" aspect="1:1" />,
        );
        const cover = container.firstElementChild as Element;

        layOut(cover, 72, 72);
        expect(screen.queryByText('French')).toBeNull();

        layOut(cover, 96, 96);
        expect(screen.getByText('French')).toBeTruthy();
    });

    it('shows no overline without a cuisine, however tall', () => {
        const { container } = render(<RecipeCover recipeId="rec_42" title="Lemon tart" aspect="band" />);

        layOut(container.firstElementChild as Element, 360, 96);

        expect(container.textContent).toBe('L');
    });

    it.each([
        ['4:3', 4 / 3],
        ['1:1', 1],
    ] as const)('reserves the %s box by its aspect ratio', (aspect, ratio) => {
        const { container } = render(<RecipeCover recipeId="rec_1" title="Tart" aspect={aspect} />);

        expect(Number.parseFloat(getComputedStyle(container.firstElementChild as Element).aspectRatio)).toBeCloseTo(
            ratio,
        );
    });

    it('draws the band 96pt tall across its width', () => {
        const { container } = render(<RecipeCover recipeId="rec_1" title="Tart" aspect="band" />);

        expect(getComputedStyle(container.firstElementChild as Element).height).toBe('96px');
    });
});

describe('RecipeCover (native) — the dark scheme', () => {
    it('grounds the monogram in the tint’s DARK value when the system is dark', () => {
        scheme.current = 'dark';
        const { container } = render(<RecipeCover recipeId="rec_42" title="lemon tart" aspect="4:3" />);

        expect(getComputedStyle(container.firstElementChild as HTMLElement).backgroundColor).toBe(
            formatRgb(coverTintDark[coverTintOf('rec_42')]),
        );
        scheme.current = null;
    });
});
