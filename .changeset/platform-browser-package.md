---
"@thomasfosterau/effect-platform-browser": minor
---

New package: browser main-thread APIs beyond `@effect/platform-browser`. `ServiceWorkerContainer` is the page's side of a service worker (register, `ready`, updates, the waiting worker, the controller and its changes, and the controller as a schema-typed `WorkerMessaging` endpoint). `PushManager` is Web Push subscriptions (`subscribe`, `getSubscription`, `unsubscribe`, `permissionState`, and `toJson` checked against the `SubscriptionJson` schema).
