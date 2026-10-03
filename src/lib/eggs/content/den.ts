/**
 * SPOILER ZONE — words spoken in the den. ENTROPY speaks in lowercase and
 * means well; the companion is all enthusiasm. Like the story, nothing here
 * claims the reader did something on a given day: these lines know nothing
 * about the day they are read on.
 */

/** The invitation waiting in the mailbox once the den opens. */
export const DEN_INVITE = { from: 'ENTROPY', subject: 'you’re invited (bring snacks)' } as const;

/** The card shown on the first visit, until it is read. */
export const DEN_WELCOME =
  'welcome to the den. I built it out of spare pixels and a confetti surplus. your companion picked the carpet. ' +
  'there is a scrapbook, a shelf of small hats, and a table with dice on it. the dice are mine. you may borrow them.';

/** How to come back, said once on the welcome card and quietly at the bottom of the room. */
export const DEN_WAY_BACK = 'to come back: press and hold your companion on the home screen.';

/** What the companion says when poked in its own room. */
export const DEN_LINES: readonly string[] = [
  'this is MY room. ENTROPY decorated. sorry about the dice. they are everywhere.',
  '*shows you the carpet* I picked it. it is the best carpet.',
  'I keep the scrapbook under my bed. there is no bed. it is under where a bed would be.',
  'ENTROPY says the shelf is for trinkets. I say it is for sitting on. we are both right.',
  'you can wear things in here. I mean I can. you can watch. it is a fashion show.',
  'I practise my roar in here so it is ready for the backlog. *tiny roar*',
  'Kevin the dust bunny visits on weekends. he leaves fluff as rent.',
  'ENTROPY lost at dice yesterday and called it "research". it was not research.',
  'the window shows the home screen. I watch you add things. very exciting window.',
  '*curls up* this is where I go when the list is quiet. it is a good place to go.',
  'if you put a hat on me I will be unbearable about it. fair warning.',
  'I have a favourite page in the scrapbook. I will not say which. it is the fireworks.',
  'ENTROPY wanted a moat. we compromised on a rug with a blue stripe. I swim across it daily.',
  'I am not allowed on the dice table. I am on the dice table.',
  'this is where I keep my courage. it is in the corner. it is bigger than it looks.',
  'the walls are made of finished things. you can tell because they are very sturdy.',
  'I tried on every hat at once. ENTROPY took a picture. we do not talk about the picture.',
  '*rolls over* belly rubs are free in here. house rules.',
  'when it rains outside the app, ENTROPY makes it rain confetti in here instead. bad trade? great trade.',
  'I asked ENTROPY what the den is for. it said "for being somewhere." good answer.',
  'Kevin the dust bunny is not allowed in the scrapbook. he knows what he did.',
  'every pixel in this room was a leftover. leftovers make the coziest rooms.',
  'I can see the big button from here. it looks so proud of itself.',
  'shh. ENTROPY is napping behind the shelf. it naps in a very chaotic position.',
];

/** ENTROPY at the dice table: one line per thing that can happen, picked at random. */
export const DUEL_BANTER = {
  start: [
    'first to 30. a 1 empties your pot. you roll first, because I am generous and because I lost the coin toss to myself.',
    'my dice, my table, your move. first to 30. a 1 takes the pot.',
    'the rules: roll as long as you dare. a 1 takes everything you rolled this turn. bank to keep it. first to 30.',
  ],
  youBust: [
    'ohhh, the ONE. it gets everyone. it got me yesterday.',
    'bust! I did not do that. I want that on the record.',
    'a 1. the dice giveth, the dice taketh. mostly the dice taketh.',
  ],
  youBank: [
    'banked. safe, boring, effective. I hate how well it works.',
    'into the vault it goes. sensible. suspicious, but sensible.',
    'you stopped. I respect a quitter who wins.',
  ],
  entropyBust: [
    'a ONE. they are MY dice and they still did that.',
    'bust. I respect it. I hate it. I respect it.',
    'the chaos turned on its own creator. classic.',
  ],
  entropyBank: [
    'banking. caution is just chaos with a savings account.',
    'mine now. you saw nothing.',
    'I could keep going. I am choosing peace.',
  ],
  youWin: [
    'you WIN. I demand a rematch. I also demand a snack.',
    'beaten at my own table. this is going in the scrapbook. on a sad page.',
    'fine. FINE. you are the dice champion. the dice are still mine.',
  ],
  entropyWins: [
    'I WIN. put it on the fridge. no, the OTHER fridge.',
    'victory! I will be insufferable until the next game.',
    'chaos takes this round. order may try again whenever it likes.',
  ],
} as const;
