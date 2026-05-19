import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const base = import.meta.env.BASE_URL;
if (base && base !== "/") {
  setBaseUrl(window.location.origin + base.replace(/\/$/, ""));
}

createRoot(document.getElementById("root")!).render(<App />);
