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
