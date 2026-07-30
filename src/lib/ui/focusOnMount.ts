/**
 * Focus an input the moment it mounts, caret at the end.
 *
 * The `autofocus` ATTRIBUTE is not this: Chromium honours it only for
 * elements present at document load, so every dynamically-inserted inline
 * editor that relied on it mounted with a dead keyboard — the focused element
 * stayed whatever BUTTON opened the editor, typing went nowhere, Enter
 * re-pressed the button, and Escape bubbled from it into the document-level
 * dismiss. (Caught because keyboard.type in an e2e types into the real
 * activeElement; fill() focuses explicitly and masked it for months.)
 */
export function focusOnMount(node: HTMLInputElement): void {
  node.focus();
  const end = node.value.length;
  try {
    node.setSelectionRange(end, end);
  } catch {
    /* number/date inputs disallow selection — focus alone is the point */
  }
}
