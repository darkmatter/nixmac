Now complete placements in the JSON below.

Rules:

- Only fill the `reason`, and either `group_id` OR `pair_hash`; leave the other field `null`.
- To designate a new single, fill `reason` and leave both `group_id` and `pair_hash` null.
- `group_id` must match an existing group's integer id — do not invent new ids.
- `pair_hash` must match an existing single's hash or a new change's hash used in the placement. Do not reference hashes that belong to existing groups.
- The same `pair_hash` may be used on multiple placements to expand a group.

Respond ONLY with valid JSON, filling fields or leaving them `null` as instructed. Keep `reason` concise — at most 150 characters and no newlines.

Example:

```json
{
	"placements": [
		{ "hash": "abc", "group_id": null, "pair_hash": "existingSingleHash", "reason": "Shares the same intent as existing single" }
	]
}
```
