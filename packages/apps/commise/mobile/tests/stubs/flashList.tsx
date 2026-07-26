/**
 * @module tests/stubs/flashList — jsdom stand-in for `@shopify/flash-list`, aliased in by
 * `vitest.native.config.ts`. FlashList is a native (Fabric) recycler with no jsdom runtime, so the mobile
 * screens that compose the virtualized recipe/collection/discovery lists (U4) render through this
 * react-native-web stub — the same approach the mobile config already uses for `expo-image`, and mirroring
 * `packages/apps/commise/features/recipes/test-utils/flashListStub.tsx`. It renders the same observable tree
 * the tests query: the header, every `data` row through `renderItem` (no virtualization — all rows in the
 * DOM), the footer, and the empty slot when there is no data.
 */
import { Fragment, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';

/** The `renderItem` info object FlashList passes (the subset the recipe leaves read). */
interface ListRenderItemInfo<TItem> {
    readonly item: TItem;
    readonly index: number;
}

/** A header/footer/empty slot — FlashList accepts either a rendered element or a component type. */
type ListSlot = ReactElement | ComponentType | null | undefined;

/** The subset of `FlashListProps` the recipe native leaves pass. */
interface FlashListStubProps<TItem> extends Pick<
    ScrollViewProps,
    'style' | 'contentContainerStyle' | 'keyboardShouldPersistTaps' | 'accessibilityLabel'
> {
    readonly data?: readonly TItem[] | null;
    readonly renderItem?: (info: ListRenderItemInfo<TItem>) => ReactElement | null;
    readonly keyExtractor?: (item: TItem, index: number) => string;
    readonly ListHeaderComponent?: ListSlot;
    readonly ListFooterComponent?: ListSlot;
    readonly ListEmptyComponent?: ListSlot;
    /** Grid column count on device; display-inert here (every cell renders in document order). */
    readonly numColumns?: number;
    readonly refreshControl?: ScrollViewProps['refreshControl'];
    readonly refreshing?: boolean | null;
    readonly onRefresh?: (() => void) | null;
    readonly extraData?: unknown;
    readonly role?: ScrollViewProps['role'];
}

/** Render a header/footer/empty slot whether it was given as an element or as a component type. */
function renderSlot(slot: ListSlot): ReactNode {
    if (slot === null || slot === undefined) {
        return null;
    }

    if (isValidElement(slot)) {
        return slot;
    }

    const Slot = slot as ComponentType;

    return <Slot />;
}

/**
 * The jsdom FlashList stub — eagerly renders header, every row, footer, and (when empty) the empty slot into
 * a react-native-web `ScrollView`.
 */
export function FlashList<TItem>({
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
    refreshControl,
    style,
    contentContainerStyle,
    keyboardShouldPersistTaps,
    accessibilityLabel,
    role,
}: FlashListStubProps<TItem>): ReactElement {
    const rows = data ?? [];
    const hasRows = rows.length > 0;

    return (
        <ScrollView
            {...(style !== undefined ? { style } : {})}
            {...(contentContainerStyle !== undefined ? { contentContainerStyle } : {})}
            {...(keyboardShouldPersistTaps !== undefined ? { keyboardShouldPersistTaps } : {})}
            {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
            {...(role !== undefined ? { role } : {})}
            {...(refreshControl !== undefined ? { refreshControl } : {})}
        >
            {renderSlot(ListHeaderComponent)}
            {hasRows
                ? rows.map((item, index) => {
                      const rendered = renderItem?.({ item, index });
                      const key = keyExtractor?.(item, index) ?? String(index);

                      return rendered === null || rendered === undefined ? null : (
                          <Fragment key={key}>{rendered}</Fragment>
                      );
                  })
                : renderSlot(ListEmptyComponent)}
            {renderSlot(ListFooterComponent)}
        </ScrollView>
    );
}
