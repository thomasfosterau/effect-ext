# Publishing

Releases use [Changesets](https://github.com/changesets/changesets) and npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC); there is no `NPM_TOKEN`. The rationale is in [SECURITY.md](SECURITY.md#supply-chain-hardening).

## Flow

1. A PR that changes a published package adds a changeset (`vp exec changeset`).
2. On `trunk`, [release.yml](../.github/workflows/release.yml) opens or updates the "chore: version packages" PR. Its version step is the `version` task (`changeset version`, then `vp fmt`, then a lockfile refresh): `.changeset/config.json` sets `"format": false` because Changesets would otherwise pick Vite+'s editor-only `oxfmt` shim.
3. Merging that PR leaves versions not yet on npm, so the `publish` job waits for approval in the `release` environment, then `scripts/release.sh` packs each package with `pnpm pack` (which rewrites `catalog:` / `workspace:` specifiers), publishes it with `npm publish`, skips versions already on npm, and runs `changeset tag` for the GitHub releases.

Every job in the release workflow first waits on `verify-lockfile`, so nothing runs unless `.github/workflows/actions.lock` verifies.

## A new package

Trusted publishing can only be bound to a name that already exists on npm. Publish a `0.0.0` placeholder once from a machine logged in to npm (npm ≥ 11.15), then bind it:

```sh
# in an empty directory with a package.json: name, "version": "0.0.0", license,
# repository (with "directory"), "publishConfig": { "access": "public" }
npm publish --access public --provenance=false
npm trust github <name> --file release.yml --repository thomasfosterau/effect-ext --environment release --allow-publish
```

## One-time repository setup

- **Settings → Actions → General**: allow GitHub Actions to create and approve pull requests (the version PR).
- **Settings → Environments → `release`**: required reviewer (the owner), deployments from `trunk` only.
- **npm, per package → Settings → Trusted Publisher**: GitHub Actions, `thomasfosterau/effect-ext`, `release.yml`, environment `release`. Remove any classic token.
- **Protect `trunk`**: PRs and passing CI required, no direct pushes.
