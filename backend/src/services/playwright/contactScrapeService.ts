import { existsSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { env } from "../../config/env.js";
import { computeContactabilityScore } from "../scoring/scoringService.js";
import type { ContactInfo } from "../../types/contact.js";

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeUrl(input: string): string {
  try {
    return new URL(input, "https://www.youtube.com").toString();
  } catch {
    return input;
  }
}

function buildAboutUrl(channelUrl: string): string {
  const url = new URL(channelUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.startsWith("@")) {
    return `${url.origin}/${parts[0]}/about`;
  }
  if (parts[0] === "channel" && parts[1]) {
    return `${url.origin}/channel/${parts[1]}/about`;
  }
  return `${url.origin}${url.pathname.replace(/\/$/, "")}/about`;
}

function extractEmails(text: string): string[] {
  return unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []);
}

function platformFromUrl(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "website";
  }

  if (/instagram\.com$/.test(host)) return "instagram";
  if (/(x\.com|twitter\.com)$/.test(host)) return "x_twitter";
  if (/tiktok\.com$/.test(host)) return "tiktok";
  if (/facebook\.com$/.test(host)) return "facebook";
  if (/threads\.net$/.test(host)) return "threads";
  if (/linkedin\.com$/.test(host)) return "linkedin";
  if (/discord\.(gg|com)$/.test(host)) return "discord";
  if (/twitch\.tv$/.test(host)) return "twitch";
  if (/patreon\.com$/.test(host)) return "patreon";
  return "website";
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

async function dismissConsent(page: Page): Promise<void> {
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

async function collectLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      (
        globalThis as {
          document?: {
            querySelectorAll: (
              selector: string
            ) => ArrayLike<{ href?: string | null; getAttribute?: (name: string) => string | null }>;
          };
        }
      ).document?.querySelectorAll("a[href]") ?? []
    )
      .map((node) => node.href || node.getAttribute?.("href") || "")
      .filter(Boolean)
  );
}

async function getScopedLinks(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((rootSelector) => {
    const doc = (
      globalThis as {
        document?: {
          querySelectorAll: (selector: string) => ArrayLike<{
            querySelectorAll: (
              selector: string
            ) => ArrayLike<{ href?: string | null; getAttribute?: (name: string) => string | null }>;
          }>;
        };
      }
    ).document;
    const roots = Array.from(doc?.querySelectorAll(rootSelector) ?? []);
    const searchRoots = roots.length
      ? roots
      : [
          {
            querySelectorAll: (nestedSelector: string) =>
              (doc?.querySelectorAll(nestedSelector) ?? []) as ArrayLike<{
                href?: string | null;
                getAttribute?: (name: string) => string | null;
              }>
          }
        ];

    return searchRoots
      .flatMap((root) => Array.from(root.querySelectorAll("a[href]")))
      .map((anchor) => anchor.href || anchor.getAttribute?.("href") || "")
      .filter(Boolean);
  }, selector);
}

async function maybeOpenDetailsDialog(page: Page): Promise<void> {
  const keywords =
    /link|more|details|business|email|\u94fe\u63a5|\u66f4\u591a|\u66f4\u591a\u4fe1\u606f|\u7535\u5b50\u90ae\u4ef6/i;

  try {
    const clicked = await page.evaluate((patternSource) => {
      const candidates = Array.from(
        (
          globalThis as {
            document?: {
              querySelectorAll: (selector: string) => ArrayLike<{ textContent?: string | null; click?: () => void }>;
            };
          }
        ).document?.querySelectorAll('a[href="javascript:void(0);"]') ?? []
      );
      const pattern = new RegExp(patternSource, "i");
      const target =
        candidates.find((anchor) => pattern.test(anchor.textContent || "")) ||
        candidates.find((anchor) => (anchor.textContent || "").trim().length > 0);
      if (!target) return false;
      target.click?.();
      return true;
    }, keywords.source);

    if (clicked) {
      await page.waitForTimeout(2000);
      const popupText = await page.locator("ytd-popup-container").innerText({ timeout: 3000 }).catch(() => "");
      if (/links|more info|business|email|@|\u94fe\u63a5|\u66f4\u591a\u4fe1\u606f|\u7535\u5b50\u90ae\u4ef6/i.test(popupText)) {
        return;
      }
    }
  } catch {
    // Continue with locator fallbacks.
  }

  const triggers = [
    page.locator('a[href="javascript:void(0);"]').filter({ hasText: keywords }).first(),
    page.locator('a[href="javascript:void(0);"]').first(),
    page.locator("yt-channel-external-link-view-model a").first()
  ];

  for (const trigger of triggers) {
    try {
      if (!(await trigger.count())) continue;
      await trigger.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      await trigger.click({ timeout: 2500, force: true });
      await page.waitForTimeout(2000);
      const popupText = await page.locator("ytd-popup-container").innerText({ timeout: 3000 }).catch(() => "");
      if (/links|more info|business|email|@|\u94fe\u63a5|\u66f4\u591a\u4fe1\u606f|\u7535\u5b50\u90ae\u4ef6/i.test(popupText)) {
        return;
      }
    } catch {
      // Try next trigger.
    }
  }
}

interface EmailRevealResult {
  gated: boolean;
  emails: string[];
  reveal_button_found: boolean;
  reveal_button_clicked: boolean;
}

async function maybeRevealEmail(page: Page): Promise<EmailRevealResult> {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const visibleEmails = extractEmails(bodyText);
  if (visibleEmails.length) {
    return {
      gated: false,
      emails: visibleEmails,
      reveal_button_found: false,
      reveal_button_clicked: false
    };
  }

  const revealPattern =
    /view email address|view email|business email|email|\u67e5\u770b\u7535\u5b50\u90ae\u4ef6\u5730\u5740|\u7535\u5b50\u90ae\u4ef6|\u90ae\u4ef6/i;

  const revealButtonCandidates = [
    page.getByText(revealPattern).first(),
    page.getByRole("button", { name: revealPattern }).first(),
    page.locator("button, a").filter({ hasText: revealPattern }).first()
  ];

  let revealButtonFound = false;
  let revealButtonClicked = false;

  for (const revealButton of revealButtonCandidates) {
    try {
      if (!(await revealButton.count())) continue;
      revealButtonFound = true;
      await revealButton.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      await revealButton.click({ timeout: 2500, force: true });
      revealButtonClicked = true;
      await page.waitForTimeout(2000);
      break;
    } catch {
      revealButtonFound = true;
    }
  }

  const afterText = await page.locator("body").innerText().catch(() => "");
  const afterEmails = extractEmails(afterText);
  if (afterEmails.length) {
    return {
      gated: false,
      emails: afterEmails,
      reveal_button_found: revealButtonFound,
      reveal_button_clicked: revealButtonClicked
    };
  }

  const gated =
    /captcha|recaptcha|verify|verification|sign in|not a robot|\u4eba\u673a|\u9a8c\u8bc1|\u63d0\u4ea4/i.test(afterText);
  return {
    gated,
    emails: [],
    reveal_button_found: revealButtonFound,
    reveal_button_clicked: revealButtonClicked
  };
}

function isUsefulChannelLink(link: string, currentChannelUrl: string): boolean {
  const href = normalizeUrl(link);
  if (!href || href.toLowerCase().startsWith("javascript:")) return false;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtube.com" || host === "youtu.be") {
    const currentPath = (() => {
      try {
        return new URL(currentChannelUrl).pathname.replace(/\/$/, "");
      } catch {
        return "";
      }
    })();
    const path = url.pathname.replace(/\/$/, "");
    return path.startsWith("/@") && path !== currentPath;
  }

  return true;
}

function classifyLinks(
  links: string[],
  currentChannelUrl: string
): { social_links: string[]; website_candidates: string[] } {
  const normalized = unique(links.map(normalizeUrl).filter((link) => isUsefulChannelLink(link, currentChannelUrl)));
  return {
    social_links: normalized.filter(
      (link) => platformFromUrl(link) !== "website" && !link.includes("youtube.com") && !link.includes("youtu.be")
    ),
    website_candidates: normalized.filter((link) => platformFromUrl(link) === "website" && !link.includes("youtube.com"))
  };
}

interface BrowserSession {
  page: Page;
  mode: "cdp" | "launch";
  cleanup: () => Promise<void>;
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
      "No CDP browser detected and no local Chrome/Edge executable was found. Start a browser with remote debugging or set BROWSER_EXECUTABLE_PATH."
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

async function createBrowserSession(cdpUrl: string, requireLoggedInBrowser: boolean): Promise<BrowserSession> {
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
      throw new Error(`Contact browser setup failed. CDP: ${cdpMessage}. Launch fallback: ${launchMessage}`);
    }
  }
}

export interface ContactScrapeInput {
  channelUrl: string;
  videoUrl?: string | null;
  cdpUrl?: string;
  requireLoggedInBrowser?: boolean;
  manualAssist?: boolean;
}

export interface ContactScrapeResult extends ContactInfo {
  social_links_json: string;
  social_links: string[];
  automation_note: string | null;
  browser_mode: "cdp" | "launch";
  manual_action_required: boolean;
}

export async function scrapePublicChannelContact(input: ContactScrapeInput): Promise<ContactScrapeResult> {
  const session = await createBrowserSession(input.cdpUrl || env.BROWSER_CDP_URL, input.requireLoggedInBrowser ?? true);
  const { page } = session;
  let keepPageOpen = false;

  try {
    const aboutUrl = buildAboutUrl(input.channelUrl);
    await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await dismissConsent(page);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.mouse.wheel(0, 1000).catch(() => {});
    await page.waitForTimeout(1000);
    await maybeOpenDetailsDialog(page);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const emailResult = await maybeRevealEmail(page);
    const popupLinks = await getScopedLinks(page, "ytd-popup-container");
    const pageLinks = await collectLinks(page);
    const links = popupLinks.length ? popupLinks : pageLinks;
    const { social_links, website_candidates: websiteCandidates } = classifyLinks(links, input.channelUrl);
    const public_email = emailResult.emails[0] ?? extractEmails(bodyText)[0] ?? null;
    const website_url = websiteCandidates[0] ?? null;

    const manualActionRequired = Boolean(
      (input.manualAssist ?? true) &&
        session.mode === "cdp" &&
        !public_email &&
        (emailResult.gated || emailResult.reveal_button_found)
    );
    keepPageOpen = manualActionRequired;

    const contact_status = public_email
      ? "found"
      : emailResult.gated
        ? "gated"
        : social_links.length || website_url
          ? "found"
          : "not_found";

    const contactability_score = computeContactabilityScore({
      publicEmailFound: Boolean(public_email),
      socialLinksFound: social_links.length > 0,
      websiteOrContactPageFound: Boolean(website_url)
    });

    const automation_note = manualActionRequired
      ? emailResult.gated
        ? "Detected an email reveal flow that needs manual verification. The page was left open in your logged-in Chrome. Click 'View email address', complete the verification, then run contact scraping again."
        : "Detected a visible 'View email address' entry but no email was extracted automatically. The page was left open in your logged-in Chrome. Click the email button manually, complete any prompt if shown, then run contact scraping again."
      : null;

    return {
      public_email,
      social_links,
      social_links_json: JSON.stringify(social_links),
      website_url,
      contact_status,
      contactability_score,
      browser_mode: session.mode,
      manual_action_required: manualActionRequired,
      automation_note
    };
  } finally {
    if (!keepPageOpen) {
      await session.cleanup().catch(() => {});
    }
  }
}
