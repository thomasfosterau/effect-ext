# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via GitHub's [**Report a vulnerability**](https://github.com/thomasfosterau/effect-ext/security/advisories/new) button (Security → Advisories), **not** through public issues.

You can expect an initial response within a few days. Please include a description, reproduction steps, and the affected package and version.

## Credentials

An AI provider client takes its API key only as a `Redacted` value you pass, or one its `layerConfig` loads through `Config.Redacted`; the only implicit read is `@thomasfosterau/effect-ai-gateway`'s `…FromUrl` variants, which load `CF_AIG_TOKEN` through `Config`. The gateway's BYOK routes take no provider key at all. A way for a key to leak into a log line, a span attribute, an error message, or a request to a host other than the configured `apiUrl` is in scope.

## Supply-chain hardening

These packages are published with a hardened, automated pipeline designed to resist supply-chain attacks (e.g. self-propagating npm worms that steal credentials and publish trojanized versions):

- **No long-lived npm token.** Releases use npm [**OIDC Trusted Publishing**](https://docs.npmjs.com/trusted-publishers): GitHub Actions proves its identity to npm with a short-lived, workflow-bound OIDC token. There is no `NPM_TOKEN` secret to steal from CI. The publish step uses the npm CLI directly (`npm publish` of a `pnpm pack` tarball), pinned to an exact npm version in the release job (npm >= 11.5.1 is needed for OIDC, newer than the npm Node 22 bundles) rather than `npm@latest`, which would put whatever the registry serves that day into the job holding `id-token: write`. pnpm 11's `pnpm publish` also performs the OIDC exchange natively; the npm CLI path is kept for now.
- **Provenance.** npm attaches [provenance](https://docs.npmjs.com/generating-provenance-statements) — the statement cryptographically linking an artifact to its source commit and workflow — automatically under trusted publishing when the source repository and the package are both public, as this repository is. Nothing requests it explicitly: do not add `--provenance` or `NPM_CONFIG_PROVENANCE=true`, which would fail the publish if the repository were ever made private.
- **Install scripts disabled in the release job.** The release workflow installs dependencies with `pnpm install --frozen-lockfile --ignore-scripts`, and turns off pnpm 11's `verify-deps-before-run` for that job (`pnpm_config_verify_deps_before_run: "false"`) so a later `pnpm run` / `pnpm exec` cannot silently re-install with scripts (pnpm 11 reads only the `pnpm_config_*` spelling), and `scripts/release.sh` packs with `pnpm pack --config.ignore-scripts=true` (`pnpm pack` has no `--ignore-scripts` flag); a compromised (transitive) dependency cannot execute install hooks in the privileged publish job. CI installs with scripts because the type gate needs the Effect-patched `tsc` that `prepare` produces; `allowBuilds` in `pnpm-workspace.yaml` names the only packages whose install scripts may run.
- **Pinned actions.** All GitHub Actions are pinned to full commit SHAs, so a hijacked tag cannot inject malicious workflow code.
- **Least privilege.** Workflows default to `permissions: {}`; each job opts into only the scopes it needs. CI checks out with `persist-credentials: false`.
- **Manual approval gate.** Publishing runs in a protected `release` environment that requires manual approval.
- **Locked dependencies.** Installs use `pnpm install --frozen-lockfile` against the committed `pnpm-lock.yaml`; Dependabot proposes updates for review. pnpm's `minimumReleaseAge` holds a newly published version for 8 hours before it installs, and Dependabot's `cooldown` waits a day. CI also runs `pnpm audit --audit-level high`.

## Release pipeline

The publishing pipeline and its one-time maintainer setup (trusted publisher, protected `release` environment, branch protection) are documented in [PUBLISHING.md](./PUBLISHING.md).
