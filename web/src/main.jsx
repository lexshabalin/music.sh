import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { PlayerProvider } from "./usePlayer";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </HashRouter>
  </React.StrictMode>
);
