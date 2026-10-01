import { useEffect } from "react";
import { usePageMeta } from "../hooks/usePageMeta";
import { Arrival } from "../components/v3/Arrival";
import { MovingParts } from "../components/v3/MovingParts";
import { DirectOrdering } from "../components/v3/DirectOrdering";
import { Movement } from "../components/v3/Movement";
import { ControlSurface } from "../components/v3/ControlSurface";
import { Business } from "../components/v3/Business";
import { Network } from "../components/v3/Network";
import { ExperienceIt } from "../components/v3/ExperienceIt";
import { PlanMenu } from "../components/v3/PlanMenu";
import { Decision } from "../components/v3/Decision";
import { Departure } from "../components/v3/Departure";

/**
 * The homepage (`/`). Reviewed at `/v3`, which now redirects here.
 *
 * One continuous film in twelve scenes: Arrival → The Restaurant (moving parts) → The Order
 * (direct vs. marketplace) → The Movement (one order through the system) → The System (one
 * surface) → The Customer & The Business → The Network → Experience It (live demo) → Choose your
 * plan → The Decision (who / why / FAQ) → Departure. The page crosses between a dark cinematic
 * world and a warm parchment one; the crossings are part of the story.
 *
 * Engineering: scroll-scrubbed scenes use native scroll + CSS sticky (no hijacking, no scroll
 * library, no WebGL), so every word is real HTML, nothing blocks first paint, and reduced motion
 * gets each scene's final composition as a static section. Real data where it exists — the live
 * storefront iframe, live plans from the API, the demo restaurant's own photography and menu.
 */
export function HomeV3Page() {
  usePageMeta({
    title: "GarnishTable — Online Ordering for Independent Restaurants",
    description:
      "Restaurant operating technology for independent restaurants: your own direct ordering, kitchen, POS, delivery, loyalty and analytics in one system — with 0% platform commission on direct orders.",
  });

  // Tell the first-load loader in index.html the page is mounted (one of the three things it waits on).
  useEffect(() => {
    (window as Window & { __gtLoader?: { ready: () => void } }).__gtLoader?.ready();
  }, []);

  return (
    <div className="theme-obsidian -mt-[61px]" style={{ background: "#0f0c0d" }}>
      <Arrival />
      <MovingParts />
      <DirectOrdering />
      <Movement />
      <ControlSurface />
      <Business />
      <Network />
      <ExperienceIt />
      <PlanMenu />
      <Decision />
      <Departure />
    </div>
  );
}
