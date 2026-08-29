import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { ToastProvider } from "./components/ui/toast";
import { queryClient } from "./lib/query-client";
import { ThemeProvider } from "./lib/theme";
import { AppRoutes } from "./routes";
import "./styles/theme.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html is missing its #root element.");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* Inside the router so a toast can be raised from any route,
              including the auth pages. */}
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
