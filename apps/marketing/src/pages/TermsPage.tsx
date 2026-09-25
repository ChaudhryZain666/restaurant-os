import { Link } from "react-router-dom";
import { LegalPageLayout } from "../components/LegalPageLayout";
import { usePageMeta } from "../hooks/usePageMeta";

const LAST_UPDATED = "September 14, 2026";

export function TermsPage() {
  usePageMeta({
    title: "Terms of Service — GarnishTable",
    description: "The terms that govern use of GarnishTable's online ordering platform, for restaurant owners, agencies, and their customers.",
  });
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated={LAST_UPDATED} currentPath="/terms">
      <p>
        These Terms of Service ("Terms") govern access to and use of GarnishTable (the "Service"), operated by{" "}
        <strong>[LEGAL_ENTITY_NAME]</strong> ("GarnishTable," "we," "us," or "our"). By creating an account, starting a
        trial, or otherwise using the Service, you agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>1. Acceptance of these Terms</h2>
      <p>
        By registering for an account — as a restaurant owner, an agency, a member of staff invited by either, or a
        customer placing an order through a restaurant's storefront — you confirm that you have read, understood, and
        agree to be bound by these Terms and our{" "}
        <Link to="/privacy">Privacy Policy</Link>. If you are registering on behalf of a business or agency, you
        confirm you have the authority to bind that business or agency to these Terms.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be able to form a legally binding contract to use the Service. If you are registering a restaurant
        or agency, you must be authorized to act on its behalf, and the information you provide about that business
        (name, location, contact details, tax/registration information where collected) must be accurate.
      </p>

      <h2>3. Accounts and account responsibility</h2>
      <p>
        You are responsible for maintaining the confidentiality of your account credentials and for all activity
        that occurs under your account. Notify us promptly if you believe your account has been compromised. We may
        suspend or terminate an account that we reasonably believe is being used fraudulently, abusively, or in
        violation of these Terms.
      </p>

      <h2>4. Restaurant and agency responsibilities</h2>
      <p>
        If you operate a restaurant on the Service, you are solely responsible for: the accuracy of your menu,
        pricing, and availability information; complying with applicable food-safety, labeling, health, and
        licensing laws in your jurisdiction; fulfilling orders placed through your storefront; and any tax
        obligations arising from your sales. If you operate as an agency managing restaurants on the Service, you are
        responsible for the accuracy of the information you provide on a managed restaurant's behalf and for having
        the managed restaurant's authorization to act for it.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose, or in a way that infringes the rights of others.</li>
        <li>Attempt to gain unauthorized access to another restaurant's, agency's, or customer's account or data.</li>
        <li>Interfere with or disrupt the integrity or performance of the Service, including through automated scraping, load testing, or attempts to bypass rate limits or access controls.</li>
        <li>Upload content you do not have the right to use, or content that is fraudulent, misleading, or infringing.</li>
        <li>Reverse-engineer, decompile, or attempt to extract the source code of the Service except as permitted by law.</li>
      </ul>

      <h2>6. Subscriptions, trials, and billing</h2>
      <p>
        Certain features of the Service are offered under paid subscription plans, billed to restaurant owners and
        agencies (not to their customers). Current plan names, prices, and included features are shown at signup and
        in your account's billing settings, and are the version of the terms that applies to your subscription unless
        we notify you of a change in advance. Where a free trial is offered, its length and any card requirement will
        be shown to you before you start it. Subscriptions renew automatically for successive billing periods at the
        then-current price unless cancelled before the renewal date, consistent with the cancellation behavior
        described in our{" "}
        <Link to="/refund-policy">Refund &amp; Cancellation Policy</Link>. Subscription payments are processed by a
        third-party payment provider (see Section 10); we do not store your full payment card details.
      </p>

      <h2>7. Customer orders</h2>
      <p>
        When a customer places an order through a restaurant's storefront on the Service, that order is a transaction
        between the customer and the restaurant (or, where applicable, the restaurant's delivery partner) — GarnishTable
        provides the ordering platform but is not itself the seller of the food or beverages ordered. Payment for
        customer orders is handled by the payment provider connected to that specific restaurant. Order accuracy,
        fulfillment, and any refund of an order are the responsibility of the restaurant fulfilling it, separate from
        the SaaS subscription billing described in Section 6.
      </p>

      <h2>8. Payment-provider relationship</h2>
      <p>
        GarnishTable relies on third-party providers to process both restaurant subscription billing and customer
        order payments. Your use of payment features is also subject to the applicable payment provider's own terms.
        We are not responsible for the acts, omissions, or availability of any third-party payment provider.
      </p>

      <h2>9. Platform availability</h2>
      <p>
        We aim to keep the Service available and reliable, but we do not guarantee uninterrupted or error-free
        operation. The Service may be temporarily unavailable for maintenance, updates, or reasons outside our
        control. We are not liable for losses arising from Service unavailability, except where applicable law
        prevents us from limiting that liability.
      </p>

      <h2>10. Intellectual property</h2>
      <p>
        The Service, including its software, design, and branding, is owned by GarnishTable or its licensors and is
        protected by intellectual property laws. These Terms do not grant you any ownership rights in the Service —
        only a limited, non-exclusive, non-transferable right to use it in accordance with these Terms.
      </p>

      <h2>11. Your content</h2>
      <p>
        You retain ownership of the content you upload to the Service — menu items, descriptions, images, restaurant
        branding, and similar material ("Your Content"). By uploading Your Content, you grant GarnishTable a
        non-exclusive, worldwide license to host, display, and transmit it as necessary to operate the Service on
        your behalf (for example, showing your menu to customers on your storefront). You are responsible for
        ensuring Your Content does not infringe any third party's rights.
      </p>

      <h2>12. Third-party services</h2>
      <p>
        The Service may integrate with or rely on third-party services (for example, payment processors, delivery
        providers, email delivery, or mapping/geocoding services). We are not responsible for the availability,
        accuracy, or conduct of third-party services, which are governed by their own terms.
      </p>

      <h2>13. Disclaimers</h2>
      <p>
        The Service is provided "as is" and "as available," without warranties of any kind, whether express or
        implied, including implied warranties of merchantability, fitness for a particular purpose, and
        non-infringement, except to the extent such disclaimers are not permitted by applicable law.
      </p>

      <h2>14. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by applicable law, GarnishTable will not be liable for any indirect,
        incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or business
        opportunity, arising out of or in connection with your use of the Service. <strong>[FOUNDER/LEGAL REVIEW
        REQUIRED]</strong> — a specific liability cap (e.g. fees paid in a preceding period) should be set once the
        commercial and legal structure is finalized.
      </p>

      <h2>15. Termination</h2>
      <p>
        You may stop using the Service at any time and may cancel a paid subscription as described in our{" "}
        <Link to="/refund-policy">Refund &amp; Cancellation Policy</Link>. We may suspend or terminate your access to
        the Service if you materially breach these Terms and do not correct the breach within a reasonable time after
        notice, or immediately in cases of fraud, illegal activity, or a security risk to the Service or other users.
      </p>

      <h2>16. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Where a change is material, we will make reasonable efforts to
        notify affected account holders (for example, by email or an in-product notice) before it takes effect.
        Continued use of the Service after a change takes effect constitutes acceptance of the updated Terms.
      </p>

      <h2>17. Governing law</h2>
      <p>
        These Terms are governed by the laws of <strong>[GOVERNING_JURISDICTION]</strong>, without regard to its
        conflict-of-laws principles. <strong>[FOUNDER/LEGAL REVIEW REQUIRED]</strong> — final governing jurisdiction
        and dispute-resolution mechanism (courts vs. arbitration) should be confirmed with counsel before launch.
      </p>

      <h2>18. Contact</h2>
      <p>
        Questions about these Terms can be sent through our <Link to="/contact">contact page</Link>, or by email to{" "}
        <strong>[LEGAL_CONTACT_EMAIL]</strong>.
      </p>
    </LegalPageLayout>
  );
}
