import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { loadKeysFromDisk, loadActiveProject } from "./store";
import "./styles.css";

loadKeysFromDisk();
loadActiveProject();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
