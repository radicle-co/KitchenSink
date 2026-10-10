'use client';

/**
 * @module details/VariantDetailsDialog — the details dialog, web (curated U14; `docs/design/ingredientSpecialization.md`
 * §S8.2 to §S8.8, §S9).
 *
 * A presentational leaf: it renders the state `useVariantDetailsDialog` derived, which the host passes in, on the
 * design-system `Sheet`. The short list is a
 * single-select listbox whose selection does not follow focus; the long list is a search combobox that controls an
 * always-open listbox through `aria-activedescendant`, with each group a real `role="group"`.
 *
 * Focus on load (§S8.6): the first row, the current row, the search input, or Try again. It moves only when focus is
 * still where the dialog put it, so a list that arrives late never pulls focus from a control the person chose.
 *
 * @pattern Adapter over the design-system `Sheet` — the leaf maps each statechart state to the sheet's slots
 * @pattern Roving tabindex (short list) and active descendant (long list), the two APG listbox focus models
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { focusOnArrival } from '@commise/ui/dialog-focus';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import { Sheet } from '@commise/ui/sheet';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useCallback, useId, useState, type FC, type KeyboardEvent, type ReactNode } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { recipeNutritionMessages } from '../nutrition/messages.js';
import { type DetailsTextMessages, caloriesLabel, dialogViewOf, variantOptionName } from './detailsText.js';
import { type VariantRow, rowsOfPlan } from './groupVariants.js';
import type { VariantDetailsDialogProps } from './props.js';
import { VariantOption } from './VariantOption.js';

/** The id of a row's option element. */
function optionId(listboxId: string, variantId: string): string {
    return `${listboxId}-${variantId}`;
}

export const VariantDetailsDialog: FC<VariantDetailsDialogProps> = ({ open, foodName, details, onDismissed }) => {
    const locale = useLocale();
    const { ingredientDetails: copy } = useMessages(recipeMessages);
    const { calories } = useMessages(recipeNutritionMessages);
    const { readOffline } = useMessages(offlineNoticeMessages);
    const text: DetailsTextMessages = { details: copy, calories };
    const foodId = useId();
    const introId = useId();
    const currentId = useId();
    const listboxId = useId();
    const searchId = useId();
    const { state } = details;
    const { isLong, current, currentLine, total, announcement } = dialogViewOf(state, details.announcedCount, text);

    // The long list's keyboard-active row, and the short list's last focused row (its roving tab stop). Each opening
    // starts with neither, so the current row is active and the load target holds the tab stop.
    const [chosenId, setChosenId] = useState<string | undefined>(undefined);
    const [rovingId, setRovingId] = useState<string | undefined>(undefined);
    const [openSeen, setOpenSeen] = useState(open);

    if (open !== openSeen) {
        setOpenSeen(open);
        setChosenId(undefined);
        setRovingId(undefined);
    }

    const visibleRows: readonly VariantRow[] =
        state.name === 'combined'
            ? state.rows
            : state.name === 'longList' || state.name === 'searching'
              ? rowsOfPlan(state.plan)
              : [];
    const defaultActive = current?.listed === true ? current.variant.id : undefined;
    // The chosen row, else the current one; a row the search has hidden is not active.
    const activeRow = visibleRows.find((row) => row.variant.id === (chosenId ?? defaultActive));
    const activeVariantId = activeRow?.variant.id;

    // The short list's focus target on load (§S8.6): the current row when it is listed, else the first row.
    const shortTarget = visibleRows.find((row) => row.variant.id === defaultActive) ?? visibleRows[0];
    const shortTargetId = shortTarget === undefined ? undefined : optionId(listboxId, shortTarget.variant.id);
    const tabStopId = visibleRows.some((row) => optionId(listboxId, row.variant.id) === rovingId)
        ? rovingId
        : shortTargetId;
    const activeOptionId = activeVariantId === undefined ? undefined : optionId(listboxId, activeVariantId);

    // ⚠️ Callback refs, not an effect: the Sheet's content mounts inside a Radix portal one commit after this
    // component, so an effect here runs before the target exists. A callback ref runs when the node itself mounts,
    // before the Sheet's own open focus, which then leaves it alone (§S8.1). Each moves focus only where the person
    // has not already placed it (`focusOnArrival`).
    const focusListArrival = useCallback(
        (listbox: HTMLElement | null) => {
            const target = Array.from(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? []).find(
                (option) => option.id === shortTargetId,
            );

            focusOnArrival(target ?? null);
        },
        [shortTargetId],
    );
    const focusWhenMounted = useCallback((node: HTMLElement | null) => {
        focusOnArrival(node?.querySelector<HTMLElement>('button') ?? node);
    }, []);
    // The long list's active row is always in view (§S9 SC 2.4.11): on load (in `edit`, the current row), on each
    // move, and when a cleared search brings the list back. React re-runs this ref whenever the active row changes.
    const scrollActiveIntoView = useCallback(
        (listbox: HTMLElement | null) => {
            Array.from(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
                .find((option) => option.id === activeOptionId)
                ?.scrollIntoView({ block: 'nearest' });
        },
        [activeOptionId],
    );

    const optionFor = (
        row: VariantRow,
        tabIndex: number | undefined,
        onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void,
    ): ReactNode => {
        const isCurrent = current?.listed === true && current.variant.id === row.variant.id;
        const label = caloriesLabel(row.calories, locale, text);

        return (
            <VariantOption
                key={row.variant.id}
                id={optionId(listboxId, row.variant.id)}
                parts={row.shownParts}
                name={variantOptionName(row, isCurrent, locale, text)}
                calories={label.visible}
                isCurrent={isCurrent}
                currentTag={copy.tagCurrent}
                hasCheckColumn={current?.listed === true}
                selected={tabIndex === undefined ? row.variant.id === activeVariantId : isCurrent}
                active={tabIndex === undefined && row.variant.id === activeVariantId}
                tabIndex={tabIndex}
                onPick={() => details.onPick(row)}
                onKeyDown={onKeyDown}
                onFocus={tabIndex === undefined ? undefined : () => setRovingId(optionId(listboxId, row.variant.id))}
            />
        );
    };

    /** Short list keys (§S9 SC 2.1.1): Up, Down, Home and End move focus; Enter or Space commits. */
    const onShortKey = (row: VariantRow) => (event: KeyboardEvent<HTMLDivElement>) => {
        const options = Array.from(
            event.currentTarget.closest('[role="listbox"]')?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
        );
        const at = options.indexOf(event.currentTarget);
        const next: Readonly<Record<string, number>> = {
            ArrowDown: Math.min(at + 1, options.length - 1),
            ArrowUp: Math.max(at - 1, 0),
            Home: 0,
            End: options.length - 1,
        };

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            details.onPick(row);
        } else if (event.key in next) {
            event.preventDefault();
            options[next[event.key] ?? at]?.focus();
        }
    };

    /** Long list keys: Up and Down move the active row, Enter commits it. Space types (§S9 SC 2.1.1). */
    const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Enter') {
            if (activeRow !== undefined) {
                event.preventDefault();
                details.onPick(activeRow);
            }

            return;
        }

        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }

        event.preventDefault();
        const at = visibleRows.findIndex((row) => row.variant.id === activeVariantId);
        const nextIndex = event.key === 'ArrowDown' ? Math.min(at + 1, visibleRows.length - 1) : Math.max(at - 1, 0);
        const next = visibleRows[nextIndex];

        if (next !== undefined) {
            setChosenId(next.variant.id);
        }
    };

    const toolbar = isLong
        ? {
              heading: (
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <label htmlFor={searchId} className="text-body-sm font-medium text-ink">
                          {fillTemplate(copy.searchLabelOther, { count: total })}
                      </label>
                      <span className="text-caption text-ink-muted">{copy.caloriesBasis}</span>
                  </span>
              ),
              controls: (
                  <span className="flex items-center gap-2">
                      <input
                          ref={focusWhenMounted}
                          id={searchId}
                          type="text"
                          role="combobox"
                          aria-expanded={state.name !== 'noMatches'}
                          aria-controls={state.name === 'noMatches' ? undefined : listboxId}
                          aria-autocomplete="list"
                          aria-activedescendant={activeOptionId}
                          autoComplete="off"
                          value={details.query}
                          onChange={(event) => details.onQueryChange(event.target.value)}
                          onKeyDown={onSearchKey}
                          className="h-12 min-w-0 flex-1 rounded-md border border-line-control px-3 text-body-md text-ink focus:outline-none focus:ring-2 focus:ring-focus-ring"
                      />
                      {details.query !== '' && (
                          <button
                              type="button"
                              aria-label={copy.searchClear}
                              onClick={(event) => {
                                  // Clear unmounts itself; focus goes to the input first so it is never lost.
                                  event.currentTarget.parentElement?.querySelector('input')?.focus();
                                  details.onClearQuery();
                              }}
                              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-ink/6 focus:outline-none focus:ring-2 focus:ring-focus-ring"
                          >
                              <Icon name="x" size={20} />
                          </button>
                      )}
                  </span>
              ),
          }
        : undefined;

    const footer =
        details.onRemove === undefined ? undefined : (
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                {/* `fill`: full width below 640 px, content width at the end of the `sm` row (§S8.2 Footer, R9). */}
                {state.name === 'detailsNoneLeft' && (
                    <Button variant="secondary" icon="x" onPress={details.onClose} width="fill">
                        {copy.dismiss}
                    </Button>
                )}
                <Button variant="secondary" icon="minus" onPress={details.onRemove} width="fill">
                    {copy.remove}
                </Button>
            </div>
        );

    const renderBody = (): ReactNode => {
        switch (state.name) {
            case 'loading':
                return (
                    <div className="flex flex-col gap-2 px-4">
                        {/* Shown here, said once by the status region below (§S12 row 17). */}
                        <p aria-hidden="true" className="text-body-sm text-ink-muted">
                            {copy.loading}
                        </p>
                        {[0, 1, 2].map((index) => (
                            <div
                                key={index}
                                aria-hidden="true"
                                className="h-12 rounded-md bg-surface-muted motion-safe:animate-pulse"
                            />
                        ))}
                    </div>
                );
            case 'error':
                return (
                    <div className="flex flex-col items-start gap-3 px-4">
                        <p role="alert" className="text-body-md text-ink">
                            {copy.loadFailed}
                        </p>
                        <div ref={focusWhenMounted}>
                            <Button variant="secondary" icon="refreshCw" onPress={details.onRetry}>
                                {copy.retry}
                            </Button>
                        </div>
                    </div>
                );
            case 'offline':
                return (
                    <div className="px-4">
                        <OfflineReadSlot message={readOffline} />
                    </div>
                );
            case 'noVariants':
                return (
                    <p className="px-4 text-body-md text-ink">{fillTemplate(copy.noVariants, { food: foodName })}</p>
                );
            case 'detailsNoneLeft':
                return <p className="px-4 text-body-md text-ink">{fillTemplate(copy.noneLeft, { food: foodName })}</p>;
            case 'combined':
                return (
                    <div ref={focusListArrival} id={listboxId} role="listbox" aria-labelledby={foodId}>
                        {state.rows.map((row) =>
                            optionFor(row, optionId(listboxId, row.variant.id) === tabStopId ? 0 : -1, onShortKey(row)),
                        )}
                    </div>
                );
            case 'noMatches':
                return (
                    <p className="px-4 text-body-md text-ink">
                        {fillTemplate(copy.noMatches, { query: state.query, count: state.total })}
                    </p>
                );
            case 'longList':
            case 'searching':
                return (
                    <div ref={scrollActiveIntoView} id={listboxId} role="listbox" aria-labelledby={foodId}>
                        {state.plan.headless.map((row) => optionFor(row, undefined))}
                        {state.plan.groups.map((group, index) => {
                            const headerId = `${listboxId}-group-${String(index)}`;
                            const top = index === 0 && state.plan.headless.length === 0 ? 'pt-3' : 'pt-6';

                            return (
                                <div key={group.key} role="group" aria-labelledby={headerId}>
                                    {/* A listbox holds groups and options only: the APG grouped listbox's header. */}
                                    <p
                                        id={headerId}
                                        role="presentation"
                                        className={`px-4 pb-2 text-body-sm font-semibold text-ink first-letter:uppercase ${top}`}
                                    >
                                        {group.key}
                                    </p>
                                    {group.rows.map((row) => optionFor(row, undefined))}
                                </div>
                            );
                        })}
                    </div>
                );
        }
    };

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    details.onClose();
                }
            }}
            onDismissed={onDismissed}
            title={details.mode === 'add' ? copy.actionAdd : copy.actionEdit}
            labelledBy={[foodId]}
            describedBy={currentLine === undefined ? [introId] : [introId, currentId]}
            closeLabel={copy.close}
            size={isLong ? 'full' : 'content'}
            toolbar={toolbar}
            footer={footer}
        >
            <div className="flex flex-col gap-1 px-4 pb-4">
                <p id={foodId} className="text-body-md font-semibold text-ink first-letter:uppercase">
                    {foodName}
                </p>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p id={introId} className="text-body-sm text-ink-muted">
                        {copy.intro}
                    </p>
                    {state.name === 'combined' && <p className="text-caption text-ink-muted">{copy.caloriesBasis}</p>}
                </div>
                {currentLine !== undefined && (
                    <p id={currentId} className="text-body-sm text-ink-muted">
                        <span className="font-semibold text-ink">{currentLine.before}</span>
                        <VariantPartsLine parts={currentLine.parts} tone="secondary" />
                        {currentLine.after}
                    </p>
                )}
            </div>
            {renderBody()}
            {/* One polite region, mounted before it speaks, so screen readers hear each change (§S9 SC 4.1.3). */}
            <p role="status" className="sr-only">
                {announcement}
            </p>
        </Sheet>
    );
};
