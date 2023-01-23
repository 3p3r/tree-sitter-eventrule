#!/usr/bin/env node
const { compile } = require("../dist/main");

if (process.argv.length !== 3) {
	console.error("Usage: rule2rego <rule>.json");
	process.exit(1);
}

if (process.argv[2].toLowerCase().endsWith("help")) {
	console.log("Compiles AWS Event Rule pattern JSON to OPA REGO policy.");
	console.log("Usage: rule2rego <rule>.json");
	process.exit(0);
}

compile().catch((e) => {
	console.error(e);
	process.exit(1);
});
