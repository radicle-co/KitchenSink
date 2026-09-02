// @vitest-environment jsdom
/**
 * Component tests for the WEB review leaf — EVERY state the surface can be in, not the happy path.
 *
 * `loading`, `running`, `stalled`, `settling`, `ready`, `expired` (with and without a job), `missing` and
 * `failed`; plus the per-line branches a `ready` job contains — parsed, pending, unparseable, retryable, a
 * line that named no foods, an unknown review reason, and the edit affordance's own open/busy/cancel path.
 *
 * ⛔ Two assertions here are about NOT rendering something, and both guard a real defect:
 *
 *  - The retry control must NOT appear on a `ready` or an `expired` job. `retry` re-drives exactly the
 *    `failed_retryable` population, so on a complete job it provably does nothing, and on an expired one
 *    the server answers `409`. Offering it in either place is a control that lies.
 *  - The correction slot must NOT appear on a line with no proposal. There is nothing to dispute about a
 *    line that has not been parsed yet.
 *
 * Queries are role/label/text only — no `data-testid` anywhere in this package.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { useState, type FC } from 'react';
import userEvent from '@testing-library/user-event';

import type { ParseJobLineView, ParseJobResponse, ParseProposal } from '@kitchensink/recipe-service-client';

import { ParseJobReview } from '../ParseJobReview.js';
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

function job(lines: readonly ParseJobLineView[], status: ParseJobResponse['status'] = 'complete'): ParseJobResponse {
    return {
        id: '00000000-0000-4000-8000-00000000d001',
        status,
        createdAt: '2026-09-02T11:59:00.000Z',
        expiresAt: '2026-09-03T11:59:00.000Z',
        lines: [...lines],
        ...{},
    };
}

/** A state carrying a job plus its real progress, so no test hand-writes a tally. */
function withJob(kind: 'running' | 'stalled' | 'settling' | 'ready', lines: readonly ParseJobLineView[]) {
    const status = kind === 'ready' ? 'complete' : kind === 'settling' ? 'partial' : 'running';
    const value = job(lines, status);

    return { kind, job: value, progress: toParseJobProgress(value) } as ParseJobViewState;
}

function renderReview(state: ParseJobViewState, overrides: Partial<ParseJobReviewProps> = {}) {
    const props: ParseJobReviewProps = {
        state,
        retry: { run: vi.fn(), busy: false, notice: undefined },
        edit: { submit: vi.fn(), busyLineIndex: undefined, notice: undefined },
        onStartOver: vi.fn(),
        ...overrides,
    };

    render(<ParseJobReview {...props} />);

    return props;
}

describe('ParseJobReview (web) — the states with no job to show', () => {
    it('announces the load through a status role, and shows no line list', () => {
        renderReview({ kind: 'loading' });

        expect(screen.getByRole('status').textContent).toContain(messages.loading);
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('reports a missing job as ONE answer — never as an authorization failure', () => {
        // A stranger's job and an absent one are the same `404` on purpose; saying "not yours" would
        // confirm the id exists, which is exactly what that choice hides.
        renderReview({ kind: 'missing' });

        expect(screen.getByRole('alert').textContent).toContain(messages.missing);
    });

    it('reports a load failure', () => {
        renderReview({ kind: 'failed' });

        expect(screen.getByRole('alert').textContent).toContain(messages.failed);
    });

    it('offers a fresh start — and NOT a retry — for a job that expired before any view arrived', () => {
        const props = renderReview({ kind: 'expired', job: undefined });

        expect(screen.getByRole('alert').textContent).toContain(messages.expired);
        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
        expect(props.onStartOver).not.toHaveBeenCalled();
    });
});

describe('ParseJobReview (web) — a job in progress', () => {
    const inFlight = [line({ lineIndex: 0, status: 'parsed', proposal: proposal() }), line({ lineIndex: 1 })];

    it('announces the work and reports progress as settled-of-total', () => {
        renderReview(withJob('running', inFlight));

        expect(screen.getByRole('status', { name: messages.progressLabel }).textContent).toContain('1 of 2 lines read');
    });

    it('⛔ does NOT count a retryable line as read — it is outstanding work, not a verdict', () => {
        renderReview(withJob('settling', [line({ status: 'failed_retryable' }), line({ lineIndex: 1 })]));

        expect(screen.getByRole('status', { name: messages.progressLabel }).textContent).toContain('0 of 2 lines read');
    });

    it('says a stalled job is taking longer than usual, and still offers both ways out', () => {
        renderReview(withJob('stalled', inFlight));

        expect(screen.getByText(messages.stalled)).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.retryAction })).toBeTruthy();
        expect(screen.getByRole('button', { name: messages.startOverAction })).toBeTruthy();
    });

    it('⚠️ tells a settling job it may finish on its own — never a flat "failed"', () => {
        // A `partial` job self-heals as in-flight messages land. "10 lines failed" would be false for most
        // of the window this sentence is on screen.
        renderReview(withJob('settling', [line({ status: 'failed_retryable' })]));

        expect(screen.getByText(messages.settling)).toBeTruthy();
    });

    it('runs the retry command from the settling state', async () => {
        const props = renderReview(withJob('settling', [line({ status: 'failed_retryable' })]));

        await userEvent.click(screen.getByRole('button', { name: messages.retryAction }));

        expect(props.retry.run).toHaveBeenCalledTimes(1);
    });

    it('marks the retry control busy and refuses a second press while one is in flight', async () => {
        const props = renderReview(withJob('settling', [line({ status: 'failed_retryable' })]), {
            retry: { run: vi.fn(), busy: true, notice: undefined },
        });
        const control = screen.getByRole('button', { name: messages.retryAction });

        expect((control as HTMLButtonElement).disabled).toBe(true);
        await userEvent.click(control);
        expect(props.retry.run).not.toHaveBeenCalled();
    });

    it('surfaces a retry refusal as an alert without discarding the job on screen', () => {
        renderReview(withJob('settling', [line({ status: 'failed_retryable', sourceLine: '2 cups flour' })]), {
            retry: { run: vi.fn(), busy: false, notice: messages.retryExpired },
        });

        expect(screen.getByRole('alert').textContent).toContain(messages.retryExpired);
        expect(screen.getByText('2 cups flour')).toBeTruthy();
    });
});

describe('ParseJobReview (web) — a finished job', () => {
    const finished = [
        line({ lineIndex: 0, status: 'parsed', proposal: proposal() }),
        line({
            lineIndex: 1,
            sourceLine: 'For the sauce',
            status: 'parsed',
            proposal: proposal({ foods: [], reviewReasons: ['group_header'] }),
        }),
        line({ lineIndex: 2, sourceLine: '???', status: 'unparseable' }),
    ];

    it('renders one row per line, in submission order', () => {
        renderReview(withJob('ready', finished));

        // Addressed by each row's OWN accessible name rather than by position among `listitem`s: the foods
        // and review-reason chips are list items too, so a positional query would count them and — worse —
        // would still pass if a row lost its label entirely.
        const list = within(screen.getByRole('list', { name: messages.lineListLabel }));
        const rows = [1, 2, 3].map((number) => list.getByRole('listitem', { name: `Line ${String(number)}` }));

        expect(rows[0]?.textContent).toContain('2 cups flour');
        expect(rows[1]?.textContent).toContain('For the sauce');
        expect(rows[2]?.textContent).toContain('???');
        expect(list.queryByRole('listitem', { name: 'Line 4' })).toBeNull();
    });

    it('shows the measure and the foods a parsed line proposed', () => {
        renderReview(withJob('ready', [finished[0]!]));

        expect(screen.getByText('2 cup')).toBeTruthy();
        expect(screen.getByText('flour')).toBeTruthy();
    });

    it('reports a line that named no foods as a fact, with its localized reason', () => {
        renderReview(withJob('ready', [finished[1]!]));

        expect(screen.getByText(messages.lineNoFoods)).toBeTruthy();
        expect(screen.getByText('This looks like a heading, not an ingredient')).toBeTruthy();
    });

    it('⛔ falls back for a review reason this build has never seen — no raw snake_case reaches a cook', () => {
        renderReview(
            withJob('ready', [line({ status: 'parsed', proposal: proposal({ reviewReasons: ['from_the_future'] }) })]),
        );

        expect(screen.getByText(messages.reasonUnknown)).toBeTruthy();
        expect(screen.queryByText('from_the_future')).toBeNull();
    });

    it('⛔ offers NO retry on a finished job — the control would provably do nothing', () => {
        renderReview(withJob('ready', finished));

        expect(screen.queryByRole('button', { name: messages.retryAction })).toBeNull();
    });

    it('names each line status distinctly, so an unreadable line is not mistaken for a retryable one', () => {
        renderReview(withJob('ready', finished));

        expect(screen.getByText(messages.lineUnparseable)).toBeTruthy();
        expect(screen.queryByText(messages.lineRetryable)).toBeNull();
    });
});

describe('ParseJobReview (web) — editing one line', () => {
    const editable = [line({ lineIndex: 3, sourceLine: '2 cps flour', status: 'unparseable' })];

    it('opens an edit field seeded with the line as stored', async () => {
        renderReview(withJob('ready', editable));

        await userEvent.click(screen.getByRole('button', { name: 'Edit line 4' }));

        expect(screen.getByLabelText(messages.lineEditLabel)).toHaveProperty('value', '2 cps flour');
    });

    it('⛔ submits the WIRE index, not the number shown to the cook', async () => {
        // The row is labelled "line 4" and the API takes `3`. Sending the human number silently edits the
        // wrong line — a defect nothing downstream can detect.
        const props = renderReview(withJob('ready', editable));

        await userEvent.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await userEvent.clear(screen.getByLabelText(messages.lineEditLabel));
        await userEvent.type(screen.getByLabelText(messages.lineEditLabel), '2 cups flour');
        await userEvent.click(screen.getByRole('button', { name: messages.lineEditSubmit }));

        expect(props.edit.submit).toHaveBeenCalledWith(3, '2 cups flour');
    });

    it('refuses to submit a blank replacement — an edit is not a delete', async () => {
        const props = renderReview(withJob('ready', editable));

        await userEvent.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await userEvent.clear(screen.getByLabelText(messages.lineEditLabel));
        await userEvent.click(screen.getByRole('button', { name: messages.lineEditSubmit }));

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

        expect((screen.getByRole('button', { name: 'Edit line 1' }) as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByRole('button', { name: 'Edit line 2' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('⚠️ KEEPS the typed correction when the edit fails — a cook must not retype it', async () => {
        // The editor used to close the moment the request left, discarding the draft on every failure. That
        // is the exact loss the paste form goes out of its way to prevent one component over.
        const user = userEvent.setup();
        renderReview(withJob('ready', editable), {
            edit: { submit: vi.fn(), busyLineIndex: undefined, notice: messages.lineEditFailed },
        });

        await user.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await user.clear(screen.getByLabelText(messages.lineEditLabel));
        await user.type(screen.getByLabelText(messages.lineEditLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.lineEditSubmit }));

        expect(screen.getByLabelText(messages.lineEditLabel)).toHaveProperty('value', '2 cups flour');
        expect(screen.getByRole('alert').textContent).toContain(messages.lineEditFailed);
    });

    it('⛔ refuses a SECOND submit while the first is still in flight', async () => {
        // The editor now stays open across the request (see the test above), which is what makes a double
        // submit reachable at all — before that it closed itself and the question could not arise. Driven
        // through `rerender` because the busy flag arrives from the parent AFTER the editor is open.
        const user = userEvent.setup();
        const submit = vi.fn();
        const props = (busyLineIndex: number | undefined): ParseJobReviewProps => ({
            state: withJob('ready', editable),
            retry: { run: vi.fn(), busy: false, notice: undefined },
            edit: { submit, busyLineIndex, notice: undefined },
            onStartOver: vi.fn(),
        });

        const { rerender } = render(<ParseJobReview {...props(undefined)} />);

        await user.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await user.clear(screen.getByLabelText(messages.lineEditLabel));
        await user.type(screen.getByLabelText(messages.lineEditLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.lineEditSubmit }));
        expect(submit).toHaveBeenCalledTimes(1);

        rerender(<ParseJobReview {...props(3)} />);

        const control = screen.getByRole('button', { name: messages.lineEditSubmit });
        expect((control as HTMLButtonElement).disabled).toBe(true);
        await user.click(control);
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it('closes the editor once the STORED line reads back what was sent', async () => {
        // Success is not "the request left" — it is the job view carrying the corrected text. Driven through
        // a real controlled owner, because a frozen `state` prop could never show the close.
        const user = userEvent.setup();

        const Harness: FC = () => {
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
                />
            );
        };

        render(<Harness />);

        await user.click(screen.getByRole('button', { name: 'Edit line 4' }));
        await user.clear(screen.getByLabelText(messages.lineEditLabel));
        await user.type(screen.getByLabelText(messages.lineEditLabel), '2 cups flour');
        await user.click(screen.getByRole('button', { name: messages.lineEditSubmit }));

        expect(screen.queryByLabelText(messages.lineEditLabel)).toBeNull();
        expect(screen.getByRole('listitem', { name: 'Line 4' }).textContent).toContain('2 cups flour');
    });

    it('surfaces an edit refusal as an alert', () => {
        renderReview(withJob('ready', editable), {
            edit: { submit: vi.fn(), busyLineIndex: undefined, notice: messages.lineEditFailed },
        });

        expect(screen.getByRole('alert').textContent).toContain(messages.lineEditFailed);
    });
});

describe('ParseJobReview (web) — the correction seam', () => {
    it('renders nothing extra when no correction renderer is supplied', () => {
        renderReview(withJob('ready', [line({ status: 'parsed', proposal: proposal() })]));

        expect(screen.queryByRole('button', { name: 'This parse is wrong' })).toBeNull();
    });

    it('renders the supplied control once per PARSED line, and hands it that line', () => {
        const renderCorrection = vi.fn((l: ParseJobLineView) => (
            <button type="button">{`Correct line ${String(l.lineIndex)}`}</button>
        ));

        renderReview(
            withJob('ready', [
                line({ lineIndex: 0, status: 'parsed', proposal: proposal() }),
                line({ lineIndex: 1, status: 'parsed', proposal: proposal() }),
            ]),
            { renderCorrection },
        );

        expect(screen.getByRole('button', { name: 'Correct line 0' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Correct line 1' })).toBeTruthy();
        expect(renderCorrection.mock.calls.map(([l]) => l.lineIndex)).toEqual([0, 1]);
    });

    it('⛔ does NOT offer the correction slot on a line with no proposal — there is nothing to dispute', () => {
        const renderCorrection = vi.fn(() => <button type="button">Correct</button>);

        renderReview(withJob('ready', [line({ lineIndex: 0, status: 'unparseable' })]), { renderCorrection });

        expect(renderCorrection).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull();
    });
});
