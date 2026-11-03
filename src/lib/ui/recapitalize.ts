/**
 * Make the iOS keyboard re-check its capitalization for a freshly focused,
 * empty field.
 *
 * iOS keeps the keyboard's shift state when focus moves from one text field
 * to another in code while the keyboard is already up, so the new field
 * starts in whatever case the last one ended in: each chained checklist item
 * opened in lowercase until a backspace made the keyboard look again
 * (2026-11-03 report). A change to the field's text does the same as that
 * backspace, so once the focus has settled a space goes in and comes back
 * out, a frame apart. Text the reader has started typing is never touched,
 * and devices without touch skip it entirely.
 *
 * @param node The field, already focused (pair with focusOnMount).
 */
export function recapitalize(node: HTMLInputElement): void {
  if (typeof navigator === 'undefined' || !(navigator.maxTouchPoints > 0)) return;
  const stillOurs = (value: string) => document.activeElement === node && node.value === value;
  requestAnimationFrame(() => {
    if (!stillOurs('')) return;
    node.value = ' ';
    node.setSelectionRange(1, 1);
    requestAnimationFrame(() => {
      if (!stillOurs(' ')) return;
      node.value = '';
      node.setSelectionRange(0, 0);
    });
  });
}
