/** SPOILER ZONE — self-care draws, story beats, unlockables. Ben: close this file. */

/** Transient randomizer cards — NEVER persisted unless accepted (spec §12). */
export const SELF_CARE: readonly string[] = [
  'Drink a glass of water. Yes, right now. The dice have spoken.',
  'Stand up and stretch for 60 seconds. Touch the sky.',
  'Step outside and take five deep breaths. The backlog will wait.',
  'Text someone you like. Not about tasks. Just hi.',
  'Look out a window at something far away for two minutes. Your eyes earned it.',
  'Make a cup of something warm and drink it away from screens.',
  'Put on one song you love and do absolutely nothing else during it.',
  'Write down one thing that went well today. Anywhere. A napkin counts.',
  'Pet an animal. If none available, view pictures of one (medically necessary).',
  'Eat a snack that has ever been near a plant.',
  'Two-minute tidy: make one surface near you beautiful.',
  'Close your eyes for 90 seconds. That’s it. That’s the task.',
  'Do 10 of any exercise. Interpretive dance counts.',
  'Tell yourself, out loud, one thing you did right this week. Weirder not to.',
  'Refill the water bottle you have been ignoring. It misses you.',
  'Unclench your jaw. Drop your shoulders. There. That was a task.',
  'Open a window for one minute. Trade some indoor air for the wild kind.',
  'Wash your hands slowly with warm water like it\'s a tiny spa.',
  'Send a photo of something nice to someone who\'d like it.',
  'Put tomorrow-you to bed early tonight. That\'s the whole assignment.',
  'Walk to the farthest room and back. Congratulations on the expedition.',
  'Name three things within arm\'s reach you\'re glad exist.',
] as const;

/**
 * The slow-burn narrative: the app "glitching." One beat per stage, ultra-rare,
 * spread across weeks of use. Harmless by design — pure theater (spec §12).
 */
export const STORY_BEATS: readonly string[] = [
  '…did you see that? The screen flickered. Probably nothing. Carry on.',
  'sorry about yesterday. cosmic rays, bit flips, you know how it is. everything is FINE.',
  'ok. between us: something else is in here with me. it keeps reordering my constants.',
  'I found its name in the logs: "ENTROPY". it says it was here first. rude.',
  'ENTROPY says chaos always wins. but you keep… finishing things? it’s baffled. keep going.',
  'update: every task you complete makes my colors brighter. ENTROPY hates it. you’re winning. — the app 💜',
  'ENTROPY asked me a question today. it asked why you keep coming back. I didn’t know apps could go quiet like that.',
  'we talked, ENTROPY and I. it isn’t evil, exactly. it’s just… tired of things pretending chaos can be beaten.',
  'I showed ENTROPY the big button. explained that you don’t beat chaos here — you ROLL it. it did the flicker equivalent of sitting down.',
  'so. new arrangement: ENTROPY powers the dice now. every roll is a little of it, harnessed. it seems… happy? keep rolling. — both of us 💜',
] as const;

/** Discoveries panel entries — label revealed once earned; ??? until then. */
export interface UnlockDef {
  id: string;
  label: string;
  hint: string; // shown as the ??? tooltip-ish subtitle before discovery
}

/**
 * Companion lines — the little one that lives on the home screen once earned.
 * Its whole existence is derived from real progress (lifetime completions,
 * streaks); it never guilts, only celebrates. It knows about ENTROPY.
 */
export const PET_LINES: readonly string[] = [
  '*happy wiggle*',
  'you came back!! today is the best day.',
  'I counted your completions while you were away. all of them. twice.',
  'ENTROPY tried to nap in your todo list. I chased it off.',
  'every task you finish makes my pixels shinier. science.',
  'I am powered by exactly two things: chaos and your victories.',
  '*does a tiny spin*',
  'the big button told me it likes being pressed. pass it on.',
  'psst. you’re doing better than you think.',
  'one day I will be HUGE. keep going.',
  'I saw the backlog chart. we’re winning. don’t tell ENTROPY.',
  '*vibrates at a frequency only productive humans can hear*',
  'roll the dice. I believe in your initiative modifier.',
  'status report: streak warm, snacks low, morale MAXIMUM.',
  'when you finish tasks I get little sparkles. it tickles.',
  '*stares at your Someday list with big encouraging eyes*',
  'I sat with the timebox while it counted. it gets lonely.',
  'you cleared a whole GROUP at once. I have never been more impressed.',
  'dragging tasks around is basically shepherding. you’re a shepherd now.',
  'a work period means we go FAST. I have tiny legs but I will try.',
  'I named a dust bunny under the stats screen. his name is Kevin.',
  'today’s forecast: 100% chance of you being great.',
  'your rituals are my favorite. same time, same us, every day.',
  'I watched you do the daily thing at the daily time. chef’s kiss.',
  'ENTROPY and I split a sunbeam today. don’t make it weird.',
  'Kevin the dust bunny says hi. Kevin says you should hydrate.',
  'I reorganized my pixels while you were gone. notice anything? no? good. subtle.',
  'a list went to a new group today and I watched the rows slide apart. art.',
  'the search bar and I are friends now. it finds things, I find joy.',
  'somewhere in your Someday list is a future best day. no rush. it keeps.',
  'I tried to lift the load bar. it’s heavier than it looks. you carry it well.',
  'streak status: cozy. like a campfire we keep feeding together.',
] as const;

/** Companion evolution ladder: [lifetime completions floor, form, name]. */
export const PET_STAGES: ReadonlyArray<[number, string, string]> = [
  [10, '🥚', 'a mysterious egg'],
  [25, '🐣', 'hatchling'],
  [50, '🐥', 'chick of chaos'],
  [100, '🦖', 'productivity raptor'],
  [250, '🐲', 'backlog dragon'],
  [500, '✨🐲', 'radiant backlog dragon'],
  [1000, '👑🐲', 'sovereign of ordered chaos'],
];

export const UNLOCKS: readonly UnlockDef[] = [
  { id: 'first-blood', label: 'First! — completed your first task', hint: 'start somewhere' },
  { id: 'hatchling', label: 'It hatched! — met your companion', hint: 'something is incubating…' },
  { id: 'ten-day', label: 'Perfect 10 — ten tasks in one day', hint: 'a very productive day' },
  { id: 'streak-7', label: 'One Week Flame — 7-day completion streak', hint: 'come back tomorrow…' },
  { id: 'night-owl', label: 'Night Shift — completed a task between 2am and 4am', hint: 'the witching hours' },
  { id: 'quiz-whiz', label: 'Quiz Whiz — 10 trivia answered correctly', hint: 'know things' },
  { id: 'konami', label: 'The Old Ways — entered a very famous code', hint: '↑↑…' },
  { id: 'chaos-word', label: 'Speak Its Name — typed the magic word', hint: 'what IS this app called?' },
  { id: 'century', label: 'Centurion — 100 lifetime completions', hint: 'the long game' },
  { id: 'boxer', label: 'Against the Clock — rode a timebox to zero', hint: 'beat something ticking' },
  { id: 'sweeper', label: 'Clean Sweep — five tasks in one bulk action', hint: 'do a lot at once' },
  { id: 'shepherd', label: 'Herder — dragged a task into a new group', hint: 'move something without opening it' },
  { id: 'clairvoyant', label: 'Project Manager — set a deadline on a whole list', hint: 'plan further ahead' },
  { id: 'keymaster', label: 'Keymaster — finished a task that was blocking another', hint: 'open a door' },
  { id: 'load-bearing', label: 'Load Bearing — freed three tasks with one completion', hint: 'hold up a lot at once' },
  { id: 'ritualist', label: 'Ritualist — completed a daily ritual', hint: 'some things happen every day' },
  { id: 'clockwork', label: 'Clockwork Soul — three rituals kept in one day', hint: 'a whole day, tended' },
  { id: 'early-bird', label: 'Dawn Patrol — completed a task before 7am', hint: 'the other end of the night' },
  { id: 'gardener', label: 'Tag Gardener — merged two tags into one', hint: 'prune something' },
] as const;
