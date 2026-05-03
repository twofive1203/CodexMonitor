import { describe, expect, it } from "vitest";
import { parseAppsListResponse } from "./appsListResponse";

describe("parseAppsListResponse", () => {
  it("normalizes nested app responses and sorts accessible apps first", () => {
    expect(
      parseAppsListResponse({
        result: {
          data: [
            { id: "b", name: "Beta", is_accessible: false },
            {
              id: "a",
              name: "Alpha",
              description: "Calendar",
              isAccessible: true,
              install_url: "https://example.test/install",
              distribution_channel: "stable",
            },
          ],
        },
      }),
    ).toEqual([
      {
        id: "a",
        name: "Alpha",
        description: "Calendar",
        isAccessible: true,
        installUrl: "https://example.test/install",
        distributionChannel: "stable",
      },
      {
        id: "b",
        name: "Beta",
        isAccessible: false,
        installUrl: null,
        distributionChannel: null,
      },
    ]);
  });

  it("returns an empty list for invalid app responses", () => {
    expect(parseAppsListResponse({ result: { data: { invalid: true } } })).toEqual([]);
    expect(parseAppsListResponse(null)).toEqual([]);
  });
});
