<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?> · Droplets Shop on <?= h($stack) ?></title>
<link rel="stylesheet" href="/shop.css">
<?= $links ?>

<script type="speculationrules">{"prefetch":[{"where":{"href_matches":"/product/*"},"eagerness":"moderate"}]}</script>
<script type="module" src="/index.js"></script>
</head>
<body class="shop">
<?= $toasts ?>
<header class="shop-header"><div class="shop-wrap">
<a class="shop-logo" href="/gallery"><span aria-hidden="true">◆</span> Droplets Shop</a>
<nav class="shop-nav" aria-label="Shop"><?php foreach (['/gallery' => 'Gallery', '/admin' => 'Admin'] as $href => $label): ?><a href="<?= $href ?>"<?= $href === $current ? ' aria-current="page"' : '' ?>><?= $label ?></a><?php endforeach; ?></nav>
<div class="shop-cart"><?= $cart ?></div>
</div></header>
<main class="shop-main shop-wrap">
<?= $content ?>
</main>
<footer class="shop-footer"><div class="shop-wrap">
<p class="shop-stack"><?= h($stack) ?></p>
<p>Droplets demo shop · host: <?= h($stack) ?> · droplets: &lt;djs-shop&gt;</p>
<p><a href="/gallery">Gallery</a> · <a href="/cart">Cart</a> · <a href="/admin">Admin</a> · <a href="/">The Svelte example</a></p>
</div></footer>
</body>
</html>
