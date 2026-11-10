<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Droplets in PHP</title>
  <script type="module" src="<?= h($droplets_public) ?>/index.js"></script>
</head>
<body style="font-family: system-ui, sans-serif; background: #f8fafc; margin: 0; padding: 2rem;">
  <main style="max-width: 48rem; margin: 0 auto;">
    <h1>Plain PHP page, three Svelte droplets</h1>
    <p>Each fragment below was fetched by the PHP process with curl and rendered on the server.
       Try <a href="/?who=Elephant">?who=Elephant</a>, or the <a href="/gallery">shop demo</a>.</p>
<?php foreach ($fragments as $fragment): ?>
    <?= $fragment ?>

<?php endforeach; ?>
  </main>
</body>
</html>
