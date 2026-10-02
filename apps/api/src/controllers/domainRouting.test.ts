import { describe, expect, it } from "@jest/globals";
import { customDomainRouting } from "./domain.controller.js";

describe("customDomainRouting (Phase 85A)", () => {
  it("reports that custom domains don't serve traffic while no edge routing target is configured", () => {
    expect(customDomainRouting(undefined)).toEqual({ servingAvailable: false, cnameTarget: null });
    expect(customDomainRouting("   ")).toEqual({ servingAvailable: false, cnameTarget: null });
  });

  it("returns the normalised CNAME target once the edge can serve customer hostnames", () => {
    expect(customDomainRouting("Domains.GarnishTable.com.")).toEqual({ servingAvailable: true, cnameTarget: "domains.garnishtable.com" });
  });
});
