import { sendMessageSchema } from "./message.validation";

/**
 * No database: what a location send is allowed to be.
 *
 * Worth pinning because the failure mode is silent on our side and loud
 * at Meta's — an out-of-range coordinate comes back as a generic API
 * error that names nothing, so the only place it can be explained is
 * here.
 */
describe("sending a location", () => {
  const valid = {
    type: "location",
    location: {
      latitude: 28.6139,
      longitude: 77.209,
      name: "Shop",
      address: "Connaught Place",
    },
  };

  it("accepts a pin with a name and address", () => {
    expect(sendMessageSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts bare coordinates — a GPS share has no name", () => {
    expect(
      sendMessageSchema.safeParse({
        type: "location",
        location: { latitude: 0, longitude: 0 },
      }).success,
    ).toBe(true);
  });

  it("refuses coordinates that are not places", () => {
    for (const location of [
      { latitude: 91, longitude: 0 },
      { latitude: -91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: 0, longitude: -181 },
    ]) {
      expect(
        sendMessageSchema.safeParse({ type: "location", location }).success,
      ).toBe(false);
    }
  });

  it("requires the coordinates nested, not flat", () => {
    // The controller hands the validated body straight through, so a flat
    // latitude/longitude would arrive somewhere nothing reads.
    expect(
      sendMessageSchema.safeParse({
        type: "location",
        latitude: 28.6,
        longitude: 77.2,
      }).success,
    ).toBe(false);
  });

  it("still refuses a type it has never heard of", () => {
    expect(
      sendMessageSchema.safeParse({
        type: "hologram",
        location: valid.location,
      }).success,
    ).toBe(false);
  });
});
