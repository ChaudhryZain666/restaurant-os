import { LegalPageLayout } from "./LegalPageLayout";
import { useNoIndex } from "../hooks/useNoIndex";

/**
 * Phase 89 (option C) — what a legal page shows in production while the founder-supplied legal
 * facts (src/lib/legal.ts) are not configured: the page's own title and a plain statement that the
 * document is not published yet. Deliberately contains no entity name, jurisdiction, contact
 * address or policy wording, never claims the documents are final or reviewed, and is noindexed so
 * the placeholder never becomes a search result. The missing configuration stays a tracked launch
 * blocker (/version.json legalConfigured:false, smoke-test warning).
 */
export function LegalPendingNotice({ title, currentPath }: { title: string; currentPath: string }) {
  useNoIndex();
  return (
    <LegalPageLayout title={title} currentPath={currentPath}>
      <p data-legal-status="pending">
        Legal documents are being finalized. This page will be published here before paid plans are offered.
      </p>
    </LegalPageLayout>
  );
}
