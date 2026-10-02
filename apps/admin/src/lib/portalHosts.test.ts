import { portalHomeForOrigin } from "./portalHosts";

const PRODUCTION = {
  pos: "https://pos.garnishtable.com",
  agency: "https://agency.garnishtable.com",
  platformAdmin: "https://admin.garnishtable.com/",
};

describe("portalHomeForOrigin (Phase 85A)", () => {
  it("maps each portal hostname to its own section", () => {
    expect(portalHomeForOrigin("https://pos.garnishtable.com", PRODUCTION)).toBe("/pos");
    expect(portalHomeForOrigin("https://agency.garnishtable.com", PRODUCTION)).toBe("/agency");
    expect(portalHomeForOrigin("https://admin.garnishtable.com", PRODUCTION)).toBe("/platform");
  });

  it("leaves the Owner Portal and unknown hosts on the role-based home", () => {
    expect(portalHomeForOrigin("https://app.garnishtable.com", PRODUCTION)).toBeNull();
    expect(portalHomeForOrigin("http://localhost:5174", PRODUCTION)).toBeNull();
  });

  it("does nothing when no portal hostnames are configured (local development)", () => {
    expect(portalHomeForOrigin("https://pos.garnishtable.com", {})).toBeNull();
  });
});
