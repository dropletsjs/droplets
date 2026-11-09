<script lang="ts">
export const ssr = true;
export const hydrate = true;
</script>

<script setup lang="ts">
import { computed, watch } from "vue";
import { actionUrl } from "$droplets/form";
import { imageUrl } from "../../lib/api.ts";
import { emit } from "../../lib/events.ts";
import { formatDate, formatMoney, stockLabel } from "../../lib/format.ts";
import EnhancedForm from "../../lib/vue/EnhancedForm.vue";
import type { DropletActions, DropletProps } from "./$types";

// Products, stock and the sales campaign; the login gate without a session.
// Every edit is a plain form posting to an action, so the admin works
// without JavaScript. Tabs are links on the host's own URL (`?view=…`).
// Hydrated, the forms are enhanced (`EnhancedForm`): a submit posts with
// fetch and the droplet renders again with the result, its load run again.
const props = defineProps<DropletProps>();

// Before the first `await`: while the component sets up, `actionUrl()`
// knows the render in progress.
const at = (name: keyof DropletActions) => actionUrl<DropletActions>(name);
const actions = {
  create: at("create"),
  update: at("update"),
  remove: at("delete"),
  stock: at("stock"),
  campaignSave: at("campaignSave"),
  campaignStop: at("campaignStop"),
  logout: at("logout"),
};

const first = await props.data;
// After an action the droplet renders again with the load's new data: follow it.
const d = computed(() => (props.data instanceof Promise ? first : props.data));

type Result = { saved?: string; stock?: number; deleted?: string; campaign?: string; stopped?: string; loggedOut?: boolean; errors?: Record<string, string>; reason?: string; message?: string };
const result = computed(() => (props.form ?? null) as Result | null);
const errors = computed(() => result.value?.errors ?? {});

// Tell the other droplets on the page (the cart, cards) that a product changed.
watch(result, (r) => {
  const id = r?.saved ?? r?.deleted;
  if (id) emit("shop:product-changed", { id });
});

const tabs = [
  { view: "list", label: "Products" },
  { view: "new", label: "New product" },
  { view: "campaign", label: "Campaign" },
] as const;

const euros = (cents: number) => (cents / 100).toFixed(2);
const editing = computed(() => (d.value.authorized && d.value.view === "edit" ? d.value.product : null));
</script>

<template>
  <section v-if="!d.authorized" class="gate">
    <h2>🔒 Admin</h2>
    <p v-if="result?.loggedOut">You are logged out.</p>
    <p v-else>You need to log in to manage the shop.</p>
    <a class="button primary" href="/login?next=/admin">Log in</a>
  </section>

  <section v-else class="admin">
    <nav class="tabs">
      <a v-for="tab in tabs" :key="tab.view" :href="`?view=${tab.view}`" :aria-current="d.view === tab.view ? 'page' : undefined">
        {{ tab.label }}
      </a>
      <EnhancedForm :action="actions.logout" class="logout">
        <span>{{ d.admin }}</span>
        <button class="button">Log out</button>
      </EnhancedForm>
    </nav>

    <p v-if="d.campaign" class="campaign">
      <span class="badge sale">{{ d.campaign.name }} −{{ d.campaign.pct }}%</span>
      {{ d.campaign.scope === "all" ? "on every product" : `on ${d.campaign.productIds.length} products` }}
      <template v-if="d.campaign.endsAt">· ends {{ formatDate(d.campaign.endsAt) }}</template>
      <a href="?view=campaign">Manage</a>
    </p>

    <p v-if="result?.saved || result?.deleted || result?.campaign || result?.stopped" class="notice ok" role="status">✓ Saved.</p>
    <p v-if="result?.reason === 'login'" class="notice error" role="alert">{{ result.message }}</p>
    <p v-if="errors.form" class="notice error" role="alert">{{ errors.form }}</p>

    <!-- Products -->
    <table v-if="d.view === 'list'" class="products">
      <thead>
        <tr><th></th><th>Product</th><th>Price</th><th>Sale</th><th>Stock</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="p in d.products" :key="p.id" :class="{ flash: result?.saved === p.id }">
          <td><img :src="imageUrl(p.image)" alt="" width="48" height="48" /></td>
          <td><b>{{ p.name }}</b><br /><small>{{ p.slug }}</small></td>
          <td>{{ formatMoney(p.priceCents, p.currency) }}</td>
          <td>
            <template v-if="p.salePriceCents !== null">{{ formatMoney(p.salePriceCents, p.currency) }}<br /><small>−{{ p.salePct }}%</small></template>
            <template v-else>—</template>
          </td>
          <td>
            <EnhancedForm :action="actions.stock" class="stock-form">
              <input type="hidden" name="id" :value="p.id" />
              <input class="field" type="number" name="stock" min="0" max="99999" :value="p.stock" :aria-label="`Stock of ${p.name}`" />
              <button class="button">Save</button>
            </EnhancedForm>
            <p :class="`stock stock-${p.stockState}`">{{ stockLabel(p.stockState, p.stock) }}</p>
          </td>
          <td class="row-actions">
            <a :href="`?view=edit&id=${p.id}`">Edit</a>
            <EnhancedForm :action="actions.remove">
              <input type="hidden" name="id" :value="p.id" />
              <button class="link danger">Delete</button>
            </EnhancedForm>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- New / Edit -->
    <EnhancedForm
      v-else-if="d.view === 'new' || editing"
      enctype="multipart/form-data"
      :action="editing ? actions.update : actions.create"
      class="product-form"
    >
      <h2>{{ editing ? `Edit: ${editing.name}` : "New product" }}</h2>
      <input v-if="editing" type="hidden" name="id" :value="editing.id" />
      <label>Name <input class="field" name="name" required maxlength="80" :value="editing?.name" /></label>
      <p v-if="errors.name" class="notice error">{{ errors.name }}</p>
      <label>Slug <input class="field" name="slug" maxlength="80" :value="editing?.slug" placeholder="from the name" /></label>
      <p v-if="errors.slug" class="notice error">{{ errors.slug }}</p>
      <label>
        Category
        <select class="field" name="category" required>
          <option v-for="c in d.categories" :key="c.slug" :value="c.slug" :selected="editing?.category === c.slug">{{ c.name }}</option>
        </select>
      </label>
      <div class="pair">
        <label>Price (€) <input class="field" name="price" inputmode="decimal" required :value="editing ? euros(editing.priceCents) : ''" /></label>
        <label>Stock <input class="field" name="stock" type="number" min="0" required :value="editing?.stock ?? 10" /></label>
      </div>
      <p v-if="errors.price" class="notice error">{{ errors.price }}</p>
      <p v-if="errors.stock" class="notice error">{{ errors.stock }}</p>
      <label>Description <textarea class="field" name="description" rows="4" required maxlength="1000" :value="editing?.description"></textarea></label>
      <p v-if="errors.description" class="notice error">{{ errors.description }}</p>
      <label>Details <input class="field" name="details" maxlength="200" :value="editing?.details" placeholder="350 ml · stoneware · dishwasher safe" /></label>
      <div class="image">
        <img v-if="editing" :src="imageUrl(editing.image)" alt="" width="160" height="160" />
        <label>Image <input name="image" type="file" accept="image/png,image/jpeg,image/webp" :required="!editing" /></label>
        <small>PNG, JPEG or WebP, at most 2 MB.</small>
      </div>
      <p v-if="errors.image" class="notice error">{{ errors.image }}</p>
      <div class="buttons">
        <button class="button primary">Save</button>
        <a class="button" href="?view=list">Cancel</a>
      </div>
    </EnhancedForm>
    <p v-else-if="d.view === 'edit'" class="notice error">No such product. <a href="?view=list">Back to the list</a></p>

    <!-- Campaign -->
    <div v-else-if="d.view === 'campaign'" class="campaigns">
      <EnhancedForm v-if="d.campaign" :action="actions.campaignStop" class="current">
        <input type="hidden" name="id" :value="d.campaign.id" />
        <p>Current: <b>{{ d.campaign.name }}</b> · −{{ d.campaign.pct }}% · since {{ formatDate(d.campaign.startsAt) }}</p>
        <button class="button">Stop now</button>
      </EnhancedForm>

      <EnhancedForm :action="actions.campaignSave" class="product-form">
        <h2>New campaign</h2>
        <label>Name <input class="field" name="name" required maxlength="60" placeholder="Back to school" /></label>
        <p v-if="errors.name" class="notice error">{{ errors.name }}</p>
        <label>Discount (%) <input class="field" name="pct" type="number" min="1" max="90" value="15" required /></label>
        <p v-if="errors.pct" class="notice error">{{ errors.pct }}</p>
        <fieldset>
          <legend>Applies to</legend>
          <label class="inline"><input type="radio" name="scope" value="all" checked /> All products</label>
          <label class="inline"><input type="radio" name="scope" value="selected" /> Selected:</label>
          <div class="picks">
            <label v-for="p in d.products" :key="p.id" class="inline"><input type="checkbox" name="productIds" :value="p.id" /> {{ p.name }}</label>
          </div>
        </fieldset>
        <p v-if="errors.productIds" class="notice error">{{ errors.productIds }}</p>
        <div class="pair">
          <label>From <input class="field" name="startsAt" type="date" /></label>
          <label>To <input class="field" name="endsAt" type="date" /></label>
        </div>
        <p v-if="errors.endsAt" class="notice error">{{ errors.endsAt }}</p>
        <button class="button primary">Start campaign</button>
      </EnhancedForm>

      <p v-if="d.recent.length" class="recent">
        Recent:
        <span v-for="c in d.recent" :key="c.id">{{ c.name }} −{{ c.pct }}% ({{ c.stopped_at ? "stopped" : c.ends_at ? `ends ${formatDate(c.ends_at)}` : "open" }}) </span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.gate {
  max-width: 400px;
  margin: 2rem auto;
  padding: 2rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  text-align: center;
}

.admin {
  display: grid;
  gap: 1rem;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  overflow-x: auto;
}

.tabs a {
  padding: 0.5rem 1rem;
  border-radius: 999px;
  color: var(--muted);
  font-weight: 600;
  text-decoration: none;
}

.tabs a[aria-current] {
  background: var(--brand-soft);
  color: var(--brand);
}

.logout {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin-left: auto;
  color: var(--muted);
}

.campaign {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  padding: 0.7rem 1rem;
  border-radius: var(--radius);
  background: var(--coral-soft);
}

.campaign a {
  margin-left: auto;
  color: inherit;
  font-weight: 600;
}

.products {
  width: 100%;
  border-collapse: collapse;
}

.products th {
  padding: 0.5rem;
  color: var(--muted);
  font-size: 0.8rem;
  text-align: left;
  text-transform: uppercase;
}

.products td {
  padding: 0.6rem 0.5rem;
  border-top: 1px solid var(--line);
  vertical-align: top;
}

.products img {
  border-radius: 8px;
  background: var(--grey-soft);
}

.products small {
  color: var(--muted);
}

.products tr.flash td {
  background: #e3f7ee;
  transition: background 1s;
}

.stock-form {
  display: flex;
  gap: 0.4rem;
}

.stock-form .field {
  width: 90px;
}

.stock-form + .stock {
  margin-top: 0.3rem;
}

.row-actions {
  display: flex;
  gap: 0.8rem;
  align-items: center;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  text-decoration: underline;
  cursor: pointer;
}

.danger {
  color: #b42318;
}

@media (max-width: 720px) {
  .products thead {
    display: none;
  }

  .products tr {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 0.3rem 0.6rem;
    padding: 0.8rem 0;
    border-top: 1px solid var(--line);
  }

  .products td {
    padding: 0;
    border: 0;
  }

  .products td:first-child {
    grid-row: span 5;
  }
}

.product-form {
  display: grid;
  gap: 0.7rem;
  max-width: 640px;
}

.product-form h2 {
  margin: 0;
}

.product-form label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.9rem;
  font-weight: 600;
}

.product-form label.inline {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  font-weight: 500;
}

.product-form fieldset {
  display: grid;
  gap: 0.4rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-small);
}

.picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.2rem;
  padding-left: 1.4rem;
}

.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
}

.image {
  display: grid;
  gap: 0.4rem;
}

.image img {
  border-radius: var(--radius-small);
}

.buttons {
  display: flex;
  gap: 0.6rem;
}

.campaigns {
  display: grid;
  gap: 1.5rem;
}

.current {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.8rem 1rem;
  border-radius: var(--radius);
  background: var(--coral-soft);
}

.current p {
  margin: 0;
}

.recent {
  color: var(--muted);
  font-size: 0.9rem;
}
</style>
