# Publishing & releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) and published to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — there is no `NPM_TOKEN`. See [SECURITY.md](./SECURITY.md) for the security rationale behind the pipeline.

## The release flow

1. **Add a changeset with your change.** Run `pnpm changeset`, pick the bump (`patch` / `minor` / `major`) and write a user-facing summary, then commit the generated file alongside your change. (Changes that don't affect the published package — docs, CI, examples — need no changeset.)
2. **Merge to `trunk`.** The [`release`](./.github/workflows/release.yml) workflow runs and, while changesets are pending, opens or updates a **"Version Packages"** PR that applies the version bump and rolls the changesets into `CHANGELOG.md`.
3. **Merge the "Version Packages" PR.** With no changesets left, the workflow publishes the new version to npm via the npm CLI and trusted publishing, then tags the commit and creates the GitHub release.

The version step (`pnpm run version`) runs `changeset version`, then `vp fmt`, then `pnpm install --lockfile-only`. Changesets v3 formats the changelogs it writes with whatever formatter it detects, and it detects the `oxfmt` shim that Vite+ installs; that shim only serves editors and exits non-zero when run directly. So `.changeset/config.json` sets `"format": false` and the script formats with `vp fmt` itself.

`scripts/release.sh` packs each package with `pnpm pack` (which rewrites `catalog:`/`workspace:` specifiers) and publishes the tarball with an exact-pinned npm CLI via trusted publishing (OIDC); nothing requests provenance explicitly: the repository and the package are public, so trusted publishing attaches it. A package already published at its current version is skipped, so a partial run can be re-run. `changeset tag` then emits the `New tag:` lines the Changesets action uses to push the tags and create the GitHub releases. Why each setting is what it is: [SECURITY.md](./SECURITY.md#supply-chain-hardening).

## Maintainer setup (one-time)

The `@thomasfosterau/effect-ai-*` packages and `@thomasfosterau/effect-evals` are already on npm, published from `thomasfosterau/effect-ai-ext` before it was merged here; their trusted publisher still names that repository and must be repointed (step 3) before the next release, or their publish fails auth while the others go through. Their changelogs continue in each package's `CHANGELOG.md`. Their version tags (`@thomasfosterau/effect-ai-ext@0.5.1`, …) live in effect-ai-ext: push them here before the first release (`git fetch <effect-ai-ext> 'refs/tags/*:refs/tags/*' && git push origin --tags`; the commits they name are in this history), or `changeset tag` will tag each AI package's current, already-published version again and the Release workflow will create a GitHub release for it.

`@thomasfosterau/effect-utilities` has not been published yet. npm's trusted-publisher binding is configured per package on npmjs.com, which needs the package to exist — so the first release is a one-off owner action (a manual `npm publish` of the `pnpm pack` tarball from a machine with an npm session, or a classic token used once and then revoked), after which the following steps make the automated flow work end-to-end:

0. **Rename the default branch to `trunk`** (#8). On GitHub it is still `main`, while CI, Release, Changesets and the fallow gate all target `trunk`; until the rename, no workflow runs. **Settings → General → Default branch** (GitHub retargets open PRs).
1. **Allow Actions to open the Version Packages PR.** In the repo: **Settings → Actions → General → Workflow permissions** → enable **"Allow GitHub Actions to create and approve pull requests"**. Without this the built-in `GITHUB_TOKEN` is forbidden from opening pull requests and the workflow fails at the PR-creation step — even though the job already grants `pull-requests: write`.
2. **Create and protect the `release` environment.** **Settings → Environments → New environment → `release`** → enable **Required reviewers** (yourself) and restrict deployment to the `trunk` branch, so publishing pauses for manual approval. The Release workflow names this environment; until it exists the job cannot run.
3. **Configure the trusted publisher**, for every published package: `@thomasfosterau/effect-utilities`, `effect-ai-ext`, `effect-ai-gateway`, `effect-ai-mistral`, `effect-ai-cohere`, `effect-ai-voyage`, `effect-ai-elevenlabs` and `effect-evals` (for the AI packages, replace the existing `thomasfosterau/effect-ai-ext` binding). On npmjs.com, open the package → **Settings → Trusted Publisher** and add:
   - Provider: **GitHub Actions**
   - Repository: `thomasfosterau/effect-ext`
   - Workflow: `release.yml`
   - Environment: `release`

   Then remove any classic automation token for the package.

4. **Protect `trunk`.** Require pull requests and passing CI before merge, and disallow direct pushes, so a release can only be triggered by merging the reviewed "Version Packages" PR.

## Retiring the effect-web packages (one-time)

The web modules came from `thomasfosterau/effect-web`, three of whose packages are on npm: `@thomasfosterau/effect-web`, `@thomasfosterau/effect-robots` and `@thomasfosterau/effect-sitemap` (0.1.0 each). Its other eight (`effect-rss-feed`, `effect-atom-feed`, `effect-json-feed`, `effect-uri-template`, `effect-langtag`, `effect-css`, `effect-encoding`, `effect-mime`) were never published. Once `@thomasfosterau/effect-utilities` is released with the web modules, the owner deprecates the three, from a machine with an npm session (`npm deprecate` needs one; nothing in CI can do it):

```sh
npm deprecate @thomasfosterau/effect-web "Moved to @thomasfosterau/effect-utilities (Web, Net, Observability, Negotiate, ServiceWorker, Browser, BrowserTesting)"
npm deprecate @thomasfosterau/effect-robots "Moved to @thomasfosterau/effect-utilities/Robots"
npm deprecate @thomasfosterau/effect-sitemap "Moved to @thomasfosterau/effect-utilities/Sitemap"
```

Then remove those packages' trusted-publisher bindings on npmjs.com, and archive `thomasfosterau/effect-web` once its open issues have been transferred here.
