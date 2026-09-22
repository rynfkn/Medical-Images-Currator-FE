import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { BrushPreview } from "../src/components/viewer/brushPreview";

test("brush previews project into every plane and restore erased marks", () => {
  const preview = new BrushPreview([4, 5, 6]);
  // Axial row 1, column 2 corresponds to volume coordinate (1, 3, 3).
  preview.set(2, 3, 6, 1);
  expect([...preview.plane(1, 3)]).toEqual([[10, 1]]);
  expect([...preview.plane(0, 1)]).toEqual([[11, 1]]);
  expect(preview.plane(2, 2).size).toBe(0);
  const previous = preview.plane(2, 3);
  preview.set(1, 3, 10, 0);
  expect([...preview.plane(2, 3)]).toEqual([[6, 0]]);
  preview.restore(2, 3, previous);
  expect([...preview.plane(0, 1)]).toEqual([[11, 1]]);
  preview.removeLabel(1);
  expect([...preview.plane(2, 3)]).toEqual([[6, 0]]);
  preview.clear();
  expect(preview.plane(2, 3).size).toBe(0);
});

test("label filtering and brush feedback remain independent of overlay opacity", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const fixtures = JSON.parse(readFileSync(".e2e/fixtures.json", "utf8"));
  const caseId = fixtures.cases["Label visibility"].id;
  await page.goto("/login");
  await page.getByLabel("Username").fill(fixtures.username);
  await page.getByLabel("Password").fill(fixtures.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/datasets$/);
  await page.goto(`/cases/${caseId}`);
  const canvas = page.locator(".viewer-stage canvas");
  await expect(canvas).toBeVisible();
  const colors = () =>
    canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0,
        teal = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > pixels[i + 1] + 20 && pixels[i] > pixels[i + 2] + 20)
          red++;
        if (pixels[i + 1] > pixels[i] + 20 && pixels[i + 2] > pixels[i] + 20)
          teal++;
      }
      return { red, teal };
    });
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await expect.poll(async () => (await colors()).teal).toBeGreaterThan(100);
  const token = await page.evaluate(() =>
    localStorage.getItem("medical-curator-token"),
  );
  const requestHeaders = { Authorization: `Bearer ${token}` };
  const maskUrl = `/api/v1/viewer/cases/${caseId}/mask/2/3`;
  const originalMask = await (
    await page.request.get(maskUrl, { headers: requestHeaders })
  ).body();

  await page.getByRole("button", { name: "Label 1", exact: true }).click();
  await expect.poll(async () => (await colors()).teal).toBe(0);
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Label 2", exact: true }).click();
  await expect.poll(async () => (await colors()).red).toBe(0);
  await expect.poll(async () => (await colors()).teal).toBeGreaterThan(100);
  // Filtering must not create a segmentation draft or change the stored mask.
  expect(
    await (await page.request.get(maskUrl, { headers: requestHeaders })).body(),
  ).toEqual(originalMask);
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "All labels", exact: true }).click();
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await expect.poll(async () => (await colors()).teal).toBeGreaterThan(100);

  await page.getByRole("slider", { name: /Overlay/ }).press("Home");
  await expect.poll(colors).toEqual({ red: 0, teal: 0 });
  await page.getByLabel("Brush label", { exact: true }).selectOption("1");
  await page.getByRole("slider", { name: /Brush size/ }).press("Home");
  await page.getByRole("slider", { name: /Brush size/ }).press("ArrowRight");
  await page.getByRole("slider", { name: /Brush size/ }).press("ArrowRight");
  const brush = async () => {
    await page.getByLabel("Brush label", { exact: true }).selectOption("1");
    await page.getByRole("button", { name: "Brush", exact: true }).click();
    const box = (await canvas.boundingBox())!;
    const sent = page.waitForResponse(
      (response) =>
        response.url().includes(`/paint/2/3`) &&
        response.request().method() === "POST",
    );
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(0, 0);
    expect((await sent).status()).toBe(204);
    await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
    await expect.poll(async () => (await colors()).teal).toBe(0);
  };
  await brush();
  const centerPixel = () =>
    canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
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
  const brushColor = await centerPixel();
  await page.getByRole("slider", { name: /Overlay/ }).press("End");
  await expect.poll(centerPixel).toEqual(brushColor);
  await page.getByRole("slider", { name: /Overlay/ }).press("Home");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(colors).toEqual({ red: 0, teal: 0 });
  await brush();
  const erasure = page.waitForResponse(
    (response) =>
      response.url().includes(`/paint/2/3`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(0, 0);
  await erasure;
  await expect.poll(colors).toEqual({ red: 0, teal: 0 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);

  await page.getByRole("button", { name: "Next slice", exact: true }).click();
  await expect.poll(colors).toEqual({ red: 0, teal: 0 });
  await page
    .getByRole("button", { name: "Previous slice", exact: true })
    .click();
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await page.getByLabel("Window level", { exact: true }).fill("10");
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Coronal", exact: true }).click();
  await expect(page.locator(".viewer-readout")).toContainText("Coronal");
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Axial", exact: true }).click();
  await page.getByRole("slider", { name: "Slice", exact: true }).press("Home");
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Next slice", exact: true }).click();
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Visible", exact: true }).click();
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Label 2", exact: true }).click();
  await expect.poll(colors).toEqual({ red: 0, teal: 0 });
  await page.getByRole("button", { name: "All labels", exact: true }).click();
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await page.screenshot({
    path: "test-results/brush-zero-overlay.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard changes" })
    .click();
  await expect.poll(colors).toEqual({ red: 0, teal: 0 });
  await brush();
  await page
    .getByRole("button", { name: "Save segmentation", exact: true })
    .click();
  await expect(
    page.getByText("Segmentation saved as version v1.", { exact: true }),
  ).toBeVisible();
  await expect.poll(colors).toEqual({ red: 0, teal: 0 });
  await page.getByRole("slider", { name: /Overlay/ }).press("End");
  await expect.poll(async () => (await colors()).red).toBeGreaterThan(100);
  await expect.poll(async () => (await colors()).teal).toBeGreaterThan(100);
});
