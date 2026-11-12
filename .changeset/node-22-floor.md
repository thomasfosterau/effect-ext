---
"@thomasfosterau/effect-ext": patch
---

Lower `engines.node` from `>=22.18` to `>=22`, the library's real floor (#71): the suite passes on Node 22.0.0. Only the `effect-evals` CLI needs 22.18 (default type stripping, `module.registerHooks()`), so its bin now checks the Node version at start-up and exits with a message naming the requirement, instead of failing inside the loader. `URL.parse` (Node 22.1) is replaced by a `URL.canParse`-based helper in `Net`, `Mime`'s `DataUrl` and `UriTemplate`'s `WellKnown`. Consumers on Node 22.0–22.17 no longer get `EBADENGINE`.
