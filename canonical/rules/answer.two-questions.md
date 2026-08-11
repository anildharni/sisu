---
kind: rule
id: answer.two-questions
title: "The two questions"
section: answer
order: 10
---

This repository carries an agent-governance harness. Before changing anything, answer two
questions **from the repository alone**:

1. **What am I allowed to change here?** — the autonomy tiers, the change-control paths, and
   the enforcement table at the end of this file, which states for every control whether it
   is a wall and against which actor.
2. **How will I know I didn't break it?** — run the oracles listed under Session protocol
   (never trust a number written in prose), keep every ratchet tightening, and leave the run
   in the ledger.

Nothing in this file is live state. Counts and dates are narratives of why things are where
they are; the commands are the truth. Where this file and a command disagree, the command wins
— and the disagreement is a lesson worth capturing.
