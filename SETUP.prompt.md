# SETUP — run this in your agent (no API key, no LLM call by sisu)

You are working in the repository for **sisu**: Agent-governance harness generator: installs roles, change-control tiers, quality ratchets, hooks, an accreting knowledge base and an audit ledger into a software project. Private, internal; never published.

Read `CLAUDE.md` first. Then, as the `scout` and `librarian` roles:

1. Read the real codebase (entry points, tests, configs). Do not trust any document's numbers.
2. For each non-obvious, verifiable fact about this codebase (where an invariant is enforced,
   which oracle covers an area, a convention with its example), run
   `node harness/scripts/capture.mjs "<claim>" --applies-to <path>` and fill `why` and a
   verification handle. Write into `project/knowledge/candidate/` ONLY — never into `active/`.
   The first agent run must not bypass the promotion gate that exists to contain its mistakes.
3. Fill `project/roles/domain-guide.md` with this product's domain vocabulary and invariants.
4. Run the oracles in the Session protocol table and report real numbers.
5. End with a Handoff Block and `node harness/scripts/ledger.mjs end`.
