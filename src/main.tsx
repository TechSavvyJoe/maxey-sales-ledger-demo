import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./density.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import Root from "./Root";
import { registerServiceWorker } from "./registerServiceWorker";
import { CLOUD_BUILD } from "./persistence/database";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// The online-only pilot must never intercept Firebase's reserved auth routes.
// Its private host is separate from the existing offline demo's service worker.
if (import.meta.env.PROD && !CLOUD_BUILD) registerServiceWorker();
