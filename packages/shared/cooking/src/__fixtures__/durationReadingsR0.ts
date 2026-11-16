import type { DurationReading } from '../duration.js';

/**
 * The r0 golden readings: what the digit-only `readDuration` of origin/main a0e3653f5 answered for each line below.
 *
 * Generated ONCE from that reader, never from a newer one. Command, run from the repository root with Node 24:
 * `npx tsx gen.ts modern.json`, where gen.ts calls main's `readDuration` over every line of GOLDEN_CORPUS_STEPS,
 * STEP_LINE_TRAPS and STEP_LINE_TRAPS_2 (`stepLinesGolden.ts`), then over the modern set (`modern.json`), and prints one
 * row per distinct line. The modern set is part of this file: it is the lines below the last public-domain one.
 *
 * gen.ts, in full (main's reader imported by path; the rows below are its output after prettier):
 *
 *     import { readFileSync } from 'node:fs';
 *     import { readDuration } from './duration.ts';
 *     import { GOLDEN_CORPUS_STEPS, STEP_LINE_TRAPS, STEP_LINE_TRAPS_2 } from './__fixtures__/stepLinesGolden.ts';
 *
 *     const modern: string[] = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8'));
 *     const lines = [
 *         ...GOLDEN_CORPUS_STEPS.flatMap((s) => s.lines),
 *         ...STEP_LINE_TRAPS.flatMap((s) => s.lines),
 *         ...STEP_LINE_TRAPS_2.flatMap((s) => s.lines),
 *         ...modern,
 *     ];
 *     const unique = [...new Set(lines)];
 *     const rows = unique.map((line) => `    { line: ${JSON.stringify(line)}, reading: ${JSON.stringify(readDuration(line)).replace(/"(\w+)":/g, '$1:').replace(/,/g, ', ').replace(/\{/g, '{ ').replace(/\}/g, ' }')} },`);
 *     process.stdout.write(rows.join('\n') + '\n');
 *
 * This is the frozen r0 reader in data form (qse carry 1). A later edit to this file is a test change and needs a qse
 * TEST-CHANGE record.
 */
export interface R0Reading {
    readonly line: string;
    readonly reading: DurationReading;
}

export const DURATION_READINGS_R0: readonly R0Reading[] = [
    {
        line: 'Select round, very firm and even sized tomatoes, cut off the top (reserve to use as a cover), scrape out the inside, being very careful to not break the tomato.',
        reading: { kind: 'none' },
    },
    {
        line: 'Fill each tomato with some finely prepared "cold slaw," cover with the top of the tomato, lay them on lettuce leaves and pour a mayonnaise dressing over each.',
        reading: { kind: 'none' },
    },
    {
        line: 'You may lay them en masse on a decorated platter, heaping them in the shape of a mound, or serve individually.',
        reading: { kind: 'none' },
    },
    { line: 'Stir one scant half cup of butter to a cream with one cup of sugar.', reading: { kind: 'none' } },
    {
        line: 'Add alternately one-half cup of sweet milk, yolks of two eggs which you have previously beaten until quite light, add whites of two, and one-half cup of sifted flour.',
        reading: { kind: 'none' },
    },
    {
        line: 'Make a custard of one-half cup of milk, with one cup of grated chocolate, one-half cup of granulated sugar;',
        reading: { kind: 'none' },
    },
    { line: 'boil until thick, add the yolk of one egg, then remove from the fire;', reading: { kind: 'none' } },
    {
        line: 'stir until cool, add this to the cake batter, add one and one-half cups of sifted flour, two teaspoons of baking-powder and one of vanilla flavoring.',
        reading: { kind: 'none' },
    },
    {
        line: 'Bake in layers and ice between and on top with plain white icing flavored to taste.',
        reading: { kind: 'none' },
    },
    { line: 'You may substitute almond or colored icing.', reading: { kind: 'none' } },
    {
        line: 'Wash and pick ripe cranberries and set on to boil in a porcelain-lined kettle closely covered.',
        reading: { kind: 'none' },
    },
    { line: 'When soft strain the pulp through a fine wire sieve.', reading: { kind: 'none' } },
    { line: 'Measure the juice and add an equal quantity of sugar.', reading: { kind: 'none' } },
    {
        line: 'Set it on to boil again and let it boil very fast for about ten minutes--but it must boil steadily all the time.',
        reading: { kind: 'none' },
    },
    {
        line: 'Wet a mold with cold water, turn the jelly into it and set it away to cool, when firm turn it into a glass salver.',
        reading: { kind: 'none' },
    },
    {
        line: 'If you use canned string beans, heat some fat in a spider and put in one tablespoon of flour;',
        reading: { kind: 'none' },
    },
    { line: 'brown slightly;', reading: { kind: 'none' } },
    {
        line: 'add one tablespoon of brown sugar, a pinch of salt, some cinnamon and vinegar to taste;',
        reading: { kind: 'none' },
    },
    {
        line: 'then add the beans and let them simmer on the back of stove, but do not let them burn.',
        reading: { kind: 'none' },
    },
    {
        line: 'The juice of pickled peaches or pears is delicious in preparing sweet and sour beans.',
        reading: { kind: 'none' },
    },
    {
        line: 'Stem the cherries--do not pit them,--pack tight in glass fruit jars, cover with syrup, made of two tablespoons of sugar to a quart of fruit, allowing one-half cup of water to each quart of cherries.',
        reading: { kind: 'none' },
    },
    { line: 'Let them boil fifteen minutes from the time they begin to boil.', reading: { kind: 'none' } },
    {
        line: 'Put on to boil one and one-half cups of water with juice of two lemons, sweeten to taste, add a few small pieces of cinnamon bark;',
        reading: { kind: 'none' },
    },
    {
        line: 'when boiling stir in three teaspoons of cornstarch that have been dissolved in a little cold water.',
        reading: { kind: 'none' },
    },
    {
        line: 'Boil a few minutes, then pour over the well-beaten yolks of two eggs, stirring all the time.',
        reading: { kind: 'none' },
    },
    {
        line: 'Stir in stiffly-beaten whites of eggs, and pour over and around puffs when cold.',
        reading: { kind: 'none' },
    },
    { line: 'Serve cold.', reading: { kind: 'none' } },
    {
        line: 'Brown slices of leek or young onions in one tablespoon of drippings, add neck or breast of lamb, cut in small pieces;',
        reading: { kind: 'none' },
    },
    { line: 'season with white pepper, salt and parsley;', reading: { kind: 'none' } },
    { line: 'cook until tender, just before serving season with dill.', reading: { kind: 'none' } },
    {
        line: 'Take one cup of water, a quarter glass of brandy, one cup of sugar, juice of half a lemon.',
        reading: { kind: 'none' },
    },
    { line: 'Boil all in double boiler.', reading: { kind: 'none' } },
    {
        line: 'Beat the yolks of two eggs light, and add the boiling sauce gradually to them, stirring constantly until thick.',
        reading: { kind: 'none' },
    },
    { line: 'Hard boil the eggs, place them immediately into cold water.', reading: { kind: 'none' } },
    {
        line: 'When cold; remove the shells carefully, cut the eggs in half lengthwise and butter slightly.',
        reading: { kind: 'none' },
    },
    {
        line: 'Lay one or two sardellen or appetite silds on one half of the egg and press the one half gently on the other half which has the sardellen.',
        reading: { kind: 'none' },
    },
    { line: 'The egg must appear whole.', reading: { kind: 'none' } },
    {
        line: 'Now tie lengthwise and across with the narrowest, various colored ribbons you can find.',
        reading: { kind: 'none' },
    },
    {
        line: 'The yolks may be kept several days and be as if just separated from the whites if they are placed in a cup previously rinsed with cold water and a pinch of salt added to them.',
        reading: { kind: 'none' },
    },
    {
        line: 'The cup must be closely covered with a wet cloth, and this must be changed and well rinsed in cold water every day.',
        reading: { kind: 'none' },
    },
    {
        line: 'When whites are left over make a small angel cake or any of the cookies which require the whites of egg only.',
        reading: { kind: 'none' },
    },
    { line: 'When yolks are left over use for making mayonnaise.', reading: { kind: 'none' } },
    {
        line: 'To one pint of strawberries take one pint of sugar and one-half cup of water.',
        reading: { kind: 'none' },
    },
    {
        line: 'Unless strawberries are cooked in the sun they should be prepared only in small quantities or they will be dark and unpalatable.',
        reading: { kind: 'none' },
    },
    {
        line: 'If the following directions are carefully observed the berries will be plump and of a rich red color.',
        reading: { kind: 'none' },
    },
    { line: 'Bring the sugar and water to a boil;', reading: { kind: 'none' } },
    { line: 'add the strawberries and cook ten minutes.', reading: { kind: 'none' } },
    {
        line: 'Remove the berries carefully with a skimmer and cook the syrup until it is of the consistency of jelly.',
        reading: { kind: 'none' },
    },
    { line: 'Return the berries to the syrup;', reading: { kind: 'none' } },
    { line: 'bring all to a boil and when cool put in glass tumblers.', reading: { kind: 'none' } },
    {
        line: 'Mix one tablespoon of butter and one of flour in a saucepan and add gradually half a pint of boiling water.',
        reading: { kind: 'none' },
    },
    { line: 'Stir until it just reaches the boiling point;', reading: { kind: 'none' } },
    { line: 'take from the fire and add the yolks of two eggs.', reading: { kind: 'none' } },
    {
        line: 'Into another saucepan put a slice of onion, a bay leaf, and a clove of garlic;',
        reading: { kind: 'none' },
    },
    {
        line: 'add four tablespoons of vinegar, and stand this over the fire until the vinegar is reduced one-half.',
        reading: { kind: 'none' },
    },
    { line: 'Turn this into the sauce, stir for a moment;', reading: { kind: 'none' } },
    { line: 'strain through a fine sieve;', reading: { kind: 'none' } },
    { line: 'add half a teaspoon of salt and serve.', reading: { kind: 'none' } },
    {
        line: 'This sauce may be varied by adding lemon juice instead of vinegar, or by using the water in which the fish was boiled.',
        reading: { kind: 'none' },
    },
    { line: 'It is one of the daintiest of all sauces.', reading: { kind: 'none' } },
    { line: 'Select the largest sweet cherries for this purpose, leaving the stems on.', reading: { kind: 'none' } },
    {
        line: 'Allow half a pound of sugar to every pound of fruit, and a pint of good brandy for every five pounds of fruit.',
        reading: { kind: 'none' },
    },
    { line: 'Make a syrup of the sugar, using as little water as possible.', reading: { kind: 'none' } },
    { line: 'Pour it over the cherries and let them remain in the syrup all night.', reading: { kind: 'none' } },
    { line: 'Next day put them in a preserving kettle and heat slowly.', reading: { kind: 'none' } },
    { line: 'Boil about eight minutes.', reading: { kind: 'none' } },
    {
        line: 'Take up the cherries with a perforated skimmer and boil the syrup fifteen minutes.',
        reading: { kind: 'none' },
    },
    {
        line: 'Add the brandy to the boiling syrup, remove from the fire and pour over the cherries hot, and seal.',
        reading: { kind: 'none' },
    },
    {
        line: 'Hash may be made with one or many vegetables and with or without the addition of meat and fish.',
        reading: { kind: 'none' },
    },
    {
        line: 'Potato is the most useful vegetable for hash, because it combines well with meat or other vegetables.',
        reading: { kind: 'none' },
    },
    {
        line: 'The vegetables must be chopped fine, well seasoned with salt and pepper, and parsley, onion, chives or green pepper if desired, and moistened with stock, milk or water, using a quarter of a cup to a pint of hash.',
        reading: { kind: 'none' },
    },
    { line: 'Melt one-half tablespoon of butter or savory drippings in a pan;', reading: { kind: 'none' } },
    {
        line: 'put in the hash, spreading it evenly and dropping small pieces of butter or drippings over the top.',
        reading: { kind: 'none' },
    },
    { line: 'Cover the pan;', reading: { kind: 'none' } },
    { line: 'let the hash cook over a moderate fire for half an hour;', reading: { kind: 'none' } },
    { line: 'fold over like an omelet and serve.', reading: { kind: 'none' } },
    {
        line: 'If properly cooked there will be a rich brown crust formed on the outside of the hash.',
        reading: { kind: 'none' },
    },
    {
        line: 'In this method the work is easily and quickly done and the fruit retains its shape, color and flavor.',
        reading: { kind: 'none' },
    },
    { line: 'Particularly nice for berries.', reading: { kind: 'none' } },
    { line: 'Sterilize jars and utensils.', reading: { kind: 'none' } },
    { line: 'Make the syrup;', reading: { kind: 'none' } },
    { line: 'prepare the fruit the same as for cooking.', reading: { kind: 'none' } },
    {
        line: 'Fill the hot jars with the fruit, drained, and pour in enough hot syrup to fill the jar solidly.',
        reading: { kind: 'none' },
    },
    { line: 'Run the handle of a silver spoon around the inside of the jar.', reading: { kind: 'none' } },
    { line: 'Place the hot jars, uncovered, and the covers, in a moderate oven.', reading: { kind: 'none' } },
    {
        line: 'Cover the bottom of the oven with a sheet of asbestos, the kind plumbers employ in covering pipes, or put into the oven shallow pans in which there are about two inches of boiling water.',
        reading: { kind: 'none' },
    },
    {
        line: 'Cook berries to the boiling point or until the bubbles in the syrup just rise to the top;',
        reading: { kind: 'none' },
    },
    { line: 'cook larger fruits, eight to ten minutes or according to the fruit.', reading: { kind: 'none' } },
    { line: 'Remove from the oven, slip on rubber, first dipped in boiling water;', reading: { kind: 'none' } },
    { line: 'then fill the jar with boiling syrup.', reading: { kind: 'none' } },
    { line: 'Cover and seal.', reading: { kind: 'none' } },
    { line: 'Place the jars on a board and out of a draft of air.', reading: { kind: 'none' } },
    { line: 'If the screw covers are used tighten them after the glass has cooled.', reading: { kind: 'none' } },
    {
        line: 'Large fruits, such as peaches, pears, quince, crab-apples, etc., will require about a pint of syrup to each quart jar of fruit.',
        reading: { kind: 'none' },
    },
    { line: 'The small fruit will require a little over half a pint of syrup.', reading: { kind: 'none' } },
    { line: 'The French style of making lettuce salad is as follows:', reading: { kind: 'none' } },
    {
        line: 'After dressing the salad, mix it in one tablespoon of oil, then take only two tablespoons of white wine vinegar, mixed with a very little pepper and salt, and just turn the lettuce over and over in this mixture.',
        reading: { kind: 'none' },
    },
    { line: 'Take third cut of chuck or the tenderloin.', reading: { kind: 'none' } },
    { line: 'Have the spider very hot, use just enough fat to grease the spider.', reading: { kind: 'none' } },
    {
        line: 'Lay in the steak, turning very often to keep in the juice, season with salt and pepper.',
        reading: { kind: 'none' },
    },
    { line: 'Serve on a hot platter.', reading: { kind: 'none' } },
    { line: 'Line the bottom and sides of a clean barrel or keg with cabbage leaves.', reading: { kind: 'none' } },
    { line: 'Cut into fine shreds one or two dozen large heads of white, crisp cabbage.', reading: { kind: 'none' } },
    { line: 'Do this on a large slaw-cutter.', reading: { kind: 'none' } },
    {
        line: 'Now begin to pack: First put in a layer of cabbage, say about four inches deep, and press down firmly and sprinkle with about four tablespoons of salt.',
        reading: { kind: 'none' },
    },
    {
        line: 'Put one or two tart apples, cut up fine, between each layer, or some Malaga grapes (which will impart a fine flavor to the kraut).',
        reading: { kind: 'none' },
    },
    {
        line: 'When four layers have been put in, pound with a wooden beetle until the cabbage is quite compact and then add more cabbage, and so on until all has been salted, always pounding down each layer.',
        reading: { kind: 'none' },
    },
    {
        line: 'Last, cover with cabbage leaves, then a clean cloth, a well-fitting board, and a heavy stone, to act as weight on top of all.',
        reading: { kind: 'none' },
    },
    { line: 'It is now ready to set away in a cool cellar to ferment.', reading: { kind: 'none' } },
    { line: 'In two weeks examine, remove the scum, if any;', reading: { kind: 'none' } },
    {
        line: 'wash the cloth, board and stone, wash also the sides of the keg or jar, and place all back again.',
        reading: { kind: 'none' },
    },
    { line: 'This must be done weekly.', reading: { kind: 'none' } },
    {
        line: 'All vegetables should be thoroughly cleansed just before being put on to cook.',
        reading: { kind: 'none' },
    },
    {
        line: 'Green vegetables; such as cabbage, cauliflower and Brussels sprouts, should be soaked heads down in salted cold water, to which a few spoons of vinegar may be added.',
        reading: { kind: 'none' },
    },
    {
        line: 'To secure the best results all vegetables except beans, that is the dried beans, should be put in boiling water and the water must be made to boil again as soon as possible after the vegetables have been added and must be kept boiling until the cooking is finished.',
        reading: { kind: 'none' },
    },
    { line: 'In cooking vegetables, conserve their juices.', reading: { kind: 'none' } },
    {
        line: 'The average housewife pours down the sink drainpipe the juices from all the vegetables which she cooks;',
        reading: { kind: 'none' },
    },
    { line: 'she little realizes that she thus drains away the health of her family.', reading: { kind: 'none' } },
    {
        line: 'Cook vegetables with just sufficient water to prevent them from burning, and serve their juices with them;',
        reading: { kind: 'none' },
    },
    {
        line: 'else save the vegetable "waters" and, by the addition of milk and butter convert them into soups for the family use.',
        reading: { kind: 'none' },
    },
    {
        line: 'Such soups, derived from one or several vegetables, alone or mixed together, make palatable and healthful additions to the family bill-of-fare.',
        reading: { kind: 'none' },
    },
    {
        line: 'This vegetable is in season in the fall and spring, and may be cooked like kohl-rabi and served in a white cream or sauce.',
        reading: { kind: 'none' },
    },
    { line: 'The artichoke may also be cooked in milk.', reading: { kind: 'none' } },
    {
        line: 'When this is done, cut the washed and peeled artichoke into cubes, put in a stew-pan, and cover with milk (a generous pint to a quart of cubes).',
        reading: { kind: 'none' },
    },
    { line: 'Add one small onion and cook twenty minutes.', reading: { kind: 'none' } },
    {
        line: 'Beat together one tablespoon of butter and one level tablespoon of flour, and stir this into the boiling milk.',
        reading: { kind: 'none' },
    },
    {
        line: 'Then season with one teaspoon of salt and one-fourth teaspoon of pepper, and continue the cooking one-half hour longer.',
        reading: { kind: 'none' },
    },
    { line: 'The cooking should be done in a double boiler.', reading: { kind: 'none' } },
    { line: 'The artichoke also makes a very good soup.', reading: { kind: 'none' } },
    { line: 'Add 2 tbsp. oil to the pan.', reading: { kind: 'none' } },
    { line: 'Heat until it shimmers.', reading: { kind: 'none' } },
    { line: 'Stir in 8 oz. cream cheese.', reading: { kind: 'none' } },
    { line: 'Mix until smooth.', reading: { kind: 'none' } },
    { line: 'Bake for approx. 25 minutes.', reading: { kind: 'one', seconds: 1500 } },
    { line: 'Let it cool on a rack.', reading: { kind: 'none' } },
    { line: 'Add 1.5 cups of stock.', reading: { kind: 'none' } },
    { line: 'Simmer for 10 min.', reading: { kind: 'one', seconds: 600 } },
    { line: 'Season to taste.', reading: { kind: 'none' } },
    { line: 'Fold the dough as in Fig. 2 and chill it.', reading: { kind: 'none' } },
    { line: 'Roll it out thin.', reading: { kind: 'none' } },
    { line: 'Add the zest (about 1 tsp. from one lemon).', reading: { kind: 'none' } },
    { line: 'Stir well.', reading: { kind: 'none' } },
    { line: 'Preheat the oven to 350°F.', reading: { kind: 'none' } },
    { line: 'Grease a 9-inch pan.', reading: { kind: 'none' } },
    { line: 'Cut the butter into 1/2 in. cubes.', reading: { kind: 'none' } },
    { line: 'Chill them for 15 minutes.', reading: { kind: 'one', seconds: 900 } },
    { line: 'Add 0.5 tsp salt and 2.25 cups flour.', reading: { kind: 'none' } },
    { line: 'Mix.', reading: { kind: 'none' } },
    { line: 'Whisk the eggs; add the milk; beat well.', reading: { kind: 'none' } },
    { line: 'Use a 9 x 13 in. pan.', reading: { kind: 'none' } },
    { line: 'Line it with parchment.', reading: { kind: 'none' } },
    { line: 'Simmer until reduced by half (about 10 min.).', reading: { kind: 'one', seconds: 600 } },
    { line: 'Strain the sauce.', reading: { kind: 'none' } },
    { line: 'Season with salt, pepper, etc.', reading: { kind: 'none' } },
    { line: 'Serve hot.', reading: { kind: 'none' } },
    { line: 'Add 1 c. sugar, 2 Tbsp. butter, and 1 lb. apples.', reading: { kind: 'none' } },
    { line: 'Bake at 190°C for 40 min.', reading: { kind: 'one', seconds: 2400 } },
    { line: "Follow Mrs. Beeton's method and beat the whites stiff.", reading: { kind: 'none' } },
    { line: 'Fold them in gently.', reading: { kind: 'none' } },
    { line: 'Set the oven to gas mark 6.', reading: { kind: 'none' } },
    { line: 'Bake the loaf for 35 minutes.', reading: { kind: 'one', seconds: 2100 } },
    { line: 'Is it golden?', reading: { kind: 'none' } },
    { line: 'Take it out now!', reading: { kind: 'none' } },
    { line: 'Garnish with a sprig of mint.', reading: { kind: 'none' } },
    { line: 'Add 2 T. butter.', reading: { kind: 'none' } },
    { line: 'Stir.', reading: { kind: 'none' } },
    { line: 'Add 1 t. salt.', reading: { kind: 'none' } },
    { line: 'See Fig. 2.', reading: { kind: 'none' } },
    { line: 'Then fold.', reading: { kind: 'none' } },
    { line: 'Add the eggs.', reading: { kind: 'none' } },
    { line: '"Beat them well."', reading: { kind: 'none' } },
    { line: 'Serve.', reading: { kind: 'none' } },
    { line: 'Bake 20 minutes, keeps 3 days.', reading: { kind: 'one', seconds: 1200 } },
    { line: 'Bake for 25 minutes at 180C.', reading: { kind: 'one', seconds: 1500 } },
    { line: 'Bake 20–25 min, until golden.', reading: { kind: 'one', seconds: 1200 } },
    { line: 'Simmer 20 to 25 minutes or until tender.', reading: { kind: 'one', seconds: 1200 } },
    { line: 'Simmer for 5 or 6 minutes.', reading: { kind: 'one', seconds: 300 } },
    { line: 'Roast for 1 h 30 then rest.', reading: { kind: 'one', seconds: 3600 } },
    { line: 'Rest 1 hour 5 minutes.', reading: { kind: 'one', seconds: 3900 } },
    { line: 'Boil for ten minutes.', reading: { kind: 'none' } },
    { line: 'Chill for an hour.', reading: { kind: 'none' } },
    { line: 'Chill for an hour or overnight.', reading: { kind: 'none' } },
    { line: 'Let it rest half an hour.', reading: { kind: 'none' } },
    { line: 'Cook 2 eggs for 3 minutes.', reading: { kind: 'one', seconds: 180 } },
    { line: 'Cook for 3 minutes, then add 2 minutes more.', reading: { kind: 'many' } },
    { line: 'Bake 20 minutes, then 10 minutes more.', reading: { kind: 'many' } },
    { line: 'Stir every 5 minutes.', reading: { kind: 'one', seconds: 300 } },
    { line: 'Stir every five minutes.', reading: { kind: 'none' } },
    { line: 'Stir once a minute.', reading: { kind: 'none' } },
    { line: 'Fry 2 minutes each side.', reading: { kind: 'one', seconds: 120 } },
    { line: 'Fry two minutes each side.', reading: { kind: 'none' } },
    { line: 'Add 2 cups flour and mix for 1 minute.', reading: { kind: 'one', seconds: 60 } },
    { line: 'Add two cups flour and mix for one minute.', reading: { kind: 'none' } },
    { line: 'Marinate for 48 hours.', reading: { kind: 'one', seconds: 172800 } },
    { line: 'Marinate overnight, or up to 24 hours.', reading: { kind: 'one', seconds: 86400 } },
    { line: 'Bake for 1 hour and 15 minutes.', reading: { kind: 'one', seconds: 4500 } },
    { line: 'Bake for an hour and 15 minutes.', reading: { kind: 'one', seconds: 900 } },
    { line: 'Bake for an hour and a half.', reading: { kind: 'none' } },
    { line: 'Microwave 30 seconds.', reading: { kind: 'one', seconds: 30 } },
    { line: 'Microwave thirty seconds.', reading: { kind: 'none' } },
    { line: 'Whisk for a minute or two.', reading: { kind: 'none' } },
    { line: 'Whisk 1 or 2 minutes.', reading: { kind: 'one', seconds: 60 } },
    { line: 'Let stand 5 minutes, or until set.', reading: { kind: 'one', seconds: 300 } },
    { line: 'Sear 1 minute per side, 2 minutes in all.', reading: { kind: 'many' } },
    { line: 'Preheat the oven to 350 degrees.', reading: { kind: 'none' } },
    { line: 'Serve with 2 lemon wedges.', reading: { kind: 'none' } },
    { line: 'Serves 4 to 6 people.', reading: { kind: 'none' } },
    { line: 'Cook 20 minutes (or 25 if the pieces are thick).', reading: { kind: 'one', seconds: 1200 } },
    { line: 'Prep 10 min; cook 15 min.', reading: { kind: 'many' } },
    { line: 'Wait a second, then flip.', reading: { kind: 'none' } },
    { line: 'Boil a minute then add the sugar.', reading: { kind: 'none' } },
    { line: 'Rest for 15 minutes; this keeps 2 days.', reading: { kind: 'one', seconds: 900 } },
    { line: 'Bake 1½ hours.', reading: { kind: 'one', seconds: 5400 } },
    { line: 'Soak beans 8 hours or overnight.', reading: { kind: 'one', seconds: 28800 } },
    { line: 'Cool for 1 h 30 min before slicing.', reading: { kind: 'one', seconds: 5400 } },
    { line: 'Simmer for 45-50 minutes.', reading: { kind: 'one', seconds: 2700 } },
    { line: 'Add ten drops of vanilla.', reading: { kind: 'none' } },
    { line: 'Chop 3 onions and fry 5 minutes.', reading: { kind: 'one', seconds: 300 } },
];
