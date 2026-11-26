---
"@thomasfosterau/effect-ext": minor
---

Add `Query`: LINQ-style queries as data. `Query.fields<A>()` builds typed filters and sort keys, `Query.run` evaluates a query over any iterable, and `Query.FilterFor` / `Query.SortFor` derive wire codecs from a `Schema.Struct` and `Query.QueryFor` covers a whole query, so a query can be stored or sent and run in memory or by a backend. Add `QueryParams`: read and write `Query`s as URL query strings through a pluggable `Dialect`, with JSON:API-style `brackets` and an `odata` subset built in.
