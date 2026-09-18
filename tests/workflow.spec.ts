import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Case, Dataset } from "../src/types/api";

interface Fixtures {
  username: string;
  password: string;
  correction: string;
  cases: Record<string, Case>;
  datasets: Record<string, Dataset>;
}
const fixtures = () =>
  JSON.parse(readFileSync(".e2e/fixtures.json", "utf8")) as Fixtures;
async function login(page: Page) {
  await page.goto("/datasets");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Username").fill(fixtures().username);
  await page.getByLabel("Password").fill(fixtures().password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Datasets", exact: true }),
  ).toBeVisible();
}
async function openCase(page: Page, name: string) {
  await page.goto(`/cases/${fixtures().cases[name].id}`);
  await expect(
    page.getByRole("heading", { name: "Your review" }),
  ).toBeVisible();
}
async function apiGet(page: Page, path: string) {
  const token = await page.evaluate(() =>
    localStorage.getItem("medical-curator-token"),
  );
  const response = await page.request.get(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();
  return response;
}

test("authentication, navigation, draft reuse, approval and logout", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("invalid");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Incorrect username or password",
  );
  await login(page);
  await page
    .getByRole("link", { name: "Approved test dataset", exact: true })
    .click();
  await page.getByRole("link", { name: "Open case_0001" }).click();
  await expect(
    page.getByRole("heading", { name: "3D NIfTI Case" }),
  ).toBeVisible();
  await page.getByLabel("Comment (optional)").fill("Annotation is valid.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved.");
  await page.reload();
  await expect(page.getByLabel("Comment (optional)")).toHaveValue(
    "Annotation is valid.",
  );
  const reviews = await (
    await apiGet(page, `/cases/${fixtures().cases.Approved.id}/reviews`)
  ).json();
  expect(reviews).toHaveLength(1);
  await page
    .getByRole("button", { name: "Submit review", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Review submitted successfully.",
  );
  await expect(page.locator(".case-heading .status")).toHaveText("APPROVED");
  await page.getByRole("link", { name: "Back to cases" }).click();
  await expect(page.locator("tbody .status")).toHaveText("APPROVED");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => localStorage.getItem("medical-curator-token")),
  ).toBeNull();
});

test("correction upload preserves v0 and submits MODIFIED", async ({
  page,
}) => {
  await login(page);
  await openCase(page, "Corrected");
  const original = fixtures().cases.Corrected.current_annotation!;
  const originalBytes = await (
    await apiGet(page, original.url.slice("/api/v1".length))
  ).body();
  await page.getByRole("radio", { name: "MODIFIED", exact: false }).check();
  await page
    .getByRole("button", { name: "Submit review", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Please upload a corrected annotation",
  );
  await page.getByLabel("Correction file").setInputFiles({
    name: "invalid.nii.gz",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("invalid"),
  });
  await page.getByRole("button", { name: "Upload correction" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    await (await apiGet(page, `/cases/${original.case_id}/annotations`)).json(),
  ).toHaveLength(1);
  await page.getByLabel("Correction file").setInputFiles(fixtures().correction);
  await page.getByRole("button", { name: "Upload correction" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Current annotation: v1",
  );
  await expect(page.locator(".annotation-panel .tag")).toHaveText(
    "v1 · Corrected",
  );
  await page.getByLabel("Comment (optional)").fill("Tumor boundary corrected.");
  await page
    .getByRole("button", { name: "Submit review", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Review submitted successfully.",
  );
  await expect(page.locator(".case-heading .status")).toHaveText("MODIFIED");
  const versions = await (
    await apiGet(page, `/cases/${original.case_id}/annotations`)
  ).json();
  expect(
    versions.map((version: { version: number }) => version.version),
  ).toEqual([0, 1]);
  expect(versions[1].parent_id).toBe(original.id);
  expect(
    await (await apiGet(page, original.url.slice("/api/v1".length))).body(),
  ).toEqual(originalBytes);
  const review = (
    await (await apiGet(page, `/cases/${original.case_id}/reviews`)).json()
  )[0];
  expect(review.comment).toBe("Tumor boundary corrected.");
  expect(review.annotation_version_id).toBe(versions[1].id);
});

for (const [name, decision] of [
  ["Needs correction", "NEEDS CORRECTION"],
  ["Rejected", "REJECTED"],
]) {
  test(`${decision} can be submitted without an upload`, async ({ page }) => {
    await login(page);
    await openCase(page, name);
    await page.getByRole("radio", { name: new RegExp(decision) }).check();
    await page
      .getByLabel("Comment (optional)")
      .fill("Segmentation is missing on several slices.");
    await page
      .getByRole("button", { name: "Submit review", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Review submitted successfully.",
    );
    await expect(page.locator(".case-heading .status")).toHaveText(decision);
  });
}

for (const format of ["PNG", "JPEG"]) {
  test(`${format} protected image and annotation file retrieval`, async ({
    page,
  }) => {
    await login(page);
    await openCase(page, format);
    const image = page.getByRole("img", { name: "Case image_0001" });
    await expect(image).toBeVisible();
    expect(
      await image.evaluate(
        (element) => (element as HTMLImageElement).naturalWidth,
      ),
    ).toBe(320);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download annotation v0" }).click();
    expect((await download).suggestedFilename()).toBe("instances.json");
    const item = fixtures().cases[format];
    const document = await (
      await apiGet(page, item.annotation_url!.slice("/api/v1".length))
    ).json();
    await page.getByLabel("Correction file").setInputFiles({
      name: "correction.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(document)),
    });
    await page.getByRole("button", { name: "Upload correction" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Current annotation: v1",
    );
    await page.getByRole("radio", { name: /MODIFIED/ }).check();
    await page
      .getByRole("button", { name: "Submit review", exact: true })
      .click();
    await expect(page.locator(".case-heading .status")).toHaveText("MODIFIED");
    if (format === "PNG")
      await page.screenshot({
        path: "test-results/case-review-desktop.png",
        fullPage: true,
      });
  });
}

test("DICOM metadata, file download, and review without annotations", async ({
  page,
}) => {
  await login(page);
  await openCase(page, "DICOM");
  await expect(
    page.getByRole("heading", { name: "DICOM Series" }),
  ).toBeVisible();
  await expect(
    page.getByText("Generated test series", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /MODIFIED/ })).toBeDisabled();
  await expect(page.getByLabel("Correction file")).toHaveCount(0);
  await page.getByText("Series files (2)", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download slice 1", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("000000.dcm");
  await page
    .getByRole("button", { name: "Submit review", exact: true })
    .click();
  await expect(page.locator(".case-heading .status")).toHaveText("APPROVED");
});

test("another reviewer’s draft locks review and upload actions", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/cases/${fixtures().cases.Locked.id}`);
  await expect(page.getByRole("status")).toContainText(
    "Another reviewer has an open draft",
  );
  await expect(
    page.getByRole("button", { name: "Upload correction" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Submit review", exact: true }),
  ).toHaveCount(0);
});

test("expired token clears the session and redirects to login", async ({
  page,
}) => {
  await login(page);
  await page.evaluate(() =>
    localStorage.setItem("medical-curator-token", "expired"),
  );
  await page
    .getByRole("link", { name: "Approved test dataset", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => localStorage.getItem("medical-curator-token")),
  ).toBeNull();
});

test("case layout fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/cases/${fixtures().cases.Locked.id}`);
  await expect(
    page.getByRole("heading", { name: "3D NIfTI Case" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/case-review-mobile.png",
    fullPage: true,
  });
});
