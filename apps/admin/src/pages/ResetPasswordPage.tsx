import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.request("/auth/reset-password", { method: "POST", body: { token, password }, skipRefresh: true });
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {!token ? (
          <Alert tone="danger" role="alert">
            This reset link is missing its token. Request a new one from the{" "}
            <Link to="/forgot-password" className="font-medium underline">
              forgot password
            </Link>{" "}
            page.
          </Alert>
        ) : (
          <Card className="animate-scale-in flex flex-col gap-4">
            <h1 className="font-heading text-2xl font-semibold text-foreground">Set a new password</h1>
            {done ? (
              <Alert tone="success">Password updated. Redirecting to log in...</Alert>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
                <label className="flex flex-col gap-1 text-sm text-foreground">
                  New password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
                {error && (
                  <Alert tone="danger" role="alert">
                    {error}
                  </Alert>
                )}
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? "Updating..." : "Update password"}
                </Button>
              </form>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
