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

enum Helper {
	CoelesceArray = "f(x) := x if { is_array(x) }\nf(x) := [x] if { not is_array(x) }",
	HasKey = "has_key(x, k) { _ = x[k] }",
}

interface Rule {
	name: string;
	negate?: boolean;
	helpers?: Helper[];
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
	readonly orderedPaths: string[];
}

function pathsToInput(paths: string[]) {
	return paths.reduce((cur: string, next: string) => {
		return `f(${cur}["${next}"])[_]`;
	}, "input");
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
	const inputPath = pathsToInput(orderedPaths);
	return { name: `allow_${ruleName || "or"}`, inputPath, orderedPaths };
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

function emitRuleOr(context: Context): Rule {
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
				out += `\t${emitRule({ ...context, node: childRule }).name}\n`;
			}
			out += "\n}\n";
		}
	}
	context.rules.push(out);
	return { name };
}
function emitRulePrefix(context: Context): Rule {
	const { name: firstPart, inputPath } = getJsonPathFromQueryCaptureNode(
		context.node,
	);
	const secondPart =
		context.node.parent?.type === NodeType.rule_anything_but_matching
			? "_prefix"
			: "";
	const name = `${firstPart}${secondPart}`;
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(`${name} {\n\tstartswith(${inputPath}, "${ruleTest}")\n}`);
	return { name };
}
function emitRuleSuffix(context: Context): Rule {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(`${name} {\n\tendswith(${inputPath}, "${ruleTest}")\n}`);
	return { name };
}
function emitRuleEqualsIgnoreCase(context: Context): Rule {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(
		`${name} {\n\tlower(${inputPath}) == "${ruleTest.toLowerCase()}"\n}`,
	);
	return { name };
}
function emitRuleWildcard(context: Context): Rule {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(
		`${name} {\n\tglob.match("${ruleTest}", [], ${inputPath})\n}`,
	);
	return { name };
}
function emitRuleAnythingBut(context: Context): Rule {
	let out = "";
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = context.node.namedChildren[1];
	if (ruleTest.type === NestedNodeType.rule_nested_prefix_matching) {
		return {
			name: emitRule({ ...context, node: ruleTest }).name,
			negate: true,
		};
	}
	if (ruleTest.type === PrimitiveNodeType.array) {
		const val = ruleTest.text.slice(1, -1);
		out += `${name} {\n\tcount([match | v := ${inputPath}; s := [ ${val} ][_]; s == v; match := v]) == 0\n}`;
	}
	if (ruleTest.type === PrimitiveNodeType.string) {
		const val = unquote(ruleTest.text);
		out += `${name} {\n\t${inputPath} != "${val}"\n}`;
	}
	if (ruleTest.type === PrimitiveNodeType.number) {
		const val = ruleTest.text;
		out += `${name} {\n\t${inputPath} != ${val}\n}`;
	}
	context.rules.push(out);
	return { name };
}
function emitRuleNumeric(context: Context): Rule {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const firstSign = unquote(context.node.namedChildren[1].text);
	const firstNum = unquote(context.node.namedChildren[2].text);
	const rules = ["", ""];
	rules[0] += `${name} {\n\t${inputPath} ${firstSign} ${firstNum}\n`;
	const secondSign = unquote(context.node.namedChildren[3]?.text || "");
	const secondNum = unquote(context.node.namedChildren[4]?.text || "");
	if (secondSign && secondNum) {
		rules[0] += `\t${inputPath} ${secondSign} ${secondNum}\n`;
	}
	rules[0] += "}";
	context.rules.push(...rules);
	return { name };
}
function emitRuleIpAddress(context: Context): Rule {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(
		`${name} {\n\tnet.cidr_contains("${ruleTest}", ${inputPath})\n}`,
	);
	return { name };
}
function emitRuleExactly(context: Context): Rule {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = unquote(context.node.namedChildren[1].text);
	context.rules.push(`${name} {\n\t${inputPath} == "${ruleTest}"\n}`);
	return { name };
}
function emitRuleExists(context: Context): Rule {
	const { name, orderedPaths } = getJsonPathFromQueryCaptureNode(context.node);
	const helpers = [Helper.HasKey];
	const negate = context.node.namedChildren[1].text !== "true";
	const key = orderedPaths.pop();
	const input = pathsToInput(orderedPaths);
	const len = input.length;
	const some = `${input.slice(0, len - 2)}i${input.slice(len - 1, len)}`;
	context.rules.push(`${name} {\n\tsome i\n\thas_key(${some}, "${key}")\n}`);
	return { name, negate, helpers };
}
function emitRuleValue(context: Context): Rule {
	const { name, inputPath } = getJsonPathFromQueryCaptureNode(context.node);
	const ruleTest = context.node.namedChildren[1].text.slice(1, -1);
	context.rules.push(
		`${name} {\n\tcount([match | v := ${inputPath}; s := [ ${ruleTest} ][_]; s == v; match := v]) > 0\n}`,
	);
	return { name };
}

function emitRule(context: Context): Rule {
	if (context.ruleCache.has(context.node.id)) {
		return context.ruleRoots.get(context.ruleCache.get(context.node.id));
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
	const rule = (() => {
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
		context.ruleRoots.set(rule.name, rule);
	}
	context.ruleCache.set(context.node.id, rule.name);
	return rule;
}

interface Context {
	readonly rules: string[];
	readonly ruleCache: Map<number, string>;
	readonly ruleRoots: Map<string, Rule>;
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
		const ruleRoots = new Map<string, Rule>();
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
		const futures = "import future.keywords.if";
		if (sources.length === 1) {
			header = `package rule2rego\n${futures}\ndefault allow := false`;
		} else {
			const pkgPath = relative(sourceRoot, sourcePath).slice(0, -5);
			const ruleName = pkgPath.replace(kebabRegExp, "");
			regoRulenames.push(ruleName);
			header = `package rule2rego.${ruleName}\n${futures}\ndefault allow := false`;
		}
		const helpers = [Helper.CoelesceArray];
		ruleRoots.forEach(
			(rule) =>
				rule.helpers && helpers.splice(helpers.length, 0, ...rule.helpers),
		);
		const init = [...new Set(Array.from(ruleCache.values()))]
			.map((i) => `default ${i} := false`)
			.join("\n");
		const policy = `\n${rules.join("\n")}`;
		const footer = `allow {\n\t${Array.from(ruleRoots.values())
			.map((rule) => `${rule.negate ?? false ? "not " : ""}${rule.name}`)
			.join("\n\t")}\n}`;
		const body = `${header}\n${helpers.join(
			"\n",
		)}\n${init}${policy}\n${footer}`.replace(/\n\n/g, "\n");
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
