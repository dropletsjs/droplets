import { randomBytes } from "node:crypto";
import type { Campaign } from "../types.ts";
import { db, now } from "./db.ts";

/**
 * The campaign running now: not stopped, started, not ended. At most one
 * counts; a newer one wins.
 */
export async function currentCampaign(at = now()): Promise<Campaign | null> {
  const row = await db()
    .selectFrom("campaigns")
    .selectAll()
    .where("stopped_at", "is", null)
    .where("starts_at", "<=", at)
    .where((eb) => eb.or([eb("ends_at", "is", null), eb("ends_at", ">", at)]))
    .orderBy("starts_at", "desc")
    .executeTakeFirst();
  if (!row) return null;
  const products = row.scope === "selected"
    ? await db().selectFrom("campaign_products").select("product_id").where("campaign_id", "=", row.id).execute()
    : [];
  return {
    id: row.id,
    name: row.name,
    pct: row.pct,
    scope: row.scope === "selected" ? "selected" : "all",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    productIds: products.map((p) => p.product_id),
  };
}

/** `price` lowered by the campaign when it covers the product, else `null`. */
export function salePrice(campaign: Campaign | null, productId: string, priceCents: number): number | null {
  if (!campaign) return null;
  if (campaign.scope === "selected" && !campaign.productIds.includes(productId)) return null;
  return Math.round((priceCents * (100 - campaign.pct)) / 100);
}

export async function recentCampaigns(limit = 5) {
  return db().selectFrom("campaigns").selectAll().orderBy("created_at", "desc").limit(limit).execute();
}

export type CampaignInput = {
  name: string;
  pct: number;
  scope: "all" | "selected";
  productIds: string[];
  startsAt: string;
  endsAt: string | null;
};

/** Starts a campaign; the one running before it stops. */
export async function startCampaign(input: CampaignInput): Promise<string> {
  const id = `c_${randomBytes(6).toString("hex")}`;
  const at = now();
  await db().transaction().execute(async (tx) => {
    await tx.updateTable("campaigns").set({ stopped_at: at }).where("stopped_at", "is", null).execute();
    await tx.insertInto("campaigns").values({
      id,
      name: input.name,
      pct: input.pct,
      scope: input.scope,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      stopped_at: null,
      created_at: at,
    }).execute();
    if (input.scope === "selected" && input.productIds.length) {
      await tx.insertInto("campaign_products")
        .values(input.productIds.map((product_id) => ({ campaign_id: id, product_id })))
        .execute();
    }
  });
  return id;
}

export async function stopCampaign(id: string): Promise<boolean> {
  const result = await db().updateTable("campaigns").set({ stopped_at: now() })
    .where("id", "=", id).where("stopped_at", "is", null).executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}
