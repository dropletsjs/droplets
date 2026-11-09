// The shop's routes, proxied under this origin (see lib/shop.ts): the same
// handler for /index.js, /droplets/*, /assets/* and /api/*.
import { shop } from "@/lib/shop-page";

export const dynamic = "force-dynamic";

const proxy = (request: Request) => shop.proxy(request);

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS };
