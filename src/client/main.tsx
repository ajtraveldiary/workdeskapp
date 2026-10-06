import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CACHE_MAX_AGE, CACHE_VERSION, persister, queryClient } from "./queryClient";
import "./styles.css";
import { startAutoUpdate } from "./autoUpdate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        buster: CACHE_VERSION,
        // Email bodies stay out of localStorage (size); the browser's HTTP cache keeps them instead.
        dehydrateOptions: { shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) && q.queryKey[0] !== "email-content" },
      }}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
);

startAutoUpdate();
