import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Card, Spinner } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useNoIndex } from "../hooks/useNoIndex";

export function ConfirmEmailChangePage() {
  useNoIndex();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"loading" | "done" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiClient
      .request<{ message: string; email: string }>("/auth/confirm-email-change", {
        method: "POST",
        body: { token },
      })
      .then((data) => {
        setMessage(data.message);
        setStatus("done");
      })
      .catch((err) => {
        setMessage((err as Error).message);
        setStatus("error");
      });
  }, [token]);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4">
      <Card className="animate-scale-in flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Confirm email address</h1>
        {status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Confirming...
          </p>
        )}
        {status === "done" && <Alert tone="success">{message}</Alert>}
        {status === "error" && (
          <Alert tone="danger" role="alert">
            {message ?? "This confirmation link is missing its token."}
          </Alert>
        )}
        <Link to="/account" className="text-sm font-medium text-primary hover:underline">
          Back to account
        </Link>
      </Card>
    </div>
  );
}
