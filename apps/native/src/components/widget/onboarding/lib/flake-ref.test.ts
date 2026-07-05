import { describe, expect, it } from "vitest";
import {
	DEFAULT_CONFIG_DIR,
	STARTER_TEMPLATES,
	parseFlakeRef,
} from "./flake-ref";

describe("DEFAULT_CONFIG_DIR", () => {
	it("uses the canonical nix-darwin location", () => {
		expect(DEFAULT_CONFIG_DIR).toBe("/etc/nix-darwin");
	});
});

describe("STARTER_TEMPLATES", () => {
	it("points the scratch flow at the bundled starter templates", () => {
		expect(STARTER_TEMPLATES.map((template) => template.id)).toEqual([
			"nix-darwin-determinate",
			"nixos-unified",
			"flake-parts",
		]);
	});

	it("keeps the embedded nix-darwin template as the recommended default", () => {
		expect(STARTER_TEMPLATES[0]).toMatchObject({
			id: "nix-darwin-determinate",
			recommended: true,
		});
	});
});

describe("parseFlakeRef", () => {
	it("accepts owner/repo shorthand and query options", () => {
		expect(parseFlakeRef("czxtm/darwin")).toMatchObject({
			valid: true,
			importable: true,
			type: "repo",
		});

		expect(parseFlakeRef("czxtm/darwin?ref=main&dir=hosts/work")).toMatchObject(
			{
				valid: true,
				importable: true,
				type: "repo",
			},
		);
	});

	it("accepts full git URLs and scp-style SSH", () => {
		expect(
			parseFlakeRef("https://example.com/x/y.git?dir=flakes/mac&ref=dev"),
		).toMatchObject({
			valid: true,
			importable: true,
			type: "repo",
		});

		expect(
			parseFlakeRef("ssh://git@example.com/x/y.git?dir=system"),
		).toMatchObject({
			valid: true,
			importable: true,
			type: "repo",
		});

		expect(
			parseFlakeRef("git@github.com:czxtm/darwin.git?ref=main&dir=mac"),
		).toMatchObject({
			valid: true,
			importable: true,
			type: "repo",
		});
	});

	it("accepts github host-prefixed paths", () => {
		expect(parseFlakeRef("github.com/czxtm/darwin.git")).toMatchObject({
			valid: true,
			importable: true,
			type: "repo",
		});

		expect(parseFlakeRef("www.github.com/czxtm/darwin")).toMatchObject({
			valid: true,
			importable: true,
			type: "repo",
		});
	});

	it("accepts nix-style github: sugar for the shorthand", () => {
		expect(parseFlakeRef("github:owner/repo")).toMatchObject({
			valid: true,
			importable: true,
			type: "repo",
		});

		expect(parseFlakeRef("github:owner/repo?ref=main&dir=hosts/work")).toMatchObject({
			valid: true,
			importable: true,
			type: "repo",
		});

		// The Nix path-segment ref form points the user at ?ref= instead.
		const pathRef = parseFlakeRef("github:owner/repo/main");
		expect(pathRef).toMatchObject({ valid: false, importable: false });
		expect(pathRef.hint).toContain("?ref=");
	});

	it("rejects unsupported or malformed forms", () => {
		expect(parseFlakeRef("/www.github.com/czxtm/darwin/")).toMatchObject({
			valid: false,
			importable: false,
		});

		expect(parseFlakeRef("owner/repo?other=value")).toMatchObject({
			valid: false,
			importable: false,
		});

		expect(parseFlakeRef("owner/repo?ref=main&ref=dev")).toMatchObject({
			valid: false,
			importable: false,
		});

		expect(parseFlakeRef("owner/repo?dir=/absolute")).toMatchObject({
			valid: false,
			importable: false,
		});
	});
});
