# Changesets

Each pull request that changes the published extension should include a
changeset:

```bash
npm run changeset
```

Choose `patch`, `minor`, or `major`, then describe the user-visible change. The
release workflow collects pending changesets into a version pull request.
Merging that pull request packages the VSIX, publishes it to Visual Studio
Marketplace, and creates a matching GitHub release.

Documentation-only and internal maintenance changes may use an empty
changeset:

```bash
npm run changeset -- --empty
```
