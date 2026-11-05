# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

Every pull request that changes a published package's behaviour should include a changeset describing the change:

```sh
vp run changeset
```

When changesets land on `trunk`, the release workflow opens a "Version Packages" pull request that bumps the versions and updates each package's `CHANGELOG.md`. Merging that pull request publishes the new versions to npm.
