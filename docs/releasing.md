# Release guide

This plugin is distributed from GitHub. Keep `private: true` in `package.json`; no npm package or npm publishing credentials are needed.

## Validate a release candidate

1. Use Node.js 24 and run:

   ```bash
   npm ci --ignore-scripts
   npm run check
   git diff --check
   ```

2. Install the checkout on a Paseo 0.11+ test host:

   ```bash
   paseo plugin install /absolute/path/to/paseo-agy-usage
   paseo plugin ls
   paseo plugin logs paseo-agy-usage
   ```

3. Require `running` with no startup errors. In **Settings → Usage**, check the account email, the plan badge without a duplicate Plan row, the four quota windows, percentages, and reset countdowns. Check both light and dark themes. Renew an expired login through `agy`, then refresh usage.
4. Review public files for credentials and private account details. Use sample data or redact the account email in screenshots.

The automated suite covers behavior through discovery and fetch. Its OS and network I/O are fixtures, so CI does not replace real credential-store verification. Windows has been exercised against a live login; macOS and Linux remain host-acceptance tasks.

## Publish a GitHub Release

1. Update `package.json` to the intended version. `0.1.0` is reserved for the first release. Synchronize the lockfile:

   ```bash
   npm install --package-lock-only --ignore-scripts
   ```

2. Move the relevant `CHANGELOG.md` entries from **Unreleased** to the version being released. The plugin manifest has no separate version field; `package.json` is the version source of truth.
3. Commit the release changes, push `main`, and wait for CI to pass.
4. Tag that tested commit, using the same version as `package.json`:

   ```bash
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
   ```

The release workflow validates the tag and lockfile versions, checks that the commit belongs to `main`, runs the checks, and creates a GitHub Release with generated notes. GitHub supplies ZIP and tar.gz source archives. The workflow uses the built-in `GITHUB_TOKEN` with repository-content write access; it does not publish to npm.

If checks fail, fix the candidate before publishing. The workflow can be re-run after a transient infrastructure failure. Once a release is public, keep its tag immutable and publish corrections as a new version.

## Verify direct Git installation

Use the exact released tag on a test daemon. If the local development plugin is enabled, disable it first: the usage source ID `antigravity` is global, so two copies cannot run together. An alternate plugin ID preserves the development installation's source configuration.

```bash
paseo plugin disable paseo-agy-usage
paseo plugin add git:breathi3552/paseo-agy-usage --ref v0.1.0 --id paseo-agy-usage-release-check
paseo plugin ls
paseo plugin logs paseo-agy-usage-release-check
```

Paseo runs the manifest's locked runtime-dependency installation. Verify the Usage card, then remove the temporary installation and re-enable the development plugin. Restore the development plugin even if the smoke test fails. On a separate test daemon with no development copy, omit the disable/enable commands.

```bash
paseo plugin remove paseo-agy-usage-release-check
paseo plugin enable paseo-agy-usage
```

The selector chooses the initial content; `--ref` is not a permanent update pin. See [Paseo plugin sources](https://paseo.sh/docs/plugins/reference#plugin-sources) for update behavior.

## Submit to the Paseo registry

Repository publication and registry approval are separate steps. After host acceptance and a GitHub Release:

1. Open the [plugin submission form](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml).
2. Use **Antigravity Usage** as the title and provide `https://github.com/breathi3552/paseo-agy-usage` with the release tag as the source.
3. Prepare a redacted screenshot of the native Usage card before submission. Visual listings require an interface image; the icon does not count. Either commit the screenshot under `assets/` and declare it in manifest `media`, or provide a public image URL in the submission or review PR. The public-URL route does not require a manifest change.
4. The repository already includes an English `OVERVIEW.md`, a PNG listing icon, the SVG usage-source icon, and a locked preparation command.

After approval, users can install the registry listing without the `git:` prefix. Until then, document direct Git installation.
