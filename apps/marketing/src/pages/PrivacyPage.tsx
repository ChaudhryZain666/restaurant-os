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
      <p>The Service currently uses these service providers to process information on our behalf:</p>
      <ul>
        <li><strong>DigitalOcean</strong> — hosts the servers that run the Service, including its cache, server logs and database backups.</li>
        <li><strong>MongoDB Atlas</strong> (MongoDB, Inc.) — hosts the database that stores accounts, restaurants, menus and orders.</li>
        <li><strong>Brevo</strong> — sends account and order emails (verification, password reset, invitations, order updates).</li>
        <li><strong>Hostinger</strong> — provides our domain name service and the mailboxes that receive email sent to our contact addresses.</li>
        <li><strong>Anthropic</strong> — reads menu files a restaurant uploads for AI-assisted menu import, only when that feature is used.</li>
      </ul>
      <p>
        Some pages also load resources directly from third parties, which receive your browser's IP address and
        standard request information when the page loads: web fonts from <strong>Google Fonts</strong> (our website and
        the restaurant/agency dashboard), the <strong>Paddle</strong> checkout script (the restaurant/agency dashboard)
        and map tiles from <strong>OpenStreetMap</strong> (address maps in the dashboard).
      </p>
      <p>
        Paid subscription billing will be processed by <strong>Paddle</strong>, as merchant of record, once paid plans are
        offered; card payments for restaurant orders by a restaurant's own connected payment provider once online
        payment is offered. We will update this list before adding a new provider.
        <LegalReviewNote>
          Verified against production on 24 October 2026 (read-only): the providers above are the ones configured;
          not configured: Paddle billing, Stripe, Safepay, LocationIQ, OpenAI, object storage, analytics. Still
          unresolved: each provider's contracting entity, data-processing terms and processing locations (other than
          those in Section 8), and whether Paddle.js should load before billing is live.
        </LegalReviewNote>
      </p>
      <h2>5. Data retention</h2>
      <p>
        We retain personal information for as long as reasonably necessary to provide the Service, maintain account
        and transaction records, address security incidents and disputes, and meet applicable legal obligations.
        When information is no longer required, it should be deleted or de-identified where feasible, subject to
        backups, technical constraints, and lawful retention requirements. Database backups are taken daily and kept
        for about 30 days, so deleted information can remain in a backup for up to that long before the backup is
        removed. Server logs are rotated automatically by size.
        <LegalReviewNote>
          Verified (production, read-only): daily backups kept 30 days (GT_BACKUP_KEEP_DAYS=30), stored only on the
          production server (no off-site copy configured); container logs rotate at 10 MB × 3 files. Still
          unresolved: an approved retention schedule for accounts, orders, billing records, support requests and
          uploads; there is no automatic deletion of these today. Do not promise a fixed deletion deadline.
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
        account directly from their account settings: this removes the name, email address, phone number and saved
        addresses from the account and disables sign-in. The contact and delivery details given with past orders
        stay with those orders, as part of the restaurant's order records. For any other request, or if you are a
        restaurant owner, agency, or staff member (these accounts can't be deleted from the settings page), contact
        us as described in Section 11.
      </p>

      <h2>8. International data considerations</h2>
      <p>
        Because the Service relies on third-party infrastructure and integrations, personal information is
        processed in countries outside Pakistan. The servers that run the Service, including their cache, logs and
        backups, are in Frankfurt, Germany. The database is hosted by MongoDB Atlas on Amazon Web Services in
        Mumbai, India. Other providers listed in Section 4 process information in the locations they operate
        from.
        <LegalReviewNote>
          Verified: DigitalOcean droplet region fra1 (Frankfurt) from the server's own metadata; MongoDB Atlas
          region AWS AP_SOUTH_1 (Mumbai, India) from Atlas's own replica-set member tags (25 Oct 2026). Unresolved: Brevo,
          Anthropic, Hostinger, Google Fonts, Paddle and OpenStreetMap processing locations, and any transfer
          safeguards. Do not claim a mechanism without evidence.
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
