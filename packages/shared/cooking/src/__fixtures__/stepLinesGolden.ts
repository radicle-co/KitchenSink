/**
 * The public-domain half of the golden line split, the oracle for `splitStepLines`.
 *
 * Source: the golden split file (sha256 f84747ce44e18090…), `source === 'corpus'` only. These are 1919 cookbook steps, so
 * they are public domain and may live in the repository. The modern half stays outside it and is scored locally.
 * `lines` is the product owner's split. It also cuts at semicolons and a paragraph colon, which this split does not make yet, so a
 * test may only assert that a split makes no cut the golden split lacks. Generated; do not edit by hand.
 */
export interface GoldenStep {
    readonly recipe: string;
    readonly step: number;
    readonly text: string;
    readonly lines: readonly string[];
}

export const GOLDEN_CORPUS_STEPS: readonly GoldenStep[] = [
    {
        recipe: 'STUFFED TOMATOES',
        step: 1,
        text: 'Select round, very firm and even sized tomatoes, cut off the top (reserve to use as a cover), scrape out the inside, being very careful to not break the tomato. Fill each tomato with some finely prepared "cold slaw," cover with the top of the tomato, lay them on lettuce leaves and pour a mayonnaise dressing over each. You may lay them en masse on a decorated platter, heaping them in the shape of a mound, or serve individually.',
        lines: [
            'Select round, very firm and even sized tomatoes, cut off the top (reserve to use as a cover), scrape out the inside, being very careful to not break the tomato.',
            'Fill each tomato with some finely prepared "cold slaw," cover with the top of the tomato, lay them on lettuce leaves and pour a mayonnaise dressing over each.',
            'You may lay them en masse on a decorated platter, heaping them in the shape of a mound, or serve individually.',
        ],
    },
    {
        recipe: 'CHOCOLATE LAYER CAKE',
        step: 1,
        text: 'Stir one scant half cup of butter to a cream with one cup of sugar. Add alternately one-half cup of sweet milk, yolks of two eggs which you have previously beaten until quite light, add whites of two, and one-half cup of sifted flour. Make a custard of one-half cup of milk, with one cup of grated chocolate, one-half cup of granulated sugar; boil until thick, add the yolk of one egg, then remove from the fire; stir until cool, add this to the cake batter, add one and one-half cups of sifted flour, two teaspoons of baking-powder and one of vanilla flavoring. Bake in layers and ice between and on top with plain white icing flavored to taste. You may substitute almond or colored icing.',
        lines: [
            'Stir one scant half cup of butter to a cream with one cup of sugar.',
            'Add alternately one-half cup of sweet milk, yolks of two eggs which you have previously beaten until quite light, add whites of two, and one-half cup of sifted flour.',
            'Make a custard of one-half cup of milk, with one cup of grated chocolate, one-half cup of granulated sugar;',
            'boil until thick, add the yolk of one egg, then remove from the fire;',
            'stir until cool, add this to the cake batter, add one and one-half cups of sifted flour, two teaspoons of baking-powder and one of vanilla flavoring.',
            'Bake in layers and ice between and on top with plain white icing flavored to taste.',
            'You may substitute almond or colored icing.',
        ],
    },
    {
        recipe: 'CRANBERRY JELLY',
        step: 1,
        text: 'Wash and pick ripe cranberries and set on to boil in a porcelain-lined kettle closely covered. When soft strain the pulp through a fine wire sieve. Measure the juice and add an equal quantity of sugar. Set it on to boil again and let it boil very fast for about ten minutes--but it must boil steadily all the time. Wet a mold with cold water, turn the jelly into it and set it away to cool, when firm turn it into a glass salver.',
        lines: [
            'Wash and pick ripe cranberries and set on to boil in a porcelain-lined kettle closely covered.',
            'When soft strain the pulp through a fine wire sieve.',
            'Measure the juice and add an equal quantity of sugar.',
            'Set it on to boil again and let it boil very fast for about ten minutes--but it must boil steadily all the time.',
            'Wet a mold with cold water, turn the jelly into it and set it away to cool, when firm turn it into a glass salver.',
        ],
    },
    {
        recipe: 'SWEET SOUR BEANS',
        step: 1,
        text: 'If you use canned string beans, heat some fat in a spider and put in one tablespoon of flour; brown slightly; add one tablespoon of brown sugar, a pinch of salt, some cinnamon and vinegar to taste; then add the beans and let them simmer on the back of stove, but do not let them burn. The juice of pickled peaches or pears is delicious in preparing sweet and sour beans.',
        lines: [
            'If you use canned string beans, heat some fat in a spider and put in one tablespoon of flour;',
            'brown slightly;',
            'add one tablespoon of brown sugar, a pinch of salt, some cinnamon and vinegar to taste;',
            'then add the beans and let them simmer on the back of stove, but do not let them burn.',
            'The juice of pickled peaches or pears is delicious in preparing sweet and sour beans.',
        ],
    },
    {
        recipe: 'CHERRIES FOR PIES',
        step: 1,
        text: 'Stem the cherries--do not pit them,--pack tight in glass fruit jars, cover with syrup, made of two tablespoons of sugar to a quart of fruit, allowing one-half cup of water to each quart of cherries. Let them boil fifteen minutes from the time they begin to boil.',
        lines: [
            'Stem the cherries--do not pit them,--pack tight in glass fruit jars, cover with syrup, made of two tablespoons of sugar to a quart of fruit, allowing one-half cup of water to each quart of cherries.',
            'Let them boil fifteen minutes from the time they begin to boil.',
        ],
    },
    {
        recipe: 'LEMON SAUCE',
        step: 1,
        text: 'Put on to boil one and one-half cups of water with juice of two lemons, sweeten to taste, add a few small pieces of cinnamon bark; when boiling stir in three teaspoons of cornstarch that have been dissolved in a little cold water. Boil a few minutes, then pour over the well-beaten yolks of two eggs, stirring all the time. Stir in stiffly-beaten whites of eggs, and pour over and around puffs when cold. Serve cold.',
        lines: [
            'Put on to boil one and one-half cups of water with juice of two lemons, sweeten to taste, add a few small pieces of cinnamon bark;',
            'when boiling stir in three teaspoons of cornstarch that have been dissolved in a little cold water.',
            'Boil a few minutes, then pour over the well-beaten yolks of two eggs, stirring all the time.',
            'Stir in stiffly-beaten whites of eggs, and pour over and around puffs when cold.',
            'Serve cold.',
        ],
    },
    {
        recipe: 'LAMB STEW--TOCANE',
        step: 1,
        text: 'Brown slices of leek or young onions in one tablespoon of drippings, add neck or breast of lamb, cut in small pieces; season with white pepper, salt and parsley; cook until tender, just before serving season with dill.',
        lines: [
            'Brown slices of leek or young onions in one tablespoon of drippings, add neck or breast of lamb, cut in small pieces;',
            'season with white pepper, salt and parsley;',
            'cook until tender, just before serving season with dill.',
        ],
    },
    {
        recipe: 'BRANDY SAUCE',
        step: 1,
        text: 'Take one cup of water, a quarter glass of brandy, one cup of sugar, juice of half a lemon. Boil all in double boiler. Beat the yolks of two eggs light, and add the boiling sauce gradually to them, stirring constantly until thick.',
        lines: [
            'Take one cup of water, a quarter glass of brandy, one cup of sugar, juice of half a lemon.',
            'Boil all in double boiler.',
            'Beat the yolks of two eggs light, and add the boiling sauce gradually to them, stirring constantly until thick.',
        ],
    },
    {
        recipe: 'EGG SANDWICHES',
        step: 1,
        text: 'Hard boil the eggs, place them immediately into cold water. When cold; remove the shells carefully, cut the eggs in half lengthwise and butter slightly. Lay one or two sardellen or appetite silds on one half of the egg and press the one half gently on the other half which has the sardellen. The egg must appear whole. Now tie lengthwise and across with the narrowest, various colored ribbons you can find.',
        lines: [
            'Hard boil the eggs, place them immediately into cold water.',
            'When cold; remove the shells carefully, cut the eggs in half lengthwise and butter slightly.',
            'Lay one or two sardellen or appetite silds on one half of the egg and press the one half gently on the other half which has the sardellen.',
            'The egg must appear whole.',
            'Now tie lengthwise and across with the narrowest, various colored ribbons you can find.',
        ],
    },
    {
        recipe: 'TO KEEP EGG YOLKS',
        step: 1,
        text: 'The yolks may be kept several days and be as if just separated from the whites if they are placed in a cup previously rinsed with cold water and a pinch of salt added to them. The cup must be closely covered with a wet cloth, and this must be changed and well rinsed in cold water every day.',
        lines: [
            'The yolks may be kept several days and be as if just separated from the whites if they are placed in a cup previously rinsed with cold water and a pinch of salt added to them.',
            'The cup must be closely covered with a wet cloth, and this must be changed and well rinsed in cold water every day.',
        ],
    },
    {
        recipe: 'TO KEEP EGG YOLKS',
        step: 2,
        text: 'When whites are left over make a small angel cake or any of the cookies which require the whites of egg only.',
        lines: [
            'When whites are left over make a small angel cake or any of the cookies which require the whites of egg only.',
        ],
    },
    {
        recipe: 'TO KEEP EGG YOLKS',
        step: 3,
        text: 'When yolks are left over use for making mayonnaise.',
        lines: ['When yolks are left over use for making mayonnaise.'],
    },
    {
        recipe: 'PRESERVED STRAWBERRIES',
        step: 1,
        text: 'To one pint of strawberries take one pint of sugar and one-half cup of water. Unless strawberries are cooked in the sun they should be prepared only in small quantities or they will be dark and unpalatable. If the following directions are carefully observed the berries will be plump and of a rich red color.',
        lines: [
            'To one pint of strawberries take one pint of sugar and one-half cup of water.',
            'Unless strawberries are cooked in the sun they should be prepared only in small quantities or they will be dark and unpalatable.',
            'If the following directions are carefully observed the berries will be plump and of a rich red color.',
        ],
    },
    {
        recipe: 'PRESERVED STRAWBERRIES',
        step: 2,
        text: 'Bring the sugar and water to a boil; add the strawberries and cook ten minutes. Remove the berries carefully with a skimmer and cook the syrup until it is of the consistency of jelly. Return the berries to the syrup; bring all to a boil and when cool put in glass tumblers.',
        lines: [
            'Bring the sugar and water to a boil;',
            'add the strawberries and cook ten minutes.',
            'Remove the berries carefully with a skimmer and cook the syrup until it is of the consistency of jelly.',
            'Return the berries to the syrup;',
            'bring all to a boil and when cool put in glass tumblers.',
        ],
    },
    {
        recipe: 'SAUCE HOLLANDAISE',
        step: 1,
        text: 'Mix one tablespoon of butter and one of flour in a saucepan and add gradually half a pint of boiling water. Stir until it just reaches the boiling point; take from the fire and add the yolks of two eggs. Into another saucepan put a slice of onion, a bay leaf, and a clove of garlic; add four tablespoons of vinegar, and stand this over the fire until the vinegar is reduced one-half. Turn this into the sauce, stir for a moment; strain through a fine sieve; add half a teaspoon of salt and serve. This sauce may be varied by adding lemon juice instead of vinegar, or by using the water in which the fish was boiled. It is one of the daintiest of all sauces.',
        lines: [
            'Mix one tablespoon of butter and one of flour in a saucepan and add gradually half a pint of boiling water.',
            'Stir until it just reaches the boiling point;',
            'take from the fire and add the yolks of two eggs.',
            'Into another saucepan put a slice of onion, a bay leaf, and a clove of garlic;',
            'add four tablespoons of vinegar, and stand this over the fire until the vinegar is reduced one-half.',
            'Turn this into the sauce, stir for a moment;',
            'strain through a fine sieve;',
            'add half a teaspoon of salt and serve.',
            'This sauce may be varied by adding lemon juice instead of vinegar, or by using the water in which the fish was boiled.',
            'It is one of the daintiest of all sauces.',
        ],
    },
    {
        recipe: 'BRANDIED CHERRIES',
        step: 1,
        text: 'Select the largest sweet cherries for this purpose, leaving the stems on. Allow half a pound of sugar to every pound of fruit, and a pint of good brandy for every five pounds of fruit. Make a syrup of the sugar, using as little water as possible. Pour it over the cherries and let them remain in the syrup all night. Next day put them in a preserving kettle and heat slowly. Boil about eight minutes. Take up the cherries with a perforated skimmer and boil the syrup fifteen minutes. Add the brandy to the boiling syrup, remove from the fire and pour over the cherries hot, and seal.',
        lines: [
            'Select the largest sweet cherries for this purpose, leaving the stems on.',
            'Allow half a pound of sugar to every pound of fruit, and a pint of good brandy for every five pounds of fruit.',
            'Make a syrup of the sugar, using as little water as possible.',
            'Pour it over the cherries and let them remain in the syrup all night.',
            'Next day put them in a preserving kettle and heat slowly.',
            'Boil about eight minutes.',
            'Take up the cherries with a perforated skimmer and boil the syrup fifteen minutes.',
            'Add the brandy to the boiling syrup, remove from the fire and pour over the cherries hot, and seal.',
        ],
    },
    {
        recipe: 'VEGETABLE HASH',
        step: 1,
        text: 'Hash may be made with one or many vegetables and with or without the addition of meat and fish. Potato is the most useful vegetable for hash, because it combines well with meat or other vegetables. The vegetables must be chopped fine, well seasoned with salt and pepper, and parsley, onion, chives or green pepper if desired, and moistened with stock, milk or water, using a quarter of a cup to a pint of hash. Melt one-half tablespoon of butter or savory drippings in a pan; put in the hash, spreading it evenly and dropping small pieces of butter or drippings over the top. Cover the pan; let the hash cook over a moderate fire for half an hour; fold over like an omelet and serve. If properly cooked there will be a rich brown crust formed on the outside of the hash.',
        lines: [
            'Hash may be made with one or many vegetables and with or without the addition of meat and fish.',
            'Potato is the most useful vegetable for hash, because it combines well with meat or other vegetables.',
            'The vegetables must be chopped fine, well seasoned with salt and pepper, and parsley, onion, chives or green pepper if desired, and moistened with stock, milk or water, using a quarter of a cup to a pint of hash.',
            'Melt one-half tablespoon of butter or savory drippings in a pan;',
            'put in the hash, spreading it evenly and dropping small pieces of butter or drippings over the top.',
            'Cover the pan;',
            'let the hash cook over a moderate fire for half an hour;',
            'fold over like an omelet and serve.',
            'If properly cooked there will be a rich brown crust formed on the outside of the hash.',
        ],
    },
    {
        recipe: 'CANNING FRUIT BAKED IN OVEN',
        step: 1,
        text: 'In this method the work is easily and quickly done and the fruit retains its shape, color and flavor. Particularly nice for berries.',
        lines: [
            'In this method the work is easily and quickly done and the fruit retains its shape, color and flavor.',
            'Particularly nice for berries.',
        ],
    },
    {
        recipe: 'CANNING FRUIT BAKED IN OVEN',
        step: 2,
        text: 'Sterilize jars and utensils. Make the syrup; prepare the fruit the same as for cooking. Fill the hot jars with the fruit, drained, and pour in enough hot syrup to fill the jar solidly. Run the handle of a silver spoon around the inside of the jar. Place the hot jars, uncovered, and the covers, in a moderate oven.',
        lines: [
            'Sterilize jars and utensils.',
            'Make the syrup;',
            'prepare the fruit the same as for cooking.',
            'Fill the hot jars with the fruit, drained, and pour in enough hot syrup to fill the jar solidly.',
            'Run the handle of a silver spoon around the inside of the jar.',
            'Place the hot jars, uncovered, and the covers, in a moderate oven.',
        ],
    },
    {
        recipe: 'CANNING FRUIT BAKED IN OVEN',
        step: 3,
        text: 'Cover the bottom of the oven with a sheet of asbestos, the kind plumbers employ in covering pipes, or put into the oven shallow pans in which there are about two inches of boiling water. Cook berries to the boiling point or until the bubbles in the syrup just rise to the top; cook larger fruits, eight to ten minutes or according to the fruit. Remove from the oven, slip on rubber, first dipped in boiling water; then fill the jar with boiling syrup. Cover and seal. Place the jars on a board and out of a draft of air. If the screw covers are used tighten them after the glass has cooled.',
        lines: [
            'Cover the bottom of the oven with a sheet of asbestos, the kind plumbers employ in covering pipes, or put into the oven shallow pans in which there are about two inches of boiling water.',
            'Cook berries to the boiling point or until the bubbles in the syrup just rise to the top;',
            'cook larger fruits, eight to ten minutes or according to the fruit.',
            'Remove from the oven, slip on rubber, first dipped in boiling water;',
            'then fill the jar with boiling syrup.',
            'Cover and seal.',
            'Place the jars on a board and out of a draft of air.',
            'If the screw covers are used tighten them after the glass has cooled.',
        ],
    },
    {
        recipe: 'CANNING FRUIT BAKED IN OVEN',
        step: 4,
        text: 'Large fruits, such as peaches, pears, quince, crab-apples, etc., will require about a pint of syrup to each quart jar of fruit. The small fruit will require a little over half a pint of syrup.',
        lines: [
            'Large fruits, such as peaches, pears, quince, crab-apples, etc., will require about a pint of syrup to each quart jar of fruit.',
            'The small fruit will require a little over half a pint of syrup.',
        ],
    },
    {
        recipe: 'LETTUCE',
        step: 1,
        text: 'The French style of making lettuce salad is as follows: After dressing the salad, mix it in one tablespoon of oil, then take only two tablespoons of white wine vinegar, mixed with a very little pepper and salt, and just turn the lettuce over and over in this mixture.',
        lines: [
            'The French style of making lettuce salad is as follows:',
            'After dressing the salad, mix it in one tablespoon of oil, then take only two tablespoons of white wine vinegar, mixed with a very little pepper and salt, and just turn the lettuce over and over in this mixture.',
        ],
    },
    {
        recipe: 'FRIED BEEFSTEAK',
        step: 1,
        text: 'Take third cut of chuck or the tenderloin. Have the spider very hot, use just enough fat to grease the spider. Lay in the steak, turning very often to keep in the juice, season with salt and pepper. Serve on a hot platter.',
        lines: [
            'Take third cut of chuck or the tenderloin.',
            'Have the spider very hot, use just enough fat to grease the spider.',
            'Lay in the steak, turning very often to keep in the juice, season with salt and pepper.',
            'Serve on a hot platter.',
        ],
    },
    {
        recipe: 'SAUERKRAUT',
        step: 1,
        text: 'Line the bottom and sides of a clean barrel or keg with cabbage leaves. Cut into fine shreds one or two dozen large heads of white, crisp cabbage. Do this on a large slaw-cutter. Now begin to pack: First put in a layer of cabbage, say about four inches deep, and press down firmly and sprinkle with about four tablespoons of salt. Put one or two tart apples, cut up fine, between each layer, or some Malaga grapes (which will impart a fine flavor to the kraut). When four layers have been put in, pound with a wooden beetle until the cabbage is quite compact and then add more cabbage, and so on until all has been salted, always pounding down each layer. Last, cover with cabbage leaves, then a clean cloth, a well-fitting board, and a heavy stone, to act as weight on top of all. It is now ready to set away in a cool cellar to ferment. In two weeks examine, remove the scum, if any; wash the cloth, board and stone, wash also the sides of the keg or jar, and place all back again. This must be done weekly.',
        lines: [
            'Line the bottom and sides of a clean barrel or keg with cabbage leaves.',
            'Cut into fine shreds one or two dozen large heads of white, crisp cabbage.',
            'Do this on a large slaw-cutter.',
            'Now begin to pack: First put in a layer of cabbage, say about four inches deep, and press down firmly and sprinkle with about four tablespoons of salt.',
            'Put one or two tart apples, cut up fine, between each layer, or some Malaga grapes (which will impart a fine flavor to the kraut).',
            'When four layers have been put in, pound with a wooden beetle until the cabbage is quite compact and then add more cabbage, and so on until all has been salted, always pounding down each layer.',
            'Last, cover with cabbage leaves, then a clean cloth, a well-fitting board, and a heavy stone, to act as weight on top of all.',
            'It is now ready to set away in a cool cellar to ferment.',
            'In two weeks examine, remove the scum, if any;',
            'wash the cloth, board and stone, wash also the sides of the keg or jar, and place all back again.',
            'This must be done weekly.',
        ],
    },
    {
        recipe: 'VEGETABLES',
        step: 1,
        text: 'All vegetables should be thoroughly cleansed just before being put on to cook.',
        lines: ['All vegetables should be thoroughly cleansed just before being put on to cook.'],
    },
    {
        recipe: 'VEGETABLES',
        step: 2,
        text: 'Green vegetables; such as cabbage, cauliflower and Brussels sprouts, should be soaked heads down in salted cold water, to which a few spoons of vinegar may be added.',
        lines: [
            'Green vegetables; such as cabbage, cauliflower and Brussels sprouts, should be soaked heads down in salted cold water, to which a few spoons of vinegar may be added.',
        ],
    },
    {
        recipe: 'VEGETABLES',
        step: 3,
        text: 'To secure the best results all vegetables except beans, that is the dried beans, should be put in boiling water and the water must be made to boil again as soon as possible after the vegetables have been added and must be kept boiling until the cooking is finished.',
        lines: [
            'To secure the best results all vegetables except beans, that is the dried beans, should be put in boiling water and the water must be made to boil again as soon as possible after the vegetables have been added and must be kept boiling until the cooking is finished.',
        ],
    },
    {
        recipe: 'VEGETABLES',
        step: 4,
        text: 'In cooking vegetables, conserve their juices.',
        lines: ['In cooking vegetables, conserve their juices.'],
    },
    {
        recipe: 'VEGETABLES',
        step: 5,
        text: 'The average housewife pours down the sink drainpipe the juices from all the vegetables which she cooks; she little realizes that she thus drains away the health of her family. Cook vegetables with just sufficient water to prevent them from burning, and serve their juices with them; else save the vegetable "waters" and, by the addition of milk and butter convert them into soups for the family use. Such soups, derived from one or several vegetables, alone or mixed together, make palatable and healthful additions to the family bill-of-fare.',
        lines: [
            'The average housewife pours down the sink drainpipe the juices from all the vegetables which she cooks;',
            'she little realizes that she thus drains away the health of her family.',
            'Cook vegetables with just sufficient water to prevent them from burning, and serve their juices with them;',
            'else save the vegetable "waters" and, by the addition of milk and butter convert them into soups for the family use.',
            'Such soups, derived from one or several vegetables, alone or mixed together, make palatable and healthful additions to the family bill-of-fare.',
        ],
    },
    {
        recipe: 'JERUSALEM ARTICHOKE',
        step: 1,
        text: 'This vegetable is in season in the fall and spring, and may be cooked like kohl-rabi and served in a white cream or sauce. The artichoke may also be cooked in milk.',
        lines: [
            'This vegetable is in season in the fall and spring, and may be cooked like kohl-rabi and served in a white cream or sauce.',
            'The artichoke may also be cooked in milk.',
        ],
    },
    {
        recipe: 'JERUSALEM ARTICHOKE',
        step: 2,
        text: 'When this is done, cut the washed and peeled artichoke into cubes, put in a stew-pan, and cover with milk (a generous pint to a quart of cubes). Add one small onion and cook twenty minutes. Beat together one tablespoon of butter and one level tablespoon of flour, and stir this into the boiling milk. Then season with one teaspoon of salt and one-fourth teaspoon of pepper, and continue the cooking one-half hour longer. The cooking should be done in a double boiler. The artichoke also makes a very good soup.',
        lines: [
            'When this is done, cut the washed and peeled artichoke into cubes, put in a stew-pan, and cover with milk (a generous pint to a quart of cubes).',
            'Add one small onion and cook twenty minutes.',
            'Beat together one tablespoon of butter and one level tablespoon of flour, and stir this into the boiling milk.',
            'Then season with one teaspoon of salt and one-fourth teaspoon of pepper, and continue the cooking one-half hour longer.',
            'The cooking should be done in a double boiler.',
            'The artichoke also makes a very good soup.',
        ],
    },
];

/**
 * The product owner's trap table (sha256 47a4b2c9fd0e294e…): abbreviations, decimals and
 * two-sided sentence ends the golden set lacks. A split must match each row exactly. Written by the product owner, never by the
 * builder. Generated; do not edit by hand.
 */
export const STEP_LINE_TRAPS: readonly { readonly text: string; readonly lines: readonly string[] }[] = [
    {
        text: 'Add 2 tbsp. oil to the pan. Heat until it shimmers.',
        lines: ['Add 2 tbsp. oil to the pan.', 'Heat until it shimmers.'],
    },
    {
        text: 'Stir in 8 oz. cream cheese. Mix until smooth.',
        lines: ['Stir in 8 oz. cream cheese.', 'Mix until smooth.'],
    },
    {
        text: 'Bake for approx. 25 minutes. Let it cool on a rack.',
        lines: ['Bake for approx. 25 minutes.', 'Let it cool on a rack.'],
    },
    {
        text: 'Add 1.5 cups of stock. Simmer for 10 min. Season to taste.',
        lines: ['Add 1.5 cups of stock.', 'Simmer for 10 min.', 'Season to taste.'],
    },
    {
        text: 'Fold the dough as in Fig. 2 and chill it. Roll it out thin.',
        lines: ['Fold the dough as in Fig. 2 and chill it.', 'Roll it out thin.'],
    },
    {
        text: 'Add the zest (about 1 tsp. from one lemon). Stir well.',
        lines: ['Add the zest (about 1 tsp. from one lemon).', 'Stir well.'],
    },
    {
        text: 'Preheat the oven to 350°F. Grease a 9-inch pan.',
        lines: ['Preheat the oven to 350°F.', 'Grease a 9-inch pan.'],
    },
    {
        text: 'Cut the butter into 1/2 in. cubes. Chill them for 15 minutes.',
        lines: ['Cut the butter into 1/2 in. cubes.', 'Chill them for 15 minutes.'],
    },
    {
        text: 'Add 0.5 tsp salt and 2.25 cups flour. Mix.',
        lines: ['Add 0.5 tsp salt and 2.25 cups flour.', 'Mix.'],
    },
    {
        text: 'Whisk the eggs; add the milk; beat well.',
        lines: ['Whisk the eggs; add the milk; beat well.'],
    },
    {
        text: 'Use a 9 x 13 in. pan. Line it with parchment.',
        lines: ['Use a 9 x 13 in. pan.', 'Line it with parchment.'],
    },
    {
        text: 'Simmer until reduced by half (about 10 min.). Strain the sauce.',
        lines: ['Simmer until reduced by half (about 10 min.).', 'Strain the sauce.'],
    },
    {
        text: 'Season with salt, pepper, etc. Serve hot.',
        lines: ['Season with salt, pepper, etc.', 'Serve hot.'],
    },
    {
        text: 'Add 1 c. sugar, 2 Tbsp. butter, and 1 lb. apples. Bake at 190°C for 40 min.',
        lines: ['Add 1 c. sugar, 2 Tbsp. butter, and 1 lb. apples.', 'Bake at 190°C for 40 min.'],
    },
    {
        text: "Follow Mrs. Beeton's method and beat the whites stiff. Fold them in gently.",
        lines: ["Follow Mrs. Beeton's method and beat the whites stiff.", 'Fold them in gently.'],
    },
    {
        text: 'Set the oven to gas mark 6. Bake the loaf for 35 minutes.',
        lines: ['Set the oven to gas mark 6.', 'Bake the loaf for 35 minutes.'],
    },
    {
        text: 'Is it golden? Take it out now!',
        lines: ['Is it golden?', 'Take it out now!'],
    },
    {
        text: 'Garnish with a sprig of mint.',
        lines: ['Garnish with a sprig of mint.'],
    },
];

/**
 * The product owner's second trap table (sha256 88c6faa3fcd89461…). Extra
 * cuts are gated at zero, as for the golden set; missed cuts are reported only. Generated; do not edit by hand.
 */
export const STEP_LINE_TRAPS_2: readonly { readonly text: string; readonly lines: readonly string[] }[] = [
    {
        text: 'Add 2 T. butter. Stir.',
        lines: ['Add 2 T. butter.', 'Stir.'],
    },
    {
        text: 'Add 1 t. salt. Stir.',
        lines: ['Add 1 t. salt.', 'Stir.'],
    },
    {
        text: 'See Fig. 2. Then fold.',
        lines: ['See Fig. 2.', 'Then fold.'],
    },
    {
        text: 'Add the eggs. "Beat them well." Serve.',
        lines: ['Add the eggs.', '"Beat them well."', 'Serve.'],
    },
];
