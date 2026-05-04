**Grouping rules**

- Hash is the key for each change. Filename, lines and diff are sources of meaning.
- One user goal touching many files should be a single group.
- Artifacts and generated files (lock files, backups, generated paths) belong to the group of the change that caused them.
- Assign a numeric `group_id` to each group.
- Changes may legitimately be **standalone** (no group relation).

At the end provide shared `group_id` integers and a short one-sentence `reason` for why each change belongs to that group or is standalone. Keep each `reason` under 150 characters and avoid newlines.
