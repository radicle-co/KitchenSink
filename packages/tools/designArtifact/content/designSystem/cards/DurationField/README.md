DurationField is a time entry made of an hours box and a minutes box that stores its value in seconds. The visible `label` names the group, while `hoursLabel` and `minutesLabel` give each box its accessible name and the short units ("h", "min") are decorative. `onChange` reports every edit as the whole duration in seconds, or `undefined` when both boxes are empty. Use it for prep and cook times, and pass all label and unit strings from your localised copy.

The native leaf has the same contract, with an error given to each box as its accessibility hint.
