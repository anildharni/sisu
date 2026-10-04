# overrides/ — whole-file replacements of canonical sources

Mirror the canonical path: `overrides/mechanisms/<id>.md`, `overrides/rules/<id>.md`,
`overrides/roles/<name>.md`. Copy the canonical file, add
`based-on-canonical-hash: sha256:<hash>` to its frontmatter (`sisu doctor` prints the current
hash), edit, re-emit. Patching or merging is never done: an override replaces the whole file.
`upgrade` flags an override whose canonical base changed (stale-base) or disappeared (orphan).
