/**
 * @module cards/cardStyle — the one style block every card page carries. Colours are the host's token variables.
 */

/** The shared CSS of a card page: page chrome, the two-column pair, column labels, notes, and the phone-size stage. */
export const CARD_STYLE = `body{margin:0;padding:16px;background:var(--canvas);color:var(--ink);font-family:Inter,system-ui,sans-serif}
.pair{display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start}.pair>section{display:flex;flex-direction:column;gap:12px}
.lbl{margin:0;font:600 11px/1.4 Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted)}
.web{flex:1 1 360px;min-width:0}.native{width:358px;flex:none}.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.col{display:flex;flex-direction:column;gap:12px}
.muted,.note{margin:0;font-size:13px;line-height:1.4;color:var(--ink-muted)}
.frame{position:relative;transform:translateZ(0);overflow:hidden;border-radius:24px;border:1px solid var(--line-divider);background:var(--canvas)}`;
