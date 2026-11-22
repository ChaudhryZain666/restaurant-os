import { showsPublicHome } from "./publicHome";

const PRODUCTION = {
  pos: "https://pos.garnishtable.com",
  agency: "https://agency.garnishtable.com",
  platformAdmin: "https://admin.garnishtable.com",
};
const base = { pathname: "/", authLoading: false, signedIn: false, origin: "https://app.garnishtable.com", portals: PRODUCTION };

describe("showsPublicHome (Launch, 2026-11-22)", () => {
  it("a signed-out visitor to the Owner Portal's root gets the public home", () => {
    expect(showsPublicHome(base)).toBe(true);
    expect(showsPublicHome({ ...base, origin: "http://localhost:5174", portals: {} })).toBe(true); // local development
  });

  it("a signed-in user keeps the dashboard (existing layout and RequireAuth)", () => {
    expect(showsPublicHome({ ...base, signedIn: true })).toBe(false);
  });

  it("decides nothing while the session is still loading", () => {
    expect(showsPublicHome({ ...base, authLoading: true })).toBe(false);
  });

  it("only the root path: every other signed-out path still goes to sign-in", () => {
    for (const pathname of ["/orders", "/billing", "/settings", "/login", "/pos"]) {
      expect(showsPublicHome({ ...base, pathname })).toBe(false);
    }
  });

  it("the POS, agency and platform-admin hosts keep going straight to sign-in", () => {
    for (const origin of [PRODUCTION.pos, PRODUCTION.agency, PRODUCTION.platformAdmin]) {
      expect(showsPublicHome({ ...base, origin })).toBe(false);
    }
  });
});
