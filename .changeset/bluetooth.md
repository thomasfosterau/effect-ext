---
"@thomasfosterau/effect-platform-browser": minor
---

Add `Bluetooth`: Web Bluetooth's picker (`request`), `devices`, `availability`, and a scoped GATT connection (`connect`) whose services and characteristics `read`, `write` and stream `notifications`, failing `Disconnected` when the link drops. `Browser.layer` includes it, and `BrowserTesting` adds `TestBluetooth`, an in-memory GATT tree with a `Control` that answers the picker, drops links and pushes notifications.
