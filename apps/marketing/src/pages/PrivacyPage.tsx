import { Link } from "react-router-dom";
import { LegalPageLayout } from "../components/LegalPageLayout";
import { usePageMeta } from "../hooks/usePageMeta";

const LAST_UPDATED = "September 14, 2026";

export function PrivacyPage() {
  usePageMeta({
    title: "Privacy Policy — GarnishTable",
    description: "How GarnishTable collects, uses, and protects information for restaurant owners, agencies, staff, and their customers.",
  });
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated={LAST_UPDATED} currentPath="/privacy">
      <p>
        This Privacy Policy explains what information GarnishTable (operated by{" "}
        <strong>[LEGAL_ENTITY_NAME]</strong>) collects through the Service, how it is used, and the choices available
        to you. It applies to restaurant owners, agencies, invited staff, and the customers who order through a
        restaurant's storefront.
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
      <p>We share information with the following categories of service providers, only as needed to operate the Service:</p>
      <ul>
        <li>Payment processors, to process subscription billing and customer order payments.</li>
        <li>Email delivery providers, to send account and order-related emails.</li>
        <li>Cloud infrastructure and file-storage providers, to host the application and store uploaded images.</li>
        <li>Geocoding/mapping providers, where a restaurant has delivery enabled, to validate and route delivery addresses.</li>
      </ul>
      <p>
        These providers are only permitted to use the information we share with them to perform services for us,
        not for their own independent purposes. <strong>[FOUNDER/LEGAL REVIEW REQUIRED]</strong> — a complete,
        named subprocessor list should be published here once the production provider set (payment, email, hosting)
        is finalized.
      </p>

      <h2>5. Data retention</h2>
      <p>
        We retain account and order information for as long as an account remains active and for a reasonable period
        afterward to meet legal, accounting, and dispute-resolution obligations. A customer may request deletion of
        their account (see Section 7); where we retain order records after deletion, it is to preserve the accuracy
        of a restaurant's own order and financial history, with personal identifiers removed or minimized where
        possible. <strong>[FOUNDER/LEGAL REVIEW REQUIRED]</strong> — specific retention periods per data category
        should be finalized and stated here.
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
        The Service may be accessed from, and information may be processed in, locations other than your own.{" "}
        <strong>[FOUNDER/LEGAL REVIEW REQUIRED]</strong> — the specific hosting region(s) and any cross-border
        transfer mechanism (e.g. standard contractual clauses) should be documented here once production
        infrastructure is finalized.
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
        <Link to="/contact">contact page</Link>, or by email to <strong>[PRIVACY_CONTACT_EMAIL]</strong>.
      </p>
    </LegalPageLayout>
  );
}
