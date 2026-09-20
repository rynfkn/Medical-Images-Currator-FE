import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Case, Dataset } from "../src/types/api";
import { pairFiles } from "../src/pairing";

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
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
}
async function openCase(page: Page, name: string) {
  await page.goto(`/cases/${fixtures().cases[name].id}`);
  await expect(
    page.getByRole("heading", { name: "Your review" }),
  ).toBeVisible();
}
/** The viewer paints every format onto one canvas, so this is the common check. */
async function expectViewer(page: Page) {
  // The first visit decodes the volume into the slice cache, which can take a moment.
  await expect(page.locator(".viewer-stage canvas")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".viewer-readout")).toContainText("Axial");
  await expect(
    page.locator(".viewer-badge").filter({ hasText: "Loading" }),
  ).toHaveCount(0);
  await expect(page.locator(".viewer-stage [role=alert]")).toHaveCount(0);
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
  await expectViewer(page);
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
  await page.getByRole("link", { name: "Back to files" }).click();
  await expect(page.locator(".file-card .status")).toHaveText("APPROVED");
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
    "corrected annotation before submitting MODIFIED",
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
    await expectViewer(page);
    // A 2D raster case is a single-slice volume, so there is one plane only.
    await expect(page.locator(".viewer-readout")).toContainText("Axial 1/1");
    await expect(page.locator(".viewer-bar")).not.toContainText("Coronal");
    // The canvas must actually contain the overlay, not just exist while requests fail.
    const centerPixel = () =>
      page.locator(".viewer-stage canvas").evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
        return [
          ...canvas
            .getContext("2d")!
            .getImageData(
              Math.floor(canvas.width / 2),
              Math.floor(canvas.height / 2),
              1,
              1,
            ).data,
        ];
      });
    const withMask = await centerPixel();
    await page.getByRole("button", { name: "Visible", exact: true }).click();
    await expect.poll(centerPixel).not.toEqual(withMask);
    await page.getByRole("button", { name: "Hidden", exact: true }).click();
    await expect.poll(centerPixel).toEqual(withMask);
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

test("HTML from a misconfigured API shows a useful login error", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>Frontend fallback</body></html>",
    }),
  );
  await page.goto("/login");
  await page.getByLabel("Username").fill(fixtures().username);
  await page.getByLabel("Password").fill(fixtures().password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "web page instead of API data",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("medical-curator-token")),
  ).toBeNull();
});

test("DICOM metadata, file download, and review without annotations", async ({
  page,
}) => {
  await login(page);
  await openCase(page, "DICOM");
  await expectViewer(page);
  await expect(
    page.getByText("Generated test series", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /MODIFIED/ })).toBeDisabled();
  await expect(page.getByLabel("Correction file")).toHaveCount(0);
  await page.getByText("DICOM slices (2)", { exact: true }).click();
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
  await expect(page.locator(".notice")).toContainText(
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
  await expectViewer(page);
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

test("brush edits are saved as a new NIfTI version", async ({ page }) => {
  await login(page);
  await openCase(page, "Needs correction");
  await expectViewer(page);
  const item = fixtures().cases["Needs correction"];
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  const stage = page.locator(".viewer-stage canvas");
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 6);
  await page.mouse.up();
  await expect(page.getByText("Unsaved changes")).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "Save segmentation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Segmentation saved as version v1",
  );
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  const versions = await (
    await apiGet(page, `/cases/${item.id}/annotations`)
  ).json();
  expect(
    versions.map((version: { version: number }) => version.version),
  ).toEqual([0, 1]);
});

test("leaving with unsaved edits asks before discarding them", async ({
  page,
}) => {
  await login(page);
  await openCase(page, "Rejected");
  await expectViewer(page);
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  const box = (await page.locator(".viewer-stage canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.getByText("Unsaved changes")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Back to files" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("unsaved segmentation changes");
  await expect(page).toHaveURL(/\/cases\//);
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/datasets\//);
  const versions = await (
    await apiGet(page, `/cases/${fixtures().cases.Rejected.id}/annotations`)
  ).json();
  expect(versions).toHaveLength(1);
});

test("segmentations pair with their image by name", () => {
  const file = (name: string) => new File(["x"], name);
  const images = [file("case_00546.nii.gz"), file("case_00061.nii.gz")];
  const { pairs, unmatched } = pairFiles(images, [
    // KiTS names masks with a suffix; an exact name must still win over it.
    file("case_00546_segmentations_v5.nii.gz"),
    file("case_00061.nii.gz"),
    file("case_99999.nii.gz"),
  ]);
  expect(pairs.map((pair) => pair.label?.name)).toEqual([
    "case_00546_segmentations_v5.nii.gz",
    "case_00061.nii.gz",
  ]);
  expect(unmatched.map((file) => file.name)).toEqual(["case_99999.nii.gz"]);
});
