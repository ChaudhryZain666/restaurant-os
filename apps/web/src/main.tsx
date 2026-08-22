import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@restaurant/ui";
import "./index.css";
import { App } from "./App";
import { AuthProvider } from "./context/AuthContext";
import { CartProvider } from "./context/CartContext";
import { RestaurantProvider } from "./context/RestaurantContext";
import { TableProvider } from "./context/TableContext";
import { ThemeProvider } from "./components/ThemeProvider";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary description="This page hit an unexpected error. Reloading usually fixes it — if it keeps happening, please contact support.">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <RestaurantProvider>
            <TableProvider>
              <ThemeProvider>
                <AuthProvider>
                  <CartProvider>
                    <App />
                  </CartProvider>
                </AuthProvider>
              </ThemeProvider>
            </TableProvider>
          </RestaurantProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
