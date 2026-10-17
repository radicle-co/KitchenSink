A still 4 px seafoam bar that says the results on screen are being replaced. It appears only after the pending delay, and goes as soon as `pending` clears. The results beneath stay at full strength and usable, and the bar is hidden from assistive tech with no `aria-busy`, so the settled results are what get announced. It does not move, so reduce-motion viewers see the same thing. Render it inside a `relative` container that follows a 24 px gap.

On native the bar is absolutely positioned, takes no layout space, and appears after a timer-based delay.
