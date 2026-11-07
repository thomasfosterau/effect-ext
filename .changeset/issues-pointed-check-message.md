---
"@thomasfosterau/effect-ext": minor
---

`Issues.pointers` keeps a struct-level check's `message` when the check points its failure at a field (`{ path, issue: new SchemaIssue.InvalidValue() }`), where it said "Expected a valid value" (#69). The walk now carries the nearest `Filter` down through `Pointer`, `Composite`, `AnyOf` and `Encoding`, as effect-jsonapi's `issueLeaves` does. `Issues.Leaf` gains `describedBy` (the check that describes a message-less `InvalidValue`), and the new `Issues.message(leaf)` formats a leaf the way `pointers` does, so a caller with its own error envelope can build on `Issues.leaves`.
