<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ $title }} · Droplets Shop on {{ $stack }}</title>
<link rel="stylesheet" href="/shop.css">
@foreach ($links as $link)
<link rel="{{ $link['rel'] }}" href="{{ $link['href'] }}"@if ($link['as'] !== null) as="{{ $link['as'] }}"@endif>
@endforeach
<script type="speculationrules">{"prefetch":[{"where":{"href_matches":"/product/*"},"eagerness":"moderate"}]}</script>
<script type="module" src="/index.js"></script>
</head>
<body class="shop">
{!! $toasts !!}
<header class="shop-header"><div class="shop-wrap">
<a class="shop-logo" href="/gallery"><span aria-hidden="true">◆</span> Droplets Shop</a>
<nav class="shop-nav" aria-label="Shop">@foreach (['/gallery' => 'Gallery', '/admin' => 'Admin'] as $href => $label)<a href="{{ $href }}"@if ($href === $current) aria-current="page"@endif>{{ $label }}</a>@endforeach</nav>
<div class="shop-cart">{!! $cart !!}</div>
</div></header>
<main class="shop-main shop-wrap">
@yield('content')
</main>
<footer class="shop-footer"><div class="shop-wrap">
<p class="shop-stack">{{ $stack }}</p>
<p>Droplets demo shop · host: {{ $stack }} · droplets: &lt;djs-shop&gt;</p>
<p><a href="/gallery">Gallery</a> · <a href="/cart">Cart</a> · <a href="/admin">Admin</a> · <a href="/">The Svelte example</a></p>
</div></footer>
</body>
</html>
