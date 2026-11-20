import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Credentials } from "@thomasfosterau/effect-platform-browser";
import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting";

const control = Effect.service(TestCredentials.Control);

const creation: Credentials.CreationOptionsJson = {
  rp: { id: "example.com", name: "Example" },
  user: { id: "dXNlci0x", name: "ada@example.com", displayName: "Ada" },
  challenge: "Y2hhbGxlbmdl",
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};

const request: Credentials.RequestOptionsJson = { challenge: "c2lnbiBpbg", rpId: "example.com" };

/** Yields until `check` holds: a forked ceremony needs a few turns to start. */
const eventually = <R>(
  check: Effect.Effect<boolean, never, R>,
  tries = 100,
): Effect.Effect<void, never, R> =>
  Effect.flatMap(check, (holds) =>
    holds || tries === 0
      ? Effect.void
      : Effect.andThen(
          Effect.yieldNow,
          Effect.suspend(() => eventually(check, tries - 1)),
        ),
  );

const isWaiting = Effect.flatMap(control, (c) => c.waiting);

const reason = <A, R>(effect: Effect.Effect<A, Credentials.CredentialsError, R>) =>
  Effect.map(Effect.flip(effect), (error) => error.reason);

/** What a ceremony resolves with: a credential-shaped object, or the platform's `null`. */
interface Resolution {
  readonly credential: Option.Option<object>;
}

/** A container that resolves every ceremony with `resolution`'s credential, or `null`. */
const resolving = ({ credential }: Resolution): Credentials.WebAuthnLike => {
  const settle = () => Promise.resolve(Option.getOrNull(credential));
  return { container: { create: settle, get: settle }, statics: {} };
};

/** A rejection the platform would give: a `DOMException`. */
const refused = () => Promise.reject(new DOMException("no", "NotAllowedError"));

const buffer = (...bytes: ReadonlyArray<number>) => Uint8Array.from(bytes).buffer;

describe("Credentials.make", () => {
  it.effect("fails every call Unsupported without WebAuthn, and reports no capabilities", () =>
    Effect.gen(function* () {
      const unsupported = Credentials.make();
      expect(unsupported.supported).toBe(false);
      const reasons = yield* Effect.forEach(
        [
          Effect.asVoid(unsupported.register(creation)),
          Effect.asVoid(unsupported.authenticate(request)),
          unsupported.signalUnknownCredential({ rpId: "example.com", credentialId: "AA" }),
          unsupported.signalAllAcceptedCredentials({
            rpId: "example.com",
            userId: "AA",
            allAcceptedCredentialIds: [],
          }),
          unsupported.signalCurrentUserDetails({
            rpId: "example.com",
            userId: "AA",
            name: "ada",
            displayName: "Ada",
          }),
        ],
        reason,
        { concurrency: 1 },
      );
      expect(reasons).toEqual(Array.from({ length: 5 }, () => "Unsupported"));
      expect(yield* unsupported.capabilities).toEqual({});
    }),
  );

  it.effect(
    "fails Failed when a ceremony resolves with no credential, or not a public-key one",
    () =>
      Effect.gen(function* () {
        const nothing = Credentials.make(resolving({ credential: Option.none() }));
        const password = Credentials.make(
          resolving({ credential: Option.some({ id: "ada", type: "password" }) }),
        );
        expect(yield* reason(nothing.register(creation))).toBe("Failed");
        expect(yield* reason(password.authenticate(request))).toBe("Failed");
      }),
  );

  it.effect("encodes extension outputs, an absent attachment and an absent user handle", () =>
    Effect.gen(function* () {
      const credentials = Credentials.make(
        resolving({
          credential: Option.some({
            id: "AQ",
            rawId: buffer(1),
            authenticatorAttachment: null,
            response: {
              clientDataJSON: buffer(0x7b, 0x7d),
              authenticatorData: buffer(2),
              signature: buffer(3),
              userHandle: null,
            },
            getClientExtensionResults: () => ({
              prf: { results: { first: buffer(0xff), second: Uint8Array.of(0, 1, 2).subarray(1) } },
              appid: false,
              list: [1, "two", null],
              callback: () => {},
            }),
          }),
        }),
      );
      const response = yield* credentials.authenticate(request);
      expect(response).toEqual({
        id: "AQ",
        rawId: "AQ",
        type: "public-key",
        authenticatorAttachment: undefined,
        clientExtensionResults: {
          prf: { results: { first: "_w", second: "AQI" } },
          appid: false,
          list: [1, "two", null],
          callback: null,
        },
        response: {
          clientDataJSON: "e30",
          authenticatorData: "Ag",
          signature: "Aw",
          userHandle: undefined,
        },
      });
      // What a page posts back decodes on the server with the same schema.
      expect(Schema.decodeUnknownSync(Credentials.AuthenticationResponseJson)(response)).toEqual(
        response,
      );
    }),
  );

  it.effect("encodes a registration from an authenticator with no attachment", () =>
    Effect.gen(function* () {
      const credentials = Credentials.make(
        resolving({
          credential: Option.some({
            id: "AQ",
            rawId: buffer(1),
            authenticatorAttachment: null,
            response: { clientDataJSON: buffer(0x7b, 0x7d), attestationObject: buffer(0xa0) },
            getClientExtensionResults: () => ({}),
          }),
        }),
      );
      const response = yield* credentials.register(creation);
      expect(response.authenticatorAttachment).toBeUndefined();
      expect(response.response.attestationObject).toBe("oA");
    }),
  );

  it.effect("answers capabilities it can, and none where the agent's answer fails", () =>
    Effect.gen(function* () {
      const legacy = Credentials.make({
        container: resolving({ credential: Option.none() }).container,
        statics: {
          isConditionalMediationAvailable: () => Promise.resolve(true),
          isUserVerifyingPlatformAuthenticatorAvailable: refused,
        },
      });
      expect(yield* legacy.capabilities).toEqual({ conditionalGet: true });
      const failing = Credentials.make({
        container: resolving({ credential: Option.none() }).container,
        statics: { getClientCapabilities: refused },
      });
      expect(yield* failing.capabilities).toEqual({});
    }),
  );

  it.effect("maps a signal's rejection onto a reason", () =>
    Effect.gen(function* () {
      const credentials = Credentials.make({
        container: resolving({ credential: Option.none() }).container,
        statics: {
          signalUnknownCredential: () =>
            Promise.reject(new DOMException("wrong RP", "SecurityError")),
        },
      });
      expect(
        yield* reason(
          credentials.signalUnknownCredential({ rpId: "other.com", credentialId: "AA" }),
        ),
      ).toBe("Security");
    }),
  );
});

describe.each([
  { parsers: true, label: "with the platform's parsers" },
  { parsers: false, label: "converting by hand" },
])("TestCredentials, $label", ({ parsers }) => {
  const layer = TestCredentials.layer({ parsers });

  it.effect("registers a passkey, then signs in with it", () =>
    Effect.gen(function* () {
      const registered = yield* Credentials.register({
        ...creation,
        extensions: { credProps: true },
      });
      expect(registered).toEqual({
        id: "Acr-",
        rawId: "Acr-",
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          clientDataJSON: expect.any(String),
          attestationObject: "oA",
          authenticatorData: "AQID",
          transports: ["internal"],
          publicKey: "BAUG",
          publicKeyAlgorithm: -7,
        },
      });
      const discovered = yield* Credentials.authenticate({ challenge: request.challenge });
      expect(discovered.id).toBe(registered.id);
      const signedIn = yield* Credentials.authenticate({
        ...request,
        allowCredentials: [{ id: registered.id, type: "public-key" }],
        extensions: { prf: { eval: { first: "AA" } } },
      });
      expect(signedIn.id).toBe(registered.id);
      expect(signedIn.response.userHandle).toBe("dXNlci0x");
      expect(signedIn.clientExtensionResults).toEqual({ prf: { results: { first: "_w" } } });
      expect(yield* (yield* control).passkeys).toEqual([
        {
          id: "Acr-",
          rpId: "example.com",
          userId: "dXNlci0x",
          name: "ada@example.com",
          displayName: "Ada",
        },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails Encoding for a malformed base64url field", () =>
    Effect.gen(function* () {
      expect(yield* reason(Credentials.register({ ...creation, challenge: "not*base64" }))).toBe(
        "Encoding",
      );
      expect(
        yield* reason(
          Credentials.authenticate({
            ...request,
            allowCredentials: [{ id: "a", type: "public-key" }],
          }),
        ),
      ).toBe("Encoding");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses a passkey already registered, and an unsupported algorithm", () =>
    Effect.gen(function* () {
      const first = yield* Credentials.register(creation);
      const again = Credentials.register({
        ...creation,
        excludeCredentials: [{ id: first.id, type: "public-key" }],
      });
      expect(yield* reason(again)).toBe("InvalidState");
      const ed448 = Credentials.register({
        ...creation,
        pubKeyCredParams: [{ type: "public-key", alg: -8 }],
      });
      expect(yield* reason(ed448)).toBe("NotSupported");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails NotAllowed with no passkey for the site", () =>
    Effect.gen(function* () {
      yield* Credentials.register(creation);
      expect(yield* reason(Credentials.authenticate({ ...request, rpId: "other.com" }))).toBe(
        "NotAllowed",
      );
    }).pipe(Effect.provide(layer)),
  );
});

describe("TestCredentials", () => {
  it.effect("maps each rejection onto a reason", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const names = [
        "NotAllowedError",
        "SecurityError",
        "ConstraintError",
        "AbortError",
        "UnknownError",
      ];
      const reasons = yield* Effect.forEach(
        names,
        (name) => Effect.andThen(c.failNext(name), reason(Credentials.register(creation))),
        { concurrency: 1 },
      );
      expect(reasons).toEqual(["NotAllowed", "Security", "Constraint", "Aborted", "Failed"]);
      yield* c.failNext("NotAllowedError");
      expect(yield* reason(Credentials.authenticate(request))).toBe("NotAllowed");
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("waits on autofill for a conditional sign-in, until the user picks a passkey", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const registered = yield* Credentials.register(creation);
      const fiber = yield* Effect.forkChild(Credentials.authenticate(request, "conditional"));
      yield* eventually(isWaiting);
      yield* c.pick(registered.id);
      expect((yield* Fiber.join(fiber)).id).toBe(registered.id);
      expect(yield* c.waiting).toBe(false);
      const other = yield* Effect.forkChild(Credentials.authenticate(request, "conditional"));
      yield* eventually(isWaiting);
      yield* c.pick("bm9wZQ");
      expect(yield* reason(Fiber.join(other))).toBe("NotAllowed");
      expect((yield* c.requests).map((r) => [r.ceremony, r.mediation])).toEqual([
        ["create", Option.none()],
        ["get", Option.some("conditional")],
        ["get", Option.some("conditional")],
      ]);
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("aborts a conditional sign-in when the fiber is interrupted", () =>
    Effect.gen(function* () {
      const c = yield* control;
      const fiber = yield* Effect.forkChild(Credentials.authenticate(request, "conditional"));
      yield* eventually(isWaiting);
      yield* Fiber.interrupt(fiber);
      expect(yield* c.waiting).toBe(false);
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("reports the client's capabilities, or the two older checks", () =>
    Effect.gen(function* () {
      const full = yield* Effect.provide(Credentials.capabilities, TestCredentials.layer());
      expect(full.passkeyPlatformAuthenticator).toBe(true);
      const legacy = yield* Effect.provide(
        Credentials.capabilities,
        TestCredentials.layer({ clientCapabilities: false }),
      );
      expect(legacy).toEqual({ conditionalGet: true, userVerifyingPlatformAuthenticator: true });
    }),
  );

  it.effect("records the signals sent, and fails them Unsupported without the API", () =>
    Effect.gen(function* () {
      const credentials = yield* Credentials.Credentials;
      yield* credentials.signalUnknownCredential({ rpId: "example.com", credentialId: "AA" });
      yield* credentials.signalAllAcceptedCredentials({
        rpId: "example.com",
        userId: "dXNlci0x",
        allAcceptedCredentialIds: ["AQ"],
      });
      yield* credentials.signalCurrentUserDetails({
        rpId: "example.com",
        userId: "dXNlci0x",
        name: "ada@example.com",
        displayName: "Ada L.",
      });
      expect((yield* (yield* control).signals).map((signal) => signal.kind)).toEqual([
        "unknownCredential",
        "allAcceptedCredentials",
        "currentUserDetails",
      ]);
      const without = TestCredentials.make({ signals: false }).credentials;
      expect(
        yield* reason(without.signalUnknownCredential({ rpId: "example.com", credentialId: "AA" })),
      ).toBe("Unsupported");
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("omits the Level 2 fields where the agent lacks their accessors", () =>
    Effect.gen(function* () {
      const registered = yield* Credentials.register({ ...creation, rp: { name: "Example" } });
      expect(registered.response).toEqual({
        clientDataJSON: expect.any(String),
        attestationObject: "oA",
        authenticatorData: undefined,
        transports: undefined,
        publicKey: undefined,
        publicKeyAlgorithm: undefined,
      });
    }).pipe(Effect.provide(TestCredentials.layer({ level2: false }))),
  );

  it.effect("builds the unsupported service when switched off", () =>
    Effect.gen(function* () {
      expect((yield* Credentials.Credentials).supported).toBe(false);
    }).pipe(Effect.provide(TestCredentials.layer({ supported: false }))),
  );
});
