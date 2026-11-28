import type { Transport } from "@dropletsjs/droplets";

// A class of the app's own, the case a transport is for: it reaches the browser as itself.
export class Money {
  readonly cents: number;
  readonly currency: string;

  constructor(cents: number, currency: string) {
    this.cents = cents;
    this.currency = currency;
  }

  format(): string {
    return `${(this.cents / 100).toFixed(2)} ${this.currency}`;
  }
}

export const transport: Transport = {
  Money: {
    encode: (value) => value instanceof Money && { cents: value.cents, currency: value.currency },
    decode: (json: { cents: number; currency: string }) => new Money(json.cents, json.currency),
  },
};
