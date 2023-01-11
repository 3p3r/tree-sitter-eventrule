# tree-sitter-eventrule
Grammar for AWS Event Rules: https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns-content-based-filtering.html

![Syntax Highlighting](highlight.png)

## `rule2rego` utility

```bash
$ npm install -g tree-sitter-eventrule
$ rule2rego --help
Compiles AWS Event Rule pattern JSON to OPA REGO policy.
Usage: rule2rego <rule>.json
```

## adding e2e compiler tests

Jest picks up your tests automatically if you follow these instructions:

- Add your rule JSON `<rule name>.json` under `test/fixtures`
- With the same name, create a directory `<rule name>`
- Create two additional directories `allows` and `denies` inside it
- Any JSON you put in either of those two folder is picked as an event

`npm test` output is sorted alphabetically.

Sample directory structure:

```raw
- test/fixtures
  - prefix-matching.json
  - prefix-matching
    - allows
      - event1.json
      - event2.json
    - denies
      - event1.json
      - event2.json
```
