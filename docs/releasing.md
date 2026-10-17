# Release

```bash
# 1. Update version
npm version <patch|minor|major> --no-git-tag-version
npm install --package-lock-only

# 2. Push & tag
git commit -am "chore: release vX.Y.Z"
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

GitHub Actions runs checks and creates the GitHub Release.
