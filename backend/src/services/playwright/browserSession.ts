import { existsSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { env } from "../../config/env.js";

export interface BrowserSession {
  page: Page;
  mode: "cdp" | "launch";
  cleanup: () => Promise<void>;
}

function findLocalBrowserExecutable(): string | null {
  const candidates = [
    env.BROWSER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Microsoft\\Edge\\Application\\msedge.exe`
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function connectViaCdp(cdpUrl: string): Promise<BrowserSession> {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30000 });
  const existingContext = browser.contexts()[0];
  const context = existingContext || (await browser.newContext());
  const page = await context.newPage();

  return {
    page,
    mode: "cdp",
    cleanup: async () => {
      await page.close().catch(() => {});
      if (!existingContext) {
        await context.close().catch(() => {});
      }
    }
  };
}

async function launchLocalBrowser(): Promise<BrowserSession> {
  const executablePath = findLocalBrowserExecutable();
  if (!executablePath) {
    throw new Error(
      "No CDP browser detected and no local Chrome/Edge executable was found. Start a browser with remote debugging enabled or set BROWSER_EXECUTABLE_PATH."
    );
  }

  const browser = await chromium.launch({
    executablePath,
    headless: env.PLAYWRIGHT_HEADLESS
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  return {
    page,
    mode: "launch",
    cleanup: async () => {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  };
}

export async function createBrowserSession(cdpUrl: string, requireLoggedInBrowser: boolean): Promise<BrowserSession> {
  try {
    return await connectViaCdp(cdpUrl);
  } catch (error) {
    const cdpMessage = error instanceof Error ? error.message : String(error);
    if (requireLoggedInBrowser) {
      throw new Error(
        `Could not connect to your logged-in Chrome session at ${cdpUrl}. Please start Chrome with remote debugging enabled and keep your logged-in profile open. Original error: ${cdpMessage}`
      );
    }

    try {
      return await launchLocalBrowser();
    } catch (launchError) {
      const launchMessage = launchError instanceof Error ? launchError.message : String(launchError);
      throw new Error(`Browser setup failed. CDP: ${cdpMessage}. Launch fallback: ${launchMessage}`);
    }
  }
}

export async function dismissConsent(page: Page): Promise<void> {
  for (const label of ["Accept all", "I agree", "Accept", "Reject all"]) {
    try {
      const button = page.getByRole("button", { name: label }).first();
      if (await button.count()) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(1000);
        return;
      }
    } catch {
      // Ignore.
    }
  }
}
