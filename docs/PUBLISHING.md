# Publishing

Releases use [Changesets](https://github.com/changesets/changesets) and npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC); there is no `NPM_TOKEN`. The rationale is in [SECURITY.md](SECURITY.md#supply-chain-hardening).

## Flow

1. A PR that changes a published package adds a changeset (`vp exec changeset`).
2. On `trunk`, [release.yml](../.github/workflows/release.yml) opens or updates the "chore: version packages" PR. Its version step is the `version` task (`changeset version`, then `vp fmt`, then a lockfile refresh): `.changeset/config.json` sets `"format": false` because Changesets would otherwise pick Vite+'s editor-only `oxfmt` shim.
3. Merging that PR leaves versions not yet on npm, so the `publish` job waits for approval in the `release` environment, then runs `vp run release`: every package's build, the offline `check:dist` on that commit, then `vp pm publish -r --access public --no-git-checks -- --ignore-scripts` (pnpm rewrites `catalog:` / `workspace:` specifiers, publishes in dependency order, skips versions already on npm and does the OIDC exchange itself), then `changeset git-tag`, which tags each untagged version and reports the tags to the Changesets action, which pushes them and creates the GitHub releases. A failed publish stops before tagging. There is no publish script.

`vp run release:dry-run` runs the same build and checks and lists what `vp pm publish` would publish, without publishing or tagging.

Every job in the release workflow first waits on `verify-lockfile`, so nothing runs unless `.github/workflows/actions.lock` verifies.

## A new package

Trusted publishing can only be bound to a name that already exists on npm, so publish a new package's first version by hand from a clean `trunk`, logged in to npm as `thomasfosterau`: `vp install --frozen-lockfile`, `vp run release:dry-run`, then `vp run release`, then `git push origin --tags`. Never publish from a package directory. Then add its trusted publisher (below).

## One-time repository setup

- **Settings → Actions → General**: allow GitHub Actions to create and approve pull requests (the version PR).
- **Settings → Environments → `release`**: required reviewer (the owner), deployments from `trunk` only.
- **npm, per package → Settings → Trusted Publisher**: GitHub Actions, `thomasfosterau/effect-ext`, `release.yml`, environment `release`. Remove any classic token.
- **Protect `trunk`**: PRs and passing CI required, no direct pushes.
