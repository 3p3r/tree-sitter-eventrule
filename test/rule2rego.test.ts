import { compile } from "../rule2rego";
import { sync as glob } from "glob";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// rome-ignore lint/suspicious/noExplicitAny: <explanation>
type ExplicitAny = any;
interface Fixture {
	policy: { evaluate: (input: ExplicitAny) => ExplicitAny[] };
	name: string;
	source: string;
	allows: ExplicitAny[];
	denies: ExplicitAny[];
}

function getLoadedFixtures() {
	// @ts-expect-error - this is how we get data from globalSetup.ts
	return globalThis.FIXTURES as Fixture[];
}

describe("rule2rego tests", () => {
	getLoadedFixtures().forEach((fixture) => {
		describe(fixture.name, () => {
			fixture.allows.forEach((input, i) => {
				it(`allows: sample ${i}`, () => {
					const result = fixture.policy.evaluate(input);
					expect(result.length).toBe(1);
					expect(result[0].result.allow).toBeTruthy();
				});
			});
			fixture.denies.forEach((input, i) => {
				it(`denies: sample ${i}`, () => {
					const result = fixture.policy.evaluate(input);
					expect(result.length).toBe(1);
					expect(result[0].result.allow).toBeFalsy();
				});
			});
		});
	});
	describe("walkInput", () => {
		it("should walk fixtures", async () => {
			const files = glob(path.join(__dirname, "fixtures", "*.json"));
			await fs.promises.mkdir(path.join(os.tmpdir(), "tree-sitter-eventrule"), {
				recursive: true,
			});
			const tmpDir = await fs.promises.mkdtemp(
				path.join(os.tmpdir(), "tree-sitter-eventrule/"),
			);
			for (const file of files) {
				fs.writeFileSync(
					path.join(tmpDir, path.basename(file)),
					fs.readFileSync(file),
				);
			}
			const policies = await compile(tmpDir);
			expect(policies.length).toBe(files.length + 1);
			expect(policies[12]).toEqual(`package rule2rego.wildcardmatching
default allow := false
default allow_source := false
allow_source {
	glob.match("Simple*Service", [], input["source"])
}
allow {
	allow_source
}`);
			// const files = await walkInput(resolve(__dirname, "fixtures"));
		});
	});
});
