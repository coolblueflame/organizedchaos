/**
 * Focus an element the moment it mounts; a text field also gets its caret
 * placed at the end.
 *
 * The `autofocus` ATTRIBUTE is not this: Chromium honours it only for
 * elements present at document load, so every dynamically-inserted inline
 * editor that relied on it mounted with a dead keyboard — the focused element
 * stayed whatever BUTTON opened the editor, typing went nowhere, Enter
 * re-pressed the button, and Escape bubbled from it into the document-level
 * dismiss. (Caught because keyboard.type in an e2e types into the real
 * activeElement; fill() focuses explicitly and masked it for months.)
 */
export function focusOnMount(node: HTMLElement): void {
  node.focus();
  // Caret placement is for text fields; anything else (a dialog's OK button)
  // just wants the focus, so it can be answered from the keyboard.
  if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement)) return;
  const end = node.value.length;
  try {
    node.setSelectionRange(end, end);
  } catch {
    /* number/date inputs disallow selection — focus alone is the point */
  }
}
