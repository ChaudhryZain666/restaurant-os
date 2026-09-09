import { useEffect, useState, type FormEvent } from "react";
import type { Agency } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";
import { useAgencyPermission } from "../hooks/useAgencyPermission";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

/**
 * Phase 58 — the agency's own profile, and Section 12A's white-label domain boundary. Deliberately
 * split into two honestly-scoped halves:
 *
 * 1. Profile (name/description/contact email) — a real, complete CRUD surface against the existing
 *    Agency model, gated on agency.manage (owner-only, mirroring billing.manage's "owner only"
 *    convention already used on AgencyBillingPage).
 *
 * 2. White-label domain — records a candidate domain and verifies OWNERSHIP only, reusing
 *    domainVerification.service.ts's exact DNS-TXT mechanism DomainMapping already established.
 *    This explicitly does NOT enable sending email from the domain or branding invitation emails —
 *    no per-tenant email-sending infrastructure exists in this codebase yet (a single, static
 *    env.EMAIL_FROM sender is used for every email the platform sends, agency-managed or not). The
 *    UI says so directly rather than implying more than what's real — see
 *    docs/agency-white-label-domain.md for the full boundary and what remains deferred.
 */
export function AgencySettingsPage() {
  const { activeAgencyId, agencies, refetchAgencies } = useAgency();
  const canManage = useAgencyPermission("agency.manage");
  const currentAgency = agencies.find((a) => a.id === activeAgencyId);

  const [agency, setAgency] = useState<Agency | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [domainDraft, setDomainDraft] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [domainMessage, setDomainMessage] = useState<string | null>(null);

  async function reload() {
    if (!activeAgencyId) return;
    const { agency: data } = await apiClient.request<{ agency: Agency }>(`/agencies/${activeAgencyId}`);
    setAgency(data);
    setName(data.name);
    setDescription(data.description ?? "");
    setContactEmail(data.contactEmail);
    setDomainDraft(data.domain ?? "");
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgencyId]);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setProfileSaved(false);
    setSavingProfile(true);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}`, {
        method: "PATCH",
        body: { name, description: description || undefined, contactEmail },
      });
      await Promise.all([reload(), refetchAgencies()]);
      setProfileSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSetDomain(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDomainMessage(null);
    setSavingDomain(true);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/domain`, { method: "POST", body: { domain: domainDraft } });
      await reload();
      setDomainMessage("Domain saved. Add the DNS record below, then verify.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingDomain(false);
    }
  }

  async function handleVerifyDomain() {
    setError(null);
    setDomainMessage(null);
    setVerifying(true);
    try {
      const res = await apiClient.request<{ verified: boolean; agency: Agency }>(`/agencies/${activeAgencyId}/domain/verify`, { method: "POST" });
      setAgency(res.agency);
      setDomainMessage(res.verified ? "Domain ownership verified." : "Not verified yet — DNS changes can take time to propagate. Try again shortly.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  if (!activeAgencyId) return null;
  if (loading) return <p className="text-muted">Loading settings...</p>;

  const verificationRecordHost = agency?.domain ? `_tablecloth-verify.${agency.domain}` : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Agency settings</h1>
        <p className="text-sm text-muted">{currentAgency?.name ?? "Agency"}'s profile and branding.</p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {!canManage && <Alert tone="neutral">Only an agency owner can change these settings.</Alert>}

      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-medium text-foreground">Profile</h2>
        <form onSubmit={handleSaveProfile} className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Agency name
            <input required disabled={!canManage} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Description (optional)
            <textarea disabled={!canManage} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Contact email
            <input required type="email" disabled={!canManage} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputClass} />
          </label>
          {canManage && (
            <Button type="submit" size="sm" disabled={savingProfile} className="self-end">
              {savingProfile ? "Saving..." : "Save profile"}
            </Button>
          )}
          {profileSaved && <p className="text-sm text-success sm:col-span-2">Saved.</p>}
        </form>
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium text-foreground">White-label domain</h2>
          <p className="text-sm text-muted">
            Verify that you own a domain (e.g. <span className="font-mono">garnishtable.com</span>) so this agency's identity can
            eventually operate under its own brand.
          </p>
        </div>

        <Alert tone="neutral">
          <p className="text-sm">
            <strong>What this does today:</strong> verifies domain ownership only. <strong>What it does not do yet:</strong> send
            invitation emails, password resets, or any other platform email from this domain, or replace the platform's own login
            pages with a branded experience. Every email this platform sends still comes from one shared address today — that's a
            separate, larger piece of infrastructure this verification is a real first step toward, not a substitute for.
          </p>
        </Alert>

        {domainMessage && <Alert tone={domainMessage.includes("verified") ? "success" : "neutral"}>{domainMessage}</Alert>}

        {agency?.domain && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-foreground">{agency.domain}</span>
            <Badge tone={agency.domainStatus === "verified" ? "success" : "warning"}>
              {agency.domainStatus === "verified" ? "Verified" : "Pending verification"}
            </Badge>
          </div>
        )}

        {agency?.domain && agency.domainStatus !== "verified" && agency.domainVerificationToken && verificationRecordHost && (
          <div className="rounded-lg border border-border bg-background p-3 text-xs">
            <p className="mb-1.5 text-foreground">Add this DNS TXT record, then verify:</p>
            <p className="mb-0.5">
              Host: <code className="rounded bg-black/[0.04] px-1 py-0.5 font-mono">{verificationRecordHost}</code>
            </p>
            <p>
              Value: <code className="rounded bg-black/[0.04] px-1 py-0.5 font-mono">{agency.domainVerificationToken}</code>
            </p>
          </div>
        )}

        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <form onSubmit={handleSetDomain} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm">
                Domain
                <input
                  required
                  value={domainDraft}
                  onChange={(e) => setDomainDraft(e.target.value.toLowerCase())}
                  placeholder="garnishtable.com"
                  className={inputClass}
                />
              </label>
              <Button type="submit" size="sm" variant="secondary" disabled={savingDomain}>
                {savingDomain ? "Saving..." : agency?.domain ? "Change domain" : "Add domain"}
              </Button>
            </form>
            {agency?.domain && agency.domainStatus !== "verified" && (
              <Button size="sm" onClick={handleVerifyDomain} disabled={verifying}>
                {verifying ? "Checking..." : "Verify now"}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
