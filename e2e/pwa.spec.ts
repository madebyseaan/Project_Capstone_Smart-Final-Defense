import { test, expect, type Page } from "@playwright/test";
import { hasAccount, login } from "./fixtures";

async function fireBeforeInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
    };
    (window as unknown as { __pwaPromptCalled?: boolean }).__pwaPromptCalled = false;
    event.prompt = async () => {
      (window as unknown as { __pwaPromptCalled?: boolean }).__pwaPromptCalled = true;
    };
    event.userChoice = Promise.resolve({ outcome: "dismissed", platform: "test" });
    window.dispatchEvent(event);
  });
}

test.describe("teacher PWA install entry", () => {
  test("shows the install entry, prompts, and hides after dismissal", async ({ page }) => {
    test.skip(!hasAccount("teacher"), "Teacher account is not configured");

    await login(page, "teacher");
    await page.getByRole("link", { name: "Dashboard" }).first().waitFor({ state: "visible" });
    await fireBeforeInstallPrompt(page);

    const installButton = page.getByRole("button", { name: "Install app" });
    await expect(installButton).toBeVisible();
    await installButton.click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __pwaPromptCalled?: boolean }).__pwaPromptCalled,
        ),
      )
      .toBe(true);
    await expect(installButton).toBeHidden();
  });

  test("does not register a service worker in development", async ({ page }) => {
    test.skip(!hasAccount("teacher"), "Teacher account is not configured");

    await login(page, "teacher");
    const registrations = await page.evaluate(async () => {
      const list = await navigator.serviceWorker.getRegistrations();
      return list.map((registration) => registration.scope);
    });
    expect(registrations).toEqual([]);
  });

  test("shows the offline banner and clears it when the connection returns", async ({ page }) => {
    test.skip(!hasAccount("teacher"), "Teacher account is not configured");

    await login(page, "teacher");
    await page.getByRole("link", { name: "Dashboard" }).first().waitFor({ state: "visible" });
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    await expect(
      page.getByText("You are offline. School data will load when the connection returns."),
    ).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(
      page.getByText("You are offline. School data will load when the connection returns."),
    ).toBeHidden({ timeout: 15_000 });
  });
});

test.describe("PWA is teacher-only", () => {
  for (const role of ["admin", "registrar"] as const) {
    test(`${role} has no install entry`, async ({ page }) => {
      test.skip(!hasAccount(role), `${role} account is not configured`);

      await login(page, role);
      await fireBeforeInstallPrompt(page);

      await expect(page.getByRole("button", { name: "Install app" })).toHaveCount(0);
    });
  }
});
