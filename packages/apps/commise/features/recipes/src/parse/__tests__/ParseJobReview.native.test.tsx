/**
 * Native component tests for the review leaf (react-native-web under jsdom).
 *
 * Mirrors the web leaf state for state — loading, missing, failed, expired, running, stalled, settling,
 * ready, the per-line branches, the edit affordance and the correction seam — so the two platforms cannot
 * drift on WHICH control a cook is offered in which state. That parity is the point: the judgements all
 * come from `model.ts`, and these tests are what stop one platform quietly rendering a retry the other
 * withholds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Text } from 'react-native';
import { useState, type JSX } from 'react';

import type { ParseJobLineView, ParseJobResponse, ParseProposal } from '@kitchensink/recipe-service-client';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ParseJobReview } from '../ParseJobReview.native.js';
import { recipeParseMessages } from '../messages.js';
import { toParseJobProgress } from '../model.js';
import type { ParseJobViewState } from '../model.js';
import type { ParseJobReviewProps } from '../props.js';

const messages = recipeParseMessages.en;

afterEach(cleanup);

function proposal(overrides: Partial<ParseProposal> = {}): ParseProposal {
    return {
        raw: '2 cups flour',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
        foods: [{ name: 'flour', prep: null }],
        reviewReasons: [],
        ...overrides,
    };
}

function line(overrides: Partial<ParseJobLineView> = {}): ParseJobLineView {
    return { lineIndex: 0, sourceLine: '2 cups flour', status: 'pending', proposal: null, ...overrides };
}

function withJob(kind: 'running' | 'stalled' | 'settling' | 'ready', lines: readonly ParseJobLineView[]) {
    const status: ParseJobResponse['status'] =
        kind === 'ready' ? 'complete' : kind === 'settling' ? 'partial' : 'running';
    const job: ParseJobResponse = {
        id: '00000000-0000-4000-8000-00000000d001',
        status,
        createdAt: '2026-09-02T11:59:00.000Z',
        expiresAt: '2026-09-03T11:59:00.000Z',
        lines: [...lines],
    };

    return { kind, job, progress: toParseJobProgress(job) } as ParseJobViewState;
}

function renderReview(state: ParseJobViewState, overrides: Partial<ParseJobReviewProps> = {}) {
    const props: ParseJobReviewProps = {
        state,
        retry: { run: vi.fn(), busy: false, notice: undefined },
        edit: { submit: vi.fn(), busyLineIndex: undefined, notice: undefined },
        onStartOver: vi.fn(),
        onBack: vi.fn(),
        ...overrides,
    };

    render(<ParseJobReview {...props} />);

    return props;
}

describe('ParseJobReview (native) — the states with no job to show', () => {
    it('announces the load', () => {
        renderReview({ kind: 'loading' });

        expect(screen.getByText(messages.loading)).toBeTruthy();
    });

    it('reports a missing job as ONE answer — never as an authorization failure', () => {
        renderReview({ kind: 'missing' });

        expect(screen.getByText(messages.missing)).toBeTruthy();
    });

    it('reports a load failure', () => {
        renderReview({ kind: 'failed' });

        expect(screen.getByText(messages.failed)).toBeTruthy();
    });

    it('⛔ offers a fresh start and NOT a retry for an expired job', () => {
        renderReview({ kind: 'expired', job: undefined });

        expect(screen.getByText(messages.expired)).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.startOverAction })).toBeTruthy();
        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
    });
});

describe('ParseJobReview (native) — a job in progress', () => {
    const inFlight = [line({ lineIndex: 0, status: 'parsed', proposal: proposal() }), line({ lineIndex: 1 })];

    it('reports progress as settled-of-total', () => {
        renderReview(withJob('running', inFlight));

        expect(screen.getByText('1 of 2 lines read')).toBeTruthy();
    });

    it('⛔ does NOT count a retryable line as read', () => {
        renderReview(withJob('settling', [line({ status: 'failed_retryable' }), line({ lineIndex: 1 })]));

        expect(screen.getByText('0 of 2 lines read')).toBeTruthy();
    });

    it('offers no controls while a healthy job is simply running', () => {
        renderReview(withJob('running', inFlight));

        expect(screen.getByText(messages.running)).toBeTruthy();
        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
    });

    it('says a stalled job is taking longer than usual, and offers both ways out', () => {
        renderReview(withJob('stalled', inFlight));

        expect(screen.getByText(messages.stalled)).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.retryAction })).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.startOverAction })).toBeTruthy();
    });

    it('⚠️ tells a settling job it may finish on its own — never a flat "failed"', () => {
        renderReview(withJob('settling', [line({ status: 'failed_retryable' })]));

        expect(screen.getByText(messages.settling)).toBeTruthy();
    });

    it('runs the retry command', async () => {
        const props = renderReview(withJob('settling', [line({ status: 'failed_retryable' })]));

        await userEvent.click(screen.getByRole('button', { name: messages.retryAction }));

        expect(props.retry.run).toHaveBeenCalledTimes(1);
    });

    it('refuses a second retry press while one is in flight', () => {
        // Disabled, not merely a no-op handler: a control that looks pressable and does nothing is worse
        // than one that reads as unavailable. `aria-disabled` is what react-native-web projects into the
        // DOM and what assistive tech announces; it is also why `userEvent` refuses to click it at all.
        renderReview(withJob('settling', [line({ status: 'failed_retryable' })]), {
            retry: { run: vi.fn(), busy: true, notice: undefined },
        });

        const control = screen.getByRole('button', { name: messages.retryAction });

        expect(control.getAttribute('aria-disabled')).toBe('true');
        // ⚠️ `aria-busy`, NOT `accessibilityState.busy`. react-native-web projects `accessibilityState`
        // into no DOM attribute at all, so the leaf carries both forms — the ARIA prop for the DOM and the
        // object for the device, which React Native reverse-maps. The repo's `native-a11y` lint rule
        // enforces exactly that pairing, and this assertion is what makes the DOM half falsifiable.
        expect(control.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText(messages.retrying)).toBeTruthy();
    });

    it('surfaces a retry refusal without discarding the job on screen', () => {
        renderReview(withJob('settling', [line({ status: 'failed_retryable', sourceLine: '2 cups flour' })]), {
            retry: { run: vi.fn(), busy: false, notice: messages.retryExpired },
        });

        expect(screen.getByText(messages.retryExpired)).toBeTruthy();
        expect(screen.getByText('2 cups flour')).toBeTruthy();
    });
});

describe('ParseJobReview (native) — a finished job', () => {
    /**
     * ⛔ THE ROW'S NAME MUST CARRY WHAT THE GROUPING SWALLOWS — the regression behind CI run 33946430253.
     *
     * The header is ONE accessibility element (`accessible`), which is what makes its name exist at all on
     * device: on iOS a `View` that is not an accessibility element has no `accessibilityLabel`, and on
     * Android's Fabric renderer a `View` carrying no background, border, `testID` or `accessible` is
     * FLATTENED out of the native view tree, taking its label and its `header` role with it. Being one
     * element also means assistive tech reads the label INSTEAD of the two `Text` children, so a bare
     * "Line 1" would silence both the submitted line and its status — including "Couldn't read".
     *
     * ⚠️ WHAT THIS TIER CANNOT SEE, stated plainly rather than implied: this suite renders through
     * react-native-web under jsdom, where view flattening does not exist and `accessible` is not even
     * projected to the DOM. It therefore pins the NAME, not the mechanism. The mechanism is observable
     * only on a device, which is exactly why `.maestro/recipes/parse-ingredients.yaml` asserts these same
     * two names — it is the tier that caught this, and the only one that could.
     */
    it('⛔ names the row with the line, its text and its status — the grouped header reads all three', () => {
        renderReview(
            withJob('ready', [
                line({ lineIndex: 0, sourceLine: '2 cups flour', status: 'parsed', proposal: proposal() }),
            ]),
        );

        expect(screen.getByRole('heading', { name: 'Line 1: 2 cups flour. Read' })).toBeTruthy();
        // The visible text is unchanged — the composed name adds an announcement, it does not replace copy.
        expect(screen.getByText('2 cups flour')).toBeTruthy();
        expect(screen.getByText(messages.lineParsed)).toBeTruthy();
    });

    it('⛔ carries the FAILING status into the row name, where a cook navigating by heading meets it', () => {
        renderReview(withJob('ready', [line({ lineIndex: 4, sourceLine: '???', status: 'unparseable' })]));

        expect(screen.getByRole('heading', { name: `Line 5: ???. ${messages.lineUnparseable}` })).toBeTruthy();
    });

    it('shows the measure and the foods a parsed line proposed', () => {
        renderReview(withJob('ready', [line({ status: 'parsed', proposal: proposal() })]));

        expect(screen.getByText('2 cup')).toBeTruthy();
        expect(screen.getByText('flour')).toBeTruthy();
    });

    it('⛔ renders NO number for an absent quantity (R40)', () => {
        renderReview(
            withJob('ready', [
                line({ status: 'parsed', proposal: proposal({ quantity: { kind: 'absent' }, unit: null }) }),
            ]),
        );

        expect(screen.getByText(messages.lineNoMeasure)).toBeTruthy();
    });

    it('reports a line that named no foods as a fact, with its localized reason', () => {
        renderReview(
            withJob('ready', [
                line({ status: 'parsed', proposal: proposal({ foods: [], reviewReasons: ['group_header'] }) }),
            ]),
        );

        expect(screen.getByText(messages.lineNoFoods)).toBeTruthy();
        expect(screen.getByText('This looks like a heading, not an ingredient')).toBeTruthy();
    });

    it('⛔ falls back for an unknown review reason — no raw snake_case reaches a cook', () => {
        renderReview(
            withJob('ready', [line({ status: 'parsed', proposal: proposal({ reviewReasons: ['from_the_future'] }) })]),
        );

        expect(screen.getByText(messages.reasonUnknown)).toBeTruthy();
        expect(screen.queryByText('from_the_future')).toBeNull();
    });

    it('⛔ offers NO retry on a finished job — the control would provably do nothing', () => {
        renderReview(withJob('ready', [line({ status: 'parsed', proposal: proposal() })]));

        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
    });

    it('names an unreadable line distinctly from a retryable one', () => {
        renderReview(withJob('ready', [line({ status: 'unparseable' })]));

        expect(screen.getByText(messages.lineUnparseable)).toBeTruthy();
        expect(screen.queryByText(messages.lineRetryable)).toBeNull();
    });
});

describe('ParseJobReview (native) — editing one line', () => {
    const editable = [line({ lineIndex: 3, sourceLine: '2 cps flour', status: 'unparseable' })];

    it('opens an edit field seeded with the line as stored', async () => {
        renderReview(withJob('ready', editable));

        await userEvent.click(screen.getByRole('button', { name: 'Edit line 4' }));

        expect(screen.getByLabelText(messages.lineEditLabel)).toHaveProperty('value', '2 cps flour');
    });

    it('⛔ submits the WIRE index, not the number shown to the cook', async () => {
        const props = renderReview(withJob('ready', editable));

        await userEvent.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await userEvent.clear(screen.getByLabelText(messages.lineEditLabel));
        await userEvent.type(screen.getByLabelText(messages.lineEditLabel), '2 cups flour');
        await userEvent.click(screen.getByRole('button', { name: messages.lineEditSubmit }));

        expect(props.edit.submit).toHaveBeenCalledWith(3, '2 cups flour');
    });

    it('refuses a blank replacement — an edit is not a delete — and SAYS SO', async () => {
        // REWRITTEN: the control is now unavailable rather than a silent no-op, so `userEvent` refuses to
        // press it at all (react-native-web sets `pointer-events: none`). The stronger assertion is the one
        // that was missing before — the cook is TOLD why, with the same shared sentence the paste form uses.
        const props = renderReview(withJob('ready', editable));

        await userEvent.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await userEvent.clear(screen.getByLabelText(messages.lineEditLabel));

        expect(screen.getByRole('button', { name: messages.lineEditSubmit }).getAttribute('aria-disabled')).toBe(
            'true',
        );
        expect(screen.getByText(messages.refusalNoLines)).toBeTruthy();
        expect(props.edit.submit).not.toHaveBeenCalled();
    });

    it('closes the edit field on cancel without submitting', async () => {
        const props = renderReview(withJob('ready', editable));

        await userEvent.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await userEvent.click(screen.getByRole('button', { name: messages.lineEditCancel }));

        expect(screen.queryByLabelText(messages.lineEditLabel)).toBeNull();
        expect(props.edit.submit).not.toHaveBeenCalled();
    });

    it('⛔ marks only the BUSY line busy — two rows must not both look like they are saving', async () => {
        renderReview(withJob('ready', [line({ lineIndex: 0 }), line({ lineIndex: 1 })]), {
            edit: { submit: vi.fn(), busyLineIndex: 1, notice: undefined },
        });

        // Row 2 (wire index 1) is the one saving; row 1 must stay fully usable while it does.
        expect(screen.getByRole('button', { name: 'Edit line 2' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Edit line 1' }).getAttribute('aria-disabled')).not.toBe('true');

        await userEvent.click(screen.getByRole('button', { name: 'Edit line 1' }));
        expect(screen.getByLabelText(messages.lineEditLabel)).toBeTruthy();
    });

    it('⚠️ KEEPS the typed correction when the edit fails — a cook must not retype it', async () => {
        // The editor used to close the moment the request left, discarding the draft on every failure —
        // the exact loss the paste form goes out of its way to prevent one component over.
        const user = userEvent.setup();
        renderReview(withJob('ready', editable), {
            edit: { submit: vi.fn(), busyLineIndex: undefined, notice: messages.lineEditFailed },
        });

        await user.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await user.clear(screen.getByLabelText(messages.lineEditLabel));
        await user.type(screen.getByLabelText(messages.lineEditLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.lineEditSubmit }));

        expect(screen.getByLabelText(messages.lineEditLabel)).toHaveProperty('value', '2 cups flour');
        expect(screen.getByText(messages.lineEditFailed)).toBeTruthy();
    });

    it('⛔ refuses a SECOND submit while the first is still in flight', async () => {
        const user = userEvent.setup();
        const submit = vi.fn();
        const props = (busyLineIndex: number | undefined): ParseJobReviewProps => ({
            state: withJob('ready', editable),
            retry: { run: vi.fn(), busy: false, notice: undefined },
            edit: { submit, busyLineIndex, notice: undefined },
            onStartOver: vi.fn(),
            onBack: vi.fn(),
        });

        const { rerender } = render(<ParseJobReview {...props(undefined)} />);

        await user.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await user.clear(screen.getByLabelText(messages.lineEditLabel));
        await user.type(screen.getByLabelText(messages.lineEditLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.lineEditSubmit }));
        expect(submit).toHaveBeenCalledTimes(1);

        rerender(<ParseJobReview {...props(3)} />);

        expect(screen.getByRole('button', { name: messages.lineEditSubmit }).getAttribute('aria-disabled')).toBe(
            'true',
        );
    });

    it('closes the editor once the STORED line reads back what was sent', async () => {
        // Success is not "the request left" — it is the job view carrying the corrected text.
        const user = userEvent.setup();

        function Harness(): JSX.Element {
            const [lines, setLines] = useState<readonly ParseJobLineView[]>(editable);

            return (
                <ParseJobReview
                    state={withJob('ready', lines)}
                    retry={{ run: vi.fn(), busy: false, notice: undefined }}
                    edit={{
                        submit: (lineIndex, sourceLine) =>
                            setLines([line({ lineIndex, sourceLine: sourceLine.trim(), status: 'pending' })]),
                        busyLineIndex: undefined,
                        notice: undefined,
                    }}
                    onStartOver={vi.fn()}
                    onBack={vi.fn()}
                />
            );
        }

        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await user.clear(screen.getByLabelText(messages.lineEditLabel));
        await user.type(screen.getByLabelText(messages.lineEditLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.lineEditSubmit }));

        expect(screen.queryByLabelText(messages.lineEditLabel)).toBeNull();
        expect(screen.getByText('2 cups flour')).toBeTruthy();
    });

    it('surfaces an edit refusal', () => {
        renderReview(withJob('ready', editable), {
            edit: { submit: vi.fn(), busyLineIndex: undefined, notice: messages.lineEditFailed },
        });

        expect(screen.getByText(messages.lineEditFailed)).toBeTruthy();
    });
});

describe('ParseJobReview (native) — the correction seam', () => {
    it('renders nothing extra when no correction renderer is supplied', () => {
        renderReview(withJob('ready', [line({ status: 'parsed', proposal: proposal() })]));

        expect(screen.queryByText('Correct line 0')).toBeNull();
    });

    it('renders the supplied control once per PARSED line, and hands it that line', () => {
        const renderCorrection = vi.fn((l: ParseJobLineView) => <Text>{`Correct line ${String(l.lineIndex)}`}</Text>);

        renderReview(
            withJob('ready', [
                line({ lineIndex: 0, status: 'parsed', proposal: proposal() }),
                line({ lineIndex: 1, status: 'parsed', proposal: proposal() }),
            ]),
            { renderCorrection },
        );

        expect(screen.getByText('Correct line 0')).toBeTruthy();
        expect(screen.getByText('Correct line 1')).toBeTruthy();
        expect(renderCorrection.mock.calls.map(([l]) => l.lineIndex)).toEqual([0, 1]);
    });

    it('⛔ does NOT offer the correction slot on a line with no proposal — there is nothing to dispute', () => {
        const renderCorrection = vi.fn(() => <Text>Correct</Text>);

        renderReview(withJob('ready', [line({ lineIndex: 0, status: 'unparseable' })]), { renderCorrection });

        expect(renderCorrection).not.toHaveBeenCalled();
        expect(screen.queryByText('Correct')).toBeNull();
    });
});

describe('ParseJobReview (native) — every state offers a way out', () => {
    // ⛔ THE REGRESSION GUARD FOR THE WORST DEFECT THIS SURFACE SHIPPED WITH. On mobile these screens are
    // pushed over a stack with no chrome, so a state that renders no control is a screen a cook cannot
    // leave — and `running` deliberately renders no retry. Asserted per state, on BOTH platforms, so the
    // asymmetry that caused it (web has `AppShell`, mobile has nothing) cannot reopen.
    const states: readonly (readonly [string, ParseJobViewState])[] = [
        ['loading', { kind: 'loading' }],
        ['missing', { kind: 'missing' }],
        ['failed', { kind: 'failed' }],
        ['expired', { kind: 'expired', job: undefined }],
        ['running', withJob('running', [line()])],
        ['stalled', withJob('stalled', [line()])],
        ['settling', withJob('settling', [line({ status: 'failed_retryable' })])],
        ['ready', withJob('ready', [line({ status: 'parsed', proposal: proposal() })])],
    ];

    it.each(states)('offers a back control in the %s state', async (_name, state) => {
        const user = userEvent.setup();
        const props = renderReview(state);

        await user.click(screen.getByRole('button', { name: messages.backAction }));

        expect(props.onBack).toHaveBeenCalledTimes(1);
    });
});
