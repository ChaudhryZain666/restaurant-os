import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Layout } from "./components/Layout";
import { HomeV2Page } from "./pages/HomeV2Page";
import { HomeV3Page } from "./pages/HomeV3Page";
import { ProductPage } from "./pages/ProductPage";
import { SolutionsPage } from "./pages/SolutionsPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { PricingPage } from "./pages/PricingPage";
import { FaqPage } from "./pages/FaqPage";
import { DemoPage } from "./pages/DemoPage";
import { AboutPage } from "./pages/AboutPage";
import { ContactPage } from "./pages/ContactPage";
import { StartTrialPage } from "./pages/StartTrialPage";
import { TermsPage } from "./pages/TermsPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { RefundPolicyPage } from "./pages/RefundPolicyPage";
import { NotFoundPage } from "./pages/NotFoundPage";

/** Scrolls to top on route change, but respects an in-page #anchor (nav dropdown links). */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ block: "start" });
        return;
      }
    }
    window.scrollTo(0, 0);
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
