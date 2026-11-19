<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Droplets in Laravel</title>
  <script type="module" src="{{ $dropletsPublic }}/index.js"></script>
</head>
<body style="font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 2rem;">
  <main style="max-width: 48rem; margin: 0 auto;">
    <h1>Laravel page, three Svelte droplets</h1>
    <p>Each fragment below was fetched by Laravel's HTTP client and rendered on the server.
       Try <a href="/?who=Elephant">?who=Elephant</a>, or the <a href="/gallery">shop demo</a>.</p>
@foreach ($fragments as $fragment)
    {!! $fragment !!}

@endforeach
  </main>
</body>
</html>
