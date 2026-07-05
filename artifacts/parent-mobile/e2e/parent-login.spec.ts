import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import type { TestState } from "./global-setup";

function loadState(): TestState {
  const file = path.join(__dirname, ".test-state.json");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

test.describe("Parent Login Flow", () => {
  let state: TestState;

  test.beforeAll(() => {
    state = loadState();
  });

  test("login page renders the Classmate app branding and form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Classmate")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("username-input")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("password-input")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("login-button")).toBeVisible({ timeout: 5_000 });
  });

  test("shows an error for wrong credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("username-input").fill("nonexistent_user_xyz");
    await page.getByTestId("password-input").fill("wrongpassword");
    await page.getByTestId("login-button").click();
    await expect(
      page.getByText(/invalid|incorrect|failed|try again/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("successful login redirects to the student list", async ({ page }) => {
    await page.goto("/login");

    await page.getByTestId("username-input").fill(state.parentUsername);
    await page.getByTestId("password-input").fill(state.parentPassword);
    await page.getByTestId("login-button").click();

    await expect(page).toHaveURL(/\/students/, { timeout: 12_000 });
    await expect(page.getByText("My Students")).toBeVisible({ timeout: 10_000 });
  });

  test("student list shows the linked student card after login", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("username-input").fill(state.parentUsername);
    await page.getByTestId("password-input").fill(state.parentPassword);
    await page.getByTestId("login-button").click();

    await expect(page).toHaveURL(/\/students/, { timeout: 12_000 });

    const studentCard = page.getByTestId(`student-card-${state.studentId}`);
    await expect(studentCard).toBeVisible({ timeout: 10_000 });
    await expect(studentCard.getByText(state.studentName)).toBeVisible();
  });

  test("logout button returns to login page", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("username-input").fill(state.parentUsername);
    await page.getByTestId("password-input").fill(state.parentPassword);
    await page.getByTestId("login-button").click();

    await expect(page).toHaveURL(/\/students/, { timeout: 12_000 });
    await page.getByTestId("logout-button").click();

    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });
});
