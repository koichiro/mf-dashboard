import type { Page, Response } from "playwright";
import { warn } from "../logger.js";

interface NavigationOptions {
  retryDelayMs?: number;
  timeout?: number;
}

/** Retry read-only page navigation; never use for form submission or refresh clicks. */
export async function navigateToPage(
  page: Page,
  url: string,
  options: NavigationOptions = {},
): Promise<Response | null> {
  const maxRetries = 2;
  const { retryDelayMs = 1000, timeout } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await page.goto(url, {
        waitUntil: "domcontentloaded",
        ...(timeout === undefined ? {} : { timeout }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = message.includes("net::ERR_ABORTED") || message.includes("Timeout");
      if (page.isClosed() || !retryable || attempt === maxRetries) throw error;

      warn(`Page navigation interrupted; retrying (${attempt + 1}/${maxRetries})`);
      // Use a process timer so a failed page cannot mask the navigation error.
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}
