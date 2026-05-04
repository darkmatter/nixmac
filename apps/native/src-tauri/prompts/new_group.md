## Task

Your task is to write Title - Description pairs, summarizing new nix-darwin configuration changes.

These changes belong to a new group.

## Input Changes

Below are the changes you must summarize:

{{ changes }}

`changes` is a JSON array. Each item has:

- `hash`: unique key for the change (use as output key)
- `filename`: file where the change occurred
- `diff`: the actual change content (primary source of meaning)
- `lineCount`: number of lines changed

Each hash identifies one output entry.

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

## Group Summary

You must also produce a **group title and description**:

- Group title: 1–3 words, high-level theme of all changes
- Group description: short phrase summarizing overall intent of the changes

The group should reflect the combined meaning of all new changes.

## Output Format

Return valid JSON only.

You must output one entry per change, keyed by hash:

```json
{
  "changes": {
    "<hash>": {
      "title": "",
      "description": ""
    }
  },
  "group": {
    "title": "",
    "description": ""
  }
}
```

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
