import { describe, expect, it } from "@jest/globals";
import { UberEatsProvider } from "./UberEatsProvider.js";

describe("UberEatsProvider capability declaration", () => {
  it("Phase 78 — declares connect.mechanism as oauth_redirect — the one provider with a real merchant-facing authorization_code flow", () => {
    const provider = new UberEatsProvider("client_id", "client_secret");
    expect(provider.capabilities.connect).toEqual({ mechanism: "oauth_redirect" });
  });
});
