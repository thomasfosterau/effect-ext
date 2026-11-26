---
"@thomasfosterau/effect-ext": minor
---

Add `Har`: HTTP Archive (HAR 1.2) documents. The schemas read a browser's export (`parse`, failing `HarError`) and `stringify` writes one. `recordClient` wraps an `HttpClient` and `recordServer` is server middleware, both recording each exchange into a `Recorder`, with headers and query parameters in Effect's redacted-name lists written as `"<redacted>"`. `replayClient` answers requests from a document by method and URL.
