import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { lazy, useEffect } from "react";
import type { ComponentType } from "react";
import { Layout } from "./components/Layout";
import { HomeV3Page } from "./pages/HomeV3Page";
import { NotFoundPage } from "./pages/NotFoundPage";

// The homepage (the LCP-critical route) and the 404 ship in the main bundle; every other page is
// its own chunk, fetched on first visit, so the homepage doesn't download the whole site.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const HomeV2Page = page(() => import("./pages/HomeV2Page"), "HomeV2Page");
const ProductPage = page(() => import("./pages/ProductPage"), "ProductPage");
const SolutionsPage = page(() => import("./pages/SolutionsPage"), "SolutionsPage");
const HowItWorksPage = page(() => import("./pages/HowItWorksPage"), "HowItWorksPage");
const PricingPage = page(() => import("./pages/PricingPage"), "PricingPage");
const FaqPage = page(() => import("./pages/FaqPage"), "FaqPage");
const DemoPage = page(() => import("./pages/DemoPage"), "DemoPage");
const AboutPage = page(() => import("./pages/AboutPage"), "AboutPage");
const ContactPage = page(() => import("./pages/ContactPage"), "ContactPage");
const StartTrialPage = page(() => import("./pages/StartTrialPage"), "StartTrialPage");
const TermsPage = page(() => import("./pages/TermsPage"), "TermsPage");
const PrivacyPage = page(() => import("./pages/PrivacyPage"), "PrivacyPage");
const RefundPolicyPage = page(() => import("./pages/RefundPolicyPage"), "RefundPolicyPage");

/** Scrolls to top on route change, but respects an in-page #anchor (nav dropdown and footer
 *  links). Lazy pages render their anchors only once their chunk arrives, so a missing target is
 *  watched for briefly instead of silently giving up. */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    const jump = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "start" });
      return !!el;
    };
    if (jump()) return;
    window.scrollTo(0, 0);
    const observer = new MutationObserver(() => {
      if (jump()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const giveUp = window.setTimeout(() => observer.disconnect(), 4000);
    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
    };
  }, [pathname, hash]);
  return null;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeV3Page />} />
          {/* Homepage redesign under review — not linked from Nav, noindex. See HomeV2Page.tsx. */}
          <Route path="/v2" element={<HomeV2Page />} />
          {/* The review URL for what is now the homepage — keep old links working. */}
          <Route path="/v3" element={<Navigate to="/" replace />} />
          <Route path="/product" element={<ProductPage />} />
          <Route path="/solutions" element={<SolutionsPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/start-trial" element={<StartTrialPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund-policy" element={<RefundPolicyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
