# m3n0ko0g-skills

Lives on: Windows F:\classHuman\m3n0ko0g-skills
Status: active
Updated: 2026-10-10

## What it is
The free M3n0ko0g skills library: 12 skills for auditing legacy AI systems, an MCP server, two scouts (Python and TypeScript), receipt tools, and the FINAL AUTHORITY game. Zero dependencies. Public repo, free side of classHuman AI LLC.

## Now
- `skill-lint` is a draft in `drafts/` (not in `skills/`, so the build cannot ship it). Fixtures and test results are in `drafts/tests/`.
- Status: draft. Tests so far are circular (author wrote both skill and fixture) and no real hostile sample has been reviewed.

## Next
1. Run `skill-lint` on a real hostile or suspicious skill, ideally one Lawrence did not write.
2. Then promote: move to `skills/`, change "twelve" to "thirteen" in README.md, package.json, mcp/README.md, mcp/package.json, CHANGELOG.md, add the REGISTRY row, bump the 2 count assertions in `mcp/test-server.mjs` (lines 133, 221), run `npm run build:skills` and `npm test`. Dry run passed on 2026-10-10.

## Open rulings
- Hold in drafts until step 1 above is done · decided: held, 2026-10-10, picked by Claude on Lawrence's delegation · reverse by saying promote
- Audit pass or general track? · who decides: Lawrence · evidence: it reviews third-party skills, not legacy AI systems, so general track is the default and is what the build assigns
- Renormalize the 4 CRLF fixtures (`scouts/typescript/fixture/*`, `tools/receipt/receipt.ts`)? · who decides: Lawrence · evidence: 323-line diff, no test depends on CRLF, separate PR

## Links
- Repo: https://github.com/MenokoOG/m3n0ko0g-skills · Registry: REGISTRY.md · Contributing: CONTRIBUTING.md

<!-- One page max. Overwrite as things change. History goes in log/. -->
