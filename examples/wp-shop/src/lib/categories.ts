// The shop's categories, in the filter's order. A product names one in its
// `shop_category` meta; the plugin's meta box and its REST schema list the
// same slugs. A product whose category is not one of these is not sold.
export const CATEGORIES = [
  { slug: "mugs", name: "Mugs & cups" },
  { slug: "desk", name: "Desk" },
  { slug: "bags", name: "Bags" },
  { slug: "home", name: "Home" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export const CATEGORY_SLUGS = CATEGORIES.map((category) => category.slug) as [CategorySlug, ...CategorySlug[]];

export const categoryName = (slug: string) => CATEGORIES.find((category) => category.slug === slug)?.name ?? slug;
