'use client';

/**
 * @module @commise/ui/section-switch — the web design-system {@link SectionSwitch}.
 *
 * A sticky 48 px bar on the navigation layer — so the one place, with the photo's buttons, where the recipe page may
 * blur (owner decision D12): `paper` at 90% with a small backdrop blur, readable with the blur off. A `nav` of real
 * `#id` links, so the page works with no script; a press jumps through the screen's ONE scroll host
 * (`useScrollHost().scrollToSection`, blueprint A7), which scrolls the heading under the sticky chrome, focuses it and
 * records the hash. The current link carries `aria-current="location"` and the tab's selected state (§1.10): `ink` at
 * 600 over the 3 px `hereBar`.
 *
 * Presentational: props → JSX; the jump is the host's.
 *
 * @pattern Mediator client — the switch asks the screen's scroll host for the jump; real links stay the no-script path
 */
import type { FC } from 'react';

import { useScrollHost } from '../scrollHost/scrollHostContext.js';
import type { SectionSwitchProps } from './props.js';

/** The web section switch. */
export const SectionSwitch: FC<SectionSwitchProps> = ({ label, sections, currentId, trailing, onJump }) => {
    const { scrollToSection } = useScrollHost();

    return (
        <div className="sticky top-0 z-20 flex min-h-12 items-center gap-2 border-b border-line-divider bg-paper/90 px-2 backdrop-blur-md">
            {/* The links scroll INSIDE the bar, each at its label's width; the trailing control stays pinned outside the
                scroller. Squeezed, they ran under the toggle at 320 (SC 2.5.8) and past the page at +35% (SC 1.4.10, F14). */}
            <nav aria-label={label} className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
                <ul className="flex w-max items-center gap-1">
                    {sections.map((section) => {
                        const current = section.id === currentId;

                        return (
                            <li key={section.id} className="shrink-0">
                                <a
                                    href={`#${section.id}`}
                                    aria-current={current ? 'location' : undefined}
                                    // A browser scrolls a focused element only when it is entirely out of view; one the bar's
                                    // scroll half hides is brought whole into the bar (F14).
                                    onFocus={(event) => {
                                        event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                                    }}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        scrollToSection(section.id);
                                        onJump?.(section.id);
                                    }}
                                    className={`relative inline-flex min-h-11 items-center px-3 text-label focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ${
                                        current ? 'text-ink' : 'text-ink-muted hover:text-ink'
                                    }`}
                                >
                                    {section.label}
                                    {current && (
                                        <span
                                            aria-hidden="true"
                                            className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-here-bar"
                                        />
                                    )}
                                </a>
                            </li>
                        );
                    })}
                </ul>
            </nav>
            {trailing === undefined ? null : <div className="shrink-0">{trailing}</div>}
        </div>
    );
};
