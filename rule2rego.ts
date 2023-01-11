// AWS Event Rule to OPA Rego Compiler
import Parser, { SyntaxNode } from "web-tree-sitter";

import { Query } from "web-tree-sitter";
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

interface Meta {
	// name of the rule
	readonly name: string;
	// path to use with "input"
	readonly path: string;
}

function getJsonPathFromQueryCaptureNode(node: Parser.SyntaxNode): Meta {
	const names: string[] = [];
	let iterator: Parser.SyntaxNode | null = getNextPairUp(node);
	while (iterator) {
		if (iterator.type === "pair") {
			if (iterator.children[0].type === NodeType.rule_value_matching) {
				names.push(JSON.parse(iterator.children[0].namedChildren[0].text));
			} else {
				names.push(JSON.parse(iterator.children[0].text));
			}
		}
		if (iterator.type === NodeType.rule_or_matching) {
			const currentOrCount = names.findIndex((n) => n === "$or") + 1;
			names.push(`$or${currentOrCount}`);
		}
		iterator = iterator.parent;
	}
	const ordered = names.reverse();
	// remove names immediately following an $or, this makes these rules share the
	// same path and allows us to use the same rego expression for both rules that
	// makes it represent a logical OR
	const squished: string[] = [];
	for (let i = 0; i < ordered.length; i++) {
		if (ordered[i - 1]?.startsWith("$or")) {
			continue;
		}
		squished.push(ordered[i]);
	}
	return {
		name: squished.map((n) => `["${n}"]`).join(""),
		path: ordered
			.filter((n) => !n.startsWith("$or"))
			.map((n) => `["${n}"]`)
			.join(""),
	};
}

function getNextPairUp(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
	let iterator: SyntaxNode | null = node;
	while (iterator.type !== "pair") {
		iterator = iterator.parent;
		if (!iterator) {
			return null;
		}
	}
	return iterator;
}

const createParser = async (): Promise<Parser> => {
	await Parser.init();
	const parser = new Parser();
	const language = await Parser.Language.load("tree-sitter-eventrule.wasm");
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
		.map((q) => parser.getLanguage().query(q))
		.map((q) => q.captures(tree.rootNode))
		.flatMap((q) => q);
	const rego = new Map<string, string[]>();
	const emitRego = (name: string, expr: string) => {
		rego.set(name, [...(rego.get(name) || []), expr]);
	};
	for (const ruleQuery of ruleQueries) {
		assert(ruleQuery.name === token);
		const node = ruleQuery.node;
		const type = node.type;
		switch (type) {
			case NodeType.rule_prefix_matching: {
				// check for embedded prefixes inside anything-but matchers
				if (node.parent?.type !== NodeType.rule_anything_but_matching) {
					const { path, name } = getJsonPathFromQueryCaptureNode(node);
					const value = JSON.parse(node.children[2].text);
					emitRego(name, `startswith(input.${path}, ${JSON.stringify(value)})`);
				}
				break;
			}
			case NodeType.rule_suffix_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(name, `endswith(input.${path}, ${JSON.stringify(value)})`);
				break;
			}
			case NodeType.rule_equals_ignore_case_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(
					name,
					`lower(input.${path}) == lower(${JSON.stringify(value)})`,
				);
				break;
			}
			case NodeType.rule_wildcard_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(
					name,
					`glob.match(${JSON.stringify(value)}, [], input.${path})`,
				);
				break;
			}
			case NodeType.rule_anything_but_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const prefixVariant =
					node.children[3]?.type === NodeType.rule_prefix_matching;
				const value = JSON.parse(
					prefixVariant
						? node.children[3].children[2].text
						: node.children[2].text,
				);
				emitRego(
					name,
					prefixVariant
						? `not startswith(input${path}, ${JSON.stringify(value)})`
						: `({ ${
								Array.isArray(value)
									? value.map((v) => JSON.stringify(v)).join()
									: JSON.stringify(value)
						  } } & { input${path} }) != { input${path} }`,
				);
				break;
			}
			case NodeType.rule_exists_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(name, value ? `input${path}` : `not input${path}`);
				break;
			}
			case NodeType.rule_ip_address_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(
					name,
					`net.cidr_contains(${JSON.stringify(value)}, input${path})`,
				);
				break;
			}
			case NodeType.rule_numeric_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const firstSign = JSON.parse(node.namedChildren[1].text);
				const firstNum = JSON.parse(node.namedChildren[2].text);
				emitRego(name, `input${path} ${firstSign} ${firstNum}`);
				const secondSign = JSON.parse(node.namedChildren[3]?.text || "null");
				const secondNum = JSON.parse(node.namedChildren[4]?.text || "null");
				if (secondSign && secondNum) {
					emitRego(name, `input${path} ${secondSign} ${secondNum}`);
				}
				break;
			}
			case NodeType.rule_value_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(
					name,
					`({ ${value
						.map((v: Array<string | number>) => JSON.stringify(v))
						.join()} } & { input${path} }) == { input${path} }`,
				);
				break;
			}
			default:
				// NodeType.rule_value_array:
				// these are always embedded in a rule or inside a "rule_value_matching"
				// and in either situations, this type handled in one of the cases above
				// NodeType.rule_or_matching:
				// these are handled by "squishing" them in rule paths.
				assert(
					type === NodeType.rule_value_array ||
						type === NodeType.rule_or_matching,
				);
				break;
		}
	}

	const ruleNameForPath = (path: string) =>
		`allow${path
			.replace(/[^\w\d]/g, "_")
			.replace(/_+/g, "_")
			.replace(/_$/, "")}`;
	const header = "package rule2rego\ndefault allow := false\n";
	const init = [...rego.keys()]
		.map((k) => `default ${ruleNameForPath(k)} := false`)
		.join("\n");
	const policy = [...rego]
		.flatMap(([path, rules]) =>
			rules.map((r) => `${ruleNameForPath(path)} {\n\t${r}\n}`),
		)
		.join("\n\n");
	const footer = `allow {\n${[...rego.keys()]
		.map((k) => `\t${ruleNameForPath(k)}`)
		.join("\n")}\n}`;
	const body = `${header}${init}\n${policy}\n${footer}`;
	console.log(body);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
