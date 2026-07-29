/**
 * The search box's text, kept outside the component so navigating to a result
 * and coming back doesn't wipe what you typed. Persistence is for RETURNING;
 * every fresh entry into search (home tap, "/" or Cmd/Ctrl+K from another
 * screen) calls beginFresh() first — a second search in the same session
 * shouldn't start by deleting the first one's text.
 */
class SearchQuery {
  value = $state('');

  /** Start a brand-new search: clear whatever the last session typed. */
  beginFresh(): void {
    this.value = '';
  }
}

export const searchQuery = new SearchQuery();
