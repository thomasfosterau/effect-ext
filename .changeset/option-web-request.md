---
"@thomasfosterau/effect-ext": minor
---

Request-side web modules (`Web`, `Net`, `Observability`, `Negotiate`, `ServiceWorker`, `Robots`): absent values are `Option`, and option members are plain `?: T` (#17).

- `RobotGroup.crawlDelay`: `number | undefined` (optional) -> `Option.Option<number>` (required). Migrate `new RobotGroup({ userAgents, rules })` to `new RobotGroup({ userAgents, rules, crawlDelay: Option.none() })` and `crawlDelay: 10` to `crawlDelay: Option.some(10)`; read it with `Option` helpers instead of `=== undefined`.
- `getCrawlDelay(robotsTxt, userAgent)`: `number | undefined` -> `Option.Option<number>`. Use `Option.getOrUndefined(...)` to keep the old shape.
- `ServiceWorker.Registration`: `Context.Reference<ServiceWorkerRegistrationLike | undefined>` -> `Context.Reference<Option.Option<ServiceWorkerRegistrationLike>>`. Provide `Option.some(registration)` instead of `registration` and `Option.none()` instead of `undefined`.
- Option members drop `| undefined` (omit the key instead of passing `undefined`, under `exactOptionalPropertyTypes`): `RouteClassifier.isLocaleInvariantAsset` / `isFormatNegotiatedAsset`, `FollowRedirectsOptions.maxHops` / `fetch`, the `Observability` auth-outcome input's `hasApiKey`, `ServiceWorker`'s `cacheable`, `matchOptions`, `timeout`, `action`, `tag` and `fetch` members, and `Robots`' `timeout`, `maxBytes`, `isRefusal`, `cache`, `cacheTtlSeconds`, `unavailableTtlSeconds`, `matchQuery`, `maxCrawlDelaySeconds`, `comments`.
