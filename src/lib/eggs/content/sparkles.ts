/**
 * SPOILER ZONE — what ENTROPY says when one of its sparkles is found. Each
 * line is said at the moment of finding, so "you found it" is true when it
 * is read. `{n}` is the number found so far, this one included.
 */
export const SPARKLE_FOUND: readonly string[] = [
  'you found today’s sparkle. that makes {n}. ENTROPY is pretending not to be impressed.',
  'sparkle {n}, located. ENTROPY says it was hiding it badly on purpose. it was not.',
  '{n} sparkles. ENTROPY has started a jar for them. the jar is also a sparkle.',
  'found one! ENTROPY made a small noise like a kettle. that’s {n} now.',
  'that’s sparkle number {n}. ENTROPY is already planning tomorrow’s hiding spot. it is giggling.',
  'you have a good eye. {n} sparkles, and ENTROPY is running out of places. (it is not. there are always more places.)',
  'sparkle get! ENTROPY wrote “{n}” on the wall of the den in glitter. the companion licked it.',
];

/** Said instead on the very first find. */
export const SPARKLE_FIRST =
  'you found one of ENTROPY’s sparkles! it hides one somewhere in the app every day. this was the first. ENTROPY is beside itself.';
