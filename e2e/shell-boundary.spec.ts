import { expect, test } from "@playwright/test";

const boundaryWidths = [1_039, 1_040, 1_041, 1_042, 1_119, 1_120, 1_121, 1_199, 1_200, 1_231, 1_232, 1_280];

test("desktop rail grows without making the workspace narrower", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");

  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();

  let previousWorkspaceWidth = 0;
  for (const width of boundaryWidths) {
    await page.setViewportSize({ width, height: 800 });

    const geometry = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect();
      const workspace = document.querySelector<HTMLElement>(".workspace")!.getBoundingClientRect();
      return {
        viewportWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        sidebarWidth: sidebar.width,
        workspaceLeft: workspace.left,
        workspaceWidth: workspace.width,
      };
    });

    expect(geometry.pageWidth, `${width}px has no horizontal page overflow`).toBe(geometry.viewportWidth);
    expect(Math.abs(geometry.workspaceLeft - geometry.sidebarWidth), `${width}px rail and workspace meet`).toBeLessThan(1);
    expect(
      geometry.workspaceWidth,
      `${width}px workspace must not become narrower when the viewport grows`,
    ).toBeGreaterThanOrEqual(previousWorkspaceWidth - 1);
    previousWorkspaceWidth = geometry.workspaceWidth;
  }
});
