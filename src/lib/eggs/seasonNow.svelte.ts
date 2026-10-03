/**
 * The season in force right now, for the screens (see ./seasons). Reads the
 * shared clock, so a season begins or ends on a screen left open across the
 * rollover rather than on the next reload.
 *
 * Under automation seasons stay off unless a test names one in OC_SEASON:
 * otherwise every test run in late October would quietly run in costume,
 * and a test that reads the tagline would pass or fail by the calendar.
 */
import { app } from '../state/app.svelte';
import { clock } from '../ui/clock.svelte';
import { appDayKey } from '../domain/time';
import { activeSeason, namedSeason, seasonOccurrence, seasonalEnabled, type Season } from './seasons';

class SeasonNow {
  /** Today's app-day key. */
  get day(): string {
    return appDayKey(clock.now, app.state.settings.rolloverHour);
  }

  /** The season in force, or null (also until delight progress has loaded, so a switched-off season never flashes). */
  get current(): Season | null {
    if (!app.eggsLoaded) return null;
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
      // The named season stands in for the calendar; the switch still applies.
      const named = typeof localStorage !== 'undefined' ? localStorage.getItem('OC_SEASON') : null;
      return seasonalEnabled(app.eggMarks) ? namedSeason(named) : null;
    }
    return activeSeason(this.day, app.eggMarks);
  }

  /** The ledger key marking this occurrence's letter as opened, or null out of season. */
  get letterKey(): string | null {
    const season = this.current;
    return season ? `mail:season:${seasonOccurrence(season, this.day)}` : null;
  }
}

export const seasonNow = new SeasonNow();
