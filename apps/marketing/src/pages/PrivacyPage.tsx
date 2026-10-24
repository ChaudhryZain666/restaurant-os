import { Link } from "react-router-dom";
import { LegalPageLayout } from "../components/LegalPageLayout";
import { usePageMeta } from "../hooks/usePageMeta";
import { LegalReviewNote } from "../components/LegalReviewNote";
import { LEGAL, SHOW_LEGAL_PENDING_NOTICE } from "../lib/legal";
import { LegalPendingNotice } from "../components/LegalPendingNotice";

const LAST_UPDATED = "October 24, 2026";

export function PrivacyPage() {
  usePageMeta({
    title: "Privacy Policy — GarnishTable",
    description: "How GarnishTable collects, uses, and protects information for restaurant owners, agencies, staff, and their customers.",
  });
  if (SHOW_LEGAL_PENDING_NOTICE) return <LegalPendingNotice title="Privacy Policy" currentPath="/privacy" />;
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated={LAST_UPDATED} currentPath="/privacy">
      <p>
        This Privacy Policy explains what information GarnishTable (operated by{" "}
        <strong>{LEGAL.entityName}</strong>) collects through the Service, how it is used, and the choices available
        to you. It applies to restaurant owners, agencies, invited staff, and the customers who order through a
        restaurant's storefront.
        <LegalReviewNote>
          Confirm that "GarnishTable" accurately identifies the individual proprietor or is clearly disclosed as a
          trading name before publication; it must not imply an unregistered company.
        </LegalReviewNote>
      </p>

      <h2>1. Information we collect</h2>
      <p>We collect the following categories of information:</p>
      <ul>
        <li>
          <strong>Account information</strong> — name, email address, phone number (optional), and password (stored
          as a salted hash, never in plain text) for anyone who creates a login.
        </li>
        <li>
          <strong>Restaurant/business information</strong> — restaurant name, address, business hours, menu content,
          logo and branding assets, and staff role assignments provided by an owner or agency.
        </li>
        <li>
          <strong>Customer/order information</strong> — a customer's name, contact details, delivery address (for
          delivery orders), order history, and loyalty activity where a restaurant offers a loyalty program.
        </li>
        <li>
          <strong>Payment information</strong> — we do not store full payment card numbers. Card details are entered
          directly with our payment processors (see Section 4), who return a payment status and, where applicable, a
          token we use to reference the transaction.
        </li>
        <li>
          <strong>Technical and log information</strong> — IP address, browser/device information, timestamps, and
          request logs, collected for security, rate-limiting, and troubleshooting.
        </li>
        <li>
          <strong>Cookies and local storage</strong> — used to keep you signed in and to remember interface
          preferences (for example, a selected location or a collapsed menu section). We do not use third-party
          advertising trackers on the Service today.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <p>We use the information above to:</p>
      <ul>
        <li>Provide the Service — create and authenticate accounts, display menus, process orders, and route them to the correct restaurant and location.</li>
        <li>Process subscription billing for restaurant owners and agencies, and order payments for customers, through our payment processors.</li>
        <li>Send account-related communications: email verification, password reset, staff invitations, order confirmations, and status updates.</li>
        <li>Maintain the security and integrity of the Service, including detecting and preventing abuse.</li>
        <li>Respond to support requests submitted through our <Link to="/contact">contact page</Link>.</li>
      </ul>
      <p>We do not sell personal information.</p>

      <h2>3. Restaurant and agency data responsibilities</h2>
      <p>
        A restaurant owner or agency using the Service acts as the operator of their own storefront and is
        responsible for how they collect and use their customers' information within the Service (for example, what
        they tell a customer about a loyalty program). GarnishTable processes that data on their behalf to operate
        the platform, and restricts a restaurant's or agency's access to only the data associated with their own
        account — a restaurant never has access to another restaurant's customer data.
      </p>

      <h2>4. Service providers</h2>
      <p>
        Depending on the features enabled and providers configured for the deployment, information may be processed
        by service providers in these categories:
      </p>
      <ul>
        <li>Database and application infrastructure providers, including MongoDB Atlas and Redis services where configured.</li>
        <li>S3-compatible object storage providers for uploaded menu and branding images.</li>
        <li>SMTP email providers for verification, password-reset, invitation, order, and account-related messages.</li>
        <li>Payment providers configured for restaurant order payments, including Stripe or Safepay where enabled, and Paddle for GarnishTable subscription billing if enabled.</li>
        <li>LocationIQ for address autocomplete/geocoding when delivery-address lookup is enabled.</li>
        <li>Anthropic or OpenAI for AI-assisted menu extraction only if that provider is configured and the feature is used.</li>
      </ul>
      <p>
        Information sent to a provider depends on the feature: for example, address text is sent for geocoding,
        uploaded menu content may be sent for menu extraction, and billing identifiers/statuses are exchanged with
        payment providers. Provider processing is subject to their applicable terms and privacy documentation.
        <LegalReviewNote>
          This is a code-derived list of possible integrations, not a verified list of active subprocessors. Confirm
          production values, named vendors, data categories, contractual roles, and provider privacy terms; publish
          only providers actually used. Do not imply every listed integration is active.
        </LegalReviewNote>
      </p>

      <h2>5. Data retention</h2>
      <p>
        We retain personal information for as long as reasonably necessary to provide the Service, maintain account
        and transaction records, address security incidents and disputes, and meet applicable legal obligations.
        When information is no longer required, it should be deleted or de-identified where feasible, subject to
        backups, technical constraints, and lawful retention requirements.
        <LegalReviewNote>
          The implementation does not establish a complete, approved retention schedule. Confirm periods for account
          data, orders, logs, uploaded files, billing records, support requests, backups, and deletion propagation
          before publication. Do not promise a fixed deletion deadline until verified.
        </LegalReviewNote>
      </p>

      <h2>6. Security</h2>
      <p>
        We apply reasonable technical and organizational measures to protect information on the Service — including
        password hashing, access controls scoped to each restaurant/agency's own data, and encrypted connections
        between your browser and our servers. No method of transmission or storage is completely secure, and we
        cannot guarantee absolute security.
      </p>

      <h2>7. Your rights and choices</h2>
      <p>
        Depending on your location, you may have rights to access, correct, or request deletion of your personal
        information, or to object to certain processing. A customer can update their profile and delete their own
        account directly from their account settings. For any other request, or if you are a restaurant owner,
        agency, or staff member, contact us as described in Section 10.
      </p>

      <h2>8. International data considerations</h2>
      <p>
        Because the Service relies on third-party infrastructure and integrations, personal information may be
        processed in countries outside Pakistan, depending on providers and their configured regions.
        <LegalReviewNote>
          The repository does not establish every live region or transfer safeguard. Verify actual production regions,
          international recipients, applicable transfer terms, and safeguards before publication; do not claim a
          specific mechanism without evidence.
        </LegalReviewNote>
      </p>

      <h2>9. Children's privacy</h2>
      <p>
        The Service is intended for use by restaurant owners, agency staff, and adult customers placing food orders.
        It is not directed at children, and we do not knowingly collect personal information from children.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Where a change is material, we will make reasonable
        efforts to notify affected account holders before it takes effect.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about this policy, or requests relating to your personal information, can be sent through our{" "}
        <Link to="/contact">contact page</Link>, or by email to <strong><a href={`mailto:${LEGAL.privacyEmail}`}>{LEGAL.privacyEmail}</a></strong>.
      </p>
    </LegalPageLayout>
  );
}
