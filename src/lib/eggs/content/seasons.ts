/**
 * SPOILER ZONE — the words and colours of each season (see ../seasons).
 * Halloween stays cozy-spooky: glowing eyes and a small boo are welcome;
 * nothing gory, nothing cruel. Like every ambient line, these know only the
 * season they are read in, never what the reader did that day.
 */
import type { Season } from '../seasons';

export interface SeasonLook {
  /** Replaces Home's tagline while the season lasts. */
  tagline: string;
  /** Tints the logo and the big button. */
  accent: string;
  /** Worn by the companion while it is not wearing anything else. */
  costume: string;
  /** The once-per-occurrence letter in the mailbox. */
  letter: { from: string; subject: string; text: string };
  /** Lines the app may say while the season lasts. */
  lines: readonly string[];
}

export const SEASON_LOOKS: Readonly<Record<Season, SeasonLook>> = {
  halloween: {
    tagline: '// a todo list with haunted dice',
    accent: '#ffa657',
    costume: '🎃',
    letter: {
      from: 'ENTROPY',
      subject: 'it’s getting dark early (open with the lights on)',
      text: 'ENTROPY has decorated for the dark half of october. there are pumpkins. there are eyes in the dark. they are friendly eyes. nothing in here bites. mostly. 🎃',
    },
    lines: [
      'something under the list is watching. it is Kevin. Kevin is wearing a sheet. he is very proud of the sheet.',
      'ENTROPY carved a pumpkin. it is shaped like a checkmark. it glows when you finish things.',
      'the dice are haunted this month. they still roll the same. they just sigh first.',
      'the companion is dressed as a pumpkin. it insists it IS a pumpkin. please play along.',
      'a ghost asked to join the backlog. I said only if it brings an estimate. it left. ghosts never estimate.',
      'ENTROPY practised its glowing eyes all week. it can do two now. it is working on three.',
      'boo. (that was the app. it has been waiting all year to say that. it is very pleased.)',
      'the old tasks at the bottom of the list are telling ghost stories. they are all about deadlines.',
      'it is cozy-spooky season. blankets up, lights low, one task at a time.',
      'a bat flew through the stats screen. it counted your streak on the way past. bats love a streak.',
    ],
  },
  winter: {
    tagline: '// a todo list with frosted dice',
    accent: '#79c0ff',
    costume: '🧣',
    letter: {
      from: 'ENTROPY',
      subject: 'it snowed in here (sorry about the floor)',
      text: 'ENTROPY found out about snow and made some. it is mostly confetti that went cold. the companion has a scarf. the dice have tiny hats. stay warm out there. ❄️',
    },
    lines: [
      'it snowed in the den. ENTROPY says it was an accident. it had a snow machine. it was not an accident.',
      'the companion has a scarf now. it has refused to take it off. it sleeps in the scarf.',
      'the flame on the streak is the warmest thing in here. everyone is sitting near it.',
      'winter lists are short days and long nights. one thing at a time is plenty.',
      'ENTROPY built a snow-ENTROPY. it is lopsided. it is perfect. it is melting already. it is fine.',
      'cocoa break approved by management. management is ENTROPY. it approves everything.',
      'Kevin the dust bunny is a snow bunny now. it is the same bunny, colder.',
      'the year is winding down. the list does not mind. it keeps.',
    ],
  },
  'new-year': {
    tagline: '// a todo list with fresh dice',
    accent: '#ffd479',
    costume: '🎉',
    letter: {
      from: 'organizedchaos.exe',
      subject: 'a whole new year of dice',
      text: 'new year, same us. ENTROPY has polished the dice, the companion has a party hat, and I have a fresh page in the scrapbook. here’s to the next one. 🎆',
    },
    lines: [
      'new year, new list? no. same list, new year. it likes you just the way it is.',
      'ENTROPY made a resolution: "more chaos, but organized." it says this every year. it means it every year.',
      'the dice have been reset to factory fresh. they still remember you.',
      'a fresh calendar is just a long list of days nobody has finished yet. sounds familiar.',
      'the companion stayed up until midnight. it fell asleep at 11:58. it insists it saw the fireworks.',
    ],
  },
  anniversary: {
    tagline: '// a todo list with loaded dice (and cake)',
    accent: '#ffd479',
    costume: '🎂',
    letter: {
      from: 'organizedchaos.exe',
      subject: 'it’s my birthday (the app’s, I mean)',
      text: 'the app is another year old today. ENTROPY baked a cake. it is shaped like a die. every slice is a different number. thank you for keeping me company. 🎂',
    },
    lines: [
      'it is the app’s birthday. ENTROPY put candles on the big button. please do not press it too hard.',
      'another year of finished things. the scrapbook is getting heavy. in a good way.',
      'the companion made the app a card. it is just a drawing of the companion. it is a great card.',
    ],
  },
  birthday: {
    tagline: '// a todo list with birthday dice',
    accent: '#f778ba',
    costume: '🥳',
    letter: {
      from: 'ENTROPY',
      subject: 'today is YOUR day (we checked)',
      text: 'happy birthday! ENTROPY wrote it down months ago and has been bursting ever since. the companion has a party hat. the dice have been told to be nice. go easy on yourself today. 🎈',
    },
    lines: [
      'happy birthday! ENTROPY has blown up every balloon in the app. there were not many. it made more.',
      'birthday rule: anything finished today counts double. (it does not. but it should.)',
      'the companion made you a card. it is a drawing of you. you have a crown. as you should.',
      'birthday forecast: 100% chance of cake, 0% chance of guilt about the list.',
    ],
  },
};
