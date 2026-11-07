/**
 * The native ScrollHost (A7): ONE scroller takes `bind`; `scrollToTop` moves it (animated, or instant under Reduce
 * Motion) whichever kind it is; `condensed` flips once the heading's bottom scrolls past the top; the direction and the
 * top follow the scroll; `handle` is the same scroller React Navigation's `useScrollToTop` reads; and reading the host
 * outside one is a loud wiring error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { Animated, ScrollView, Text } from 'react-native';

const motion = vi.hoisted(() => ({ reduce: false }));

vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => motion.reduce }));

import type { LayoutReport, ScrollBind, ScrollHostApi, ScrollReport } from '../props.js';
import { useFieldTarget } from '../fieldTarget.js';
import { ScrollHost } from '../ScrollHost.native.js';
import { useScrollHost } from '../scrollHostContext.js';

/** Hands the nearest host's API to a test after each commit, so no test writes to its own variables while rendering. */
const ApiProbe = ({ onApi }: { readonly onApi: (api: ScrollHostApi) => void }): null => {
    const api = useScrollHost();

    useEffect(() => onApi(api));

    return null;
};

/** Hands a field's target count to a test after each commit. */
const CountProbe = ({ id, onCount }: { readonly id: string; readonly onCount: (count: number) => void }): null => {
    const count = useFieldTarget(id);

    useEffect(() => onCount(count));

    return null;
};

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    motion.reduce = false;
});

const report = (y: number, viewport = 800, content = 4000): ScrollReport => ({
    nativeEvent: {
        contentOffset: { y },
        layoutMeasurement: { height: viewport },
        contentSize: { height: content },
    },
});

/** Render a host whose child captures `bind` and the API. */
function renderHost(sections?: readonly string[]): { bind: () => ScrollBind; api: () => ScrollHostApi } {
    const seen: { bind?: ScrollBind; api?: ScrollHostApi } = {};

    render(
        <ScrollHost {...(sections === undefined ? {} : { sections })}>
            {(bind) => {
                seen.bind = bind;

                return (
                    <ApiProbe
                        onApi={(api) => {
                            seen.api = api;
                        }}
                    />
                );
            }}
        </ScrollHost>,
    );

    return {
        bind: () => {
            if (seen.bind === undefined) {
                throw new Error('no bind');
            }

            return seen.bind;
        },
        api: () => {
            if (seen.api === undefined) {
                throw new Error('no api');
            }

            return seen.api;
        },
    };
}

describe('ScrollHost (native)', () => {
    it('hands the scroller one bind: a ref, a scroll handler, and a 16 ms throttle', () => {
        const { bind } = renderHost();

        expect(bind().scrollEventThrottle).toBe(16);
        expect(typeof bind().ref).toBe('function');
        expect(typeof bind().onScroll).toBe('function');
    });

    it('scrolls a ScrollView to the top, animated', () => {
        const { bind, api } = renderHost();
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        api().scrollToTop();

        expect(scrollView.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
    });

    it('scrolls a FlatList or FlashList to the top through scrollToOffset', () => {
        const { bind, api } = renderHost();
        const list = { scrollToOffset: vi.fn() };
        act(() => bind().ref(list));

        api().scrollToTop();

        expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    });

    it('jumps instantly under Reduce Motion', () => {
        motion.reduce = true;
        const { bind, api } = renderHost();
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        api().scrollToTop();

        expect(scrollView.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    });

    it('exposes the SAME scroller as the handle, so the one scroller has one handle', () => {
        const { bind, api } = renderHost();
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        expect(api().handle.current).toBe(scrollView);
    });

    it('condenses once the heading’s bottom scrolls past the top, and not before', () => {
        const { bind, api } = renderHost();

        act(() => api().headingLayout({ nativeEvent: { layout: { y: 44, height: 40 } } }));
        act(() => bind().onScroll(report(83)));
        expect(api().condensed).toBe(false);

        act(() => bind().onScroll(report(84)));
        expect(api().condensed).toBe(true);
    });

    // Pinned back bar, blueprint step 1 (native half). A page that pins a 56 pt bar over its scroller pads its content by
    // 56, so the title block's `onLayout` y (relative to the header) is 56 short of its content y, and the bar covers the
    // top 56 pt of the scroller. The two 56s cancel: the heading's bottom meets the BAR's bottom edge at
    // `y = layout.y + layout.height`, exactly the rule above. This pins that the host needs no inset input on native.
    it('needs no inset for a pinned bar: a 40 pt title at layout y 0 is under a 56 pt bar at scroll y 40', () => {
        const { bind, api } = renderHost();

        act(() => api().headingLayout({ nativeEvent: { layout: { y: 0, height: 40 } } }));
        act(() => bind().onScroll(report(39)));
        expect(api().condensed).toBe(false);

        act(() => bind().onScroll(report(40)));
        expect(api().condensed).toBe(true);
    });

    it('follows the direction and the top', () => {
        const { bind, api } = renderHost();

        expect(api().atTop).toBe(true);
        act(() => bind().onScroll(report(300)));
        expect(api().scrollingDown).toBe(true);
        expect(api().atTop).toBe(false);

        act(() => bind().onScroll(report(100)));
        expect(api().scrollingDown).toBe(false);
    });

    it('reports the current section from each section’s layout, and scrolls a section to the line', () => {
        const { bind, api } = renderHost(['details', 'ingredients']);
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        act(() => api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
        act(() => bind().onScroll(report(600)));

        expect(api().current).toBe('ingredients');

        api().scrollToSection('ingredients');
        expect(scrollView.scrollTo).toHaveBeenCalledWith({ y: 500, animated: true });
    });

    // A jump holds the section it named until the cook drags again, even when the page is too short for that section
    // to reach the line; the jump's own `scrollTo` reports scrolls but never a drag.
    it('holds a jumped-to section through the jump’s own scroll, and a drag of the cook’s releases it', () => {
        const { bind, api } = renderHost(['details', 'ingredients', 'steps']);
        act(() => bind().ref({ scrollTo: vi.fn() }));
        act(() => api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
        act(() => api().sectionLayout('steps')({ nativeEvent: { layout: { y: 1400, height: 200 } } }));
        act(() => bind().onScroll(report(600)));
        expect(api().current).toBe('ingredients');

        act(() => api().scrollToSection('steps'));
        expect(api().current).toBe('steps');

        // The page is too short for steps to reach the line: the jump stops at 700, where the spy alone names
        // ingredients.
        act(() => bind().onScroll(report(700, 800, 1600)));
        expect(api().current).toBe('steps');

        act(() => bind().onScrollBeginDrag());
        act(() => bind().onScroll(report(600, 800, 1600)));
        expect(api().current).toBe('ingredients');
    });

    // A section change is an EVENT, fired from the scroll handler (staff-code-quality REACT-04): a consumer that must
    // act on it (the editor's section-change checkpoint) subscribes, instead of relaying `current` through state and an
    // effect. It reports the scroll spy's section and the one before it.
    it('reports each change of the spy’s section to a subscriber, from the scroll handler, once per change', () => {
        const { bind, api } = renderHost(['details', 'ingredients']);
        const changes: (readonly [string | undefined, string | undefined])[] = [];
        let unsubscribe: () => void = () => undefined;
        act(() => {
            unsubscribe = api().onCurrentChange((current, previous) => changes.push([current, previous]));
        });
        act(() => api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));

        act(() => bind().onScroll(report(10)));
        act(() => bind().onScroll(report(20)));
        act(() => bind().onScroll(report(600)));
        act(() => bind().onScroll(report(700)));

        expect(changes).toEqual([
            ['details', undefined],
            ['ingredients', 'details'],
        ]);

        unsubscribe();
        act(() => bind().onScroll(report(10)));
        expect(changes).toHaveLength(2);
    });

    it('keeps one subscription function across renders, so a subscriber does not resubscribe on every scroll', () => {
        const { bind, api } = renderHost(['details']);
        const first = api().onCurrentChange;
        expect(typeof first).toBe('function');

        act(() => bind().onScroll(report(300)));

        expect(api().onCurrentChange).toBe(first);
    });

    /** Three sections; the page ends at 1600, so steps (at 1400) never reaches the line. */
    function heldOnSteps(): { bind: () => ScrollBind; api: () => ScrollHostApi } {
        const host = renderHost(['details', 'ingredients', 'steps']);
        act(() => host.bind().ref({ scrollTo: vi.fn() }));
        act(() => host.api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        act(() => host.api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
        act(() => host.api().sectionLayout('steps')({ nativeEvent: { layout: { y: 1400, height: 200 } } }));
        act(() => host.bind().onScroll(report(600, 800, 1600)));
        act(() => host.api().scrollToSection('steps'));
        act(() => host.bind().onScroll(report(800, 800, 1600)));

        return host;
    }

    // A tab re-tap or "Back to top" is the cook leaving the section: the index must not stay stuck on the jump.
    it('scrollToTop releases a held section', () => {
        const { bind, api } = heldOnSteps();
        expect(api().current).toBe('steps');

        act(() => api().scrollToTop());
        act(() => bind().onScroll(report(0, 800, 1600)));

        expect(api().current).toBe('details');
    });

    // The jump's own scroll ends with a momentum end (Android fires one for a programmatic `scrollTo`), so the momentum
    // end must NOT release: on a short page that would undo the hold at once. It arms the release; the next scroll — a
    // screen reader's, which begins no drag — releases.
    it('the jump’s own momentum end keeps the hold, and the next scroll after it releases (a screen-reader scroll)', () => {
        const { bind, api } = heldOnSteps();

        act(() => bind().onMomentumScrollEnd());
        expect(api().current).toBe('steps');

        act(() => bind().onScroll(report(600, 800, 1600)));
        expect(api().current).toBe('ingredients');
    });

    // A jump that moves nothing (reduced motion, or the section is already in place) reports no momentum end, so the
    // hold settles on a timer, as the web host's does.
    it('a jump with no momentum end settles after a second, and the next scroll then releases', () => {
        vi.useFakeTimers();

        try {
            const { bind, api } = heldOnSteps();

            act(() => bind().onScroll(report(700, 800, 1600)));
            expect(api().current).toBe('steps');

            act(() => {
                vi.advanceTimersByTime(1_000);
            });
            act(() => bind().onScroll(report(600, 800, 1600)));
            expect(api().current).toBe('ingredients');
        } finally {
            vi.useRealTimers();
        }
    });

    // A deep link jumps on mount, before any section has reported its layout (Home's Paste ingredients opens the
    // editor at Ingredients): the jump waits for that section's layout, then lands once.
    it('a jump asked for before its section is laid out lands when the section reports its layout', () => {
        const { bind, api } = renderHost(['details', 'ingredients']);
        const scrollView = { scrollTo: vi.fn() };
        act(() => bind().ref(scrollView));

        act(() => api().scrollToSection('ingredients'));
        expect(scrollView.scrollTo).not.toHaveBeenCalled();
        expect(api().current).toBe('ingredients');

        act(() => api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        expect(scrollView.scrollTo).not.toHaveBeenCalled();
        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
        expect(scrollView.scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 500, animated: true });

        act(() => api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 520, height: 900 } } }));
        expect(scrollView.scrollTo).toHaveBeenCalledTimes(1);
    });
    // §16.3: a native field is not found by id; it hears that it was named. `scrollToField` counts the naming, each
    // field reads its own count (`useFieldTarget`), and the field asks the reveal host to show it. Answering `true`
    // is what keeps the caller from falling back to the section heading as well.
    describe('scrollToField', () => {
        /** Render a host whose child reads the counts of the ids it is given. */
        function renderCounted(ids: readonly string[]): {
            api: () => ScrollHostApi;
            counts: () => Record<string, number>;
        } {
            const seen: { api?: ScrollHostApi; counts: Record<string, number> } = { counts: {} };

            render(
                <ScrollHost sections={['details', 'steps']}>
                    <ApiProbe
                        onApi={(api) => {
                            seen.api = api;
                        }}
                    />
                    {ids.map((id) => (
                        <CountProbe
                            key={id}
                            id={id}
                            onCount={(count) => {
                                seen.counts[id] = count;
                            }}
                        />
                    ))}
                </ScrollHost>,
            );

            return {
                api: () => {
                    if (seen.api === undefined) {
                        throw new Error('no api');
                    }

                    return seen.api;
                },
                counts: () => ({ ...seen.counts }),
            };
        }

        it('answers that it found the field, so the caller does not fall back to the section heading', () => {
            const { api } = renderCounted([]);

            expect(api().scrollToField('recipe-title')).toBe(true);
        });

        it('moves the named field’s cursor once per call, and no other field’s', () => {
            const { api, counts } = renderCounted(['a', 'b']);

            act(() => {
                api().scrollToField('a');
            });
            act(() => {
                api().scrollToField('b');
            });
            act(() => {
                api().scrollToField('a');
            });

            expect(counts()).toEqual({ a: 2, b: 1 });
        });

        it('releases a section hold: the section a jump named is no longer current once the field is named', () => {
            const { api } = renderCounted(['a']);
            act(() => api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
            act(() => api().sectionLayout('steps')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
            act(() => {
                api().scrollToSection('steps');
            });
            expect(api().current).toBe('steps');

            act(() => {
                api().scrollToField('a');
            });

            expect(api().current).not.toBe('steps');
        });

        it('cancels a jump still waiting for its section’s layout, so the layout does not drag the cook off the field', () => {
            const scrollView = { scrollTo: vi.fn() };
            const seen: { api?: ScrollHostApi; bind?: ScrollBind } = {};

            render(
                <ScrollHost sections={['details', 'steps']}>
                    {(bind) => {
                        seen.bind = bind;

                        return (
                            <ApiProbe
                                onApi={(api) => {
                                    seen.api = api;
                                }}
                            />
                        );
                    }}
                </ScrollHost>,
            );
            act(() => seen.bind?.ref(scrollView));
            act(() => {
                seen.api?.scrollToSection('steps');
            });
            act(() => {
                seen.api?.scrollToField('a');
            });

            act(() => seen.api?.sectionLayout('steps')({ nativeEvent: { layout: { y: 500, height: 900 } } }));

            expect(scrollView.scrollTo).not.toHaveBeenCalled();
        });
    });

    // An arrival on native goes through the field reveal host (`FieldRevealContext`), so this host finds no span by id.
    it('finds no span by id: a native arrival is the field reveal host’s', () => {
        const { api } = renderHost(['details']);

        expect(api().revealSpan('row', 'field')).toBe(false);
    });

    it('throws when read outside a host: a floating button with no scroller is a wiring defect', () => {
        const Orphan = (): null => {
            useScrollHost();

            return null;
        };

        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => render(<Orphan />)).toThrow(/ScrollHost/);
        spy.mockRestore();
    });

    it('renders plain children too', () => {
        const { getByText } = render(
            <ScrollHost>
                <Text>plain</Text>
            </ScrollHost>,
        );

        expect(getByText('plain')).toBeTruthy();
    });
});

describe('ScrollHost (native) — a plain ScrollView takes bind as it always did', () => {
    // The 2026-11-02 crash: a native-driven Animated.event is an OBJECT, and a plain ScrollView calls `props.onScroll(e)`.
    it('survives a scroll event through a real ScrollView and still updates the host', () => {
        const seen: { api?: ScrollHostApi } = {};

        render(
            <ScrollHost>
                {(bind) => (
                    <ScrollView {...bind} testID="scroller">
                        <ApiProbe
                            onApi={(api) => {
                                seen.api = api;
                            }}
                        />
                    </ScrollView>
                )}
            </ScrollHost>,
        );

        expect(seen.api?.atTop).toBe(true);

        const scroller = screen.getByTestId('scroller');
        Object.defineProperty(scroller, 'scrollTop', { value: 300, configurable: true });
        // The scroll view reports the end of a scroll on a 100 ms timer. Faked, it is flushed here, while the DOM is
        // there, and not left to fire after the environment is gone.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        expect(() => fireEvent.scroll(scroller)).not.toThrow();
        act(() => {
            vi.runOnlyPendingTimers();
        });
        expect(seen.api?.atTop).toBe(false);
    });
});

describe('ScrollHost (native) — the scroll offset an Animated list writes', () => {
    it('publishes one Animated.Value that stays the same object across renders and scrolls', () => {
        const { bind, api } = renderHost();
        const first = api().scrollY;

        act(() => bind().onScroll(report(120)));

        expect(first).toBeInstanceOf(Animated.Value);
        expect(api().scrollY).toBe(first);
    });
});

// A list that remounts (the Recipes list is keyed on its layout, so a Grid to List switch or a text-scale column change gives a
// new scroller) starts at offset 0, but the host's offset is written only by native scroll events and keeps its last value until the
// next one. A pin that reads it would stay pinned over a list at the top. A scroller that replaces another resets the host.
describe('ScrollHost (native) — a new scroller starts at the top', () => {
    const scroller = (): { scrollTo: (options: { y?: number }) => void } => ({ scrollTo: vi.fn() });

    const offsetOf = (api: () => ScrollHostApi): Animated.Value => {
        const value = api().scrollY;

        if (value === undefined) {
            throw new Error('the host publishes no offset');
        }

        return value;
    };

    it('resets the offset and the scroll state when a different scroller attaches', () => {
        const { bind, api } = renderHost();
        const first = scroller();
        const second = scroller();

        act(() => bind().ref(first));
        act(() => offsetOf(api).setValue(300));
        act(() => bind().onScroll(report(300)));
        expect(api().atTop).toBe(false);

        // React detaches the old scroller and attaches the new one when the list is keyed anew.
        act(() => bind().ref(null));
        act(() => bind().ref(second));

        expect(Number(JSON.stringify(offsetOf(api)))).toBe(0);
        expect(api().atTop).toBe(true);
        expect(api().viewportsDown).toBe(0);
    });

    // The reset is complete: a section jump's hold and a jump still waiting for its layout belong to the OLD scroller's
    // position, so a new scroller must not inherit them (a held section would stay current over a list at the top).
    it('releases a held section when a different scroller attaches', () => {
        const host = renderHost(['details', 'ingredients', 'steps']);
        const first = scroller();
        act(() => host.bind().ref(first));
        act(() => host.api().sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } }));
        act(() => host.api().sectionLayout('ingredients')({ nativeEvent: { layout: { y: 500, height: 900 } } }));
        act(() => host.api().sectionLayout('steps')({ nativeEvent: { layout: { y: 1400, height: 200 } } }));
        act(() => host.bind().onScroll(report(600, 800, 1600)));
        act(() => host.api().scrollToSection('steps'));
        act(() => host.bind().onScroll(report(800, 800, 1600)));
        expect(host.api().current).toBe('steps');

        act(() => host.bind().ref(null));
        act(() => host.bind().ref(scroller()));

        expect(host.api().current).toBeUndefined();
    });

    it('drops a jump still waiting for its layout when a different scroller attaches', () => {
        const host = renderHost(['details']);
        const second = scroller();
        act(() => host.bind().ref(scroller()));
        act(() => host.api().scrollToSection('details'));

        act(() => host.bind().ref(null));
        act(() => host.bind().ref(second));
        act(() => host.api().sectionLayout('details')({ nativeEvent: { layout: { y: 400, height: 500 } } }));

        expect(second.scrollTo).not.toHaveBeenCalled();
    });

    it('leaves the offset alone when the SAME scroller re-attaches', () => {
        const { bind, api } = renderHost();
        const only = scroller();

        act(() => bind().ref(only));
        act(() => offsetOf(api).setValue(300));
        act(() => bind().onScroll(report(300)));
        act(() => bind().ref(null));
        act(() => bind().ref(only));

        expect(Number(JSON.stringify(offsetOf(api)))).toBe(300);
        expect(api().atTop).toBe(false);
    });
});

describe('ScrollHost (native) — layout noise does not cost a commit', () => {
    const layout = (y: number, height: number): LayoutReport => ({ nativeEvent: { layout: { y, height } } });

    /** Render a host and count how many times its screen is rendered. */
    function renderCounting(sections: readonly string[]): { api: () => ScrollHostApi; renders: () => number } {
        const seen: { api?: ScrollHostApi; renders: number } = { renders: 0 };

        render(
            <ScrollHost sections={sections}>
                {() => {
                    seen.renders += 1;

                    return (
                        <ApiProbe
                            onApi={(api) => {
                                seen.api = api;
                            }}
                        />
                    );
                }}
            </ScrollHost>,
        );

        return {
            api: () => {
                if (seen.api === undefined) {
                    throw new Error('no api');
                }

                return seen.api;
            },
            renders: () => seen.renders,
        };
    }

    // Android re-sends a layout for float noise (+0.0004). The scroll handler is rebuilt for a new heading bottom, so
    // each wobble would re-render the screen and re-attach the native scroll event.
    it('re-renders nothing for a heading layout that differs by a fraction of a pixel', () => {
        const { api, renders } = renderCounting([]);

        act(() => api().headingLayout(layout(100, 50.0004)));
        const settled = renders();

        act(() => api().headingLayout(layout(100, 49.9996)));
        act(() => api().headingLayout(layout(100.0003, 50)));

        expect(renders()).toBe(settled);
    });

    it('re-renders nothing for a section layout that differs by a fraction of a pixel', () => {
        const { api, renders } = renderCounting(['a']);

        act(() => api().sectionLayout('a')(layout(400.0004, 80)));
        const settled = renders();

        act(() => api().sectionLayout('a')(layout(399.9996, 80)));
        act(() => api().sectionLayout('a')(layout(400.0002, 80)));

        expect(renders()).toBe(settled);
    });

    it('still re-renders for a real change of a whole pixel', () => {
        const { api, renders } = renderCounting([]);

        act(() => api().headingLayout(layout(100, 50)));
        const settled = renders();

        act(() => api().headingLayout(layout(100, 52)));

        expect(renders()).toBeGreaterThan(settled);
    });
});
