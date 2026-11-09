declare global {
  namespace App {
    interface Locals {
      /** `Set-Cookie` values the shop's fragments sent, for `handle` to pass on. */
      shopCookies?: string[];
    }
  }
}

export {};
