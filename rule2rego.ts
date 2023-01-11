// AWS Event Rule to OPA Rego Compiler
// fixme: get rid of all JSON.stringify() and JSON.parse() calls.
// they are used as shortcuts to quickly unwrap tiny inner tree-sitter nodes.

import Parser from "web-tree-sitter";
import { ok } from "assert";
import { readFile } from "fs/promises";
import { resolve } from "path";

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

function nodeIncludesSubNode(
	node: Parser.SyntaxNode,
	subnode: Parser.SyntaxNode,
): boolean {
	return (
		node.startIndex <= subnode.startIndex && node.endIndex >= subnode.endIndex
	);
}

function unquote(str: string): string {
	return str[0] === '"' ? str.slice(1, -1) : str;
}

interface Meta {
	// name of the rule
	readonly name: string;
	// path to use with "input"
	readonly path: string;
}

function getJsonPathFromQueryCaptureNode(node: Parser.SyntaxNode): Meta {
	const names: string[] = [];
	let iterator: Parser.SyntaxNode | null = getNextNodeUp(node, "pair");
	const add$or = () => {
		const indexInParent = iterator!.children[0].namedChildren.findIndex((n) =>
			nodeIncludesSubNode(n, node),
		);
		const current$orCount = names.filter((n) => n.startsWith("$or")).length + 1;
		names.push(`$or_${indexInParent}_${current$orCount}`);
	};
	while (iterator) {
		if (iterator.type === "pair") {
			const name = iterator.children[0].namedChildren[0].text;
			if (name === '"$or"') {
				add$or();
			} else if (
				// checks to see if this is a constant key of one of the rule matchings
				!iterator.namedChildren[0]?.namedChildren[0]?.type.includes("constant")
			) {
				names.push(unquote(name));
			}
		}
		iterator = iterator.parent;
	}
	const ordered = names.reverse();
	// remove names immediately following an $or, this makes these rules share the
	// same path and allows us to use the same rego expression for both rules that
	// makes it represent a logical OR
	const squished: string[] = [];
	for (let i = 0; i < ordered.length; i++) {
		if (ordered[i - 1]?.startsWith("$or") && !ordered[i].startsWith("$or")) {
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

function getNextNodeUp(
	node: Parser.SyntaxNode,
	type = "pair",
): Parser.SyntaxNode | null {
	ok(node.type.startsWith("rule_"));
	let iterator: Parser.SyntaxNode | null = node;
	while (iterator.type !== type) {
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
	const language = await Parser.Language.load(
		resolve(__dirname, "tree-sitter-eventrule.wasm"),
	);
	parser.setLanguage(language);
	return parser;
};

export async function compile(input = process.argv[2]) {
	const parser = await createParser();
	const source = await readFile(resolve(input), "utf8");
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
		ok(ruleQuery.name === token);
		const node = ruleQuery.node;
		const type = node.type;
		switch (type) {
			case NodeType.rule_prefix_matching: {
				// check for embedded prefixes inside anything-but matchers
				if (node.parent?.type !== NodeType.rule_anything_but_matching) {
					const { path, name } = getJsonPathFromQueryCaptureNode(node);
					const value = JSON.parse(node.children[2].text);
					emitRego(name, `startswith(input${path}, ${JSON.stringify(value)})`);
				}
				break;
			}
			case NodeType.rule_suffix_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(name, `endswith(input${path}, ${JSON.stringify(value)})`);
				break;
			}
			case NodeType.rule_equals_ignore_case_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(
					name,
					`lower(input${path}) == lower(${JSON.stringify(value)})`,
				);
				break;
			}
			case NodeType.rule_wildcard_matching: {
				const { path, name } = getJsonPathFromQueryCaptureNode(node);
				const value = JSON.parse(node.children[2].text);
				emitRego(
					name,
					`glob.match(${JSON.stringify(value)}, [], input${path})`,
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
				ok(
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
	if (input === process.argv[2]) {
		console.log(body);
	}
	return body;
}
