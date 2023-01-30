import { basename, resolve } from "path";
import { readFileSync, renameSync, rmSync, writeFileSync } from "fs";

import { compile } from "../rule2rego";
import { execSync } from "child_process";
import { sync as glob } from "glob";
import { loadPolicySync } from "@open-policy-agent/opa-wasm";

export default async function setup() {
	const fixRoot = resolve("test/fixtures");
	// @ts-expect-error - this is how we pass data to tests
	globalThis.FIXTURES = await Promise.all(
		glob(`${fixRoot}/*.json`).map((f) =>
			compile(f).then(([policyDocument]) => {
				const name = basename(f, ".json");
				const wasm = resolve(fixRoot, `${name}.wasm`);
				const bundle = resolve(fixRoot, `${name}.tar.gz`);
				const rego = resolve(fixRoot, `${name}.rego`);
				rmSync(rego, { force: true });
				writeFileSync(rego, policyDocument, "utf8");
				rmSync(wasm, { force: true });
				rmSync(bundle, { force: true });
				execSync(`opa build -t wasm -e rule2rego -o "${bundle}" "${rego}"`, {
					cwd: fixRoot,
				});
				execSync(`tar -xzf "${bundle}" -C "${fixRoot}" /policy.wasm`, {
					cwd: fixRoot,
				});
				renameSync(resolve(fixRoot, "policy.wasm"), wasm);
				const policy = loadPolicySync(readFileSync(wasm));
				return {
					policy: policy,
					name: name,
					source: readFileSync(f, "utf8"),
					allows: glob(`${fixRoot}/${name}/allows/*.json`).map((fa) =>
						JSON.parse(readFileSync(fa, "utf8")),
					),
					denies: glob(`${fixRoot}/${name}/denies/*.json`).map((fd) =>
						JSON.parse(readFileSync(fd, "utf8")),
					),
				};
			}),
		),
	);
}
