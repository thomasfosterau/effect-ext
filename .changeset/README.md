# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

Every pull request that changes the published package should include a
changeset describing the change:

```sh
vp run changeset
```

When changesets land on `trunk`, the release workflow opens a "Version Packages"
pull request that bumps the version and updates `CHANGELOG.md`. Merging that
pull request publishes the new version to npm.
