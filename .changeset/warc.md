---
"@thomasfosterau/effect-ext": minor
---

Add `Warc`: Web ARChive (WARC 1.0 / 1.1) files. `parse` and the streaming `decodeStream` read records strictly (failing `WarcError` with a byte offset), `encode` / `encodeAll` write them, and `makeRecord` and `warcinfo` build them. `recordClient` and `recordServer` record each exchange into a `Recorder` as a response and a request record, redacted as `Har` redacts.
