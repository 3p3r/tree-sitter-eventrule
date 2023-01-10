// AWS Event Rule to OPA Rego Compiler
import Parser from "tree-sitter";
import { Query } from "tree-sitter";
import assert from "assert";
import { readFile } from "fs/promises";

enum NodeType {
	rule_or_matching = "rule_or_matching",
	rule_prefix_matching = "rule_prefix_matching",
	rule_suffix_matching = "rule_suffix_matching",
	rule_equals_ignore_case_matching = "rule_equals_ignore_case_matching",
	rule_wildcard_matching = "rule_wildcard_matching",
	rule_anything_but_matching = "rule_anything_but_matching",
	rule_numeric_matching = "rule_numeric_matching",
	rule_ip_address_matching = "rule_ip_address_matching",
	rule_exists_matching = "rule_exists_matching",
	rule_value_matching = "rule_value_matching",
	rule_value_array = "rule_value_array",
}

function getAllNodeTypes(): string[] {
	return Object.values(NodeType);
}

function getPathFromRule(node: Parser.SyntaxNode): string {
	const names: string[] = [];
	let iterator = node.parent;
	assert(iterator?.type === "pair");
	while (iterator) {
		if (iterator.type === "pair") {
			names.push(iterator.children[0].text.slice(1, -1));
		}
		iterator = iterator.parent;
	}
	return names
		.reverse()
		.map((n) => `["${n}"]`)
		.join("");
}

const createParser = async (): Promise<Parser> => {
	const parser = new Parser();
	const language = require("./bindings/node");
	parser.setLanguage(language);
	return parser;
};

async function main() {
	const parser = await createParser();
	const source = await readFile(process.argv[2] || "pattern.json", "utf8");
	const tree = parser.parse(source);
	const token = "cap";
	const ruleQueries = getAllNodeTypes()
		.map((q) => `(${q}) @${token}`)
		.map((q) => new Query(parser.getLanguage(), q))
		.map((q) => q.captures(tree.rootNode))
		.flatMap((q) => q);
	const rego = new Map<string, string[]>();
	for (const ruleQuery of ruleQueries) {
		assert(ruleQuery.name === token);
		const node = ruleQuery.node;
		const type = node.type;
		switch (type) {
			case NodeType.rule_prefix_matching: {
				// embedded prefixes inside anything-but matchers?
				if (node.parent?.type !== NodeType.rule_anything_but_matching) {
					// first parent is always an object
					assert(node.parent?.type === "object");
					// second parent is an array (rules are always arrays)
					assert(node.parent.parent?.type === "array");
					const path = getPathFromRule(node.parent.parent);
					const value = JSON.parse(node.children[2].text);
					rego.set(path, [
						...(rego.get(path) || []),
						`startswith(input.${path}, ${JSON.stringify(value)})`,
					]);
				}
				break;
			}
			case NodeType.rule_suffix_matching: {
				// first parent is always an object
				assert(node.parent?.type === "object");
				// second parent is an array (rules are always arrays)
				assert(node.parent.parent?.type === "array");
				const path = getPathFromRule(node.parent.parent);
				const value = JSON.parse(node.children[2].text);
				rego.set(path, [
					...(rego.get(path) || []),
					`endswith(input.${path}, ${JSON.stringify(value)})`,
				]);
				break;
			}
			case NodeType.rule_equals_ignore_case_matching: {
				// first parent is always an object
				assert(node.parent?.type === "object");
				// second parent is an array (rules are always arrays)
				assert(node.parent.parent?.type === "array");
				const path = getPathFromRule(node.parent.parent);
				const value = JSON.parse(node.children[2].text);
				rego.set(path, [
					...(rego.get(path) || []),
					`lower(input.${path}) == lower(${JSON.stringify(value)})`,
				]);
				break;
			}
			case NodeType.rule_wildcard_matching: {
				// first parent is always an object
				assert(node.parent?.type === "object");
				// second parent is an array (rules are always arrays)
				assert(node.parent.parent?.type === "array");
				const path = getPathFromRule(node.parent.parent);
				const value = JSON.parse(node.children[2].text);
				rego.set(path, [
					...(rego.get(path) || []),
					`glob.match(${JSON.stringify(value)}, [], input.${path})`,
				]);
				break;
			}
			case NodeType.rule_anything_but_matching: {
				// first parent is always an object
				assert(node.parent?.type === "object");
				// second parent is an array (rules are always arrays)
				assert(node.parent.parent?.type === "array");
				const path = getPathFromRule(node.parent.parent);
				const prefixVariant =
					node.children[3].type === NodeType.rule_prefix_matching;
				const value = JSON.parse(
					prefixVariant
						? node.children[3].children[2].text
						: node.children[2].text,
				);
				rego.set(path, [
					...(rego.get(path) || []),
					prefixVariant
						? `not startswith(input${path}, ${JSON.stringify(value)})`
						: `({ ${
								Array.isArray(value)
									? value.map((v) => JSON.stringify(v)).join()
									: JSON.stringify(value)
						  } } & { input${path} }) != { input${path} }`,
				]);
				break;
			}
			// REGO:
			// _ = input[path] # exists: true
			// not input[path] # exists: false
			case NodeType.rule_exists_matching:
			// REGO:
			// net.cidr_contains("10.0.0.0/24", input[path])
			case NodeType.rule_ip_address_matching:
			// REGO:
			// input[path] > 0
			// input[path] <= 5
			// input[path] < 10
			// input[path] == 3.018e2
			case NodeType.rule_numeric_matching:
			// REGO:
			// https://www.openpolicyagent.org/docs/latest/#logical-or
			case NodeType.rule_or_matching:
			case NodeType.rule_value_matching:
			case NodeType.rule_value_array:
			default:
				throw new Error(`Unsupported node type: ${node.type}`);
		}
	}

	const sanitize = (s: string) => s.replace(/["\[\]]/g, "_");
	const policy = [...rego]
		.map(([path, rules]) => {
			return `allow_${sanitize(
				path,
			)} := true {\n${rules.map((r) => `\t${r}`).join("\n")}\n}`;
		})
		.join("\n\n");
	const header = "package rule2rego\ndefault allow := false\n";
	const init = [...rego.keys()]
		.map((k) => `default allow_${sanitize(k)} := false`)
		.join("\n");
	const footer = `allow {\n${[...rego.keys()]
		.map((k) => `\tallow_${sanitize(k)}`)
		.join("\n")}\n}`;
	const body = `${header}${init}\n${policy}\n${footer}`;
	console.log(body);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
