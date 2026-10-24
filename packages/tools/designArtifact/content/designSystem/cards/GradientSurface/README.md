A brand gradient painted behind arbitrary content, such as a hero banner. The `gradient` prop picks a brand gradient and defaults to `hero`, the canvas wash that re-themes in dark mode. `className` positions it on web and `style` does so on native, and each platform ignores the other's. With an `accessibilityLabel` it becomes a labelled group that keeps its children in the accessibility tree. It is static and has no motion. Check text contrast against the gradient you choose.

On native it paints the same gradient spec through expo-linear-gradient.
