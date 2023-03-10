// AWS Event Rule to OPA Rego Compiler

import Parser from "web-tree-sitter";
import { ok } from "assert";
import { readFile, stat, readdir } from "fs/promises";
import { resolve, relative } from "path";

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

interface RuleData {
	readonly name: string;
	readonly inputPath: string;
}

function getJsonPathFromQueryCaptureNode(node: Parser.SyntaxNode): RuleData {
	const paths: string[] = [];
	const names: string[] = [];
	let iterator: Parser.SyntaxNode | null = node;
	while (iterator) {
		if (iterator.type === PrimitiveNodeType.pair) {
			const name = iterator.children[0].namedChildren[0].text;
			const type = iterator.children[0].namedChildren[0].type;
			if (
				name === '"$or"' ||
				type.includes("value") ||
				!type.includes("constant")
			) {
				names.push(unquote(name));
				if (name !== '"$or"') {
					paths.push(unquote(name));
				}
			}
		}
		iterator = iterator.parent;
	}
	const orderedPaths = paths.reverse();
	const orderedNames = names.reverse();
	ok(orderedNames.length > 0);
	const ruleName = orderedNames
		.map((n) => n.replace(/[^\w\d]+/g, ""))
		.join("_");
	const inputPath = orderedPaths.map((n) => `["${n}"]`).join("");
	return { name: `allow_${ruleName || "or"}`, inputPath };
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

function emitRuleOr(context: Context): string {
	let out = "";
	const { name } = getJsonPathFromQueryCaptureNode(context.node);
	const childObjects = context.node.namedChildren.filter(
		(c) => c.type === PrimitiveNodeType.object,
	);
	for (const childObject of childObjects) {
		const childRules = childObject.namedChildren
			.filter(
				(c) =>
					c.type === PrimitiveNodeType.pair &&
					getAllRuleNodeTypes().includes(c.namedChildren[0].type),
			)
			.map((c) => c.namedChildren[0]);
		if (childRules.length > 0) {
			out += `${name} {\n`;
			for (const childRule of childRules) {
				out += `\t${emitRule({ ...context, node: childRule })}\n`;
			}
			out += "\n}\n";
		}
	}
	context.rules.push(out);
	return name;
}
function emitRulePrefix(context: Context): string {
	const { name: firstPart, inputPath } = getJsonPathFromQueryCaptureNode(
		context.node,
	);
	const secondPart =
		context.node.parent?.type === NodeType.rule_anything_but_matching
			? "_prefix"
			: "";
	const name = `${firstPart}${secondPart}`;
	const ruleTest = unquote(context.node.namedChildren[1].text);
	// handle input value as string
	context.rules.push(
		`${name} {\n\tstartswith(input${inputPath}, "${ruleTest}")\n}`,
	);
	// handle input value as array
	context.rules.push(
		`${name} {\n\tstartswith(input${inputPath}[_], "${ruleTest}")\n}`,
	);
	return name;
}
function emitRuleSuffix(context: Context): string {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	// handle input value as string
	context.rules.push(
		`${name} {\n\tendswith(input${inputPath}, "${ruleTest}")\n}`,
	);
	// handle input value as array
	context.rules.push(
		`${name} {\n\tendswith(input${inputPath}[_], "${ruleTest}")\n}`,
	);
	return name;
}
function emitRuleEqualsIgnoreCase(context: Context): string {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(
		`${name} {\n\tlower(input${inputPath}) == "${ruleTest.toLowerCase()}"\n}`,
	);
	context.rules.push(
		`${name} {\n\tlower(input${inputPath}[_]) == "${ruleTest.toLowerCase()}"\n}`,
	);
	return name;
}
function emitRuleWildcard(context: Context): string {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(
		`${name} {\n\tglob.match("${ruleTest}", [], input${inputPath})\n}`,
	);
	return name;
}
function emitRuleAnythingBut(context: Context): string {
	let out = "";
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = context.node.namedChildren[1];
	if (ruleTest.type === NestedNodeType.rule_nested_prefix_matching) {
		out += `${name} {\n\tnot ${emitRule({ ...context, node: ruleTest })}\n}`;
	}
	if (ruleTest.type === PrimitiveNodeType.array) {
		const val = ruleTest.text.slice(1, -1);
		out += `${name} {\n\t{ ${val} } & { input${inputPath} } != { input${inputPath} }`;
		out += `\n\tcount([match | v := input${inputPath}[_]; s := [ ${val} ][_]; s == v; match := v]) == 0\n}`;
	}
	if (ruleTest.type === PrimitiveNodeType.string) {
		const val = unquote(ruleTest.text);
		out += `${name} {\n\tinput${inputPath} != "${val}"\n}`;
	}
	if (ruleTest.type === PrimitiveNodeType.number) {
		const val = ruleTest.text;
		out += `${name} {\n\tinput${inputPath} != ${val}\n}`;
	}
	context.rules.push(out);
	return name;
}
function emitRuleNumeric(context: Context): string {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const firstSign = unquote(context.node.namedChildren[1].text);
	const firstNum = unquote(context.node.namedChildren[2].text);
	const rules = ["", ""];
	rules[0] += `${name} {\n\tinput${inputPath} ${firstSign} ${firstNum}\n`;
	rules[1] += `${name} {\n\tinput${inputPath}[_] ${firstSign} ${firstNum}\n`;
	const secondSign = unquote(context.node.namedChildren[3]?.text || "");
	const secondNum = unquote(context.node.namedChildren[4]?.text || "");
	if (secondSign && secondNum) {
		rules[0] += `\tinput${inputPath} ${secondSign} ${secondNum}\n`;
		rules[1] += `\tinput${inputPath}[_] ${secondSign} ${secondNum}\n`;
	}
	rules[0] += "}";
	rules[1] += "}";
	context.rules.push(...rules);
	return name;
}
function emitRuleIpAddress(context: Context): string {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(
		`${name} {\n\tnet.cidr_contains("${ruleTest}", input${inputPath})\n}`,
	);
	context.rules.push(
		`${name} {\n\tnet.cidr_contains("${ruleTest}", input${inputPath}[_])\n}`,
	);
	return name;
}
function emitRuleExactly(context: Context): string {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(`${name} {\n\tinput${inputPath} == "${ruleTest}"\n}`);
	return name;
}
function emitRuleExists(context: Context): string {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = context.node.namedChildren[1].text === "true";
	context.rules.push(
		`${name} {\n\t${
			ruleTest ? `input${inputPath}` : `not input${inputPath}`
		}\n}`,
	);
	return name;
}
function emitRuleValue(context: Context): string {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = context.node.namedChildren[1].text.slice(1, -1);
	context.rules.push(
		`${name} {\n\t({ ${ruleTest} } & { input${inputPath} }) == { input${inputPath} }\n}`,
	);
	if (
		context.node?.parent?.parent?.parent?.type !== NodeType.rule_or_matching
	) {
		context.rules.push(
			`${name} {\n\tcount([match | v := input${inputPath}[_]; s := [ ${ruleTest} ][_]; s == v; match := v]) > 0\n}`,
		);
	}
	return name;
}

function emitRule(context: Context): string {
	if (context.ruleCache.has(context.node.id)) {
		return context.ruleCache.get(context.node.id);
	}
	let iterator: Parser.SyntaxNode | null = context.node.parent;
	let root = true;
	while (iterator) {
		if (getAllRuleNodeTypes().includes(iterator.type)) {
			root = false;
			break;
		}
		iterator = iterator.parent;
	}
	const ruleName = (() => {
		switch (context.node.type) {
			case NodeType.rule_or_matching:
				return emitRuleOr(context);
			case NestedNodeType.rule_nested_prefix_matching:
			case NodeType.rule_prefix_matching:
				return emitRulePrefix(context);
			case NodeType.rule_suffix_matching:
				return emitRuleSuffix(context);
			case NodeType.rule_equals_ignore_case_matching:
				return emitRuleEqualsIgnoreCase(context);
			case NodeType.rule_wildcard_matching:
				return emitRuleWildcard(context);
			case NodeType.rule_anything_but_matching:
				return emitRuleAnythingBut(context);
			case NodeType.rule_numeric_matching:
				return emitRuleNumeric(context);
			case NodeType.rule_ip_address_matching:
				return emitRuleIpAddress(context);
			case NodeType.rule_exactly_matching:
				return emitRuleExactly(context);
			case NodeType.rule_exists_matching:
				return emitRuleExists(context);
			case NodeType.rule_value_matching:
				return emitRuleValue(context);
			default:
				ok(false, `unhandled node type: ${context.node.type}`);
		}
	})();
	if (root) {
		context.ruleRoots.add(ruleName);
	}
	context.ruleCache.set(context.node.id, ruleName);
	return ruleName;
}

interface Context {
	readonly rules: string[];
	readonly ruleCache: Map<number, string>;
	readonly ruleRoots: Set<string>;
	readonly node: Parser.SyntaxNode;
}

export async function walkInput(input: string): Promise<string[]> {
	const abs = resolve(input);
	const dirent = await stat(abs);
	if (!dirent.isDirectory()) {
		return [abs];
	}
	let inputs: string[] = [];
	const dirents = await readdir(abs, { withFileTypes: true });
	for (const stat of dirents) {
		const absPath = resolve(input, stat.name);
		if (stat.isDirectory()) {
			inputs = inputs.concat(await walkInput(resolve(absPath)));
			continue;
		}
		if (!stat.name.endsWith(".json")) {
			continue;
		}
		inputs.push(absPath);
	}
	return inputs;
}

export async function compile(input = process.argv[2]) {
	const parser = await createParser();
	const sourceRoot = resolve(input);
	const sources = await walkInput(input);
	const bodies: string[] = [];
	const regoRulenames: string[] = [];
	const kebabRegExp = new RegExp(/[^a-zA-Z0-9]|-{1,}/, "g");
	for (const sourcePath of sources) {
		const ruleCache = new Map<number, string>();
		const ruleRoots = new Set<string>();
		const source = await readFile(sourcePath, "utf8");
		const tree = parser.parse(source);
		const token = "cap";
		const ruleQueries = getAllRuleNodeTypes()
			.map((q) => `(${q}) @${token}`)
			.map((q) => parser.getLanguage().query(q))
			.map((q) => q.captures(tree.rootNode))
			.flatMap((q) => q);
		const rules: string[] = [];
		for (const ruleQuery of ruleQueries) {
			ok(ruleQuery.name === token);
			const node = ruleQuery.node;
			emitRule({ node, rules, ruleCache, ruleRoots });
		}
		let header = "";
		if (sources.length === 1) {
			header = "package rule2rego\ndefault allow := false";
		} else {
			const pkgPath = relative(sourceRoot, sourcePath).slice(0, -5);
			const ruleName = pkgPath.replace(kebabRegExp, "");
			regoRulenames.push(ruleName);
			header = `package rule2rego.${ruleName}\ndefault allow := false`;
		}
		const init = [...new Set(Array.from(ruleCache.values()))]
			.map((i) => `default ${i} := false`)
			.join("\n");
		const policy = `\n${rules.join("\n")}`;
		const footer = `allow {\n\t${Array.from(ruleRoots).join("\n\t")}\n}`;
		const body = `${header}\n${init}${policy}\n${footer}`.replace(
			/\n\n/g,
			"\n",
		);
		if (input === process.argv[2]) {
			console.log(body);
			console.log("");
		}
		bodies.push(body);
	}
	if (sources.length > 1) {
		// add the main
		const body = `package rule2rego\ndefault allow := false\nallow {\n  data.rule2rego.${regoRulenames.join(
			".allow\n}\nallow {\n  data.rule2rego.",
		)}.allow\n}`;
		bodies.splice(0, 0, body);
		if (input === process.argv[2]) {
			console.log(body);
			console.log("");
		}
	}
	return bodies;
}

if (process.argv[1].endsWith("rule2rego.ts")) {
	compile(process.argv[2]);
}
