import { describe, expect, it } from "@jest/globals";
import { applyJsonLd, applySeoMeta } from "./seoMeta.js";

function resetHead() {
  document.head.innerHTML = "";
  document.title = "";
}

describe("applySeoMeta", () => {
  it("sets title, description, canonical, OG, and Twitter tags", () => {
    resetHead();
    applySeoMeta({
      title: "Spice Route — Order Online",
      description: "Order online from Spice Route.",
      canonicalUrl: "https://example.com/r/spice-route",
      og: { title: "Spice Route", description: "Order online from Spice Route.", type: "website", url: "https://example.com/r/spice-route", siteName: "GarnishTable", image: "https://example.com/logo.png" },
      twitter: { card: "summary_large_image", title: "Spice Route", description: "Order online from Spice Route.", image: "https://example.com/logo.png" },
    });

    expect(document.title).toBe("Spice Route — Order Online");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("Order online from Spice Route.");
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://example.com/r/spice-route");
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe("Spice Route");
    expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")).toBe("GarnishTable");
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
  });

  it("omits OG/Twitter sub-fields that aren't provided, rather than emitting empty tags", () => {
    resetHead();
    applySeoMeta({ title: "FAQ", description: "Answers to common questions.", canonicalUrl: "https://example.com/faq" });

    expect(document.querySelectorAll('meta[property^="og:"]').length).toBe(0);
    expect(document.querySelectorAll('meta[name^="twitter:"]').length).toBe(0);
  });

  it("updates an existing description tag in place and restores its original content on cleanup", () => {
    resetHead();
    const shellTag = document.createElement("meta");
    shellTag.setAttribute("name", "description");
    shellTag.setAttribute("content", "Shell default description.");
    document.head.appendChild(shellTag);

    const cleanup = applySeoMeta({ title: "Pricing", description: "Simple, transparent pricing.", canonicalUrl: "https://example.com/pricing" });

    expect(document.querySelectorAll('meta[name="description"]').length).toBe(1);
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("Simple, transparent pricing.");

    cleanup();
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("Shell default description.");
  });

  it("creates and removes a description tag when none exists yet", () => {
    resetHead();
    const cleanup = applySeoMeta({ title: "About", description: "Who we are.", canonicalUrl: "https://example.com/about" });
    expect(document.querySelector('meta[name="description"]')).not.toBeNull();

    cleanup();
    expect(document.querySelector('meta[name="description"]')).toBeNull();
  });

  it("cleanup restores the previous title and removes every created element", () => {
    resetHead();
    document.title = "Original Title";
    const cleanup = applySeoMeta({
      title: "New Title",
      description: "New description.",
      canonicalUrl: "https://example.com/",
      og: { title: "New Title" },
      twitter: { card: "summary" },
    });
    expect(document.title).toBe("New Title");

    cleanup();
    expect(document.title).toBe("Original Title");
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:title"]')).toBeNull();
    expect(document.querySelector('meta[name="twitter:card"]')).toBeNull();
  });
});

describe("applyJsonLd", () => {
  it("injects a single application/ld+json script containing the given data", () => {
    resetHead();
    const data = { "@context": "https://schema.org", "@type": "Restaurant", name: "Spice Route" };
    applyJsonLd(data);

    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBe(1);
    expect(JSON.parse(scripts[0].textContent!)).toEqual(data);
  });

  it("cleanup removes the injected script", () => {
    resetHead();
    const cleanup = applyJsonLd({ "@type": "FAQPage" });
    expect(document.querySelector('script[type="application/ld+json"]')).not.toBeNull();

    cleanup();
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  });
});
