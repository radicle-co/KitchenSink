'use client';

/**
 * @module @commise/ui/section-index — the web design-system {@link SectionIndex} (`buildSpec.md` §7.2, §7.10).
 *
 * Three presentations of the same items, all rendered and switched by the width of the `@container/main` box with
 * Tailwind's container variants, so the switch costs no script and no measurement: the **rail** from `@wide/main:`
 * (960), the **strip** from `@regular/main:` (600) to 959, the **bar** below. The two that do not apply are
 * `display: none`, which takes them out of the accessibility tree; every id they carry is prefixed per presentation,
 * so the hidden copies never collide with the shown one.
 *
 * Placement: the leaf renders three sibling boxes (a fragment), so each can be `sticky` against the caller's own
 * layout — place it as a direct child of the box it should stick in (the editor's frame, beside or above the form).
 * Sticky offsets read `--top-chrome`, the height of the sticky header above the index (the twin of the existing
 * `--bottom-chrome`), defaulting to 0: the strip and the bar stick at it, the rail at it + 16 px.
 *
 * Surfaces: the strip and the bar are solid `paperRaised` (`darkTheme.md` §1, "section bars"), NOT glass: the
 * editor's only glass is its action bar (owner D12).
 *
 * Every jump goes through the screen's ONE `ScrollHost` (blueprint A7), which scrolls, moves focus to the heading
 * and writes the hash; a link keeps its `href` so the page works without script. The phone sheet jumps from its
 * `onDismissed`, after the sheet has gone AND after it has handed focus back to the bar — a jump made earlier would
 * have its heading focus taken back to the bar (§7.10: focus moves to the H2 after a jump).
 *
 * Presentational about data: props → JSX. Its one piece of state is the open sheet and the jump it is waiting to make.
 *
 * @pattern Strategy — one item list, three presentations chosen by container width in CSS
 * @pattern Mediator client — a choice is handed to the screen's `ScrollHost`, which performs the jump
 */
import { useId, useState, type FC, type MouseEvent } from 'react';

import { Icon } from '../icon/Icon.js';
import { useScrollHost } from '../scrollHost/scrollHostContext.js';
import { Sheet } from '../sheet/Sheet.js';
import type { Role } from '../tokens/colors.js';
import type { SectionIndexItem, SectionIndexProps } from './props.js';
import {
    TONE_GLYPH,
    TONE_ROLE,
    TONE_SEGMENT,
    barCountRoleOf,
    barItemOf,
    shownCountOf,
    type ProgressSegment,
} from './sectionIndexModel.js';

/** The text-colour utility of each role a tone can take (literal, so Tailwind emits them). */
const TEXT_CLASS: Readonly<Partial<Record<Role, string>>> = {
    dangerText: 'text-danger-text',
    attention: 'text-attention',
    inkMuted: 'text-ink-muted',
    ink: 'text-ink',
};

/** The phone bar's progress segments: complete `action`; needs action `warning` with a 1 px edge; empty `pearl`. */
const SEGMENT_CLASS: Readonly<Record<ProgressSegment, string>> = {
    done: 'bg-action',
    needsAction: 'border-t border-attention bg-attention-tint',
    empty: 'bg-surface-muted',
};

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring';

/** A link's click: keep the browser from following the fragment, and jump through the host instead. */
type Jump = (id: string) => void;

function linkClick(jump: Jump, id: string): (event: MouseEvent<HTMLAnchorElement>) => void {
    return (event) => {
        event.preventDefault();
        jump(id);
    };
}

/** The id a presentation gives an item's description. */
function reasonIdOf(prefix: string, index: number): string {
    return `${prefix}-reason-${index}`;
}

function hintIdOf(prefix: string, index: number): string {
    return `${prefix}-hint-${index}`;
}

interface ListRowProps {
    readonly item: SectionIndexItem;
    readonly current: boolean;
    readonly idPrefix: string;
    readonly index: number;
    /** `rail` rows are at least 48 px; `sheet` rows 56 px (§7.10). */
    readonly height: 'rail' | 'sheet';
    readonly onChoose: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** One rail or sheet row: the label, then the status line in `caption`, then the hint. */
const ListRow: FC<ListRowProps> = ({ item, current, idPrefix, index, height, onChoose }) => {
    const glyph = TONE_GLYPH[item.tone];
    const reasonId = reasonIdOf(idPrefix, index);
    const hintId = hintIdOf(idPrefix, index);
    const spoken = item.reason === undefined ? item.spokenStatus : undefined;
    const describedBy = [
        item.reason === undefined && spoken === undefined ? undefined : reasonId,
        item.hint === undefined ? undefined : hintId,
    ]
        .filter((id): id is string => id !== undefined)
        .join(' ');

    return (
        <li>
            <a
                href={`#${item.id}`}
                aria-label={item.label}
                aria-describedby={describedBy === '' ? undefined : describedBy}
                aria-current={current ? 'location' : undefined}
                onClick={onChoose}
                className={`relative flex flex-col justify-center gap-0.5 rounded-md py-2 ps-4 pe-3 hover:bg-surface-muted ${FOCUS} ${
                    height === 'rail' ? 'min-h-12' : 'min-h-14'
                }`}
            >
                {current && (
                    <span aria-hidden="true" className="absolute inset-y-1 start-0 w-[3px] rounded-full bg-here-bar" />
                )}
                <span
                    className={`flex items-start gap-1.5 text-label ${current ? 'text-ink' : 'font-normal text-ink-muted'}`}
                >
                    {item.tone === 'complete' && glyph !== undefined && <Icon name={glyph} size={16} tone="ink" />}
                    <span className="line-clamp-2">{item.label}</span>
                </span>
                {item.reason !== undefined && (
                    <span
                        id={reasonId}
                        className={`flex items-start gap-1 text-caption ${TEXT_CLASS[TONE_ROLE[item.tone]] ?? ''}`}
                    >
                        {item.tone !== 'complete' && glyph !== undefined && <Icon name={glyph} size={16} />}
                        <span className="line-clamp-2">{item.reason}</span>
                    </span>
                )}
                {spoken !== undefined && (
                    <span id={reasonId} className="sr-only">
                        {spoken}
                    </span>
                )}
                {item.hint !== undefined && (
                    <span id={hintId} className="text-caption text-ink-muted">
                        {item.hint}
                    </span>
                )}
            </a>
        </li>
    );
};

interface StripItemProps {
    readonly item: SectionIndexItem;
    readonly current: boolean;
    readonly reasonId: string;
    readonly onChoose: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** One strip item: glyph, the short label, the count; the reason as screen-reader text. */
const StripItem: FC<StripItemProps> = ({ item, current, reasonId, onChoose }) => {
    const glyph = TONE_GLYPH[item.tone];
    const count = shownCountOf(item);
    const toneClass = TEXT_CLASS[TONE_ROLE[item.tone]] ?? '';

    return (
        <li className="flex min-w-0 flex-auto justify-center">
            <a
                href={`#${item.id}`}
                aria-label={item.label}
                aria-describedby={(item.reason ?? item.spokenStatus) === undefined ? undefined : reasonId}
                aria-current={current ? 'location' : undefined}
                onClick={onChoose}
                className={`relative flex min-h-11 min-w-0 items-center gap-1 px-3 text-label ${FOCUS} ${
                    current ? 'text-ink' : 'font-normal text-ink-muted hover:text-ink'
                }`}
            >
                {glyph !== undefined && (
                    <span className={item.tone === 'complete' ? 'text-ink' : toneClass}>
                        <Icon name={glyph} size={16} />
                    </span>
                )}
                <span className="truncate">{item.shortLabel ?? item.label}</span>
                {count !== undefined && (
                    <span aria-hidden="true" className={toneClass}>
                        {count}
                    </span>
                )}
                {(item.reason ?? item.spokenStatus) !== undefined && (
                    <span id={reasonId} className="sr-only">
                        {item.reason ?? item.spokenStatus}
                    </span>
                )}
                {current && (
                    <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-here-bar" />
                )}
            </a>
        </li>
    );
};

/** The web section index. */
export const SectionIndex: FC<SectionIndexProps> = ({
    label,
    sheetTitle,
    sheetCloseLabel,
    items,
    currentId,
    barName,
    barSuffix,
    barCount,
    railFooter,
    onJump,
    stickyId,
    narrowHidden = false,
}) => {
    const host = useScrollHost();
    const baseId = useId();
    const [sheetOpen, setSheetOpen] = useState(false);
    // The section chosen in the sheet, jumped to once the sheet has gone (see the module note).
    const [pendingJump, setPendingJump] = useState<string | undefined>(undefined);
    const barItem = barItemOf(items, currentId);

    const jump: Jump = (id) => {
        host.scrollToSection(id);
        onJump?.(id);
    };

    return (
        <>
            <nav
                aria-label={label}
                className="sticky top-[calc(var(--top-chrome,0px)+1rem)] hidden max-h-[calc(100dvh-var(--top-chrome,0px)-2rem)] w-60 shrink-0 flex-col self-start overflow-y-auto @wide/main:flex"
            >
                <ol className="flex flex-col gap-1">
                    {items.map((item, index) => (
                        <ListRow
                            key={item.id}
                            item={item}
                            current={item.id === currentId}
                            idPrefix={`${baseId}-rail`}
                            index={index}
                            height="rail"
                            onChoose={linkClick(jump, item.id)}
                        />
                    ))}
                </ol>
                {railFooter !== undefined && railFooter !== null && (
                    <div className="mt-4 border-t border-line-divider px-4 pt-4 text-caption text-ink-muted">
                        {railFooter}
                    </div>
                )}
            </nav>
            {narrowHidden ? null : (
                <>
                    <nav
                        {...(stickyId === undefined ? {} : { id: `${stickyId}-strip` })}
                        aria-label={label}
                        className="sticky top-[var(--top-chrome,0px)] z-20 hidden h-12 border-b border-line-divider bg-paper-raised @regular/main:block @wide/main:hidden"
                    >
                        <ol className="flex h-full items-center gap-1 px-2">
                            {items.map((item, index) => (
                                <StripItem
                                    key={item.id}
                                    item={item}
                                    current={item.id === currentId}
                                    reasonId={reasonIdOf(`${baseId}-strip`, index)}
                                    onChoose={linkClick(jump, item.id)}
                                />
                            ))}
                        </ol>
                    </nav>
                    <div
                        {...(stickyId === undefined ? {} : { id: `${stickyId}-bar` })}
                        className="sticky top-[var(--top-chrome,0px)] z-20 bg-paper-raised @regular/main:hidden"
                    >
                        <button
                            type="button"
                            aria-label={barName}
                            aria-expanded={sheetOpen}
                            aria-haspopup="dialog"
                            onClick={() => {
                                setSheetOpen(true);
                            }}
                            className={`flex h-11 w-full items-center gap-2 px-4 text-label text-ink ${FOCUS}`}
                        >
                            <span className="min-w-0 flex-1 truncate text-start">
                                <span>{barItem?.label}</span>
                                {barSuffix !== undefined && (
                                    <span className="font-normal text-ink-muted">{barSuffix}</span>
                                )}
                            </span>
                            {barCount !== undefined && (
                                <span aria-hidden="true" className={TEXT_CLASS[barCountRoleOf(items)]}>
                                    {barCount}
                                </span>
                            )}
                            <Icon name="chevronDown" size={20} />
                        </button>
                        <div aria-hidden="true" className="flex h-1 gap-0.5">
                            {items.map((item) => (
                                <span key={item.id} className={`flex-1 ${SEGMENT_CLASS[TONE_SEGMENT[item.tone]]}`} />
                            ))}
                        </div>
                        <Sheet
                            open={sheetOpen}
                            onOpenChange={setSheetOpen}
                            onDismissed={() => {
                                if (pendingJump !== undefined) {
                                    setPendingJump(undefined);
                                    jump(pendingJump);
                                }
                            }}
                            title={sheetTitle}
                            closeLabel={sheetCloseLabel}
                            size="content"
                        >
                            <ol className="flex flex-col gap-1">
                                {items.map((item, index) => (
                                    <ListRow
                                        key={item.id}
                                        item={item}
                                        current={item.id === currentId}
                                        idPrefix={`${baseId}-sheet`}
                                        index={index}
                                        height="sheet"
                                        onChoose={(event) => {
                                            event.preventDefault();
                                            setPendingJump(item.id);
                                            setSheetOpen(false);
                                        }}
                                    />
                                ))}
                            </ol>
                        </Sheet>
                    </div>
                </>
            )}
        </>
    );
};
