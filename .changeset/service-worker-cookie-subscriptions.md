---
"@thomasfosterau/effect-platform-service-worker": minor
---

Adds `CookieSubscriptions` to effect-platform-service-worker: cookie change subscriptions inside a service worker. `subscribe`, `unsubscribe` and `subscriptions` go through `self.registration.cookies` (a context reference, `Unsupported` outside a service worker), and `cookieChangeListener` turns `cookiechange` events into `CookieStore.CookieChange` values for a handler run inside `waitUntil`. `memoryCookieSubscriptions` is an in-memory manager for tests.
