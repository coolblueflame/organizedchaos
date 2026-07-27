/**
 * "Add to Home Screen" support (2026-07-27 request).
 *
 * Installing is worth nudging: a home-screen launch gets the full viewport,
 * no browser chrome, and its own storage bucket the browser is far less
 * likely to evict — which for a local-first app is the difference between
 * "my tasks are here" and "where did my tasks go".
 *
 * The two platforms could not be less alike:
 *
 *  - Android/Chromium fires `beforeinstallprompt`, which we capture and
 *    replay later against a real button. One tap, done.
 *  - iOS has no such event — verified against current documentation, not
 *    assumed — so the only route is Share → Add to Home Screen, buried below
 *    the share targets where nobody finds it. All we can do is describe it.
 *
 * Anything else (desktop, in-app browsers) gets nothing: an install banner on
 * a device that can't install is just noise.
 */

/** The Chromium-only event; typed here because TS's lib.dom has no definition. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPlatform = 'ios' | 'android' | 'other';

const DISMISS_KEY = 'oc-install-dismissed';

/** iPadOS reports itself as a Mac, so touch capability is the giveaway. */
function detectPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/** Already launched from the home screen? Then there is nothing to suggest. */
function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  // Safari's own non-standard flag, still the only reliable iOS signal.
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

class InstallStore {
  readonly platform: InstallPlatform = detectPlatform();
  installed = $state(detectInstalled());
  /** True once Chromium has offered us a prompt we can replay. */
  canPromptDirectly = $state(false);
  dismissed = $state(false);
  /** The how-to sheet, opened by the banner or from Settings. */
  howToOpen = $state(false);

  private deferred: BeforeInstallPromptEvent | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      this.dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch { /* private mode — just show it */ }

    window.addEventListener('beforeinstallprompt', (e) => {
      // Suppress Chromium's own mini-infobar so our button is the one story.
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.canPromptDirectly = true;
    });
    window.addEventListener('appinstalled', () => {
      this.installed = true;
      this.deferred = null;
      this.canPromptDirectly = false;
    });
  }

  /** Show the nudge only where it can actually lead somewhere. */
  get shouldOfferBanner(): boolean {
    if (this.installed || this.dismissed) return false;
    // The webkit e2e project runs with a real iPhone user agent, so without
    // this every mobile test would render the nudge and every screenshot
    // would include it. Opt in explicitly (OC_INSTALL_BANNER) to test it —
    // same contract the delight layer uses.
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
      let forced = false;
      try {
        forced = localStorage.getItem('OC_INSTALL_BANNER') === '1';
      } catch { /* private mode */ }
      if (!forced) return false;
    }
    return this.platform !== 'other' || this.canPromptDirectly;
  }

  /** Chromium's real install flow. Returns false when we had nothing to replay. */
  async promptInstall(): Promise<boolean> {
    const evt = this.deferred;
    if (!evt) return false;
    // A captured prompt is single-use; drop it either way.
    this.deferred = null;
    this.canPromptDirectly = false;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === 'accepted') this.installed = true;
    return outcome === 'accepted';
  }

  dismiss(): void {
    this.dismissed = true;
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch { /* nothing to do; it just reappears next launch */ }
  }

  /** Settings can bring the instructions back after a dismissal. */
  openHowTo(): void {
    this.howToOpen = true;
  }
}

export const install = new InstallStore();
