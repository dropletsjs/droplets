import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { useLocation } from "./router.ts";
import { isShopPath, ShopApp } from "./shop/ShopApp.tsx";

/** `/` is the Svelte example; `/gallery`, `/product/:slug`, `/login` and `/admin` the shop demo. */
function Root() {
  const location = useLocation();
  return isShopPath(location.pathname) ? <ShopApp location={location} /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
