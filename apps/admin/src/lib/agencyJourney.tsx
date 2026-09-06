/**
 * Portal UX phase — the brief's 5-step provisioning journey (create business -> provision location
 * -> invite owner -> owner completes setup -> restaurant goes live) collapses to 3 REAL,
 * distinguishable states in this product: business/location/owner-invite-or-direct-access are all
 * created together in one atomic transaction (createAgencyBusiness), so they're never meaningfully
 * sequential — showing 5 steps where 3 always complete simultaneously would be padding, not signal.
 * This reflects the actual data (Business.status, the owner's invite-pending flag), not a new
 * status model.
 */
export type JourneyStage = "owner_invite_pending" | "owner_setup" | "live" | "suspended";

export function businessJourneyStage(business: { status: string; ownerInvitePending: boolean }): JourneyStage {
  if (business.status === "suspended") return "suspended";
  if (business.ownerInvitePending) return "owner_invite_pending";
  if (business.status !== "active") return "owner_setup";
  return "live";
}

export const JOURNEY_STAGE_LABEL: Record<JourneyStage, string> = {
  owner_invite_pending: "Waiting on owner",
  owner_setup: "Owner setting up",
  live: "Live",
  suspended: "Suspended",
};

export const JOURNEY_STAGE_TONE: Record<JourneyStage, "warning" | "info" | "success" | "danger"> = {
  owner_invite_pending: "warning",
  owner_setup: "info",
  live: "success",
  suspended: "danger",
};

function StepDot({ done, active }: { done: boolean; active?: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        done ? "bg-success/15 text-success" : active ? "border-2 border-primary text-primary" : "border border-border text-muted"
      }`}
      aria-hidden
    >
      {done ? "✓" : ""}
    </span>
  );
}

/** The fuller, 3-step version for AgencyBusinessDetailPage — created / owner has access / live. */
export function JourneySteps({ stage }: { stage: JourneyStage }) {
  if (stage === "suspended") {
    return <p className="text-sm text-danger">This business has been suspended and is not visible to customers.</p>;
  }
  const ownerReady = stage === "owner_setup" || stage === "live";
  const live = stage === "live";
  return (
    <ol className="flex flex-col gap-2 text-sm">
      <li className="flex items-center gap-2.5">
        <StepDot done />
        <span className="text-foreground">Business and first location created</span>
      </li>
      <li className="flex items-center gap-2.5">
        <StepDot done={ownerReady} active={!ownerReady} />
        <span className={ownerReady ? "text-foreground" : "text-muted"}>
          {ownerReady ? "Owner has access" : "Waiting for the owner to accept their invite"}
        </span>
      </li>
      <li className="flex items-center gap-2.5">
        <StepDot done={live} active={ownerReady && !live} />
        <span className={live ? "text-foreground" : "text-muted"}>
          {live ? "Restaurant is live" : "Owner finishes setup and publishes"}
        </span>
      </li>
    </ol>
  );
}
