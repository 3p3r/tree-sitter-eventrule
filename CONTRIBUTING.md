# Contributing

This guide will get you started with being able to build and run the test suite for this application.

## Requirements

- [Open Policy Agent (OPA)](https://www.openpolicyagent.org/docs/latest/#1-download-opa) installed and on `$PATH`

## Setup

- Clone the repository
- Install dependencies `npm i`
- Build the wasm for tests `npm run build-wasm`
- Run the tests `npm test`

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
