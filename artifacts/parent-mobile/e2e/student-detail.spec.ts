import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import type { TestState } from "./global-setup";

function loadState(): TestState {
  const file = path.join(__dirname, ".test-state.json");
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

async function loginAsParent(
  page: import("@playwright/test").Page,
  state: TestState,
) {
  await page.goto("/login");
  await page.getByTestId("username-input").fill(state.parentUsername);
  await page.getByTestId("password-input").fill(state.parentPassword);
  await page.getByTestId("login-button").click();
  await expect(page).toHaveURL(/\/students/, { timeout: 12_000 });
}

test.describe("Student Detail — Three Tabs", () => {
  let state: TestState;

  test.beforeAll(() => {
    state = loadState();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsParent(page, state);

    const studentCard = page.getByTestId(`student-card-${state.studentId}`);
    await expect(studentCard).toBeVisible({ timeout: 10_000 });
    await studentCard.click();

    await expect(page).toHaveURL(
      new RegExp(`/students/${state.studentId}`),
      { timeout: 12_000 },
    );
    await expect(page.getByText(state.studentName)).toBeVisible({ timeout: 8_000 });
  });

  test("student detail header shows the student name and grade", async ({ page }) => {
    await expect(page.getByText(state.studentName)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/Grade 8/)).toBeVisible({ timeout: 5_000 });
  });

  test("Overview tab is the default active tab and renders stats", async ({ page }) => {
    await expect(page.getByTestId("tab-overview")).toBeVisible({ timeout: 8_000 });
    await expect(
      page.getByText(/Avg Score|No progress data/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Assignments tab loads without an error", async ({ page }) => {
    await page.getByTestId("tab-assignments").click();
    await expect(
      page.getByText(/No assignments yet|Due /i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Assessments tab loads without an error", async ({ page }) => {
    await page.getByTestId("tab-assessments").click();
    await expect(
      page.getByText(/No assessments yet|\d+%/),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("all three tabs are reachable and render content without crashing", async ({ page }) => {
    const tabs: Array<{ id: string; contentPattern: RegExp }> = [
      { id: "tab-overview", contentPattern: /Avg Score|No progress data/i },
      { id: "tab-assignments", contentPattern: /No assignments yet|Due /i },
      { id: "tab-assessments", contentPattern: /No assessments yet|\d+%/ },
    ];

    for (const { id, contentPattern } of tabs) {
      await page.getByTestId(id).click();
      await expect(page.getByText(contentPattern)).toBeVisible({ timeout: 10_000 });
    }
  });

  test("back button returns to the student list", async ({ page }) => {
    await expect(page.getByTestId("tab-overview")).toBeVisible({ timeout: 5_000 });
    await page.getByTestId("back-button").click();
    await expect(page).toHaveURL(/\/students$/, { timeout: 10_000 });
    await expect(page.getByText("My Students")).toBeVisible({ timeout: 8_000 });
  });
});
