// AWS Event Rule to OPA Rego Compiler

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
	rule_exactly_matching = "rule_exactly_matching",
	rule_value_matching = "rule_value_matching",
}

enum NestedNodeType {
	rule_nested_prefix_matching = "rule_nested_prefix_matching",
}

enum PrimitiveNodeType {
	number = "number",
	string = "string",
	object = "object",
	array = "array",
	pair = "pair",
}

function getAllRuleNodeTypes(): string[] {
	return Object.values(NodeType);
}

function unquote(str: string): string {
	return str[0] === '"' ? str.slice(1, -1) : str;
}

function getJsonPathFromQueryCaptureNode(node: Parser.SyntaxNode): string {
	const names: string[] = [];
	let iterator: Parser.SyntaxNode | null = node;
	while (iterator) {
		if (iterator.type === PrimitiveNodeType.pair) {
			const name = iterator.children[0].namedChildren[0].text;
			const type = iterator.children[0].namedChildren[0].type;
			if (type.includes("value") || !type.includes("constant")) {
				names.push(unquote(name));
			}
		}
		iterator = iterator.parent;
	}
	const ordered = names.reverse();
	// ok(ordered.length > 0);
	const path = ordered.map((n) => `["${n}"]`).join("");
	return path;
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

function emitRuleOr(n: Parser.SyntaxNode, o: string[]): string {
	let out = "";
	const ruleName = `rule_${o.length + 1}_or`;
	out += `default ${ruleName} = false\n`;
	const childPairs = n.namedChildren.filter(
		(c) =>
			c.type === PrimitiveNodeType.object &&
			c.namedChildren[0]?.type === PrimitiveNodeType.pair,
	);
	const childRules = childPairs
		.map((c) => c.namedChildren[0].namedChildren[0])
		.filter((c) => getAllRuleNodeTypes().includes(c.type));
	for (const childRule of childRules) {
		out += `${ruleName} {\n\t${emitRule(childRule, o, true)}\n}\n`;
	}
	o.push(out);
	return ruleName;
}
function emitRulePrefix(n: Parser.SyntaxNode, o: string[]): string {
	const ruleName = `rule_${o.length + 1}_prefix`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = unquote(n.namedChildren[1].text);
	o.push(
		`default ${ruleName} = false\n${ruleName} {\n\tstartswith(input${rulePath}, "${ruleTest}")\n}`,
	);
	return ruleName;
}
function emitRuleSuffix(n: Parser.SyntaxNode, o: string[]): string {
	const ruleName = `rule_${o.length + 1}_suffix`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = unquote(n.namedChildren[1].text);
	o.push(
		`default ${ruleName} = false\n${ruleName} {\n\tendswith(input${rulePath}, "${ruleTest}")\n}`,
	);
	return ruleName;
}
function emitRuleEqualsIgnoreCase(n: Parser.SyntaxNode, o: string[]): string {
	const ruleName = `rule_${o.length + 1}_equals_ignore_case`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = unquote(n.namedChildren[1].text);
	o.push(
		`default ${ruleName} = false\n${ruleName} {\n\tlower(input${rulePath}) == lower("${ruleTest}")\n}`,
	);
	return ruleName;
}
function emitRuleWildcard(n: Parser.SyntaxNode, o: string[]): string {
	const ruleName = `rule_${o.length + 1}_wildcard`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = unquote(n.namedChildren[1].text);
	o.push(
		`default ${ruleName} = false\n${ruleName} {\n\tglob.match("${ruleTest}", [], input${rulePath})\n}`,
	);
	return ruleName;
}
function emitRuleAnythingBut(n: Parser.SyntaxNode, o: string[]): string {
	let out = "";
	const ruleName = `rule_${o.length + 1}_anything_but`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = n.namedChildren[1];
	out += `default ${ruleName} = false\n`;
	if (ruleTest.type === NestedNodeType.rule_nested_prefix_matching) {
		out += `${ruleName} {\n\t${emitRulePrefix(ruleTest, o)}\n}`;
	}
	if (ruleTest.type === PrimitiveNodeType.array) {
		const val = ruleTest.text.slice(1, -1);
		out += `${ruleName} {\n\t{ ${val} } & { input[${rulePath}] } != { input[${rulePath}] }\n}`;
	}
	if (ruleTest.type === PrimitiveNodeType.string) {
		const val = unquote(ruleTest.text);
		out += `${ruleName} {\n\tinput${rulePath} != "${val}"\n}`;
	}
	if (ruleTest.type === PrimitiveNodeType.number) {
		const val = ruleTest.text;
		out += `${ruleName} {\n\tinput${rulePath} != ${val}\n}`;
	}
	o.push(out);
	return ruleName;
}
function emitRuleNumeric(n: Parser.SyntaxNode, o: string[]): string {
	let out = "";
	const ruleName = `rule_${o.length + 1}_numeric`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const firstSign = unquote(n.namedChildren[1].text);
	const firstNum = unquote(n.namedChildren[2].text);
	out += `default ${ruleName} = false\n${ruleName} {\n\tinput${rulePath} ${firstSign} ${firstNum}\n`;
	const secondSign = unquote(n.namedChildren[3]?.text || "");
	const secondNum = unquote(n.namedChildren[4]?.text || "");
	if (secondSign && secondNum) {
		out += `\tinput${rulePath} ${secondSign} ${secondNum}\n`;
	}
	out += "}";
	o.push(out);
	return ruleName;
}
function emitRuleIpAddress(n: Parser.SyntaxNode, o: string[]): string {
	const ruleName = `rule_${o.length + 1}_ip_address`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = unquote(n.namedChildren[1].text);
	o.push(
		`default ${ruleName} = false\n${ruleName} {\n\tnet.cidr_contains("${ruleTest}", input${rulePath})\n}`,
	);
	return ruleName;
}
function emitRuleExactly(n: Parser.SyntaxNode, o: string[]): string {
	const ruleName = `rule_${o.length + 1}_exactly`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = unquote(n.namedChildren[1].text);
	o.push(
		`default ${ruleName} = false\n${ruleName} {\n\tinput${rulePath} == "${ruleTest}"\n}`,
	);
	return ruleName;
}
function emitRuleExists(n: Parser.SyntaxNode, o: string[]): string {
	const ruleName = `rule_${o.length + 1}_exists`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = n.namedChildren[1].text === "true";
	o.push(
		`default ${ruleName} = false\n${ruleName} {\n\t${
			ruleTest ? `input${rulePath}` : `not input${rulePath}`
		}\n}`,
	);
	return ruleName;
}
function emitRuleValue(n: Parser.SyntaxNode, o: string[], $or = false): string {
	// hack alert: these are processed when its parent $or processes it
	if (n.parent?.parent?.parent?.type === NodeType.rule_or_matching && !$or) {
		return "";
	}
	const ruleName = `rule_${o.length + 1}_value`;
	const rulePath = getJsonPathFromQueryCaptureNode(n);
	const ruleTest = n.namedChildren[1].text.slice(1, -1);
	o.push(
		`default ${ruleName} = false\n${ruleName} {\n\t({ ${ruleTest} } & { input${rulePath} }) == { input${rulePath} }\n}`,
	);
	return ruleName;
}

function emitRule(n: Parser.SyntaxNode, o: string[], nested = false): string {
	switch (n.type) {
		case NodeType.rule_or_matching:
			return emitRuleOr(n, o);
		case NodeType.rule_prefix_matching:
			return emitRulePrefix(n, o);
		case NodeType.rule_suffix_matching:
			return emitRuleSuffix(n, o);
		case NodeType.rule_equals_ignore_case_matching:
			return emitRuleEqualsIgnoreCase(n, o);
		case NodeType.rule_wildcard_matching:
			return emitRuleWildcard(n, o);
		case NodeType.rule_anything_but_matching:
			return emitRuleAnythingBut(n, o);
		case NodeType.rule_numeric_matching:
			return emitRuleNumeric(n, o);
		case NodeType.rule_ip_address_matching:
			return emitRuleIpAddress(n, o);
		case NodeType.rule_exactly_matching:
			return emitRuleExactly(n, o);
		case NodeType.rule_exists_matching:
			return emitRuleExists(n, o);
		case NodeType.rule_value_matching:
			return emitRuleValue(n, o, nested);
		default:
			ok(false, `unhandled node type: ${n.type}`);
	}
}

export async function compile(input = process.argv[2]) {
	const parser = await createParser();
	const source = await readFile(resolve(input), "utf8");
	const tree = parser.parse(source);
	const token = "cap";
	const ruleQueries = getAllRuleNodeTypes()
		.map((q) => `(${q}) @${token}`)
		.map((q) => parser.getLanguage().query(q))
		.map((q) => q.captures(tree.rootNode))
		.flatMap((q) => q);
	const rules: string[] = [];
	const allows: string[] = [];
	for (const ruleQuery of ruleQueries) {
		ok(ruleQuery.name === token);
		const node = ruleQuery.node;
		allows.push(emitRule(node, rules));
	}
	const header = "package rule2rego\ndefault allow := false";
	const policy = rules.join("\n");
	const footer = `allow {\n${allows
		.filter(Boolean)
		.map((a) => `\t${a}`)
		.join("\n")}\n}`;
	const body = `${header}\n${policy}\n${footer}`.replace(/\n\n/g, "\n");
	if (input === process.argv[2]) {
		console.log(body);
	}
	return body;
}

if (process.argv[1].endsWith("rule2rego.ts")) {
	compile(process.argv[2]);
}
