import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { useAuth } from "../context/AuthContext";
import { roleHomePath } from "../lib/roleHome";

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

/**
 * Phase 28 — the mandatory stop for an agency-provisioned "direct access" account before it can
 * reach anything else (RequireAuth redirects here whenever user.mustChangePassword is true; the
 * server enforces the same restriction independently — see middleware/auth.ts). Reuses
 * /auth/change-password unchanged: the temporary password IS a valid "current password" for that
 * endpoint, so no new backend flow was needed.
 */
export function ForcePasswordChangePage() {
  const { changePassword } = useAuth();
  const navigate = useNavigate();
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const user = await changePassword(temporaryPassword, newPassword);
      navigate(roleHomePath(user.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm animate-scale-in">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-foreground">Set your password</h1>
            <p className="mt-1 text-sm text-muted">
              Your account was set up with a temporary password. Choose a new one to continue — you won't be able to
              use the temporary password again after this.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Temporary password
            <input
              type="password"
              className={inputClass}
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            New password
            <input
              type="password"
              className={inputClass}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Confirm new password
            <input
              type="password"
              className={inputClass}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Setting password..." : "Set password & continue"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
