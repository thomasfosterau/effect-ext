# Publishing & releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) and published to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — there is no `NPM_TOKEN`. See [SECURITY.md](./SECURITY.md) for the security rationale behind the pipeline.

## The release flow

1. **Add a changeset with your change.** Run `pnpm changeset`, pick the bump (`patch` / `minor` / `major`) and write a user-facing summary, then commit the generated file alongside your change. (Changes that don't affect the published package — docs, CI, examples — need no changeset.)
2. **Merge to `trunk`.** The [`release`](./.github/workflows/release.yml) workflow runs and, while changesets are pending, opens or updates a **"Version Packages"** PR that applies the version bump and rolls the changesets into `CHANGELOG.md`.
3. **Merge the "Version Packages" PR.** With no changesets left, the workflow publishes the new version to npm via the npm CLI and trusted publishing, then tags the commit and creates the GitHub release.

The version step (`pnpm run version`) runs `changeset version`, then `vp fmt`, then `pnpm install --lockfile-only`. Changesets v3 formats the changelogs it writes with whatever formatter it detects, and it detects the `oxfmt` shim that Vite+ installs; that shim only serves editors and exits non-zero when run directly. So `.changeset/config.json` sets `"format": false` and the script formats with `vp fmt` itself.

`scripts/release.sh` packs each package with `pnpm pack` (which rewrites `catalog:`/`workspace:` specifiers) and publishes the tarball with an exact-pinned npm CLI via trusted publishing (OIDC); nothing requests provenance explicitly: the repository and the package are public, so trusted publishing attaches it. A package already published at its current version is skipped, so a partial run can be re-run. `changeset tag` then emits the `New tag:` lines the Changesets action uses to push the tags and create the GitHub releases. Why each setting is what it is: [SECURITY.md](./SECURITY.md#supply-chain-hardening).

## First publish of a new package

npm trusted publishing can only be configured for a package name that already exists on npm, so CI cannot publish a name the first time. The owner publishes a `0.0.0` placeholder for it first (no code, just a `package.json` and a one-line README) and binds the trusted publisher to it; the Changesets release from CI then publishes `0.1.0` with provenance.

For the names that had not been published yet across the library repositories, [`scripts/npm-bootstrap.sh`](./scripts/npm-bootstrap.sh) does this in one run (its header says how to run it from a Codespace); it can be deleted once it has run. The same run repoints the AI providers' and the gateway's trusted publisher from `thomasfosterau/effect-ai-ext` to this repository, revokes `@thomasfosterau/effect-ai-ext`'s and `@thomasfosterau/effect-evals`' (merged into `@thomasfosterau/effect-ext`, so nothing publishes them again), and deprecates those two and the three effect-web packages. For a single package added later, do it by hand from a machine logged in to npm (`npm login --auth-type=web`), with npm 11.15 or later:

```sh
# in an empty directory holding a package.json: name, "version": "0.0.0", description, license,
# repository (with "directory" for a workspace package), "publishConfig": { "access": "public" }
npm publish --access public --provenance=false
npm trust github <name> --file release.yml --repository thomasfosterau/<repo> --environment release --allow-publish
```

`--provenance=false` because a local publish has no OIDC identity to attest. Check the binding with `npm trust list <name>`.

## Maintainer setup (one-time)

The `@thomasfosterau/effect-ai-*` providers and the gateway are already on npm, published from `thomasfosterau/effect-ai-ext` before it was merged here; their trusted publisher still names that repository and must be repointed (step 3) before the next release, or their publish fails auth while the others go through. Their changelogs continue in each package's `CHANGELOG.md`. `@thomasfosterau/effect-ai-ext` and `@thomasfosterau/effect-evals` (0.5.1) were merged into `@thomasfosterau/effect-ext` before its first release: they are deprecated and their trusted publisher is revoked, not repointed, and their changelogs stay on npm and in git history. The version tags (`@thomasfosterau/effect-ai-cohere@0.3.4`, …) live in effect-ai-ext: push them here before the first release (`git fetch <effect-ai-ext> 'refs/tags/*:refs/tags/*' && git push origin --tags`; the commits they name are in this history), or `changeset tag` will tag each AI package's current, already-published version again and the Release workflow will create a GitHub release for it.

`@thomasfosterau/effect-ext` has not been published yet. npm's trusted-publisher binding is configured per package on npmjs.com, which needs the package to exist — so the first release is a one-off owner action (a `0.0.0` placeholder, see [First publish of a new package](#first-publish-of-a-new-package)), after which the following steps make the automated flow work end-to-end:

0. **Rename the default branch to `trunk`** (#8). On GitHub it is still `main`, while CI, Release, Changesets and the fallow gate all target `trunk`; until the rename, no workflow runs. **Settings → General → Default branch** (GitHub retargets open PRs).
1. **Allow Actions to open the Version Packages PR.** In the repo: **Settings → Actions → General → Workflow permissions** → enable **"Allow GitHub Actions to create and approve pull requests"**. Without this the built-in `GITHUB_TOKEN` is forbidden from opening pull requests and the workflow fails at the PR-creation step — even though the job already grants `pull-requests: write`.
2. **Create and protect the `release` environment.** **Settings → Environments → New environment → `release`** → enable **Required reviewers** (yourself) and restrict deployment to the `trunk` branch, so publishing pauses for manual approval. The Release workflow names this environment; until it exists the job cannot run.
3. **Configure the trusted publisher**, for every published package: `@thomasfosterau/effect-ext`, `effect-ai-gateway`, `effect-ai-mistral`, `effect-ai-cohere`, `effect-ai-voyage` and `effect-ai-elevenlabs` (for the AI packages, replace the existing `thomasfosterau/effect-ai-ext` binding; `scripts/npm-bootstrap.sh` does all of this). Remove the `thomasfosterau/effect-ai-ext` binding of `@thomasfosterau/effect-ai-ext` and `@thomasfosterau/effect-evals` and add none. On npmjs.com, open the package → **Settings → Trusted Publisher** and add:
   - Provider: **GitHub Actions**
   - Repository: `thomasfosterau/effect-ext`
   - Workflow: `release.yml`
   - Environment: `release`

   Then remove any classic automation token for the package.

4. **Protect `trunk`.** Require pull requests and passing CI before merge, and disallow direct pushes, so a release can only be triggered by merging the reviewed "Version Packages" PR.

## Retiring the superseded packages (one-time)

The web modules came from `thomasfosterau/effect-web`, three of whose packages are on npm: `@thomasfosterau/effect-web`, `@thomasfosterau/effect-robots` and `@thomasfosterau/effect-sitemap` (0.1.0 each). Its other eight (`effect-rss-feed`, `effect-atom-feed`, `effect-json-feed`, `effect-uri-template`, `effect-langtag`, `effect-css`, `effect-encoding`, `effect-mime`) were never published. Once `@thomasfosterau/effect-ext` is released with the web modules, the owner deprecates the three, from a machine with an npm session (`npm deprecate` needs one; nothing in CI can do it):

```sh
npm deprecate @thomasfosterau/effect-web "Moved to @thomasfosterau/effect-ext (Web, Net, Observability, Negotiate, ServiceWorker, Browser, BrowserTesting)"
npm deprecate @thomasfosterau/effect-robots "Moved to @thomasfosterau/effect-ext/Robots"
npm deprecate @thomasfosterau/effect-sitemap "Moved to @thomasfosterau/effect-ext/Sitemap"
```

Then remove those packages' trusted-publisher bindings on npmjs.com, and archive `thomasfosterau/effect-web` once its open issues have been transferred here.

`@thomasfosterau/effect-ai-ext` and `@thomasfosterau/effect-evals` (0.5.1 each) merged into `@thomasfosterau/effect-ext` the same way: the AI abstractions are its subpaths `/RerankerModel` … `/VoiceConversionModel`, and the evals toolkit is `/evals` and `/evals/<Module>` with the `effect-evals` bin. `scripts/npm-bootstrap.sh` deprecates both (all versions) and revokes their trusted publisher; by hand:

```sh
npm deprecate '@thomasfosterau/effect-ai-ext@*' "Merged into @thomasfosterau/effect-ext (subpaths /RerankerModel, /ClassifierModel, /SpeechModel, /TranscriptionModel, /ImageModel, /ModerationModel, /VoiceConversionModel; upstream modules from effect/ai)"
npm deprecate '@thomasfosterau/effect-evals@*' "Merged into @thomasfosterau/effect-ext (subpath /evals and /evals/<Module>; the effect-evals bin ships with it)"
npm trust list @thomasfosterau/effect-ai-ext   # then: npm trust revoke @thomasfosterau/effect-ai-ext --id <id>
npm trust list @thomasfosterau/effect-evals    # then: npm trust revoke @thomasfosterau/effect-evals --id <id>
```
