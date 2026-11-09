// No props: who may see the admin is the WordPress account behind the
// request (the plugin's signed `x-wp-shop-user`), never something it sends.
export { adminProps as props } from "../../lib/schemas.ts";
