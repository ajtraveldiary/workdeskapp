import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { App } from "./App";
import { CACHE_MAX_AGE, CACHE_VERSION, persister, queryClient } from "./queryClient";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: CACHE_MAX_AGE, buster: CACHE_VERSION }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
);
