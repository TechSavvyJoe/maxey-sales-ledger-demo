import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./density.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import App from "./App.tsx";
import { registerServiceWorker } from "./registerServiceWorker";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) registerServiceWorker();
