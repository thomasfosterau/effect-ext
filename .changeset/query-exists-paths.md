---
"@thomasfosterau/effect-ext": minor
---

`Query` filters can cross relationships and reach nested fields. A new `Exists` node matches when a related record matches its nested filter (`Query.exists`, or `fields<A>().exists` for embedded records), and `Compare`, `In`, `Text` and `Present` take dotted field paths (`address.city`), typed by `fields<A>()`. `Query.run` and `Query.toPredicate` take a `resolve` option to find related records (`Query.embedded` by default); `FilterFor` and `QueryFor` take the `relationships` an `Exists` may name. `QueryParams` decodes and encodes both in each dialect: brackets spell a relationship as a path segment (`filter[notes.text][contains]=cat`), OData as `notes/any(x: contains(x/text, 'cat'))` (and reads `all`), and `Options.relationships` declares them. A struct field whose name contains `.` can no longer be filtered on.
