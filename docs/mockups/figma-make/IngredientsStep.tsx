import React, { useState, useMemo, useRef, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type FoodSource = 'mine' | 'catalog' | 'custom';

export interface FoodItem {
    id: string;
    name: string;
    source: FoodSource;
    nutritionPer100g?: { cal: number; protein: number; carbs: number; fat: number };
}

export interface IngredientRow {
    id: string;
    food: FoodItem | null;
    quantity: string;
    quantityHigh: string;
    showRange: boolean;
    unit: string;
    preparation: string;
}

export type ListEntry = { type: 'group'; id: string; label: string } | { type: 'row'; data: IngredientRow };

// ── Static data ────────────────────────────────────────────────────────────────

const RECOGNIZED_UNITS = new Set([
    'cup',
    'tbsp',
    'tsp',
    'g',
    'oz',
    'lb',
    'ml',
    'clove',
    'pinch',
    'quart',
    'pint',
    'gram',
    'ounce',
    'pound',
    'tablespoon',
    'teaspoon',
    'milliliter',
    'millilitre',
    'kg',
    'liter',
    'litre',
]);
const UNIT_SUGGESTIONS = ['cup', 'tbsp', 'tsp', 'g', 'oz', 'lb', 'ml', 'clove', 'pinch'];

const COMMON_GROUP_LABELS = [
    'For the marinade',
    'For the sauce',
    'For the dressing',
    'For the topping',
    'For the filling',
    'For the crust',
    'Dry ingredients',
    'Wet ingredients',
    'For the dough',
    'For the glaze',
    'For serving',
    'For the garnish',
];

const MY_FOODS: FoodItem[] = [
    { id: 'my-1', name: 'Garlic', source: 'mine', nutritionPer100g: { cal: 149, protein: 6.4, carbs: 33.1, fat: 0.5 } },
    {
        id: 'my-2',
        name: 'Yellow onion',
        source: 'mine',
        nutritionPer100g: { cal: 40, protein: 1.1, carbs: 9.3, fat: 0.1 },
    },
    { id: 'my-3', name: 'Olive oil', source: 'mine', nutritionPer100g: { cal: 884, protein: 0, carbs: 0, fat: 100 } },
    { id: 'my-4', name: 'Salt', source: 'mine', nutritionPer100g: { cal: 0, protein: 0, carbs: 0, fat: 0 } },
    {
        id: 'my-5',
        name: 'Black pepper',
        source: 'mine',
        nutritionPer100g: { cal: 251, protein: 10.4, carbs: 63.9, fat: 3.3 },
    },
];

const CATALOG_FOODS: FoodItem[] = [
    {
        id: 'cat-1',
        name: 'Lamb leg, butterflied',
        source: 'catalog',
        nutritionPer100g: { cal: 204, protein: 28.2, carbs: 0, fat: 9.6 },
    },
    {
        id: 'cat-2',
        name: 'Arborio rice',
        source: 'catalog',
        nutritionPer100g: { cal: 362, protein: 7.0, carbs: 79.9, fat: 0.7 },
    },
    {
        id: 'cat-3',
        name: 'Dry white wine',
        source: 'catalog',
        nutritionPer100g: { cal: 82, protein: 0.1, carbs: 2.6, fat: 0 },
    },
    {
        id: 'cat-4',
        name: 'Vegetable stock',
        source: 'catalog',
        nutritionPer100g: { cal: 7, protein: 0.1, carbs: 1.4, fat: 0.1 },
    },
    {
        id: 'cat-5',
        name: 'Parmigiano-Reggiano',
        source: 'catalog',
        nutritionPer100g: { cal: 392, protein: 35.8, carbs: 3.2, fat: 25.8 },
    },
    {
        id: 'cat-6',
        name: 'Fresh thyme',
        source: 'catalog',
        nutritionPer100g: { cal: 101, protein: 5.6, carbs: 24.5, fat: 1.7 },
    },
    {
        id: 'cat-7',
        name: 'Fresh rosemary',
        source: 'catalog',
        nutritionPer100g: { cal: 131, protein: 3.3, carbs: 20.7, fat: 5.9 },
    },
    {
        id: 'cat-8',
        name: 'Garlic cloves',
        source: 'catalog',
        nutritionPer100g: { cal: 149, protein: 6.4, carbs: 33.1, fat: 0.5 },
    },
];

const FLOUR_VARIANTS: FoodItem[] = [
    {
        id: 'fl-1',
        name: 'All-purpose flour',
        source: 'catalog',
        nutritionPer100g: { cal: 364, protein: 10.3, carbs: 76.3, fat: 1.0 },
    },
    {
        id: 'fl-2',
        name: 'Whole-wheat flour',
        source: 'catalog',
        nutritionPer100g: { cal: 340, protein: 13.2, carbs: 72.6, fat: 1.9 },
    },
    {
        id: 'fl-3',
        name: 'Bread flour',
        source: 'catalog',
        nutritionPer100g: { cal: 361, protein: 12.0, carbs: 73.8, fat: 1.1 },
    },
    {
        id: 'fl-4',
        name: 'Pastry flour',
        source: 'catalog',
        nutritionPer100g: { cal: 362, protein: 9.0, carbs: 75.6, fat: 1.2 },
    },
];

const UNIT_GRAMS: Record<string, number> = {
    g: 1,
    gram: 1,
    grams: 1,
    kg: 1000,
    ml: 1,
    milliliter: 1,
    millilitre: 1,
    tsp: 5,
    teaspoon: 5,
    tbsp: 15,
    tablespoon: 15,
    cup: 240,
    pint: 473,
    quart: 946,
    oz: 28.35,
    ounce: 28.35,
    lb: 453.6,
    pound: 453.6,
    clove: 5,
    pinch: 0.5,
    handful: 30,
    splash: 10,
};

function toGrams(qty: string, unit: string): number {
    const q = parseFloat(qty);
    if (!q || !unit) return 0;
    return q * (UNIT_GRAMS[unit.toLowerCase().trim()] ?? 0);
}

// ── Food picker state ──────────────────────────────────────────────────────────

type PickerMode =
    | { kind: 'recent'; mine: FoodItem[] }
    | { kind: 'results'; mine: FoodItem[]; catalog: FoodItem[] }
    | { kind: 'mine-only'; mine: FoodItem[] }
    | { kind: 'catalog-only'; catalog: FoodItem[] }
    | { kind: 'no-results' }
    | { kind: 'disambiguation'; items: FoodItem[]; query: string }
    | { kind: 'usda-searching'; query: string }
    | { kind: 'usda-error'; query: string };

function resolvePickerMode(query: string, usdaState: 'idle' | 'loading' | 'error', usdaQuery: string): PickerMode {
    if (usdaState === 'loading') return { kind: 'usda-searching', query: usdaQuery };
    if (usdaState === 'error') return { kind: 'usda-error', query: usdaQuery };
    if (!query.trim()) return { kind: 'recent', mine: MY_FOODS };
    const q = query.toLowerCase().trim();
    if (q.length >= 2 && 'flour'.startsWith(q)) return { kind: 'disambiguation', items: FLOUR_VARIANTS, query };
    const mine = MY_FOODS.filter((f) => f.name.toLowerCase().includes(q));
    const catalog = CATALOG_FOODS.filter((f) => f.name.toLowerCase().includes(q));
    if (mine.length > 0 && catalog.length > 0) return { kind: 'results', mine, catalog };
    if (mine.length > 0) return { kind: 'mine-only', mine };
    if (catalog.length > 0) return { kind: 'catalog-only', catalog };
    return { kind: 'no-results' };
}

// ── Initial data — two named sections + one mid-edit row ───────────────────────

const INITIAL_LIST: ListEntry[] = [
    { type: 'group', id: 'g1', label: 'For the marinade' },
    {
        type: 'row',
        data: {
            id: 'r1',
            food: CATALOG_FOODS[0],
            quantity: '900',
            quantityHigh: '',
            showRange: false,
            unit: 'g',
            preparation: 'at room temperature',
        },
    },
    {
        type: 'row',
        data: {
            id: 'r2',
            food: MY_FOODS[0],
            quantity: '3',
            quantityHigh: '4',
            showRange: true,
            unit: 'clove',
            preparation: 'minced',
        },
    },
    {
        type: 'row',
        data: {
            id: 'r3',
            food: MY_FOODS[2],
            quantity: '2',
            quantityHigh: '',
            showRange: false,
            unit: 'tbsp',
            preparation: '',
        },
    },
    { type: 'group', id: 'g2', label: 'For the risotto' },
    {
        type: 'row',
        data: {
            id: 'r4',
            food: MY_FOODS[3],
            quantity: '',
            quantityHigh: '',
            showRange: false,
            unit: 'to taste',
            preparation: '',
        },
    },
    {
        type: 'row',
        data: {
            id: 'r5',
            food: CATALOG_FOODS[1],
            quantity: '300',
            quantityHigh: '',
            showRange: false,
            unit: 'g',
            preparation: '',
        },
    },
    {
        type: 'row',
        data: {
            id: 'r6',
            food: MY_FOODS[1],
            quantity: '1',
            quantityHigh: '',
            showRange: false,
            unit: '',
            preparation: 'finely diced',
        },
    },
    {
        type: 'row',
        data: {
            id: 'r7',
            food: { id: 'cus-1', name: 'Fresh flat-leaf parsley', source: 'custom' },
            quantity: '1',
            quantityHigh: '',
            showRange: false,
            unit: 'handful',
            preparation: 'roughly torn',
        },
    },
    // Mid-edit row — food not yet chosen
    {
        type: 'row',
        data: { id: 'r8', food: null, quantity: '', quantityHigh: '', showRange: false, unit: '', preparation: '' },
    },
];

// ── Small shared components ────────────────────────────────────────────────────

function UsdaBadge() {
    return (
        <span className="inline-block text-[9px] font-bold text-white bg-sky px-1 py-px rounded uppercase tracking-wide leading-none flex-shrink-0">
            USDA
        </span>
    );
}

function CustomBadge() {
    return (
        <span className="inline-block text-[9px] font-medium text-slate/60 border border-mist px-1 py-px rounded uppercase tracking-wide leading-none flex-shrink-0">
            Custom
        </span>
    );
}

function FoodOption({
    food,
    onSelect,
    showDetail = false,
}: {
    food: FoodItem;
    onSelect: () => void;
    showDetail?: boolean;
}) {
    return (
        <button
            onClick={onSelect}
            className="w-full px-3 py-2.5 text-left flex items-center gap-2 hover:bg-seafoam/5 active:bg-seafoam/10 transition-colors"
        >
            <span className="flex-1 min-w-0 text-sm text-charcoal truncate">{food.name}</span>
            {showDetail && food.nutritionPer100g && (
                <span className="text-xs text-slate/40 tabular-nums flex-shrink-0">
                    {food.nutritionPer100g.cal} kcal
                </span>
            )}
            {food.source === 'catalog' && <UsdaBadge />}
            {food.source === 'custom' && <CustomBadge />}
        </button>
    );
}

function PickerSectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="px-3 py-1.5 text-[10px] font-semibold text-slate/50 uppercase tracking-widest bg-pearl/60 border-b border-border/50">
            {children}
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface IngredientsStepProps {
    servings?: number;
    onChange?: (rows: IngredientRow[]) => void;
}

export function IngredientsStep({ servings = 4, onChange }: IngredientsStepProps) {
    const [list, setList] = useState<ListEntry[]>(INITIAL_LIST);

    // Group editing state
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [groupQuery, setGroupQuery] = useState('');

    // Row group-assign popup
    const [groupAssignForRowId, setGroupAssignForRowId] = useState<string | null>(null);

    // Food picker state
    const [pickerOpenForId, setPickerOpenForId] = useState<string | null>('r8');
    const [pickerQuery, setPickerQuery] = useState('');
    const [usdaState, setUsdaState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [usdaQuery, setUsdaQuery] = useState('');

    // Unit autocomplete
    const [unitSuggestForId, setUnitSuggestForId] = useState<string | null>(null);

    const pickerInputRef = useRef<HTMLInputElement>(null);
    const groupInputRef = useRef<HTMLInputElement>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Derived ────────────────────────────────────────────────────────────────

    const rows = useMemo(
        () => list.filter((e): e is { type: 'row'; data: IngredientRow } => e.type === 'row').map((e) => e.data),
        [list],
    );

    const groups = useMemo(
        () => list.filter((e): e is { type: 'group'; id: string; label: string } => e.type === 'group'),
        [list],
    );

    const hasGroups = groups.length > 0;

    const rowIndexMap = useMemo(() => {
        const m = new Map<string, number>();
        let i = 0;
        for (const e of list) if (e.type === 'row') m.set(e.data.id, i++);
        return m;
    }, [list]);

    // Sections for rendering: [{group, rowEntries[]}]
    const sections = useMemo(() => {
        const result: Array<{
            group: { id: string; label: string } | null;
            rowEntries: IngredientRow[];
        }> = [];
        let current: (typeof result)[0] | null = null;
        for (const entry of list) {
            if (entry.type === 'group') {
                current = { group: { id: entry.id, label: entry.label }, rowEntries: [] };
                result.push(current);
            } else {
                if (!current) {
                    current = { group: null, rowEntries: [] };
                    result.push(current);
                }
                current.rowEntries.push(entry.data);
            }
        }
        return result;
    }, [list]);

    const groupLabelSuggestions = useMemo(() => {
        const existing = groups.filter((g) => g.id !== editingGroupId && g.label).map((g) => g.label);
        const all = [...new Set([...existing, ...COMMON_GROUP_LABELS])];
        if (!groupQuery.trim()) return all.slice(0, 7);
        const q = groupQuery.toLowerCase();
        return all.filter((s) => s.toLowerCase().includes(q)).slice(0, 7);
    }, [groups, editingGroupId, groupQuery]);

    const nutrition = useMemo(() => {
        let cal = 0,
            protein = 0,
            carbs = 0,
            fat = 0,
            withData = 0,
            withoutData = 0;
        for (const row of rows) {
            if (!row.food) continue;
            if (!row.food.nutritionPer100g) {
                withoutData++;
                continue;
            }
            withData++;
            const g = toGrams(row.quantity, row.unit);
            if (!g) continue;
            const f = g / 100;
            cal += row.food.nutritionPer100g.cal * f;
            protein += row.food.nutritionPer100g.protein * f;
            carbs += row.food.nutritionPer100g.carbs * f;
            fat += row.food.nutritionPer100g.fat * f;
        }
        const s = Math.max(1, servings);
        return {
            cal: Math.round(cal / s),
            protein: Math.round(protein / s),
            carbs: Math.round(carbs / s),
            fat: Math.round(fat / s),
            withData,
            withoutData,
            total: withData + withoutData,
        };
    }, [rows, servings]);

    const pickerMode = resolvePickerMode(pickerQuery, usdaState, usdaQuery);
    const hasIncompleteRows = rows.some((r) => !r.food);

    // ── Helpers ────────────────────────────────────────────────────────────────

    const emitChange = useCallback(
        (next: ListEntry[]) => {
            onChange?.(
                next.filter((e): e is { type: 'row'; data: IngredientRow } => e.type === 'row').map((e) => e.data),
            );
        },
        [onChange],
    );

    const updateRow = useCallback(
        (rowId: string, patch: Partial<IngredientRow>) => {
            setList((prev) => {
                const next = prev.map((e) =>
                    e.type === 'row' && e.data.id === rowId ? { ...e, data: { ...e.data, ...patch } } : e,
                );
                emitChange(next);
                return next;
            });
        },
        [emitChange],
    );

    const removeRow = useCallback(
        (rowId: string) => {
            setList((prev) => {
                const next = prev.filter((e) => !(e.type === 'row' && e.data.id === rowId));
                emitChange(next);
                return next;
            });
            if (pickerOpenForId === rowId) setPickerOpenForId(null);
            if (groupAssignForRowId === rowId) setGroupAssignForRowId(null);
        },
        [pickerOpenForId, groupAssignForRowId, emitChange],
    );

    const makeBlankRow = (): IngredientRow => ({
        id: `r-${Date.now()}`,
        food: null,
        quantity: '',
        quantityHigh: '',
        showRange: false,
        unit: '',
        preparation: '',
    });

    const addRowAtEnd = useCallback(() => {
        const row = makeBlankRow();
        setList((prev) => {
            const n = [...prev, { type: 'row' as const, data: row }];
            emitChange(n);
            return n;
        });
        setPickerOpenForId(row.id);
        setPickerQuery('');
        setUsdaState('idle');
        setTimeout(() => pickerInputRef.current?.focus(), 60);
    }, [emitChange]);

    const addRowToGroup = useCallback(
        (groupId: string) => {
            const row = makeBlankRow();
            setList((prev) => {
                const gIdx = prev.findIndex((e) => e.type === 'group' && e.id === groupId);
                if (gIdx === -1) {
                    const n = [...prev, { type: 'row' as const, data: row }];
                    emitChange(n);
                    return n;
                }
                let ins = gIdx + 1;
                while (ins < prev.length && prev[ins].type === 'row') ins++;
                const n = [...prev.slice(0, ins), { type: 'row' as const, data: row }, ...prev.slice(ins)];
                emitChange(n);
                return n;
            });
            setPickerOpenForId(row.id);
            setPickerQuery('');
            setUsdaState('idle');
            setTimeout(() => pickerInputRef.current?.focus(), 60);
        },
        [emitChange],
    );

    const addGroup = useCallback(() => {
        const id = `g-${Date.now()}`;
        setList((prev) => [...prev, { type: 'group' as const, id, label: '' }]);
        setEditingGroupId(id);
        setGroupQuery('');
        setTimeout(() => groupInputRef.current?.focus(), 60);
    }, []);

    const confirmGroupLabel = useCallback((groupId: string, label: string) => {
        setList((prev) => {
            const trimmed = label.trim();
            if (!trimmed) return prev.filter((e) => !(e.type === 'group' && e.id === groupId));
            return prev.map((e) => (e.type === 'group' && e.id === groupId ? { ...e, label: trimmed } : e));
        });
        setEditingGroupId(null);
        setGroupQuery('');
    }, []);

    const removeGroup = useCallback((groupId: string) => {
        setList((prev) => prev.filter((e) => !(e.type === 'group' && e.id === groupId)));
    }, []);

    const moveRowToGroup = useCallback((rowId: string, targetGroupId: string | null) => {
        setList((prev) => {
            const idx = prev.findIndex((e) => e.type === 'row' && e.data.id === rowId);
            if (idx === -1) return prev;
            const entry = prev[idx];
            const without = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
            if (targetGroupId === null) return [...without, entry];
            const gIdx = without.findIndex((e) => e.type === 'group' && e.id === targetGroupId);
            if (gIdx === -1) return [...without, entry];
            let ins = gIdx + 1;
            while (ins < without.length && without[ins].type === 'row') ins++;
            return [...without.slice(0, ins), entry, ...without.slice(ins)];
        });
        setGroupAssignForRowId(null);
    }, []);

    const getRowGroupId = useCallback(
        (rowId: string): string | null => {
            let cur: string | null = null;
            for (const e of list) {
                if (e.type === 'group') cur = e.id;
                if (e.type === 'row' && e.data.id === rowId) return cur;
            }
            return null;
        },
        [list],
    );

    // Food picker
    const openPickerFor = useCallback((id: string) => {
        setPickerOpenForId(id);
        setPickerQuery('');
        setUsdaState('idle');
        setTimeout(() => pickerInputRef.current?.focus(), 60);
    }, []);

    const closePicker = useCallback(() => {
        setPickerOpenForId(null);
        setPickerQuery('');
        setUsdaState('idle');
    }, []);

    const selectFood = useCallback(
        (rowId: string, food: FoodItem) => {
            updateRow(rowId, { food });
            setPickerOpenForId(null);
            setPickerQuery('');
            setUsdaState('idle');
        },
        [updateRow],
    );

    const triggerUsdaSearch = useCallback(() => {
        const q = pickerQuery;
        setUsdaQuery(q);
        setUsdaState('loading');
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setUsdaState('error'), 2800);
    }, [pickerQuery]);

    const addCustomFood = useCallback(
        (rowId: string, name: string) => {
            const food: FoodItem = { id: `cus-${Date.now()}`, name, source: 'custom' };
            updateRow(rowId, { food });
            setPickerOpenForId(null);
            setPickerQuery('');
            setUsdaState('idle');
        },
        [updateRow],
    );

    // ── Render: food picker panel ──────────────────────────────────────────────

    const renderPickerPanel = (rowId: string) => (
        <div className="mt-1.5 border border-border rounded-[var(--radius-md)] bg-white shadow-[var(--shadow-lg)] overflow-hidden">
            <div className="p-2 border-b border-border/70">
                <div className="flex items-center gap-2 px-3 py-2 bg-pearl rounded-[var(--radius-sm)]">
                    <svg
                        className="w-3.5 h-3.5 text-slate/60 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                    </svg>
                    <input
                        ref={pickerInputRef}
                        value={pickerQuery}
                        onChange={(e) => {
                            setPickerQuery(e.target.value);
                            setUsdaState('idle');
                        }}
                        placeholder="Search ingredients…"
                        className="flex-1 bg-transparent text-sm text-charcoal placeholder:text-slate/40 outline-none"
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') closePicker();
                        }}
                    />
                    {pickerQuery && (
                        <button onClick={() => setPickerQuery('')} className="text-slate/50 hover:text-slate">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2.5}
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            <div className="max-h-64 overflow-y-auto">
                {pickerMode.kind === 'recent' && (
                    <>
                        <PickerSectionLabel>Your ingredients</PickerSectionLabel>
                        {pickerMode.mine.map((f) => (
                            <FoodOption key={f.id} food={f} onSelect={() => selectFood(rowId, f)} />
                        ))}
                    </>
                )}
                {pickerMode.kind === 'results' && (
                    <>
                        <PickerSectionLabel>Your ingredients</PickerSectionLabel>
                        {pickerMode.mine.map((f) => (
                            <FoodOption key={f.id} food={f} onSelect={() => selectFood(rowId, f)} />
                        ))}
                        <PickerSectionLabel>Food catalog</PickerSectionLabel>
                        {pickerMode.catalog.map((f) => (
                            <FoodOption key={f.id} food={f} onSelect={() => selectFood(rowId, f)} />
                        ))}
                    </>
                )}
                {pickerMode.kind === 'mine-only' && (
                    <>
                        <PickerSectionLabel>Your ingredients</PickerSectionLabel>
                        {pickerMode.mine.map((f) => (
                            <FoodOption key={f.id} food={f} onSelect={() => selectFood(rowId, f)} />
                        ))}
                    </>
                )}
                {pickerMode.kind === 'catalog-only' && (
                    <>
                        <PickerSectionLabel>Food catalog</PickerSectionLabel>
                        {pickerMode.catalog.map((f) => (
                            <FoodOption key={f.id} food={f} onSelect={() => selectFood(rowId, f)} />
                        ))}
                    </>
                )}
                {pickerMode.kind === 'no-results' && (
                    <div className="py-6 px-4 text-center">
                        <p className="text-sm text-slate">No matches in your ingredients or catalog</p>
                        <p className="text-xs text-slate/50 mt-1">Try searching USDA below, or add as custom</p>
                    </div>
                )}
                {pickerMode.kind === 'disambiguation' && (
                    <>
                        <div className="px-3 py-2 bg-sky/10 border-b border-border/50 flex items-start gap-2">
                            <svg
                                className="w-3.5 h-3.5 text-sky mt-0.5 flex-shrink-0"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                    clipRule="evenodd"
                                />
                            </svg>
                            <p className="text-xs text-slate">Several kinds of flour — which do you mean?</p>
                        </div>
                        {pickerMode.items.map((f) => (
                            <FoodOption key={f.id} food={f} onSelect={() => selectFood(rowId, f)} showDetail />
                        ))}
                        <button className="w-full px-3 py-2.5 text-left text-xs text-slate hover:bg-pearl/60 border-t border-border/50 transition-colors">
                            <span className="text-seafoam font-medium">Remember my choice</span> for "{pickerMode.query}
                            " next time
                        </button>
                    </>
                )}
                {pickerMode.kind === 'usda-searching' && (
                    <div className="py-8 px-4 text-center">
                        <div className="w-5 h-5 border-2 border-seafoam border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-sm text-slate">Searching USDA database…</p>
                        <p className="text-xs text-slate/50 mt-1">This may take a few seconds</p>
                    </div>
                )}
                {pickerMode.kind === 'usda-error' && (
                    <div className="py-6 px-4 text-center">
                        <svg
                            className="w-7 h-7 text-mist mx-auto mb-2"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                            />
                        </svg>
                        <p className="text-sm text-slate">USDA search failed</p>
                        <p className="text-xs text-slate/50 mt-0.5">Check your connection and try again</p>
                        <button
                            onClick={triggerUsdaSearch}
                            className="mt-3 text-xs font-medium text-seafoam hover:text-ocean-dark transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                )}
            </div>

            {pickerQuery && pickerMode.kind !== 'usda-searching' && (
                <div className="border-t border-border/70">
                    {pickerMode.kind !== 'usda-error' && (
                        <button
                            onClick={triggerUsdaSearch}
                            className="w-full px-3 py-2.5 text-left flex items-center gap-2 hover:bg-pearl/60 transition-colors"
                        >
                            <svg
                                className="w-4 h-4 text-slate/50 flex-shrink-0"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                />
                            </svg>
                            <span className="text-sm text-slate">
                                Search USDA for <span className="font-medium text-charcoal">"{pickerQuery}"</span>
                            </span>
                            <span className="ml-auto text-[10px] text-slate/40 font-medium">SLOW</span>
                        </button>
                    )}
                    <button
                        onClick={() => addCustomFood(rowId, pickerQuery)}
                        className={`w-full px-3 py-2.5 text-left flex items-center gap-2 hover:bg-pearl/60 transition-colors ${pickerMode.kind !== 'usda-error' ? 'border-t border-border/40' : ''}`}
                    >
                        <svg
                            className="w-4 h-4 text-coral/70 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span className="text-sm text-slate">
                            Add <span className="font-medium text-charcoal">"{pickerQuery}"</span> as custom ingredient
                        </span>
                        <span className="ml-auto text-[10px] text-slate/40">no nutrition data</span>
                    </button>
                </div>
            )}
        </div>
    );

    // ── Render: group-assign popup ─────────────────────────────────────────────

    const renderGroupAssignPopup = (rowId: string) => {
        const currentGroupId = getRowGroupId(rowId);
        return (
            <div className="absolute left-0 top-full mt-1 z-40 bg-white border border-border rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] min-w-[184px] py-1 overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-slate/50 uppercase tracking-widest border-b border-border/50">
                    Move to section
                </div>
                <button
                    onClick={() => moveRowToGroup(rowId, null)}
                    className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-seafoam/5 transition-colors ${currentGroupId === null ? 'text-seafoam font-medium' : 'text-charcoal'}`}
                >
                    {currentGroupId === null && (
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                            />
                        </svg>
                    )}
                    <span className={currentGroupId === null ? '' : 'ml-5'}>Ungrouped</span>
                </button>
                {groups.map((g) => (
                    <button
                        key={g.id}
                        onClick={() => moveRowToGroup(rowId, g.id)}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-seafoam/5 transition-colors ${currentGroupId === g.id ? 'text-seafoam font-medium' : 'text-charcoal'}`}
                    >
                        {currentGroupId === g.id && (
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        )}
                        <span className={currentGroupId === g.id ? '' : 'ml-5 truncate'}>
                            {g.label || '(unnamed section)'}
                        </span>
                    </button>
                ))}
            </div>
        );
    };

    // ── Render: single ingredient row ──────────────────────────────────────────

    const renderRow = (row: IngredientRow) => {
        const rowIndex = rowIndexMap.get(row.id) ?? 0;
        const isActive = pickerOpenForId === row.id;
        const isGroupAssignOpen = groupAssignForRowId === row.id;
        const unitIsRecognized = row.unit ? RECOGNIZED_UNITS.has(row.unit.toLowerCase().trim()) : true;
        const unitSuggestions =
            unitSuggestForId === row.id && row.unit
                ? UNIT_SUGGESTIONS.filter((u) => u.startsWith(row.unit.toLowerCase()))
                : [];

        return (
            <div
                key={row.id}
                className={`group/row relative rounded-[var(--radius-md)] transition-all duration-[var(--transition-base)] ${
                    isActive
                        ? 'bg-white border border-seafoam/30 shadow-[var(--shadow-md)] ring-1 ring-seafoam/20'
                        : 'bg-white/60 border border-border/60 hover:bg-white hover:border-border hover:shadow-[var(--shadow-sm)]'
                }`}
            >
                <div className="p-3 md:p-5">
                    {/* ── Desktop layout ────────────────────────────────────────────── */}
                    <div className="hidden md:flex flex-col gap-3">
                        {/* ── Row 1: food, qty/unit, trash ── */}
                        <div className="flex items-center gap-2 min-w-0">
                            {/* Drag handle — w-4 */}
                            <button
                                className="cursor-grab w-4 flex-shrink-0 text-mist/50 opacity-0 group-hover/row:opacity-100 transition-opacity active:cursor-grabbing"
                                title="Drag to reorder"
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
                                </svg>
                            </button>

                            {/* Group-move — always w-6 reserved so food aligns across all rows */}
                            <div className="relative w-6 flex-shrink-0 flex items-center justify-center">
                                {hasGroups ? (
                                    <>
                                        <button
                                            onClick={() => setGroupAssignForRowId(isGroupAssignOpen ? null : row.id)}
                                            className="p-1 text-mist/40 hover:text-slate opacity-0 group-hover/row:opacity-100 transition-all rounded"
                                            title="Move to different section"
                                        >
                                            <svg
                                                className="w-3.5 h-3.5"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                                                />
                                            </svg>
                                        </button>
                                        {isGroupAssignOpen && renderGroupAssignPopup(row.id)}
                                    </>
                                ) : null}
                            </div>

                            {/* Row number — w-5 */}
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-seafoam/10 text-seafoam text-[10px] font-bold flex items-center justify-center">
                                {rowIndex + 1}
                            </span>

                            {/* Food chip — w-44 */}
                            <div className="w-44 flex-shrink-0">
                                {row.food ? (
                                    <button
                                        onClick={() => openPickerFor(row.id)}
                                        className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-left transition-colors ${
                                            isActive
                                                ? 'bg-seafoam/10 border border-seafoam/30'
                                                : 'bg-pearl/60 hover:bg-seafoam/5 border border-border/60'
                                        }`}
                                    >
                                        <span className="text-sm text-charcoal font-medium truncate flex-1">
                                            {row.food.name}
                                        </span>
                                        {row.food.source === 'catalog' && <UsdaBadge />}
                                        {row.food.source === 'custom' && <CustomBadge />}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => openPickerFor(row.id)}
                                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-left bg-coral/5 border border-coral/30 hover:bg-coral/10 transition-colors"
                                    >
                                        <svg
                                            className="w-3.5 h-3.5 text-coral/60 flex-shrink-0"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                            />
                                        </svg>
                                        <span className="text-sm text-coral/70 italic">Choose food…</span>
                                    </button>
                                )}
                            </div>

                            <div className="w-px h-5 bg-border flex-shrink-0" />

                            {/* Quantity */}
                            <input
                                type="number"
                                min="0"
                                step="any"
                                value={row.quantity}
                                onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                                placeholder="qty"
                                className="w-14 flex-shrink-0 px-2 py-1.5 text-sm text-charcoal text-right bg-pearl/60 border border-border/60 rounded-[var(--radius-sm)] outline-none focus:border-seafoam/50 focus:bg-white transition-colors placeholder:text-slate/40"
                            />

                            {/* Range toggle / range high */}
                            {row.showRange ? (
                                <>
                                    <span className="text-slate/50 text-sm flex-shrink-0">–</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={row.quantityHigh}
                                        onChange={(e) => updateRow(row.id, { quantityHigh: e.target.value })}
                                        placeholder="max"
                                        className="w-14 flex-shrink-0 px-2 py-1.5 text-sm text-charcoal bg-pearl/60 border border-border/60 rounded-[var(--radius-sm)] outline-none focus:border-seafoam/50 focus:bg-white transition-colors placeholder:text-slate/40"
                                    />
                                    <button
                                        onClick={() => updateRow(row.id, { showRange: false, quantityHigh: '' })}
                                        className="text-slate/40 hover:text-seafoam transition-colors flex-shrink-0"
                                        title="Remove range"
                                    >
                                        <svg
                                            className="w-3.5 h-3.5"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M6 18L18 6M6 6l12 12"
                                            />
                                        </svg>
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => updateRow(row.id, { showRange: true })}
                                    className="text-slate/35 hover:text-seafoam transition-colors flex-shrink-0 text-xs font-medium px-0.5"
                                    title="Add quantity range"
                                >
                                    ±
                                </button>
                            )}

                            {/* Unit */}
                            <div className="relative flex-shrink-0">
                                <input
                                    value={row.unit}
                                    onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                                    onFocus={() => setUnitSuggestForId(row.id)}
                                    onBlur={() => setTimeout(() => setUnitSuggestForId(null), 150)}
                                    placeholder="unit"
                                    className={`w-20 px-2 py-1.5 text-sm bg-pearl/60 border border-border/60 rounded-[var(--radius-sm)] outline-none focus:border-seafoam/50 focus:bg-white transition-colors placeholder:text-slate/40 ${
                                        row.unit && !unitIsRecognized ? 'text-slate italic' : 'text-seafoam font-medium'
                                    }`}
                                />
                                {unitSuggestions.length > 0 && (
                                    <div className="absolute top-full left-0 mt-0.5 bg-white border border-border rounded-[var(--radius-sm)] shadow-[var(--shadow-md)] z-30 min-w-full overflow-hidden">
                                        {unitSuggestions.map((u) => (
                                            <button
                                                key={u}
                                                onMouseDown={() => {
                                                    updateRow(row.id, { unit: u });
                                                    setUnitSuggestForId(null);
                                                }}
                                                className="w-full px-3 py-1.5 text-left text-sm text-seafoam font-medium hover:bg-seafoam/5 transition-colors"
                                            >
                                                {u}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Remove */}
                            <button
                                onClick={() => removeRow(row.id)}
                                className="text-mist hover:text-error transition-colors flex-shrink-0 p-0.5 opacity-0 group-hover/row:opacity-100"
                                title="Remove ingredient"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                </svg>
                            </button>
                        </div>

                        {/* ── Row 2: preparation — full-width below food column, with visible label ── */}
                        <div className="flex items-center gap-2">
                            {/* Invisible spacers mirror the leading controls so the label left-aligns with food */}
                            <span className="w-4 flex-shrink-0" />
                            <span className="w-6 flex-shrink-0" />
                            <span className="w-5 flex-shrink-0" />
                            <span className="text-[10px] font-semibold text-slate/40 uppercase tracking-wider flex-shrink-0 select-none">
                                Prep
                            </span>
                            <input
                                value={row.preparation}
                                onChange={(e) => updateRow(row.id, { preparation: e.target.value })}
                                placeholder="e.g. minced, roughly torn, at room temperature…"
                                className="flex-1 min-w-0 px-2 py-1 text-sm text-charcoal bg-pearl/40 border border-border/40 rounded-[var(--radius-sm)] outline-none focus:border-seafoam/50 focus:bg-white focus:border-opacity-100 transition-colors placeholder:text-slate/30"
                            />
                            {/* Ghost spacer to align with trash column */}
                            <span className="w-[18px] flex-shrink-0" />
                        </div>
                    </div>

                    {/* ── Mobile layout ─────────────────────────────────────────────── */}
                    <div className="flex md:hidden flex-col gap-3.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <button className="cursor-grab text-mist/60 active:cursor-grabbing">
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
                                    </svg>
                                </button>
                                {hasGroups && (
                                    <div className="relative">
                                        <button
                                            onClick={() => setGroupAssignForRowId(isGroupAssignOpen ? null : row.id)}
                                            className="p-1 text-mist hover:text-slate transition-colors"
                                            title="Move to section"
                                        >
                                            <svg
                                                className="w-3.5 h-3.5"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                                                />
                                            </svg>
                                        </button>
                                        {isGroupAssignOpen && renderGroupAssignPopup(row.id)}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => removeRow(row.id)}
                                className="text-mist hover:text-error transition-colors p-0.5"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                </svg>
                            </button>
                        </div>

                        {/* Food */}
                        {row.food ? (
                            <button
                                onClick={() => openPickerFor(row.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 bg-pearl/60 border border-border/60 rounded-[var(--radius-sm)] text-left"
                            >
                                <span className="text-sm text-charcoal font-medium flex-1 truncate">
                                    {row.food.name}
                                </span>
                                {row.food.source === 'catalog' && <UsdaBadge />}
                                {row.food.source === 'custom' && <CustomBadge />}
                                <svg
                                    className="w-3.5 h-3.5 text-slate/40 flex-shrink-0"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                    />
                                </svg>
                            </button>
                        ) : (
                            <button
                                onClick={() => openPickerFor(row.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 bg-coral/5 border border-coral/30 rounded-[var(--radius-sm)] text-left"
                            >
                                <svg
                                    className="w-4 h-4 text-coral/60 flex-shrink-0"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                    />
                                </svg>
                                <span className="text-sm text-coral/70 italic">Choose food…</span>
                            </button>
                        )}

                        {/* Qty + unit */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <input
                                type="number"
                                min="0"
                                step="any"
                                value={row.quantity}
                                onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                                placeholder="qty"
                                className="w-16 px-2 py-1.5 text-sm text-charcoal text-right bg-pearl/60 border border-border/60 rounded-[var(--radius-sm)] outline-none focus:border-seafoam/50 transition-colors placeholder:text-slate/40"
                            />
                            {row.showRange && (
                                <>
                                    <span className="text-slate/50 text-sm">–</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={row.quantityHigh}
                                        onChange={(e) => updateRow(row.id, { quantityHigh: e.target.value })}
                                        placeholder="max"
                                        className="w-16 px-2 py-1.5 text-sm text-charcoal bg-pearl/60 border border-border/60 rounded-[var(--radius-sm)] outline-none focus:border-seafoam/50 transition-colors placeholder:text-slate/40"
                                    />
                                </>
                            )}
                            <button
                                onClick={() => updateRow(row.id, { showRange: !row.showRange, quantityHigh: '' })}
                                className="text-xs font-medium text-slate/50 hover:text-seafoam transition-colors px-1"
                            >
                                {row.showRange ? '× range' : '± range'}
                            </button>
                            <input
                                value={row.unit}
                                onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                                placeholder="unit"
                                className={`w-24 px-2 py-1.5 text-sm bg-pearl/60 border border-border/60 rounded-[var(--radius-sm)] outline-none focus:border-seafoam/50 transition-colors placeholder:text-slate/40 ${
                                    row.unit && !unitIsRecognized ? 'text-slate italic' : 'text-seafoam font-medium'
                                }`}
                            />
                        </div>

                        {/* Prep */}
                        <input
                            value={row.preparation}
                            onChange={(e) => updateRow(row.id, { preparation: e.target.value })}
                            placeholder="preparation"
                            className="w-full px-2 py-1.5 text-sm text-charcoal bg-pearl/60 border border-border/60 rounded-[var(--radius-sm)] outline-none focus:border-seafoam/50 transition-colors placeholder:text-slate/40"
                        />
                    </div>
                </div>

                {/* Picker panel (desktop — inline below row) */}
                {isActive && <div className="px-3 pb-3">{renderPickerPanel(row.id)}</div>}
            </div>
        );
    };

    // ── Render: group header ───────────────────────────────────────────────────

    const renderGroupHeader = (group: { id: string; label: string }) => {
        const isEditing = editingGroupId === group.id;
        return (
            <div className="mt-5 first:mt-0">
                {isEditing ? (
                    // Creating / renaming a group — name input with autocomplete
                    <div className="relative mb-3">
                        <div className="flex items-center gap-2">
                            <input
                                ref={groupInputRef}
                                value={groupQuery}
                                onChange={(e) => setGroupQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && groupQuery.trim()) confirmGroupLabel(group.id, groupQuery);
                                    if (e.key === 'Escape') confirmGroupLabel(group.id, '');
                                }}
                                placeholder="Section name…"
                                className="flex-1 px-3 py-2 text-sm font-semibold text-charcoal bg-white border border-seafoam/50 rounded-[var(--radius-md)] outline-none shadow-[0_0_0_3px_rgba(61,139,133,0.12)] placeholder:text-slate/40 placeholder:font-normal"
                            />
                            <button
                                onClick={() => confirmGroupLabel(group.id, groupQuery)}
                                disabled={!groupQuery.trim()}
                                className="px-3 py-2 text-sm font-medium text-white bg-seafoam rounded-[var(--radius-sm)] hover:bg-ocean-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                            >
                                Save
                            </button>
                            <button
                                onClick={() => confirmGroupLabel(group.id, '')}
                                className="p-2 text-slate/50 hover:text-charcoal transition-colors"
                                title="Cancel"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M6 18L18 6M6 6l12 12"
                                    />
                                </svg>
                            </button>
                        </div>
                        {groupLabelSuggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-20 mt-1 bg-white border border-border rounded-[var(--radius-md)] shadow-[var(--shadow-lg)] z-30 overflow-hidden">
                                {groupLabelSuggestions.map((s) => (
                                    <button
                                        key={s}
                                        onMouseDown={() => {
                                            setGroupQuery(s);
                                            setTimeout(() => confirmGroupLabel(group.id, s), 0);
                                        }}
                                        className="w-full px-3 py-2.5 text-left text-sm text-charcoal hover:bg-seafoam/5 transition-colors"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    // Display mode
                    <div className="flex items-center gap-2 mb-2 group/gh">
                        <span className="text-base font-semibold text-charcoal">
                            {group.label || '(unnamed section)'}
                        </span>
                        <div className="flex-1 h-px bg-border/70" />
                        <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover/gh:opacity-100 transition-opacity">
                            <button
                                onClick={() => addRowToGroup(group.id)}
                                className="flex items-center gap-1 px-2 py-0.5 text-xs text-seafoam hover:bg-seafoam/10 rounded transition-colors"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 4v16m8-8H4"
                                    />
                                </svg>
                                Add
                            </button>
                            <button
                                onClick={() => {
                                    setEditingGroupId(group.id);
                                    setGroupQuery(group.label);
                                    setTimeout(() => groupInputRef.current?.focus(), 30);
                                }}
                                className="p-1 text-slate/40 hover:text-slate rounded transition-colors"
                                title="Rename section"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                    />
                                </svg>
                            </button>
                            <button
                                onClick={() => removeGroup(group.id)}
                                className="p-1 text-slate/40 hover:text-error rounded transition-colors"
                                title="Remove section (keeps ingredients)"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M6 18L18 6M6 6l12 12"
                                    />
                                </svg>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ── Render: nutrition bar (full-width strip above ingredient list) ────────────

    const renderNutritionBar = () => {
        const macros = [
            { label: 'kcal', value: String(nutrition.cal), color: 'text-coral' },
            { label: 'protein', value: `${nutrition.protein}g`, color: 'text-seafoam' },
            { label: 'carbs', value: `${nutrition.carbs}g`, color: 'text-sky' },
            { label: 'fat', value: `${nutrition.fat}g`, color: 'text-charcoal' },
        ];
        return (
            <div
                className={`rounded-[var(--radius-md)] border border-border bg-white/80 overflow-hidden transition-all ${nutrition.withoutData > 0 ? 'border-amber-200/60' : ''}`}
            >
                <div className="px-3 md:px-5 py-3 md:py-3.5 flex items-center gap-3 md:gap-4 flex-wrap">
                    <span className="text-[11px] font-semibold text-slate/50 uppercase tracking-wider flex-shrink-0">
                        Per serving
                    </span>
                    {nutrition.withoutData > 0 && (
                        <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-px rounded uppercase tracking-wide flex-shrink-0">
                            partial
                        </span>
                    )}
                    <div className="flex items-center gap-4 flex-wrap">
                        {macros.map(({ label, value, color }, i) => (
                            <React.Fragment key={label}>
                                {i > 0 && <span className="text-mist/50 text-sm flex-shrink-0 hidden sm:block">·</span>}
                                <span className="flex items-baseline gap-1 flex-shrink-0">
                                    <span
                                        className={`text-sm font-bold font-['JetBrains_Mono'] tabular-nums ${nutrition.withoutData > 0 ? 'opacity-70' : ''} ${color}`}
                                    >
                                        {value}
                                    </span>
                                    <span className="text-[11px] text-slate/45">{label}</span>
                                </span>
                            </React.Fragment>
                        ))}
                    </div>
                    {nutrition.total > 0 && (
                        <span className="text-[10px] text-slate/30 ml-auto flex-shrink-0 hidden md:block tabular-nums">
                            {nutrition.withData}/{nutrition.total} ingredients · {servings} servings
                        </span>
                    )}
                </div>
                {nutrition.withoutData > 0 && (
                    <div className="px-3 md:px-5 pb-3 md:pb-3.5 flex items-center gap-2">
                        <svg className="w-3 h-3 text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path
                                fillRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clipRule="evenodd"
                            />
                        </svg>
                        <p className="text-[10px] text-amber-600">
                            {nutrition.withoutData} ingredient{nutrition.withoutData !== 1 ? 's' : ''} without nutrition
                            data — totals are estimates
                        </p>
                    </div>
                )}
            </div>
        );
    };

    // ── Render: empty state ────────────────────────────────────────────────────

    const renderEmptyState = () => (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-seafoam/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-seafoam/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                    />
                </svg>
            </div>
            <h3 className="text-base font-semibold text-charcoal mb-1">No ingredients yet</h3>
            <p className="text-sm text-slate max-w-xs mb-6">
                Add your first ingredient and choose it from the food catalog for accurate nutrition tracking.
            </p>
            <button
                onClick={addRowAtEnd}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-seafoam to-ocean-dark text-white text-sm font-medium rounded-full shadow-[0_2px_8px_rgba(61,139,133,0.25)] hover:shadow-[var(--shadow-glow)] hover:scale-[1.02] transition-all"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add first ingredient
            </button>
        </div>
    );

    // ── Main render ────────────────────────────────────────────────────────────

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="font-['Playfair_Display'] text-xl font-semibold text-charcoal">Ingredients</h3>
                    <p className="text-xs text-slate mt-0.5">
                        Choose each ingredient from the catalog for accurate nutrition tracking
                    </p>
                </div>
            </div>

            {/* Nutrition bar + full-width ingredient list */}
            <div className="space-y-3">
                {/* Nutrition bar — sits above the list, never steals horizontal space */}
                {rows.length > 0 && renderNutritionBar()}

                {/* Ingredient list — full width on all breakpoints */}
                <div className="space-y-8">
                    {rows.length === 0 ? (
                        renderEmptyState()
                    ) : (
                        <>
                            {/* Column labels — flat mode, desktop only */}
                            {!hasGroups && (
                                <div className="hidden md:flex items-center gap-2 px-3 pb-1 text-[10px] font-semibold text-slate/40 uppercase tracking-widest select-none">
                                    <span className="w-4 flex-shrink-0" />
                                    <span className="w-6 flex-shrink-0" />
                                    <span className="w-5 flex-shrink-0" />
                                    <span className="w-44 flex-shrink-0">Food</span>
                                    <div className="w-px" />
                                    <span className="">Qty · Unit</span>
                                    <span className="w-[18px] ml-auto" />
                                </div>
                            )}

                            {/* Sections */}
                            {sections.map((section, si) => (
                                <div key={si}>
                                    {/* Group header or ungrouped label */}
                                    {section.group ? (
                                        renderGroupHeader(section.group)
                                    ) : hasGroups && section.rowEntries.length > 0 ? (
                                        <div className="flex items-center gap-2 mt-5 mb-2">
                                            <span className="text-xs text-slate/40 font-medium italic">Ungrouped</span>
                                            <div className="flex-1 h-px bg-border/40" />
                                        </div>
                                    ) : null}

                                    {/* Rows in this section */}
                                    <div
                                        className={`space-y-2 ${section.group ? 'border-l-2 border-seafoam/15 pl-3' : ''}`}
                                    >
                                        {section.rowEntries.map((row) => renderRow(row))}

                                        {/* Per-section add button */}
                                        {section.group && (
                                            <button
                                                onClick={() => addRowToGroup(section.group!.id)}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-4 text-sm font-medium text-seafoam bg-seafoam/5 hover:bg-seafoam/10 border-2 border-dashed border-seafoam/30 hover:border-seafoam/50 rounded-[var(--radius-md)] transition-all group/add"
                                            >
                                                <svg
                                                    className="w-4 h-4 group-hover/add:scale-110 transition-transform"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M12 4v16m8-8H4"
                                                    />
                                                </svg>
                                                Add to {section.group.label || 'this section'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {/* Bottom action bar */}
                            <div className="grid grid-cols-2 gap-3 mt-2">
                                <button
                                    onClick={addRowAtEnd}
                                    className="flex items-center justify-center gap-2 px-4 py-4 text-sm font-medium text-seafoam bg-seafoam/5 hover:bg-seafoam/10 border-2 border-dashed border-seafoam/30 hover:border-seafoam/50 rounded-[var(--radius-md)] transition-all group/add"
                                >
                                    <svg
                                        className="w-4 h-4 group-hover/add:scale-110 transition-transform"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M12 4v16m8-8H4"
                                        />
                                    </svg>
                                    Add ingredient
                                </button>
                                <button
                                    onClick={addGroup}
                                    className="flex items-center justify-center gap-2 px-4 py-4 text-sm font-medium text-slate hover:text-charcoal bg-white/40 hover:bg-white/70 border-2 border-dashed border-border hover:border-slate/40 rounded-[var(--radius-md)] transition-all group/grp"
                                >
                                    <svg
                                        className="w-4 h-4 group-hover/grp:scale-110 transition-transform"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M4 6h16M4 12h16M4 18h7"
                                        />
                                    </svg>
                                    Add section
                                </button>
                            </div>

                            {/* Validation hint */}
                            {hasIncompleteRows && (
                                <div className="flex items-center gap-2 px-3 py-2 bg-coral/5 border border-coral/20 rounded-[var(--radius-sm)] text-xs text-coral/80 mt-1">
                                    <svg
                                        className="w-3.5 h-3.5 flex-shrink-0"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                        />
                                    </svg>
                                    {rows.filter((r) => !r.food).length} row
                                    {rows.filter((r) => !r.food).length !== 1 ? 's' : ''} still need
                                    {rows.filter((r) => !r.food).length === 1 ? 's' : ''} a food chosen before you can
                                    continue
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Mobile food picker — full-screen bottom sheet */}
            {pickerOpenForId && (
                <div className="fixed inset-0 z-40 md:hidden">
                    <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-[2px]" onClick={closePicker} />
                    <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-[var(--radius-xl)] shadow-[var(--shadow-xl)] animate-slide-up max-h-[80vh] flex flex-col">
                        <div className="pt-3 pb-1 flex justify-center flex-shrink-0">
                            <div className="w-10 h-1 rounded-full bg-mist" />
                        </div>
                        <div className="px-4 pb-3 flex items-center justify-between flex-shrink-0">
                            <p className="text-sm font-semibold text-charcoal">Choose ingredient</p>
                            <button onClick={closePicker} className="text-slate hover:text-charcoal p-1">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M6 18L18 6M6 6l12 12"
                                    />
                                </svg>
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">{renderPickerPanel(pickerOpenForId)}</div>
                    </div>
                </div>
            )}
        </div>
    );
}
