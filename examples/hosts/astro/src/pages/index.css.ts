// The shop's routes, proxied under this origin (see src/lib/shop.ts).
import type { APIRoute } from "astro";
import { shop } from "../lib/shop-page.ts";

export const ALL: APIRoute = ({ request }) => shop.proxy(request);
