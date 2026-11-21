import type { Page, Response } from "playwright";
import { describe, expect, test, vi } from "vitest";
import { navigateToPage } from "./navigation.js";

const url = "https://example.com/page";

function createPage() {
  const goto = vi.fn<Page["goto"]>().mockResolvedValue(null);
  const isClosed = vi.fn<() => boolean>().mockReturnValue(false);
  return { goto, isClosed, page: { goto, isClosed } as unknown as Page };
}

describe("navigateToPage", () => {
  test("正常なレスポンスを返し共通のnavigation timeoutを継承する", async () => {
    const { goto, page } = createPage();
    const response = { ok: () => true } as Response;
    goto.mockResolvedValue(response);

    await expect(navigateToPage(page, url)).resolves.toBe(response);
    expect(goto).toHaveBeenCalledExactlyOnceWith(url, { waitUntil: "domcontentloaded" });
  });

  test.each(["net::ERR_ABORTED", "page.goto: Timeout 120000ms exceeded."])(
    "%sの後に再遷移して復旧する",
    async (message) => {
      const { goto, page } = createPage();
      goto.mockRejectedValueOnce(new Error(message));

      await expect(navigateToPage(page, url, { retryDelayMs: 0 })).resolves.toBeNull();
      expect(goto).toHaveBeenCalledTimes(2);
    },
  );

  test("2回の中断後でも3回目の成功を返す", async () => {
    const { goto, page } = createPage();
    goto.mockRejectedValueOnce(new Error("net::ERR_ABORTED"));
    goto.mockRejectedValueOnce(new Error("net::ERR_ABORTED"));

    await expect(navigateToPage(page, url, { retryDelayMs: 0 })).resolves.toBeNull();
    expect(goto).toHaveBeenCalledTimes(3);
  });

  test("中断が続く場合は3回で打ち切り最後のエラーを返す", async () => {
    const { goto, page } = createPage();
    const error = new Error("net::ERR_ABORTED");
    goto.mockRejectedValue(error);

    await expect(navigateToPage(page, url, { retryDelayMs: 0 })).rejects.toBe(error);
    expect(goto).toHaveBeenCalledTimes(3);
  });

  test.each(["Page crashed", "net::ERR_NAME_NOT_RESOLVED", "Target closed"])(
    "%sは再試行せず元のエラーを返す",
    async (message) => {
      const { goto, page } = createPage();
      const error = new Error(message);
      goto.mockRejectedValue(error);

      await expect(navigateToPage(page, url, { retryDelayMs: 0 })).rejects.toBe(error);
      expect(goto).toHaveBeenCalledTimes(1);
    },
  );

  test("閉じたページは中断エラーでも再試行しない", async () => {
    const { goto, isClosed, page } = createPage();
    const error = new Error("net::ERR_ABORTED");
    goto.mockRejectedValue(error);
    isClosed.mockReturnValue(true);

    await expect(navigateToPage(page, url, { retryDelayMs: 0 })).rejects.toBe(error);
    expect(goto).toHaveBeenCalledTimes(1);
  });

  test("復元処理の短いtimeout指定を全試行で維持する", async () => {
    const { goto, page } = createPage();
    goto.mockRejectedValueOnce(new Error("net::ERR_ABORTED"));

    await navigateToPage(page, url, { timeout: 10000, retryDelayMs: 0 });
    expect(goto).toHaveBeenCalledTimes(2);
    for (const call of goto.mock.calls) {
      expect(call).toEqual([url, { waitUntil: "domcontentloaded", timeout: 10000 }]);
    }
  });

  test("HTTPエラー応答は呼び出し元の検証に渡し再試行しない", async () => {
    const { goto, page } = createPage();
    const response = { ok: () => false } as Response;
    goto.mockResolvedValue(response);

    await expect(navigateToPage(page, url)).resolves.toBe(response);
    expect(goto).toHaveBeenCalledTimes(1);
  });
});
