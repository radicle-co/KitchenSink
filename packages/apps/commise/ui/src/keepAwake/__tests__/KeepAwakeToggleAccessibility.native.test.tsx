/**
 * KeepAwakeToggle (native) — what VoiceOver and TalkBack actually receive. react-native-web, which the sibling suite runs on,
 * does not render `accessibilityHint`, so that suite cannot see it; this one stands in for `PressScale` and reads the props the
 * toggle hands it. The designer keeps "Keeps the screen awake while you cook." as the switch's accessibility hint only
 * (spoken after the name and the state), never as visible text.
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PressScale as PressScaleAdapter } from '../../pressScale/PressScale.native.js';
import { KeepAwakeToggle } from '../KeepAwakeToggle.native.js';

const seen = vi.hoisted(() => ({ props: undefined as ComponentProps<typeof PressScaleAdapter> | undefined }));

vi.mock('../../pressScale/index.js', () => ({
    PressScale: (props: ComponentProps<typeof PressScaleAdapter>) => {
        seen.props = props;

        return null;
    },
}));

afterEach(cleanup);

describe('KeepAwakeToggle (native) — what the screen reader receives', () => {
    it('hands the switch its name, its role, its state and the hint', () => {
        render(<KeepAwakeToggle on label="Screen on" hint="Keeps the screen awake." onChange={vi.fn()} />);

        expect(seen.props?.accessibilityRole).toBe('switch');
        expect(seen.props?.accessibilityLabel).toBe('Screen on');
        expect(seen.props?.checked).toBe(true);
        expect(seen.props?.accessibilityHint).toBe('Keeps the screen awake.');
    });

    it('hands no hint when it is given none, and draws no hint text', () => {
        render(<KeepAwakeToggle on={false} label="Screen on" onChange={vi.fn()} />);

        expect(seen.props?.accessibilityHint).toBeUndefined();
        expect(screen.queryByText('Keeps the screen awake.')).toBeNull();
    });
});
