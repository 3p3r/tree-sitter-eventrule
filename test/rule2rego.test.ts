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
});
