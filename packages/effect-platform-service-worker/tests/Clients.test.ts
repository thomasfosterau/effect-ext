import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Clients } from "@thomasfosterau/effect-platform-service-worker";
import { client, clientsStub, domError, windowClient } from "./helpers.ts";

const withClients = (stub: Clients.ClientsLike) =>
  Effect.provideService(Clients.Clients, Option.some(stub));

describe("Clients", () => {
  it.effect("every call fails Unsupported outside a service worker", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Clients.claim);
      expect(error.reason).toBe("Unsupported");
      expect(error.message).toBe("clients.claim: Unsupported");
    }),
  );

  it.effect("get reads absence as None", () => {
    const one = client("a");
    return Effect.gen(function* () {
      expect(yield* Clients.get("a")).toEqual(Option.some(one));
      expect(yield* Clients.get("b")).toEqual(Option.none());
    }).pipe(withClients(clientsStub([one])));
  });

  it.effect("windows keeps window clients only, controlled or not", () => {
    const stub = clientsStub([client("w"), windowClient("a", "https://example.com/")]);
    return Effect.gen(function* () {
      const found = yield* Clients.windows;
      expect(found.map((one) => one.id)).toEqual(["a"]);
      expect(stub.calls).toEqual(["matchAll window true"]);
    }).pipe(withClients(stub));
  });

  it.effect("maps rejections onto reasons", () => {
    const stub = clientsStub([], {
      openWindow: () => Promise.reject(domError("InvalidAccessError")),
      claim: () => Promise.reject(domError("InvalidStateError")),
      matchAll: () => Promise.reject(new TypeError("bad")),
      get: () => Promise.reject(domError("AbortError")),
    });
    return Effect.gen(function* () {
      expect((yield* Effect.flip(Clients.openWindow("/x"))).reason).toBe("NotAllowed");
      expect((yield* Effect.flip(Clients.claim)).reason).toBe("NotAllowed");
      expect((yield* Effect.flip(Clients.matchAll())).reason).toBe("InvalidUrl");
      expect((yield* Effect.flip(Clients.get("a"))).reason).toBe("Failed");
      expect(
        (yield* Effect.flip(
          Clients.focus({
            ...windowClient("a", "https://example.com/"),
            focus: () => Promise.reject("x"),
          }),
        )).reason,
      ).toBe("Failed");
    }).pipe(withClients(stub));
  });

  it.effect("navigate reads a cross-origin result as None", () => {
    const window = windowClient("a", "https://example.com/");
    return Effect.gen(function* () {
      expect(Option.isSome(yield* Clients.navigate(window, "https://example.com/next"))).toBe(true);
      expect(yield* Clients.navigate(window, "https://elsewhere.example/")).toEqual(Option.none());
    });
  });

  it.effect("focusOrOpen focuses a match ignoring the fragment, else opens", () => {
    const window = windowClient("a", "https://example.com/inbox#top");
    const stub = clientsStub([window]);
    return Effect.gen(function* () {
      const focused = yield* Clients.focusOrOpen("/inbox", "https://example.com/sw.js");
      expect(Option.map(focused, (one) => one.id)).toEqual(Option.some("a"));
      expect(window.calls).toEqual(["focus"]);
      const opened = yield* Clients.focusOrOpen("/other#x", "https://example.com/sw.js");
      expect(opened).toEqual(Option.none());
      expect(stub.calls.at(-1)).toBe("open https://example.com/other");
    }).pipe(withClients(stub));
  });

  it.effect("claim calls through", () => {
    const stub = clientsStub([]);
    return Effect.gen(function* () {
      yield* Clients.claim;
      expect(stub.calls).toEqual(["claim"]);
    }).pipe(withClients(stub));
  });

  it.effect("postTo and broadcast encode per client", () => {
    const a = client("a");
    const b = client("b");
    const At = Schema.Struct({ n: Schema.FiniteFromString });
    return Effect.gen(function* () {
      yield* Clients.postTo(At)(a, { n: 1 });
      expect(a.posted).toEqual([{ n: "1" }]);
      const reached = yield* Clients.broadcast(Schema.String, { type: "all" })("hi");
      expect(reached).toBe(2);
      expect(b.posted).toEqual(["hi"]);
      expect(yield* Clients.broadcast(Schema.String)("all windows")).toBe(2);
    }).pipe(withClients(clientsStub([a, b])));
  });
});
