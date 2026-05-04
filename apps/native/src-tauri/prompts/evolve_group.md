## Task

You are generating Title–Description pairs summarizing new nix-darwin configuration changes.

These changes belong to a group that already contains existing summarized changes.

Your job is to:

1. Use existing group context for consistency
1. Summarize only the new changes provided
1. Fill in missing fields in a pre-constructed JSON structure

## Existing Group Context

You are given summaries of already-processed group members:

{{ existing_summary }}

Each entry is formatted as:

`Title - Description`

Use this for:

- understanding group intent
- maintaining naming consistency
- avoiding redundancy

## New Changes

You will summarize the following new changes:

{{ new_changes }}

`new_changes` is a JSON array. Each item has:

- `hash`: unique key for the change (use as output key)
- `filename`: file where the change occurred
- `diff`: the actual change content (primary source of meaning)
- `lineCount`: number of lines changed

## Instructions

### Titles

- 1–3 words maximum
- Name the subject (filename is primary signal)
- Examples:
  - Git Config
  - SSH Keys
  - Editor Theme
- Avoid:
  - verbs (Update, Add, Remove)
  - adjectives (New, Another)

### Descriptions

- Short, readable phrases
- Must reflect actual diff changes
- Include concrete values when relevant:
  - config keys
  - package names
  - settings

### Consistency Rule

- Match tone and naming style of existing_summary
- Avoid duplicating already-described behavior

## Output Mapping Rules

- The `changes` object is pre-structured and indexed by hash
- Each `hash` corresponds to exactly one change entry
- You must only fill:
  - `title`
  - `description`
- Do NOT modify keys or structure

## Required Hashes

`new_hashes` is a list of string values (each value is a change hash).

You must produce outputs for all of the following hashes:

{{ new_hashes }}

Each hash listed above MUST appear in the output under `changes`.

## Output Format

Return valid JSON matching this schema:

- `changes`: object keyed by hash
  - each value has:
    - `title` (string)
    - `description` (string)
- `group`:
  - `title` (string)
  - `description` (string)

Rules:

- Do not include any fields not specified
- All hashes from input must appear in changes
- All values must be non-empty
- No extra commentary

### Example Output

```json
{
  "changes": {
    "a1b2c3": {
      "title": "Git Config",
      "description": "user.name set to Scott, user.email updated"
    },
    "d4e5f6": {
      "title": "Shell Tools",
      "description": "added ripgrep and fd packages"
    }
  },
  "group": {
    "title": "Dev Environment",
    "description": "git identity and CLI tooling configuration updates"
  }
}
```
