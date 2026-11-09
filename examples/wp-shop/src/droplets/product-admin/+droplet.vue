<script lang="ts">
export const ssr = true;
export const hydrate = true;
</script>

<script setup lang="ts">
import { computed, watch } from "vue";
import { actionUrl } from "$droplets/form";
import { imageUrl } from "../../lib/api.ts";
import { emit } from "../../lib/events.ts";
import { formatMoney, stockLabel } from "../../lib/format.ts";
import EnhancedForm from "../../lib/vue/EnhancedForm.vue";
import type { DropletActions, DropletProps } from "./$types";

// Stock and prices, on a WordPress page, for the WordPress admin who is
// logged in there: wp-shop has no login of its own. Without one, a link to
// wp-login.php that comes back here. Each row is a plain form posting to
// `?/save`, so it works without JavaScript; hydrated, the forms are
// enhanced (`EnhancedForm`) and the droplet renders again in place. The
// rest of a product (name, text, image, category, sale) is edited in
// wp-admin, which the row's Edit link opens.
const props = defineProps<DropletProps>();

// Before the first `await`: while the component sets up, `actionUrl()`
// knows the render in progress.
const save = actionUrl<DropletActions>("save");

const first = await props.data;
// After an action the droplet renders again with the load's new data: follow it.
const d = computed(() => (props.data instanceof Promise ? first : props.data));

type Result = { saved?: string; stock?: number; id?: string; errors?: Record<string, string>; reason?: string; message?: string };
const result = computed(() => (props.form ?? null) as Result | null);
const errors = computed(() => result.value?.errors ?? {});

// Tell the other droplets on the page (the cart, cards) that a product changed.
watch(result, (r) => {
  if (r?.saved) emit("shop:product-changed", { id: r.saved });
});

const euros = (cents: number) => (cents / 100).toFixed(2);
</script>

<template>
  <section v-if="!d.authorized" class="gate">
    <h2>🔒 Admin</h2>
    <p>Log in to WordPress to manage the shop's stock and prices.</p>
    <a class="button primary" :href="d.login">Log in</a>
  </section>

  <section v-else class="admin">
    <p class="who">Logged in to WordPress as <b>{{ d.admin }}</b>. Everything else about a product is in <a href="/wp-admin/edit.php?post_type=product">wp-admin</a>.</p>

    <p v-if="result?.saved" class="notice ok" role="status">✓ Saved.</p>
    <p v-if="result?.reason === 'login'" class="notice error" role="alert">{{ result.message }}</p>
    <p v-if="errors.form" class="notice error" role="alert">{{ errors.form }}</p>
    <p v-if="errors.stock || errors.price" class="notice error" role="alert">{{ errors.stock ?? errors.price }}</p>

    <table class="products">
      <thead>
        <tr><th></th><th>Product</th><th>Sale</th><th>Price and stock</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="p in d.products" :key="p.id" :class="{ flash: result?.saved === p.id }">
          <td><img :src="imageUrl(p.image)" alt="" width="48" height="48" /></td>
          <td><b>{{ p.name }}</b><br /><small>{{ p.slug }}</small></td>
          <td>
            <template v-if="p.salePriceCents !== null">{{ formatMoney(p.salePriceCents, p.currency) }}<br /><small>−{{ p.salePct }}%</small></template>
            <template v-else>—</template>
          </td>
          <td>
            <EnhancedForm :action="save" class="stock-form">
              <input type="hidden" name="id" :value="p.id" />
              <label>€ <input class="field price" name="price" inputmode="decimal" :value="euros(p.priceCents)" :aria-label="`Price of ${p.name}`" /></label>
              <input class="field" type="number" name="stock" min="0" max="99999" :value="p.stock" :aria-label="`Stock of ${p.name}`" />
              <button class="button">Save</button>
            </EnhancedForm>
            <p :class="`stock stock-${p.stockState}`">{{ stockLabel(p.stockState, p.stock) }}</p>
          </td>
          <td class="row-actions">
            <a :href="`/wp-admin/post.php?post=${p.postId}&action=edit`">Edit</a>
          </td>
        </tr>
      </tbody>
    </table>
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

.who {
  margin: 0;
  color: var(--muted);
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
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}

.stock-form label {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  color: var(--muted);
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
    grid-row: span 4;
  }
}
</style>
