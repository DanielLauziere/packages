import { describe, it, expect } from "vitest";
import {
  applyPodMessage,
  normalizePodWsUrl,
  podQueueUrl,
  podStunUrl,
  reconnectDelayMs,
  initialRosterState,
  type PodRosterState,
} from "./podClient.js";

const joined: PodRosterState = {
  status: "joined",
  deviceIds: ["a", "b"],
  errorMessage: null,
};

describe("applyPodMessage", () => {
  it("roomJoined replaces the roster", () => {
    const next = applyPodMessage(initialRosterState, {
      type: "roomJoined",
      devices: [{ deviceId: "x" }, { deviceId: "y" }],
    });
    expect(next).toEqual({
      status: "joined",
      deviceIds: ["x", "y"],
      errorMessage: null,
    });
  });

  it("deviceJoined appends once (dedupes)", () => {
    const once = applyPodMessage(joined, { type: "deviceJoined", deviceId: "c" });
    expect(once.deviceIds).toEqual(["a", "b", "c"]);
    const twice = applyPodMessage(once, { type: "deviceJoined", deviceId: "c" });
    expect(twice.deviceIds).toEqual(["a", "b", "c"]);
  });

  it("deviceJoined without deviceId is a no-op", () => {
    expect(applyPodMessage(joined, { type: "deviceJoined" })).toBe(joined);
  });

  it("deviceLeft removes the id", () => {
    const next = applyPodMessage(joined, { type: "deviceLeft", deviceId: "a" });
    expect(next.deviceIds).toEqual(["b"]);
  });

  it("error records the message with a default", () => {
    const next = applyPodMessage(joined, { type: "error" });
    expect(next.errorMessage).toBe("error");
    const custom = applyPodMessage(joined, { type: "error", message: "nope" });
    expect(custom.errorMessage).toBe("nope");
  });

  it("unknown frames leave state untouched", () => {
    expect(applyPodMessage(joined, { type: "signal" })).toBe(joined);
  });
});

describe("normalizePodWsUrl", () => {
  it("converts https → wss and appends /ws", () => {
    expect(normalizePodWsUrl("https://directeatz.com/rtc")).toBe(
      "wss://directeatz.com/rtc/ws",
    );
  });

  it("converts http → ws", () => {
    expect(normalizePodWsUrl("http://localhost:3000")).toBe("ws://localhost:3000/ws");
  });

  it("keeps an existing /ws ending and strips trailing slashes", () => {
    expect(normalizePodWsUrl("wss://h/rtc/ws///")).toBe("wss://h/rtc/ws");
  });

  it("blank input → empty string", () => {
    expect(normalizePodWsUrl("   ")).toBe("");
  });
});

describe("podQueueUrl / podStunUrl", () => {
  it("derives the HTTP queue endpoint", () => {
    expect(podQueueUrl("wss://directeatz.com/rtc/ws")).toBe(
      "https://directeatz.com/rtc/queue",
    );
    expect(podQueueUrl("ws://localhost:3031/ws")).toBe(
      "http://localhost:3031/queue",
    );
  });

  it("blank input → empty string", () => {
    expect(podQueueUrl("  ")).toBe("");
  });

  it("derives the STUN host on UDP 3478", () => {
    expect(podStunUrl("wss://directeatz.com/rtc")).toBe("stun:directeatz.com:3478");
  });

  it("blank input → empty string", () => {
    expect(podStunUrl("  ")).toBe("");
  });
});

describe("reconnectDelayMs", () => {
  it("grows exponentially with jitter and caps at 30s ±20%", () => {
    expect(reconnectDelayMs(0)).toBeGreaterThanOrEqual(800);
    expect(reconnectDelayMs(0)).toBeLessThanOrEqual(1200);
    expect(reconnectDelayMs(2)).toBeGreaterThanOrEqual(3200);
    expect(reconnectDelayMs(2)).toBeLessThanOrEqual(4800);
    expect(reconnectDelayMs(20)).toBeLessThanOrEqual(36000);
    expect(reconnectDelayMs(20)).toBeGreaterThanOrEqual(24000);
  });
});
