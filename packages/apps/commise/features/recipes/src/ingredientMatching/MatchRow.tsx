'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `MatchRow` (web): one matched line, in either flow, drawn by the
 * leaf its row kind names (`lineRowOf`): the expanded line (`MatchOpenRow`), an open line waiting its turn
 * (`MatchClosedRow`), or a settled line (`MatchSettledRow`). Every control reports to the host with the line's key.
 *
 * ONE file for both platforms: it draws nothing itself, and each leaf it names resolves to its `.native.tsx` twin at
 * bundle time, so a native copy would be this file token for token (`crossPlatformLeafDuplication`).
 *
 * Presentational: props in, markup out.
 *
 * @pattern Visitor — an exhaustive switch with no default branch over the `LineRow` kinds, so a new kind is a compile
 *     error here
 */
import type { FC, ReactElement } from 'react';

import { MatchClosedRow } from './MatchClosedRow.js';
import { MatchOpenRow } from './MatchOpenRow.js';
import type { SettledAction } from './matchLineView.js';
import type { MatchRowHandlers, MatchRowProps } from './matchRowProps.js';
import { MatchSettledRow } from './MatchSettledRow.js';

/**
 * Carry a settled row's control to the host. An exhaustive switch over the action kinds with no default branch, so a
 * new kind is a compile error here.
 *
 * @param action - The control pressed.
 * @param key - Its line.
 * @param handlers - The host's handlers.
 * @sideEffect Calls the one handler the action maps to.
 */
function runSettledAction(action: SettledAction['kind'], key: string, handlers: MatchRowHandlers): void {
    switch (action) {
        case 'change':
            handlers.onOpen(key);

            return;
        case 'useThis':
            handlers.onUseProposal(key);

            return;
        case 'search':
            handlers.onSearch(key);

            return;
        case 'keepAsWritten':
            handlers.onPick(key, { kind: 'asWritten' });

            return;
        case 'retry':
            handlers.onRetry(key);

            return;
    }
}

/** The leaf a row kind names. */
const leafOf = ({ row, searchFocus, ...handlers }: MatchRowProps): ReactElement => {
    switch (row.kind) {
        case 'open':
            return (
                <MatchOpenRow
                    line={row.line}
                    view={row.view}
                    searchFocus={searchFocus}
                    onSearch={() => {
                        handlers.onSearch(row.key);
                    }}
                    onPick={(pick) => {
                        handlers.onPick(row.key, pick);
                    }}
                />
            );
        case 'closed':
            return (
                <MatchClosedRow
                    line={row.line}
                    need={row.need}
                    current={row.current}
                    onOpen={() => {
                        handlers.onOpen(row.key);
                    }}
                />
            );
        case 'settled':
            return (
                <MatchSettledRow
                    line={row.line}
                    view={row.view}
                    onAction={(action) => {
                        runSettledAction(action, row.key, handlers);
                    }}
                    onSeeWhy={() => {
                        if (row.view.note !== undefined) {
                            handlers.onSeeWhy(row.key, row.view.note.reason);
                        }
                    }}
                />
            );
    }
};

/** One matched line. */
export const MatchRow: FC<MatchRowProps> = (props) => leafOf(props);
