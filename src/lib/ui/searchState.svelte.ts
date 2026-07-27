/**
 * The search box's text, kept outside the component so navigating to a result
 * and coming back doesn't wipe what you typed.
 */
class SearchQuery {
  value = $state('');
}

export const searchQuery = new SearchQuery();
