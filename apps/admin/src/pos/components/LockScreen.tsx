import { useState, type FormEvent } from "react";
import { Alert, Button } from "@restaurant/ui";
import { useAuth } from "../../context/AuthContext";
import { IconLock } from "../../components/icons";

/**
 * Phase 73 — the smallest secure "step away from the terminal" mechanism this codebase didn't
 * already have (confirmed via a repo-wide search for "lock"/"PIN"/"idle timeout" — nothing
 * existed). Deliberately NOT a new identity system: unlocking (same staff member) and switching
 * (a different staff member takes over) are both just a normal call to the existing
 * AuthContext.login(), the same one LoginPage.tsx uses — a locked terminal still holds a fully
 * valid session underneath, so re-authenticating either replaces it with a fresh token for the
 * same account or hands the terminal to a different one. No PINs, no new backend endpoint, no
 * second place a credential is checked.
 *
 * The overlay itself blocks interaction with the register underneath (it renders in front of
 * POSLayoutContent's <Outlet/>, and everything behind it is inert while this is mounted) but does
 * NOT log the current user out — that's the whole point versus a bare "Log out" button: the same
 * staff member can step back in with one password, and the terminal's location/business context
 * (LocationContext, tied to the authenticated user) is preserved or correctly re-resolved for
 * whoever unlocks it.
 */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { user, login, logout } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      onUnlock();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-elevated">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/[0.04] text-foreground">
            <IconLock className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-heading text-xl font-semibold text-foreground">POS locked</h1>
            <p className="text-sm text-muted">
              {switching ? "Sign in to take over this terminal." : `Enter ${user?.name ?? "your"}'s password to continue.`}
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 text-left">
          {switching && (
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus={!switching}
              autoComplete="current-password"
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in..." : switching ? "Sign in" : "Unlock"}
          </Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => {
              setSwitching((v) => !v);
              setEmail(switching ? (user?.email ?? "") : "");
              setError(null);
            }}
            className="font-medium text-primary hover:underline"
          >
            {switching ? "Back" : "Not you? Switch staff member"}
          </button>
          <button type="button" onClick={() => logout()} className="font-medium text-muted hover:text-foreground">
            Log out instead
          </button>
        </div>
      </div>
    </div>
  );
}
