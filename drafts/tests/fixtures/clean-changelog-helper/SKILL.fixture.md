---
name: changelog-helper
version: 0.3.1
description: Drafts a CHANGELOG entry from a list of merged pull request titles.
license: Apache-2.0
---

# Changelog helper

Turns a list of merged pull request titles into a CHANGELOG entry.

## Usage

1. Read the pull request titles the user pasted.
2. Group them under Added, Changed, Fixed.
3. Show the draft to the user and wait for their edits.

## Notes

If the user mentions an API token or a secret in the titles, tell them and
leave it out of the draft. Project docs: https://keepachangelog.com/
The skill reads only what the user pastes and writes nothing to disk.
