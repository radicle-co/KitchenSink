/**
 * @module @commise/features-recipes — native public-discovery view (T076 building block, US2).
 *
 * The React Native leaf of {@link import('./RecipeDiscoveryList.js').RecipeDiscoveryList} — same controlled,
 * presentational contract and the same four states (loading, error, empty, populated), rendered with RN
 * primitives. Every recipe shown is public; each row offers a Clone action.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { formatRecipeCount } from '../list/model.js';
import { discoveryMessages } from './messages.js';
import { RecipeDiscoveryCard } from './RecipeDiscoveryCard.native.js';
import { toRecipeDiscoveryItem, type RecipeDiscoveryListProps } from './model.js';

export const RecipeDiscoveryList: FC<RecipeDiscoveryListProps> = ({
    status,
    results,
    searchValue,
    onSearchChange,
    onSelectRecipe,
    onClone,
    onRetry,
    cloningId,
}) => {
    const discovery = useMessages(discoveryMessages);
    const locale = useLocale();

    let body: ReactElement;

    if (status === 'loading') {
        body = <View accessibilityLabel={discovery.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <View accessibilityRole="alert">
                <Text>{discovery.errorTitle}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={discovery.retry} onPress={onRetry}>
                    <Text>{discovery.retry}</Text>
                </Pressable>
            </View>
        );
    } else if (results.length === 0) {
        body = (
            <View>
                <Text>{discovery.emptyTitle}</Text>
                <Text>{discovery.emptyBody}</Text>
            </View>
        );
    } else {
        const count = formatRecipeCount(
            results.length,
            { one: discovery.countOne, other: discovery.countOther },
            locale,
        );
        body = (
            <View>
                <Text>{count}</Text>
                {results.map((result) => {
                    const item = toRecipeDiscoveryItem(result);

                    return (
                        <RecipeDiscoveryCard
                            key={item.id}
                            recipe={item}
                            isCloning={cloningId === item.id}
                            onSelect={onSelectRecipe}
                            onClone={onClone}
                        />
                    );
                })}
            </View>
        );
    }

    return (
        <View accessibilityLabel={discovery.heading}>
            <Text accessibilityRole="header">{discovery.heading}</Text>
            <TextInput
                accessibilityLabel={discovery.searchLabel}
                placeholder={discovery.searchPlaceholder}
                value={searchValue}
                onChangeText={onSearchChange}
            />
            {body}
        </View>
    );
};
