---
"@thomasfosterau/effect-ext": minor
---

`Browser` / `BrowserTesting`: absence is an `Option`, optional members are `?: T` (#17). Breaking:

- Every `make` that took `X | undefined` now takes an optional parameter, `make(x?: X)`: `PageVisibility.make`, `MediaQuery.make`, `WakeLock.make`, `Broadcast.make`, `ScreenOrientation.make`, `Battery.make`, `Fullscreen.make`, `IdleDetection.make`, `Locks.make`. Before: `WakeLock.make(undefined)`; after: `WakeLock.make()` (passing `undefined` still compiles).
- `Navigator.make` / `NavigatorEnvironment`: `navigator` and `events` are optional members (`navigator?: NavigatorLike`, `events?: Stream.EventListener`) instead of required `T | undefined`. Before: `make({ navigator, events: undefined })`; after: `make({ navigator })`.
- `Notifications.make` / `NotificationsEnvironment`: `Notification?` and `userActivation?` are optional members. Before: `make({ Notification: undefined })`; after: `make({})`.
- `LockOptions`, `LockManagerRequestOptions`, `LockManagerLike.query`'s result, `LockInfoLike`, `StorageManagerLike.estimate`'s result, `NavigatorLike` (except `userActivation`) and `DocumentFullscreenLike.fullscreenEnabled`: `?: T | undefined` is now `?: T`. An object built by hand with an explicit `undefined` member no longer type-checks under `exactOptionalPropertyTypes`: omit the key.
- `LockManagerLike.request`'s callback returns `Promise<void>` rather than `Promise<void> | undefined`; a callback that declined the lock returns `Promise.resolve()`.
- `TestNotifications.Shown.options` is `Option.Option<NotificationOptions>` (was `NotificationOptions | undefined`). Before: `shown[0].options`; after: `Option.getOrUndefined(shown[0].options)`.
- `TestScreenOrientation.Control.setRefusal` takes an optional parameter (`setRefusal(refusal?)`); before `setRefusal(undefined)`, after `setRefusal()`.
- Every `BrowserTesting` `Options` interface (`TestBattery`, `TestFullscreen`, `TestGeolocation.Fix`, `TestIdleDetection`, `TestNavigator`, `TestNotifications`, `TestScreenOrientation`, `TestWakeLock`) and `TestNavigator.ConnectionInit`: `?: T | undefined` is now `?: T`.

Left as the platform spells them: `NetworkInformationLike`'s members and `NavigatorLike.userActivation` (`?: T | undefined`, they read `undefined` live), the `Lock | null` callback argument, `DocumentFullscreenLike.fullscreenElement`, `IdleDetectorInstanceLike.userState` / `screenState` and `NavigatorLike.sendBeacon`'s `data`.
