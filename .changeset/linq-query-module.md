---
"@thomasfosterau/effect-ext": minor
---

Add `Query`: LINQ-style queries as data. `Query.fields<A>()` builds typed filters and sort keys, `Query.run` evaluates a query over any iterable, and `Query.FilterFor` / `Query.SortFor` derive wire codecs from a `Schema.Struct` so a filter can be accepted from a client and run in memory or walked by a backend.
