import { useEffect } from "react";
import { usePageMeta } from "../hooks/usePageMeta";
import { V2Hero } from "../components/v2/V2Hero";
import { ProblemChapter, SystemChapter } from "../components/v2/StoryChapters";
import { GrowChapter, RunChapter, SellChapter } from "../components/v2/PillarChapters";
import {
  DemoChapter,
  FaqChapter,
  FinalChapter,
  PlansChapter,
  WhoChapter,
  WhyChapter,
} from "../components/v2/ClosingChapters";

/**
 * Homepage redesign, under review at `/v2` — the live homepage at `/` is untouched. One story in
 * twelve chapters: Arrival → Problem → System → Sell → Run → Grow → See it → Plans → Who it's for
 * → Why GarnishTable → Questions → Your move. Reuses the real pieces that already work (live demo
 * iframe via ProductShowcase, live pricing via ScaleSelector, FaqItem, HeroBackdrop, GlowMark,
 * product UI mocks) rather than re-implementing them. To promote: point `/` at this component and
 * drop the noindex effect below.
 */
export function HomeV2Page() {
  usePageMeta({
    title: "GarnishTable — Restaurant operating platform for independent restaurants",
    description:
      "Your own ordering storefront, kitchen, POS, delivery, loyalty and analytics in one system — with 0% platform commission on direct orders.",
  });

  // Review-only: keep the preview out of search results until it replaces `/`.
  useEffect(() => {
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex, nofollow";
    document.head.appendChild(tag);
    return () => {
      document.head.removeChild(tag);
    };
  }, []);

  return (
    <div className="theme-obsidian bg-background">
      <V2Hero />
      <ProblemChapter />
      <SystemChapter />
      <SellChapter />
      <RunChapter />
      <GrowChapter />
      <DemoChapter />
      <PlansChapter />
      <WhoChapter />
      <WhyChapter />
      <FaqChapter />
      <FinalChapter />
    </div>
  );
}
