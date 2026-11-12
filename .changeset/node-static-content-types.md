---
"@dropletsjs/adapter-node": patch
---

`/assets/*` on the Node adapter names the content type of the common text (`.txt`, `.html`, `.xml`, `.md`, `.csv`, `.webmanifest`, with `; charset=utf-8`), image, font, WebAssembly, PDF, archive, video and audio files instead of `application/octet-stream`, which stays the fallback for any other extension.
