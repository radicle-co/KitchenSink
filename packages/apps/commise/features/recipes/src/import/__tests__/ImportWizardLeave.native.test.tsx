/**
 * Native component tests for `ImportWizardLeave`, rendered through react-native-web under jsdom. Mirrors
 * `ImportWizardLeave.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportWizardLeave } from '../ImportWizardLeave.native.js';
import { importMessages } from '../messages.js';

const l = importMessages.en.leave;

afterEach(cleanup);

describe('ImportWizardLeave (native)', () => {
    it('says what happens to every recipe, then Keep reviewing or Save and leave', () => {
        const onKeepReviewing = vi.fn();
        const onConfirm = vi.fn();
        render(
            <ImportWizardLeave
                open
                reviewed={14}
                total={309}
                resumeAt={15}
                onKeepReviewing={onKeepReviewing}
                onConfirm={onConfirm}
            />,
        );

        expect(screen.getByText(l.title)).toBeTruthy();
        expect(screen.getByText('You reviewed 14 of 309 recipes.')).toBeTruthy();
        expect(screen.getByText('The other 295 are saved now.')).toBeTruthy();
        expect(
            screen.getByText(
                'Matched foods and the usual defaults are set, and each default keeps its Default tag. Every other line is saved as written, with no food, for you to choose later.',
            ),
        ).toBeTruthy();
        expect(
            screen.getByText('They wait under “To review” in My recipes, and you can pick up at recipe 15.'),
        ).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: l.keep }));
        fireEvent.click(screen.getByRole('button', { name: l.confirm }));

        expect(onKeepReviewing).toHaveBeenCalledTimes(1);
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    // U11: stacked with the PRIMARY LAST, nearest the thumb; Save and leave used to come first, at the top.
    it('stacks Keep reviewing then Save and leave, the primary last', () => {
        render(
            <ImportWizardLeave
                open
                reviewed={14}
                total={309}
                resumeAt={15}
                onKeepReviewing={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        const keep = screen.getByRole('button', { name: l.keep });
        const confirm = screen.getByRole('button', { name: l.confirm });

        expect(keep.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders nothing while closed', () => {
        render(
            <ImportWizardLeave
                open={false}
                reviewed={14}
                total={309}
                resumeAt={15}
                onKeepReviewing={vi.fn()}
                onConfirm={vi.fn()}
            />,
        );

        expect(screen.queryByText(l.title)).toBeNull();
    });
});
