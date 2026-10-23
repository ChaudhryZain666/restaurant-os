import { useEffect, useState, type FormEvent } from "react";
import { AGENCY_WHITE_LABEL_FEATURES, type Agency, type AgencyWhiteLabelFeature } from "@restaurant/types";
import { EMAIL_SENDER_STATUS_COPY, WHITE_LABEL_FEATURE_COPY } from "../lib/whiteLabelCopy";
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
  const [brandName, setBrandName] = useState("");
  const [brandPrimaryColor, setBrandPrimaryColor] = useState("#6B2130");
  const [logo, setLogo] = useState("");
  const [whiteLabelEnabled, setWhiteLabelEnabled] = useState(false);
  const [whiteLabelOfferings, setWhiteLabelOfferings] = useState<AgencyWhiteLabelFeature[]>([]);
  const [supportEmail, setSupportEmail] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [senderDraft, setSenderDraft] = useState("");
  const [savingSender, setSavingSender] = useState(false);
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
    setBrandName(data.brandName ?? data.name);
    setBrandPrimaryColor(data.brandPrimaryColor ?? "#6B2130");
    setLogo(data.logo ?? "");
    setWhiteLabelEnabled(Boolean(data.whiteLabelEnabled));
    setWhiteLabelOfferings(data.whiteLabelOfferings ?? []);
    setSupportEmail(data.supportEmail ?? "");
    setSupportUrl(data.supportUrl ?? "");
    setSenderDraft(data.emailSender?.address ?? "");
    setDomainDraft(data.domain ?? "");
  }

  async function handleSaveSender(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSavingSender(true);
    try {
      const res = await apiClient.request<{ agency: Agency }>(`/agencies/${activeAgencyId}/email-sender`, {
        method: "PUT",
        body: { address: senderDraft },
      });
      setAgency(res.agency);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingSender(false);
    }
  }

  async function handleRemoveSender() {
    setError(null);
    setSavingSender(true);
    try {
      const res = await apiClient.request<{ agency: Agency }>(`/agencies/${activeAgencyId}/email-sender`, { method: "DELETE" });
      setAgency(res.agency);
      setSenderDraft("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingSender(false);
    }
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
        body: {
          name,
          description: description || undefined,
          contactEmail,
          brandName: brandName.trim() || name,
          brandPrimaryColor,
          // "" clears these on the server; offerings are kept even while white-label mode is off.
          logo: logo.trim(),
          supportEmail: supportEmail.trim(),
          supportUrl: supportUrl.trim(),
          whiteLabelEnabled,
          whiteLabelOfferings,
        },
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

  const verificationRecordHost = agency?.domain ? `_garnishtable-verify.${agency.domain}` : null;

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
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Customer-facing brand name
            <input disabled={!canManage} value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={120} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Logo image URL (optional)
            <input disabled={!canManage} type="url" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://your-domain.com/logo.png" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Brand primary color
            <input disabled={!canManage} type="color" value={brandPrimaryColor} onChange={(e) => setBrandPrimaryColor(e.target.value)} className="h-10 w-full rounded-lg border border-border bg-background p-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Support email (optional)
            <input disabled={!canManage} type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="help@youragency.com" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Support / help URL (optional)
            <input disabled={!canManage} type="url" value={supportUrl} onChange={(e) => setSupportUrl(e.target.value)} placeholder="https://help.youragency.com" className={inputClass} />
          </label>
          <p className="text-xs text-muted sm:col-span-2">
            Logo and help URL must be https. The support contact is shown to customers only for clients with Branded support on.
          </p>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" disabled={!canManage} checked={whiteLabelEnabled} onChange={(e) => setWhiteLabelEnabled(e.target.checked)} />
            Enable white-label mode
          </label>
          <p className="text-xs text-muted sm:col-span-2">
            White-label is optional. With it off, every client uses GarnishTable's standard experience; client choices are kept and
            show as suspended until you turn it back on. Each capability shows its real status per client on the client's page.
          </p>
          {whiteLabelEnabled && (
            <fieldset className="sm:col-span-2 rounded-xl border border-border p-3">
              <legend className="px-1 text-sm font-medium text-foreground">Capabilities available to client restaurants</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {AGENCY_WHITE_LABEL_FEATURES.map((feature) => (
                  <label key={feature} className="flex items-start gap-2 text-sm">
                    <input
                      className="mt-1"
                      type="checkbox"
                      disabled={!canManage}
                      checked={whiteLabelOfferings.includes(feature)}
                      onChange={(e) =>
                        setWhiteLabelOfferings((current) =>
                          e.target.checked ? [...new Set([...current, feature])] : current.filter((item) => item !== feature)
                        )
                      }
                    />
                    <span>
                      <span className="font-medium text-foreground">{WHITE_LABEL_FEATURE_COPY[feature].label}</span>
                      <span className="block text-xs text-muted">{WHITE_LABEL_FEATURE_COPY[feature].description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
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
            <strong>What verifying this domain does:</strong> it proves you own it. Your clients' locations can then use hostnames
            under it (e.g. <span className="font-mono">client.yourdomain.com</span>, added in the location's Settings → Custom
            domain) without a separate DNS proof, no other agency can claim them, and you can request a sender address on it for
            branded emails (below, after platform authorization). <strong>What it doesn't do:</strong> route customers by itself —
            each hostname still needs activating and a DNS record pointing to the platform. Password-reset and verification
            emails always stay on the platform's own address and links.
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

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium text-foreground">Branded email sender</h2>
          <p className="text-sm text-muted">
            Optional. Without one, branded emails go out from the platform's address with your brand name as the sender name.
            A custom address must be on your verified domain and authorized by the platform team before it's ever used.
          </p>
        </div>
        {agency?.emailSender && (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{agency.emailSender.address}</span>
              <Badge tone={EMAIL_SENDER_STATUS_COPY[agency.emailSender.status].tone}>
                {EMAIL_SENDER_STATUS_COPY[agency.emailSender.status].label}
              </Badge>
            </div>
            <p className="text-xs text-muted">
              {EMAIL_SENDER_STATUS_COPY[agency.emailSender.status].help}
              {agency.emailSender.failureReason ? ` Reason: ${agency.emailSender.failureReason}` : ""}
            </p>
          </div>
        )}
        {canManage && (
          <form onSubmit={handleSaveSender} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Sender address
              <input
                required
                type="email"
                value={senderDraft}
                onChange={(e) => setSenderDraft(e.target.value.toLowerCase())}
                placeholder={agency?.domain ? `orders@${agency.domain}` : "Add your domain first"}
                disabled={!agency?.domain}
                className={inputClass}
              />
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={savingSender || !agency?.domain}>
              {savingSender ? "Saving..." : agency?.emailSender ? "Request this address" : "Request sender"}
            </Button>
            {agency?.emailSender && (
              <Button type="button" size="sm" variant="ghost" onClick={handleRemoveSender} disabled={savingSender}>
                Stop using a custom sender
              </Button>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
