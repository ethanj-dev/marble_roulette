import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import CustomMapBuilder from "../app/custom-map-builder";
import "../app/globals.css";
import PinballRoulette from "../app/pinball-roulette";

function getRoute() {
  const hashRoute = window.location.hash.replace(/^#/, "");
  return hashRoute.startsWith("/custom") ? "custom" : "game";
}

function StaticSpaApp() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const updateRoute = () => setRoute(getRoute());

    window.addEventListener("hashchange", updateRoute);
    return () => window.removeEventListener("hashchange", updateRoute);
  }, []);

  return route === "custom" ? <CustomMapBuilder /> : <PinballRoulette />;
}

window.__PINBALL_STATIC_SPA__ = true;

createRoot(document.getElementById("root")!).render(<StaticSpaApp />);
