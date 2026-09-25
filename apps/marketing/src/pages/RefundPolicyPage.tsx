import { Link } from "react-router-dom";
import { LegalPageLayout } from "../components/LegalPageLayout";
import { usePageMeta } from "../hooks/usePageMeta";

const LAST_UPDATED = "September 14, 2026";

export function RefundPolicyPage() {
  usePageMeta({
    title: "Refund & Cancellation Policy — GarnishTable",
    description: "How subscription cancellation, trial expiry, and refunds work on GarnishTable, and how they differ from a restaurant's own customer order refunds.",
  });
  return (
    <LegalPageLayout title="Refund & Cancellation Policy" lastUpdated={LAST_UPDATED} currentPath="/refund-policy">
      <p>
        This policy covers <strong>GarnishTable subscription billing</strong> — what a restaurant owner or agency pays
        us for use of the platform. It is separate from a restaurant's own <strong>customer order</strong> refunds,
        covered in Section 6 below.
      </p>

      <h2>1. Free trials</h2>
      <p>
        Where a plan includes a free trial, no payment method is required to start it, and no charge occurs during
        the trial. You may cancel at any time during the trial with immediate effect and no charge. If a trial is not
        cancelled before it ends, your subscription proceeds as described in Section 2 (if you've chosen a plan) or
        simply expires with no charge (if no payment has been set up).
      </p>

      <h2>2. Cancelling a paid subscription</h2>
      <p>
        You can cancel a paid subscription at any time from your account's billing settings. Cancelling an active,
        currently-paid subscription schedules the cancellation to take effect at the end of your current billing
        period — you keep full access through the period you've already paid for, and are not charged again after it
        ends. Cancelling a subscription that has not yet completed a paid period (for example, one still in
        trial, or in a failed-payment state) takes effect immediately.
      </p>
      <p>
        You can reactivate a subscription that's scheduled to cancel at any point before the period ends, at no
        extra charge, and it will continue exactly as before.
      </p>

      <h2>3. What happens when a subscription ends</h2>
      <p>
        Once a subscription ends (by cancellation taking effect, or a trial expiring with no plan selected), the
        account moves to a restricted state: existing data — your menu, order history, and settings — is preserved
        and not deleted, but paid features are no longer accessible until the subscription is reactivated. A new
        subscription can be started at any time.
      </p>

      <h2>4. Renewal</h2>
      <p>
        Paid subscriptions renew automatically for the same billing interval (monthly or yearly) you selected, at the
        then-current price for your plan, unless cancelled before the renewal date as described in Section 2.
      </p>

      <h2>5. Refunds</h2>
      <p>
        <strong>[FOUNDER/LEGAL REVIEW REQUIRED — refund policy not yet finalized.]</strong> A specific refund window
        (for example, a number of days after a charge within which a refund may be requested) has not yet been
        approved and must not be assumed from this page. Until a specific policy is published here, refund requests
        are reviewed individually — contact us as described in Section 8.
      </p>
      <p>The following principles do apply regardless of the final policy above:</p>
      <ul>
        <li>
          <strong>Duplicate or incorrect charges.</strong> If you are charged in error — for example, twice for the
          same billing period — we will correct it and refund the erroneous charge once verified.
        </li>
        <li>
          <strong>Failed payments.</strong> A failed subscription payment does not immediately cancel your
          subscription. Access continues while the payment is retried; if it cannot be recovered, the subscription
          is cancelled and you are not charged further.
        </li>
        <li>
          We do not automatically refund the unused portion of a billing period when you cancel partway through it,
          unless required by applicable law or covered by the finalized policy above.
        </li>
      </ul>

      <h2>6. Customer order refunds (separate from subscription billing)</h2>
      <p>
        A refund for a customer's food or beverage order — for an incorrect, incomplete, or unfulfilled order — is
        between the customer and the restaurant that took the order, not a GarnishTable subscription matter. The
        restaurant that received the order is responsible for handling that request, typically through its own
        connected payment processor's refund mechanism. If you placed a customer order and need a refund, contact the
        restaurant directly.
      </p>

      <h2>7. Payment-provider handling</h2>
      <p>
        Both subscription billing and customer order payments are processed through third-party payment providers.
        Where a refund is approved, it is issued back through the original payment method via that provider, and may
        take several business days to appear depending on your bank or card issuer.
      </p>

      <h2>8. Policy changes and contact</h2>
      <p>
        We may update this policy from time to time, including once the refund window referenced in Section 5 is
        finalized. For a billing question, a refund request, or anything else covered by this page, contact us
        through our <Link to="/contact">contact page</Link>, or by email to <strong>[BILLING_CONTACT_EMAIL]</strong>.
      </p>
    </LegalPageLayout>
  );
}
