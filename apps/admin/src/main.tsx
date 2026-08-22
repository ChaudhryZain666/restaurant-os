import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary, ToastProvider } from "@restaurant/ui";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./context/AuthContext";
import { LocationProvider } from "./context/LocationContext";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary description="This page hit an unexpected error. Reloading usually fixes it — if it keeps happening, please contact support.">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <LocationProvider>
                <App />
              </LocationProvider>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
