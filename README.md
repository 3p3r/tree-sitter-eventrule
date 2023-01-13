# tree-sitter-eventrule

Grammar for AWS Event Rules:
https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns-content-based-filtering.html

![Syntax Highlighting](highlight.png)

## `rule2rego` utility

This utility is shipped with the npm package and is a small compiler that makes
OPA REGO policies from AWS Event Rule patterns. It requires NodeJS version which
is capable of running WASM binaries (recent version). WASM is used to parse the
JSON input and generate the REGO policy.

```bash
$ npm install -g tree-sitter-eventrule
$ rule2rego --help
Compiles AWS Event Rule pattern JSON to OPA REGO policy.
Usage: rule2rego <rule>.json
```

For example, for the following input Rule Event:

```json
// Effect of "source" && ("metricName" || "namespace")
{
  "source": ["aws.cloudwatch"],
  "$or": [
    { "metricName": ["CPUUtilization", "ReadLatency"] },
    { "namespace": ["AWS/EC2", "AWS/ES"] }
  ]
}
```

You will get the following REGO policy output:

```rego
package rule2rego
default allow := false
default allow_or_metricName := false
default allow_or_namespace := false
default allow_or := false
default allow_source := false
allow_or_metricName {
	({ "CPUUtilization", "ReadLatency" } & { input["metricName"] }) == { input["metricName"] }
}
allow_or_namespace {
	({ "AWS/EC2", "AWS/ES" } & { input["namespace"] }) == { input["namespace"] }
}
allow_or {
	allow_or_metricName
}
allow_or {
	allow_or_namespace
}
allow_source {
	({ "aws.cloudwatch" } & { input["source"] }) == { input["source"] }
}
allow {
	allow_or
	allow_source
}
```

## adding e2e compiler tests

If you want to run the tests locally, you need to have:

- Docker for Tree Sitter to build you a `.wasm` artifact
- OPA for Jest to build you `.wasm` policies for evaluation

Jest picks up your tests automatically if you follow these instructions:

- Add your rule JSON `<rule name>.json` under `test/fixtures`
- With the same name, create a directory `<rule name>`
- Create two additional directories `allows` and `denies` inside it
- Any JSON you put in either of those two folders, is picked as an event JSON

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
