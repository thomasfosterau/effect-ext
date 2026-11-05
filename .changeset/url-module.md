---
"effect-ext": minor
---

New `Url` module: absolute URLs whose scheme, hostname (or domain), port, credentials and path are part of their type. `Url.schema(spec)` decodes, serialises and checks a string, and its type records what was checked, so `Url<{ scheme: "https"; hostname: "api.example.com" }>` is assignable where a `Url<{ scheme: "http" | "https" }>` or a URL in the `example.com` domain is expected, and not the other way round. Also `is`, `satisfies`, `parse`, `resolve` (keeps the base's authority, refuses a reference that leaves it), `toURL` and `components`.
