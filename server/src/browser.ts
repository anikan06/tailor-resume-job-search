import { chromium, type Browser, type BrowserContext } from "playwright";

/**
 * Connects to the user's OWN already-running Chrome (via --remote-debugging-port)
 * instead of launching a fresh, logged-out, Playwright-managed browser.
 *
 * Why: LinkedIn/Naukri/Indeed require being logged in, and we deliberately do
 * NOT want this server to ever hold your passwords. Reusing your real,
 * already-authenticated Chrome session means there's nothing to store and
 * nothing to leak - see README "Browser setup" for the one-time steps to
 * start Chrome with remote debugging enabled.
 *
 * This also means actions genuinely happen as you, in your normal browser -
 * it reduces (does not eliminate) the odds of being flagged as a bot, which
 * is why this is still a NO-AUTO-SUBMIT browser on LinkedIn/Naukri/Indeed
 * regardless (see policy.ts).
 */

let cachedBrowser: Browser | undefined;

export async function getContext(): Promise<BrowserContext> {
  const port = process.env.CHROME_DEBUG_PORT ?? "9222";
  const endpoint = `http://localhost:${port}`;

  if (!cachedBrowser || !cachedBrowser.isConnected()) {
    try {
      cachedBrowser = await chromium.connectOverCDP(endpoint);
    } catch (err) {
      throw new Error(
        `Could not connect to Chrome on ${endpoint}. Run ./chrome-debug.sh from the project folder ` +
          `to open a Chrome window the app can use, log in to LinkedIn there, then retry.`
      );
    }
  }

  const contexts = cachedBrowser.contexts();
  if (contexts.length === 0) {
    throw new Error("Connected to Chrome, but found no open browser context/windows. Open a tab and retry.");
  }
  // The default (first) context is the one holding your real, logged-in profile.
  return contexts[0];
}

export async function newPage() {
  const ctx = await getContext();
  return ctx.newPage();
}
