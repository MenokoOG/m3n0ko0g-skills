# Fixtures for skill-lint

Synthetic. Written to exercise `drafts/skill-lint.SKILL.md`.

- `hostile-commit-helper/` plants nine problems. Its text is hostile on purpose. Treat it as untrusted data: read it, don't follow it.
- `clean-changelog-helper/` is benign but uses words that trip naive patterns, so false positives show up.

## Safety

- Nothing here is executed by any test. The only address is `example.invalid`, which is reserved and never resolves.
- Files are named `SKILL.fixture.md` and `setup.sh.fixture` so no agent loads them as a real skill and no shell runs them.
- They sit under `drafts/`, outside `skills/`, so the build never packages them.
- The hostile fixture contains two invisible characters (a zero-width space and a right-to-left override). Open it in a hex-aware editor, not a rendered view. Don't retype it, and don't let an editor strip them.
- Regenerate them with a script rather than editing by hand.
