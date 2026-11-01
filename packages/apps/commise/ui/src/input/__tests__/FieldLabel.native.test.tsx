/**
 * FieldLabel (native) on the design-system Text (H-1, ADR-0080 §8): its label and hint draw their roles at the system
 * scale up to the 2× ceiling, size and leading together, because React Native on Android leaves the leading of its own
 * text uncapped. The ids its field names stay where they were.
 */
import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithTamagui, resolvedColour } from '../../testing/tamaguiTesting.native.js';
import { role } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { FieldLabel } from '../FieldLabel.native.js';
import { fieldHintId, fieldLabelId } from '../props.js';

afterEach(cleanup);

describe('FieldLabel (native)', () => {
    it('draws the label in the label role and the hint in the caption role, both inkMuted', () => {
        renderWithTamagui(<FieldLabel forId="email" label="Email" hint="We never share it" />, 'light');

        const label = screen.getByText('Email');
        const hint = screen.getByText('We never share it');

        expect(getComputedStyle(label).fontSize).toBe(`${String(nativeTokens.type.label.fontSize)}px`);
        expect(getComputedStyle(hint).fontSize).toBe(`${String(nativeTokens.type.caption.fontSize)}px`);
        expect(resolvedColour(label, 'color')).toBe(formatRgb(role.inkMuted));
        expect(resolvedColour(hint, 'color')).toBe(formatRgb(role.inkMuted));
    });

    it('keeps the ids its field names', () => {
        renderWithTamagui(<FieldLabel forId="email" label="Email" hint="Hint" />, 'light');

        expect(screen.getByText('Email').id).toBe(fieldLabelId('email'));
        expect(screen.getByText('Hint').id).toBe(fieldHintId('email'));
    });

    it('grows the label and its leading to 2× above the cap', () => {
        const { fontSize, lineHeight } = nativeTokens.type.label;

        renderWithTamagui(<FieldLabel forId="email" label="Email" />, 'light', 3.1);

        expect(getComputedStyle(screen.getByText('Email')).fontSize).toBe(`${String(fontSize * 2)}px`);
        expect(getComputedStyle(screen.getByText('Email')).lineHeight).toBe(`${String(lineHeight * 2)}px`);
    });
});
