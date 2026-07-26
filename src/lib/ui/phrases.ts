/**
 * The Big Button's rotating labels. Same action every time; the copy keeps it
 * fresh (spec §6). Rules: unique, ≤32 chars so the button never wraps, PG,
 * and punchy. Mix of Ben's originals, dev-culture bits, and chaos-agent energy.
 */
export const PHRASES: readonly string[] = [
  // Ben's originals
  "Let's do this.",
  "Let's gooooo!",
  'BEAST MODE',
  "Git 'er done!",
  'Task me!',
  'Crush it!',
  // dev culture
  'sudo make me do it',
  'git commit to something',
  'npm run destiny',
  'deploy yourself',
  'ship it',
  'merge conflict? resolve me',
  'rm -rf procrastination',
  'compile motivation',
  'push to production (of life)',
  '/execute',
  'run the task runner',
  'ctrl+alt+achieve',
  'while(alive) { do }',
  '404: excuses not found',
  'exit vim, enter life',
  'refactor your afternoon',
  'hotfix your day',
  'stack overflow of potential',
  'chmod +x yourself',
  'no scope creep, just scope',
  // dice / chaos
  'roll for initiative',
  'RNG, take the wheel',
  'spin the wheel of fate',
  'the dice abide',
  'chaos, but organized',
  'embrace the entropy',
  'random acts of productivity',
  'let fate decide',
  'shuffle & deal',
  'feeling lucky?',
  'the algorithm has spoken',
  'summon a task',
  'consult the oracle',
  'tempt fate',
  'pull the lever',
  'jackpot incoming',
  // hype
  'One task to rule them all',
  'carpe taskem',
  'unleash the kraken',
  'hero mode: ON',
  'time to cook',
  'lock in.',
  'zero excuses detected',
  'be the storm',
  'full send',
  'send it!!',
  'do the thing',
  'the grind chooses you',
  'productivity go brrr',
  'main character moment',
  'no thoughts, just tasks',
  'winners hit buttons',
  'destiny awaits (probably)',
  'go go go go go',
  "it's task o'clock",
  'insert productivity here',
  'press for greatness',
  'this button loves you',
  'certified fresh task',
  'a wild task appears!',
  "gotta do 'em all",
  'surprise me',
  'dealer, hit me',
  'one more before bed',
  'future you says thanks',
  'the couch is a lie',
  'onwards!',
] as const;

let last = -1;

/** A random phrase, never the same one twice in a row. */
export function nextPhrase(rng: () => number = Math.random): string {
  let i = Math.floor(rng() * PHRASES.length);
  if (i === last) i = (i + 1) % PHRASES.length;
  last = i;
  return PHRASES[i]!;
}
