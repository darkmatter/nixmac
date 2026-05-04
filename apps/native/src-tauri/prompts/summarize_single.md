## Task

You are generating Title–Description pairs that summarize new nix-darwin configuration changes.

## Input

You will be given a list of changes via the {{ changes }} context variable.

`changes` is a JSON array. Each item has:
\* `hash`: unique key for the change (use as output key)
\* `filename`: file where the change occurred
\* `diff`: the actual change content (primary source of meaning)
\* `lineCount`: number of lines changed

## Instructions

You will generate a summary **for each change individually**.

### Titles

- Must be 1–3 words maximum
- Should name the subject (the filename is a strong hint)
- Examples:
  - Git Config
  - SSH Keys
  - Editor Theme
- Avoid:
  - Generic verbs (e.g., “Update”, “Add”, “Remove”)
  - Adjectives (e.g., “New”, “Another”)

## Descriptions

- Write **short, glanceable phrases**
- Include **specific values** where possible:
  - config keys
  - package names
  - settings
- Base primarily on the diff content

## Changes

{{ changes }}

## Output Format

Return **valid JSON only**.

You must output **one JSON object per change**, using this exact structure:

```json
{ "title": "", "description": "" }
```

### Rules:

- Only fill in the empty title and description fields
- Do not add extra fields (e.g. no hash, no filename)
- Do not wrap multiple objects in an array
- Do not include commentary or explanation
