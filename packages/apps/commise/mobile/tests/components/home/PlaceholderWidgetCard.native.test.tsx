/**
 * The shell every roadmap placeholder shares (native): the real widget's title in the `cardTitle` role and `ink`, and
 * the "Soon" badge in the `caption` role and `inkMuted`, like the web card's `text-card-title text-ink` and
 * `text-caption text-ink-muted`.
 *
 * Both draw through the design system's `Text` (ADR-0080), so they follow the device's dark scheme and the 2x text cap.
 * Every expected value is read from the tokens, so a scale or palette change moves this test with it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

import { PlaceholderWidgetCard } from '../../../src/components/home/skeletons/PlaceholderWidgetCard.js';

const TITLE = 'Today’s nutrition';
const SOON = 'Soon';

afterEach(cleanup);

const card = (
    <PlaceholderWidgetCard title={TITLE} soonLabel={SOON}>
        {null}
    </PlaceholderWidgetCard>
);

describe('PlaceholderWidgetCard (native) — type and colour', () => {
    it.each([
        [TITLE, 'cardTitle'],
        [SOON, 'caption'],
    ] as const)('sets “%s” in the %s role', (text, typeRole) => {
        const spec = nativeTokens.type[typeRole];
        renderWithTamagui(card, 'light');
        const style = getComputedStyle(screen.getByText(text));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)(
        'paints the title in ink and the badge in inkMuted in the %s scheme',
        (scheme) => {
            renderWithTamagui(card, scheme);
            const roles = rolesFor(scheme);

            expect(resolvedColour(screen.getByText(TITLE), 'color')).toBe(rgb(roles.ink));
            expect(resolvedColour(screen.getByText(SOON), 'color')).toBe(rgb(roles.inkMuted));
        },
    );
});
