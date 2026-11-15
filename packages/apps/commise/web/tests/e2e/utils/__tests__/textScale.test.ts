import { describe, expect, it, vi } from 'vitest';

import { applyTextScale, textScaleOf, type StyleTagPage, type TextScaleTestInfo } from '../textScale';

const infoWith = (metadata: Record<string, unknown>): TextScaleTestInfo => ({ project: { metadata } });

/**
 * The text scale a spec applies. The theme sizes text and spacing in rem, so a root font of N% grows both, as browser
 * text zoom does. These two functions are the only place the percentage is written.
 */
describe('textScaleOf', () => {
    it('reads a numeric scale from the project metadata', () => {
        expect(textScaleOf(infoWith({ textScale: 2 }))).toBe(2);
        expect(textScaleOf(infoWith({ textScale: 1.5 }))).toBe(1.5);
    });

    it('is 1 when the project sets none, or sets something that is not a number', () => {
        expect(textScaleOf(infoWith({}))).toBe(1);
        expect(textScaleOf(infoWith({ textScale: '2' }))).toBe(1);
    });
});

describe('applyTextScale', () => {
    const pageWith = (addStyleTag: StyleTagPage['addStyleTag']): StyleTagPage => ({ addStyleTag });

    it('sets the root font to the scale as a percentage, and forces it over the theme', async () => {
        const addStyleTag = vi.fn(() => Promise.resolve());

        await applyTextScale(pageWith(addStyleTag), 2);

        expect(addStyleTag).toHaveBeenCalledWith({ content: 'html { font-size: 200% !important; }' });
    });

    it('adds nothing at the default scale', async () => {
        const addStyleTag = vi.fn(() => Promise.resolve());

        await applyTextScale(pageWith(addStyleTag), 1);

        expect(addStyleTag).not.toHaveBeenCalled();
    });
});
