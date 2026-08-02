# UX Patterns: Grocery Lists & Ordering Flow

**Branch**: `007-grocery-lists` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](./research.md), domain constraints

---

## 1. List Generation from Meal Plans

### 1.1 One-Tap Generation with Explicit Context

Entry pattern:

- User starts from meal plan context (week/range selected)
- CTA: **Generate Grocery List**
- Confirmation sheet summarizes recipe count, estimated item count, pantry impact preview

Expected UX characteristics:

- Deterministic result screen (not transient toast-only success)
- Generated-at timestamp + source meal plan reference
- Clear recompute action when meal plan changes

**FR coverage**: FR-028, 001-FR-045

---

### 1.2 Aggregation Transparency Pattern

When multiple recipe ingredients collapse into one line item, users need confidence:

- Line item shows normalized quantity and a details affordance
- Details drawer lists contributing recipes + original amounts
- For unresolved conversions (if any), show explicit annotation instead of silent merge

This avoids "where did this number come from" confusion.

**FR coverage**: FR-028

---

## 2. Aisle Grouping and In-Store Speed

### 2.1 Group-by-Aisle as Default Shopping Mode

Primary shopping mode groups list items into shopping-friendly sections:

- Produce
- Dairy & Eggs
- Meat & Seafood
- Pantry
- Frozen
- Other / Unmapped

UX details:

- Section headers sticky while scrolling
- Section-level check progress (`7/11 picked`)
- Collapsible sections for faster scanning

**FR coverage**: FR-028, FR-029

---

### 2.2 Store-Specific Grouping Hint Pattern

If store is selected/configured:

- Display store badge and tuned aisle ordering
- Show "optimized for {store}" hint
- If mapping confidence is low, keep fallback category grouping and explain fallback

This pattern keeps navigation predictable without requiring perfect SKU mapping.

**FR coverage**: FR-030, FR-031 (indirect)

---

## 3. Check-Off and Pantry Interaction

### 3.1 Swipe-to-Check + Accessible Toggle

Mobile pattern:

- Swipe right to mark acquired
- Secondary long-press or overflow to "Already have"

Accessibility parity pattern:

- Every swipe action must have a visible/tappable toggle button with role/label
- State conveyed by text + icon + style (not color alone)

**FR coverage**: FR-029, NFR-003, NFR-004

---

### 3.2 Pantry Exclusion Visibility

When items are marked "already have":

- Keep them visible in a collapsed "Already have" section
- Exclude from active purchase totals
- Allow quick unmark action to avoid accidental exclusion

Avoids hidden-state confusion and supports correction.

**FR coverage**: FR-029

---

## 4. Sharing and Family Sync (Domain Pattern)

### 4.1 Shared List Presence Indicators

Collaboration pattern (domain-driven; warning-level until explicit FR):

- Avatar chips for active collaborators
- Last editor + timestamp per item
- Non-destructive conflict handling for simultaneous toggles

This follows household shopping expectations from benchmark tools.

**Traceability note**: Requested domain behavior; no explicit FR in current spec.

---

## 5. Voice Add and Manual Add

### 5.1 Fast Manual Add Sheet

Manual add should be one gesture from list view:

- Single input for "quantity + item"
- Optional category selector
- Inline parsing preview (`2 lbs apples` → quantity + unit + item)

### 5.2 Voice Add as Optional Accelerator

- Voice input launches parser with confidence display
- User must confirm parsed output before commit
- Fallback to raw text item if parse uncertain

Voice add improves capture speed while preserving correctness.

**FR relevance**: Supports FR-028/FR-029 workflows but not explicitly mandated.

---

## 6. Store Ordering Handoff Pattern

### 6.1 Pre-Order Review Gate

Before redirect/handoff:

- Show mapped / unmapped counts
- Highlight substitutions or unresolved items
- Require explicit confirmation

### 6.2 Premium Gate Clarity

For non-premium users:

- Disabled "Order Groceries" CTA with clear upgrade value proposition
- Preserve generated list functionality fully (no punitive lockout for base feature)

### 6.3 Setup Guidance Loop

If no store is configured and user taps order:

- Inline setup wizard (do not dead-end with raw error)
- After setup success, return user to review gate

**FR coverage**: FR-030, FR-031
