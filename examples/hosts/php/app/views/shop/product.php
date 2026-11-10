<nav class="shop-crumbs" aria-label="Breadcrumb">
<a href="/gallery">Gallery</a> ›
<a href="/gallery?<?= h(shop_build_query([['category', (string) ($category['slug'] ?? '')]])) ?>"><?= h($category['name'] ?? '') ?></a> ›
<span aria-current="page"><?= h($product['name']) ?></span>
</nav>
<?= $fragments[0] ?>

<section class="shop-comments"><?= $fragments[1] ?></section>
