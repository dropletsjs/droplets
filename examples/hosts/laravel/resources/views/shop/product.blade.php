@extends('shop.layout')

@section('content')
<nav class="shop-crumbs" aria-label="Breadcrumb">
<a href="/gallery">Gallery</a> ›
<a href="/gallery?{{ \App\Shop::buildQuery([['category', (string) ($category['slug'] ?? '')]]) }}">{{ $category['name'] ?? '' }}</a> ›
<span aria-current="page">{{ $product['name'] }}</span>
</nav>
{!! $fragments[0] !!}

<section class="shop-comments">{!! $fragments[1] !!}</section>
@endsection
