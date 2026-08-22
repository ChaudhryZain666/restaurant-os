import { useEffect, useState } from "react";
import type { Address, GeocodeResult } from "@restaurant/types";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { AddressAutocomplete } from "../components/AddressAutocomplete";
import { useNoIndex } from "../hooks/useNoIndex";

const emptyForm = {
  label: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  latitude: "",
  longitude: "",
};
type AddressForm = typeof emptyForm;
const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

function formFromAddress(a: Address): AddressForm {
  return {
    label: a.label ?? "",
    line1: a.line1,
    line2: a.line2 ?? "",
    city: a.city,
    state: a.state ?? "",
    postalCode: a.postalCode ?? "",
    country: a.country ?? "",
    latitude: a.latitude != null ? String(a.latitude) : "",
    longitude: a.longitude != null ? String(a.longitude) : "",
  };
}

export function AccountPage() {
  useNoIndex();
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manualCoords, setManualCoords] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailChangePassword, setEmailChangePassword] = useState("");
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState<string | null>(null);
  const [emailChangeMessage, setEmailChangeMessage] = useState<string | null>(null);

  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ addresses: Address[] }>("/users/me/addresses")
      .then((data) => setAddresses(data.addresses))
      .catch((err) => setAddressError((err as Error).message))
      .finally(() => setAddressesLoading(false));
  }, []);

  async function saveProfile() {
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      await updateProfile({ name, phone: phone || undefined });
      setProfileSaved(true);
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  /** Only ever called with a server-resolved geocoding result (see AddressAutocomplete) — never
   *  invents coordinates from whatever the customer had typed into the structured fields below. */
  function applyGeocodeResult(result: GeocodeResult) {
    setForm((prev) => ({
      ...prev,
      line1: result.components?.line1 || prev.line1,
      city: result.components?.city || prev.city,
      state: result.components?.state ?? prev.state,
      postalCode: result.components?.postalCode ?? prev.postalCode,
      country: result.components?.country ?? prev.country,
      latitude: String(result.latitude),
      longitude: String(result.longitude),
    }));
    setManualCoords(false);
  }

  function startAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setManualCoords(false);
    setAddressError(null);
  }

  function startEdit(address: Address) {
    setEditingId(address.id);
    setForm(formFromAddress(address));
    setManualCoords(address.latitude != null);
    setAddressError(null);
  }

  async function saveAddress() {
    if (!form.line1.trim() || !form.city.trim()) {
      setAddressError("Street address and city are required");
      return;
    }
    setSavingAddress(true);
    setAddressError(null);
    const body = {
      label: form.label || undefined,
      line1: form.line1,
      line2: form.line2 || undefined,
      city: form.city,
      state: form.state || undefined,
      postalCode: form.postalCode || undefined,
      country: form.country || undefined,
      latitude: form.latitude ? Number(form.latitude) : undefined,
      longitude: form.longitude ? Number(form.longitude) : undefined,
    };
    try {
      const data = editingId
        ? await apiClient.request<{ addresses: Address[] }>(`/users/me/addresses/${editingId}`, { method: "PATCH", body })
        : await apiClient.request<{ addresses: Address[] }>("/users/me/addresses", { method: "POST", body });
      setAddresses(data.addresses);
      setForm(emptyForm);
      setEditingId(null);
      setManualCoords(false);
    } catch (err) {
      setAddressError((err as Error).message);
    } finally {
      setSavingAddress(false);
    }
  }

  async function deleteAddress(address: Address) {
    const label = address.label || [address.line1, address.city].filter(Boolean).join(", ");
    if (!window.confirm(`Remove the saved address "${label}"?`)) return;
    setAddressError(null);
    try {
      const data = await apiClient.request<{ addresses: Address[] }>(`/users/me/addresses/${address.id}`, {
        method: "DELETE",
      });
      setAddresses(data.addresses);
      if (editingId === address.id) startAdd();
    } catch (err) {
      setAddressError((err as Error).message);
    }
  }

  async function makeDefault(id: string) {
    setAddressError(null);
    try {
      const data = await apiClient.request<{ addresses: Address[] }>(`/users/me/addresses/${id}`, {
        method: "PATCH",
        body: { isDefault: true },
      });
      setAddresses(data.addresses);
    } catch (err) {
      setAddressError((err as Error).message);
    }
  }

  async function changePassword() {
    setChangingPassword(true);
    setPasswordError(null);
    setPasswordChanged(false);
    try {
      await apiClient.request("/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setPasswordChanged(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordError((err as Error).message);
    } finally {
      setChangingPassword(false);
    }
  }

  async function requestEmailChange() {
    setRequestingEmailChange(true);
    setEmailChangeError(null);
    setEmailChangeMessage(null);
    try {
      const data = await apiClient.request<{ message: string }>("/auth/request-email-change", {
        method: "POST",
        body: { newEmail, currentPassword: emailChangePassword },
      });
      setEmailChangeMessage(data.message);
      setNewEmail("");
      setEmailChangePassword("");
    } catch (err) {
      setEmailChangeError((err as Error).message);
    } finally {
      setRequestingEmailChange(false);
    }
  }

  async function deleteAccount() {
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      await apiClient.request("/auth/me", { method: "DELETE", body: { currentPassword: deletePassword } });
      // A full navigation, not a client-side route change — the access token is in-memory only
      // and the refresh cookie was just cleared server-side, so reloading is what actually drops
      // AuthContext's stale `user` state rather than leaving a "logged in" UI pointed at an
      // account that no longer resolves to anything.
      window.location.href = "/login";
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeletingAccount(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Account</h1>
        <p className="text-sm text-muted">{user?.email}</p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium text-foreground">Profile</h2>
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" className={inputClass} />
        </label>
        {profileError && (
          <Alert tone="danger" role="alert">
            {profileError}
          </Alert>
        )}
        {profileSaved && (
          <Alert tone="success" className="animate-scale-in">
            Saved.
          </Alert>
        )}
        <Button onClick={saveProfile} disabled={savingProfile} className="self-start">
          {savingProfile ? "Saving..." : "Save profile"}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium text-foreground">Saved addresses</h2>
        {addressError && (
          <Alert tone="danger" role="alert">
            {addressError}
          </Alert>
        )}
        {addressesLoading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : addresses.length === 0 ? (
          <p className="text-sm text-muted">No saved addresses yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {addresses.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <div>
                  {a.label && <span className="font-medium">{a.label} — </span>}
                  {[a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}
                  {a.isDefault && <span className="ml-2 text-xs text-muted">(default)</span>}
                  {a.latitude == null && (
                    <button
                      type="button"
                      onClick={() => startEdit(a)}
                      className="ml-2 text-xs font-medium text-warning underline decoration-dotted hover:opacity-80"
                      title="Search for this address to add coordinates for delivery"
                    >
                      No coordinates — set location for delivery
                    </button>
                  )}
                </div>
                <div className="flex shrink-0 gap-3">
                  <button onClick={() => startEdit(a)} className="font-medium text-foreground/70 hover:opacity-80" type="button">
                    Edit
                  </button>
                  {!a.isDefault && (
                    <button onClick={() => makeDefault(a.id)} className="font-medium text-primary hover:opacity-80" type="button">
                      Make default
                    </button>
                  )}
                  <button onClick={() => deleteAddress(a)} className="font-medium text-danger hover:opacity-80" type="button">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">{editingId ? "Edit address" : "Add a new address"}</p>
            {editingId && (
              <button type="button" onClick={startAdd} className="text-xs font-medium text-muted underline hover:text-foreground">
                Cancel edit
              </button>
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Search for an address
            <AddressAutocomplete
              placeholder="Start typing a street, city, or postal code…"
              onSelect={applyGeocodeResult}
              resetKey={editingId ?? "new"}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Label (e.g. Home)"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className={`col-span-2 ${inputClass}`}
            />
            <input
              placeholder="Street address"
              value={form.line1}
              onChange={(e) => setForm({ ...form, line1: e.target.value })}
              className={`col-span-2 ${inputClass}`}
            />
            <input
              placeholder="Apt / suite (optional)"
              value={form.line2}
              onChange={(e) => setForm({ ...form, line2: e.target.value })}
              className={`col-span-2 ${inputClass}`}
            />
            <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputClass} />
            <input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className={inputClass} />
            <input
              placeholder="Postal code"
              value={form.postalCode}
              onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
              className={inputClass}
            />
            <input
              placeholder="Country"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-2.5">
            {form.latitude && form.longitude ? (
              <p className="text-xs text-success">
                Location set — {Number(form.latitude).toFixed(4)}, {Number(form.longitude).toFixed(4)}
              </p>
            ) : (
              <p className="text-xs text-muted">
                No location set yet — search above, or a saved address without one still works, just not for delivery.
              </p>
            )}
            <button
              type="button"
              onClick={() => setManualCoords((v) => !v)}
              className="self-start text-xs font-medium text-primary hover:underline"
            >
              {manualCoords ? "Hide manual coordinates" : "Enter coordinates manually instead"}
            </button>
            {manualCoords && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <input
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  placeholder="Latitude"
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                  className={inputClass}
                />
                <input
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  placeholder="Longitude"
                  value={form.longitude}
                  onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                  className={inputClass}
                />
              </div>
            )}
          </div>

          <Button onClick={saveAddress} disabled={savingAddress} variant="secondary" className="self-start">
            {savingAddress ? "Saving..." : editingId ? "Save changes" : "Add address"}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium text-foreground">Change password</h2>
        <label className="flex flex-col gap-1 text-sm">
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>
        {passwordError && (
          <Alert tone="danger" role="alert">
            {passwordError}
          </Alert>
        )}
        {passwordChanged && (
          <Alert tone="success" className="animate-scale-in">
            Password updated. Your other sessions have been signed out.
          </Alert>
        )}
        <Button
          onClick={changePassword}
          disabled={changingPassword || !currentPassword || newPassword.length < 8}
          className="self-start"
        >
          {changingPassword ? "Updating..." : "Update password"}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium text-foreground">Change email address</h2>
        <p className="text-sm text-muted">
          We'll send a confirmation link to the new address — your login email stays {user?.email} until you use it.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          New email address
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Current password
          <input
            type="password"
            value={emailChangePassword}
            onChange={(e) => setEmailChangePassword(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
        </label>
        {emailChangeError && (
          <Alert tone="danger" role="alert">
            {emailChangeError}
          </Alert>
        )}
        {emailChangeMessage && (
          <Alert tone="success" className="animate-scale-in">
            {emailChangeMessage}
          </Alert>
        )}
        <Button
          onClick={requestEmailChange}
          disabled={requestingEmailChange || !newEmail || !emailChangePassword}
          className="self-start"
        >
          {requestingEmailChange ? "Sending..." : "Send confirmation link"}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3 border-danger/30">
        <h2 className="font-medium text-danger">Delete account</h2>
        {user?.role !== "customer" ? (
          <p className="text-sm text-muted">
            Restaurant staff and owner accounts can't be self-deleted here — contact platform support to transfer
            ownership or remove your staff access first.
          </p>
        ) : !deleteConfirming ? (
          <>
            <p className="text-sm text-muted">
              This permanently removes your name, email, and saved addresses from your account and signs you out
              everywhere. Your past orders stay in the restaurants' own records, as they must.
            </p>
            <Button variant="destructive" onClick={() => setDeleteConfirming(true)} className="self-start">
              Delete my account
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-danger">This can't be undone. Enter your password to confirm.</p>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              className={inputClass}
            />
            {deleteError && (
              <Alert tone="danger" role="alert">
                {deleteError}
              </Alert>
            )}
            <div className="flex gap-2">
              <Button variant="destructive" onClick={deleteAccount} disabled={deletingAccount || !deletePassword}>
                {deletingAccount ? "Deleting..." : "Permanently delete my account"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteConfirming(false);
                  setDeletePassword("");
                  setDeleteError(null);
                }}
                disabled={deletingAccount}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
