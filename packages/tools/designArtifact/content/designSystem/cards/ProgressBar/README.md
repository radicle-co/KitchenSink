ProgressBar shows how far a task with a known number of steps has come, such as the import review's "Recipe 14 of 309". It is determinate only. A wait of unknown length uses `LoadingNotice`. `value` is clamped into `[0, max]`, and a bar whose `max` is 0 or less draws empty. The caller writes the progress in words beside the bar, because the bar draws the same fact and does not replace it. `label` names the bar for a screen reader and must be localised by the caller.

On native the bar reports its value to VoiceOver and TalkBack as a progress value.
