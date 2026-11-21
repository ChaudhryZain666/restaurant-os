import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// QA-008 — the printed receipt (admin app) showed a broken logo: the demo seed points the logo at
// /restaurant-images/wildwood-kitchen-logo.svg, which only the storefront's public/ folder had.
// Static demo images are served by whichever app renders them, so both apps must carry every one.
const repo = join(process.cwd(), "..", "..");
const seedFiles = ["apps/api/src/scripts/seed-demo-data.ts", "apps/api/src/scripts/demo/wildwoodKitchenCatalog.ts"];

function referencedImages(): string[] {
  const paths = new Set<string>();
  for (const file of seedFiles) {
    const source = readFileSync(join(repo, file), "utf8");
    for (const match of source.matchAll(/"(\/(?:restaurant-images|menu-images)\/[^"]+)"/g)) paths.add(match[1]);
  }
  return [...paths];
}

describe("demo images (QA-008)", () => {
  it("the seed references static images", () => {
    expect(referencedImages()).toContain("/restaurant-images/wildwood-kitchen-logo.svg");
  });

  it.each(["apps/admin/public", "apps/web/public"])("%s serves every image the demo seed references", (publicDir) => {
    const missing = referencedImages().filter((p) => !existsSync(join(repo, publicDir, p)));
    expect(missing).toEqual([]);
  });
});
