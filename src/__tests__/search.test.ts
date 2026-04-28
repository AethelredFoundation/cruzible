import {
  SEARCH_NAVIGATION_TARGETS,
  buildSearchResults,
  type SearchableValidator,
} from "@/lib/search";

const validators: SearchableValidator[] = [
  {
    address: "aeth1liveatlas",
    moniker: "Atlas Live Validator",
    identity: "atlas-keybase",
  },
  {
    address: "aeth1safeguard",
    moniker: "Safeguard Stake",
  },
];

describe("buildSearchResults", () => {
  it("returns app navigation without inventing chain data", () => {
    const results = buildSearchResults("vault", validators);

    expect(results).toEqual([
      {
        category: "Navigation",
        kind: "navigation",
        items: [SEARCH_NAVIGATION_TARGETS[0]],
      },
    ]);
  });

  it("uses only caller-provided live validators for validator results", () => {
    const results = buildSearchResults("atlas", validators);

    expect(results).toEqual([
      {
        category: "Live Validators",
        kind: "validator",
        items: [
          {
            label: "Atlas Live Validator",
            href: "/validators/aeth1liveatlas",
            description: "aeth1liveatlas - atlas-keybase",
          },
        ],
      },
    ]);
  });

  it("does not return canned validator, block, or transaction examples", () => {
    expect(buildSearchResults("Coinbase Cloud", [])).toEqual([]);
    expect(buildSearchResults("block", [])).toEqual([]);
    expect(buildSearchResults("0xabc123", [])).toEqual([]);
  });
});
