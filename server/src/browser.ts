import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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

const PORT = process.env.CHROME_DEBUG_PORT ?? "9222";
const ENDPOINT = `http://localhost:${PORT}`;
/** Same profile folder as chrome-debug.sh, so logins made either way are shared. */
const PROFILE_DIR = process.env.CHROME_DEBUG_PROFILE ?? join(homedir(), ".job-search-agent", "chrome-profile");

/**
 * `launch: true` starts the app's own Chrome (as chrome-debug.sh does) when it isn't running -
 * only for flows the user just started, like signing in, never for background work.
 */
export async function getContext(opts: { launch?: boolean } = {}): Promise<BrowserContext> {
  if (!cachedBrowser || !cachedBrowser.isConnected()) {
    try {
      cachedBrowser = await chromium.connectOverCDP(ENDPOINT);
    } catch (err) {
      if (!opts.launch) {
        throw new Error(
          `Could not connect to Chrome on ${ENDPOINT}. Run ./chrome-debug.sh from the project folder ` +
            `to open a Chrome window the app can use, log in to LinkedIn there, then retry.`
        );
      }
      cachedBrowser = await launchDebugChrome();
    }
  }

  const contexts = cachedBrowser.contexts();
  if (contexts.length === 0) {
    throw new Error("Connected to Chrome, but found no open browser context/windows. Open a tab and retry.");
  }
  // The default (first) context is the one holding your real, logged-in profile.
  return contexts[0];
}

/**
 * Opens `url` in a small window of its own (e.g. a sign-in popup), starting the app's
 * Chrome first if needed. The caller closes the page, which closes the window.
 */
export async function openPopupWindow(url: string, size = { width: 520, height: 780 }): Promise<Page> {
  const ctx = await getContext({ launch: true });
  const strayTabs = ctx.pages().filter((p) => p.url() === "about:blank");
  const cdp = await cachedBrowser!.newBrowserCDPSession();
  try {
    const opened = ctx.waitForEvent("page", { timeout: 10000 });
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", newWindow: true });
    const page = await opened;
    const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId });
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { ...size, left: 120, top: 80 } });
    // A Chrome we just started opens with an empty tab of its own; the popup replaces it.
    for (const tab of strayTabs) await tab.close().catch(() => undefined);
    await page.bringToFront();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return page;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

function chromeBinary(): string | undefined {
  const candidates = process.env.CHROME_PATH
    ? [process.env.CHROME_PATH]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
      : process.platform === "win32"
        ? [join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"), join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe")]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find((c) => existsSync(c));
}

/** Starts Google Chrome (not Chromium - it's the user's real browser, signed in as them) with remote debugging on the app's own profile, then connects to it. */
async function launchDebugChrome(): Promise<Browser> {
  const binary = chromeBinary();
  if (!binary) throw new Error("Couldn't find Google Chrome. Install it, or set CHROME_PATH to its executable, then retry.");
  mkdirSync(PROFILE_DIR, { recursive: true });
  spawn(
    binary,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE_DIR}`, "--no-first-run", "--no-default-browser-check", "--window-size=520,780", "about:blank"],
    { detached: true, stdio: "ignore" }
  ).unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      return await chromium.connectOverCDP(ENDPOINT);
    } catch {
      // Not listening yet.
    }
  }
  throw new Error(`Started Chrome, but it didn't open port ${PORT}. Close any Chrome using ${PROFILE_DIR} and retry.`);
}

export async function newPage() {
  const ctx = await getContext();
  return ctx.newPage();
}
