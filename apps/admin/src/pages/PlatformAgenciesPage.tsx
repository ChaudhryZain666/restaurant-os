import { useEffect, useState } from "react";
import type { AgencyEmailSenderStatus, Paginated } from "@restaurant/types";
import { Alert, Badge, Button, Card, Pagination } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { EMAIL_SENDER_STATUS_COPY } from "../lib/whiteLabelCopy";

interface PlatformAgencyRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  businessCount: number;
  memberCount: number;
  domain: string | null;
  domainStatus: "pending_verification" | "verified" | null;
  emailSender: { address: string; status: AgencyEmailSenderStatus; requestedAt: string; failureReason: string | null } | null;
  createdAt: string;
}

/**
 * Platform agencies, and the platform-side step of white-label branded email: authorizing an
 * agency's custom sender address. The email transport is generic SMTP with no verification API, so
 * "Authorize" is the platform team's statement that the SMTP provider account is set up to send for
 * that domain (SPF/DKIM at the provider). The server refuses it unless the agency's domain is
 * DNS-verified and unclaimed by any other agency.
 */
export function PlatformAgenciesPage() {
  const [data, setData] = useState<Paginated<PlatformAgencyRow> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load(p = page) {
    return apiClient
      .request<Paginated<PlatformAgencyRow>>(`/platform/agencies?page=${p}&limit=20`)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    void load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function review(agency: PlatformAgencyRow, decision: "verified" | "failed") {
    let reason: string | undefined;
    if (decision === "failed") {
      reason = window.prompt(`Why can't ${agency.emailSender?.address} be used? The agency will see this.`)?.trim();
      if (!reason) return;
    } else if (
      !window.confirm(
        `Authorize ${agency.emailSender?.address}? Only confirm after the email provider is set up to send for ${agency.domain} (SPF/DKIM records published and the domain approved at the provider).`
      )
    ) {
      return;
    }
    setBusyId(agency.id);
    setError(null);
    try {
      await apiClient.request(`/platform/agencies/${agency.id}/email-sender/review`, { method: "POST", body: { decision, reason } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Agencies</h1>
        <p className="text-sm text-muted">Agencies on the platform, and custom email senders waiting for authorization.</p>
      </div>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {!data ? (
        !error && <p className="text-muted">Loading agencies...</p>
      ) : data.items.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No agencies yet.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Agency</th>
                <th className="px-4 py-2 font-medium">Clients</th>
                <th className="px-4 py-2 font-medium">Domain</th>
                <th className="px-4 py-2 font-medium">Custom email sender</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((agency) => (
                <tr key={agency.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{agency.name}</div>
                    <div className="text-xs text-muted">
                      /{agency.slug} · {agency.status}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{agency.businessCount}</td>
                  <td className="px-4 py-3">
                    {agency.domain ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-mono text-xs">{agency.domain}</span>
                        <Badge tone={agency.domainStatus === "verified" ? "success" : "warning"}>
                          {agency.domainStatus === "verified" ? "Verified" : "Pending"}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {agency.emailSender ? (
                      <div className="flex flex-col items-start gap-1.5">
                        <span className="font-mono text-xs">{agency.emailSender.address}</span>
                        <Badge tone={EMAIL_SENDER_STATUS_COPY[agency.emailSender.status].tone}>
                          {EMAIL_SENDER_STATUS_COPY[agency.emailSender.status].label}
                        </Badge>
                        {agency.emailSender.failureReason && <span className="text-xs text-muted">{agency.emailSender.failureReason}</span>}
                        {agency.emailSender.status === "pending_authorization" && (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => void review(agency, "verified")} disabled={busyId === agency.id}>
                              Authorize
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void review(agency, "failed")} disabled={busyId === agency.id}>
                              Reject
                            </Button>
                          </div>
                        )}
                        {agency.emailSender.status === "verified" && (
                          <Button size="sm" variant="ghost" onClick={() => void review(agency, "failed")} disabled={busyId === agency.id}>
                            Revoke
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">None requested</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {data && (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          hasNextPage={data.hasNextPage}
          hasPreviousPage={data.hasPreviousPage}
          onPageChange={setPage}
          totalLabel={`${data.total} agenc${data.total === 1 ? "y" : "ies"}`}
        />
      )}
    </div>
  );
}
