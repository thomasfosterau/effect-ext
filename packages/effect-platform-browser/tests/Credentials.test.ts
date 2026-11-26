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

const configURL = "https://idp.example/fedcm.json";

const identityRequest: Credentials.IdentityRequest = {
  providers: [{ configURL, clientId: "rp-1" }],
};

const disconnect: Credentials.IdentityDisconnect = {
  configURL,
  clientId: "rp-1",
  accountHint: "ada@example.com",
};

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
          unsupported.storePassword({ id: "ada", password: "pw" }),
          Effect.asVoid(unsupported.password()),
          Effect.asVoid(unsupported.identity(identityRequest)),
          unsupported.disconnectIdentity(disconnect),
          unsupported.preventSilentAccess,
        ],
        reason,
        { concurrency: 1 },
      );
      expect(reasons).toEqual(Array.from({ length: 10 }, () => "Unsupported"));
      expect([unsupported.passwordsSupported, unsupported.identitySupported]).toEqual([
        false,
        false,
      ]);
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

describe("Credentials passwords", () => {
  it.effect("stores a password, replacing one with the same id, and fills it back", () =>
    Effect.gen(function* () {
      const c = yield* control;
      expect((yield* Credentials.Credentials).passwordsSupported).toBe(true);
      yield* Credentials.storePassword({ id: "ada@example.com", password: "old" });
      yield* Credentials.storePassword({
        id: "ada@example.com",
        password: "correct horse",
        name: "Ada",
        iconURL: "https://example.com/ada.png",
      });
      expect((yield* c.passwords).map((stored) => stored.password)).toEqual(["correct horse"]);
      expect(yield* Credentials.password()).toEqual(
        Option.some({
          id: "ada@example.com",
          password: "correct horse",
          name: Option.some("Ada"),
          iconURL: Option.some("https://example.com/ada.png"),
        }),
      );
      expect((yield* c.requests).map((r) => [r.ceremony, r.mediation])).toEqual([
        ["store", Option.none()],
        ["store", Option.none()],
        ["password", Option.none()],
      ]);
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("reads an absent name or icon as None", () =>
    Effect.gen(function* () {
      yield* Credentials.storePassword({ id: "ada", password: "pw" });
      const stored = yield* Credentials.password("silent");
      expect(Option.map(stored, (found) => [found.name, found.iconURL])).toEqual(
        Option.some([Option.none(), Option.none()]),
      );
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("signs in silently only until preventSilentAccess, then asks", () =>
    Effect.gen(function* () {
      const c = yield* control;
      expect(yield* Credentials.password("silent")).toEqual(Option.none());
      expect(yield* Credentials.password("optional")).toEqual(Option.none());
      yield* Credentials.storePassword({ id: "ada", password: "pw" });
      yield* Credentials.preventSilentAccess;
      expect(yield* c.silentAccess).toBe(false);
      expect(yield* Credentials.password("silent")).toEqual(Option.none());
      yield* c.dismissNext;
      expect(yield* Credentials.password("optional")).toEqual(Option.none());
      expect(Option.isSome(yield* Credentials.password("optional"))).toBe(true);
      expect(yield* c.silentAccess).toBe(true);
      expect(Option.isSome(yield* Credentials.password("silent"))).toBe(true);
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("asks with required, and picks the first of several", () =>
    Effect.gen(function* () {
      const c = yield* control;
      yield* Credentials.storePassword({ id: "ada", password: "pw" });
      yield* Credentials.storePassword({ id: "grace", password: "pw2" });
      expect(yield* Credentials.password("silent")).toEqual(Option.none());
      const picked = yield* Credentials.password("required");
      expect(Option.map(picked, (found) => found.id)).toEqual(Option.some("ada"));
      yield* c.dismissNext;
      expect(yield* Credentials.password("required")).toEqual(Option.none());
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("fails an empty password, a rejected store, and a rejected request", () =>
    Effect.gen(function* () {
      const c = yield* control;
      expect(yield* reason(Credentials.storePassword({ id: "ada", password: "" }))).toBe("Failed");
      yield* c.failNext("SecurityError");
      expect(yield* reason(Credentials.storePassword({ id: "ada", password: "pw" }))).toBe(
        "Security",
      );
      yield* c.failNext("NotAllowedError");
      expect(yield* reason(Credentials.password())).toBe("NotAllowed");
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("fails Unsupported without PasswordCredential, or without store", () =>
    Effect.gen(function* () {
      const without = TestCredentials.make({ passwords: false }).credentials;
      expect(without.passwordsSupported).toBe(false);
      expect(yield* reason(without.storePassword({ id: "ada", password: "pw" }))).toBe(
        "Unsupported",
      );
      expect(yield* reason(without.password())).toBe("Unsupported");
      const noStore = Credentials.make({
        container: { create: refused, get: refused },
        statics: {},
        passwordCredential: (data) => ({ id: data.id, type: "password" }),
      });
      expect(yield* reason(noStore.storePassword({ id: "ada", password: "pw" }))).toBe(
        "Unsupported",
      );
      expect(yield* reason(noStore.preventSilentAccess)).toBe("Unsupported");
    }),
  );

  it.effect("reads anything but a password credential as None", () =>
    Effect.gen(function* () {
      const odd = Credentials.make({
        ...resolving({ credential: Option.some({ type: "federated", id: "ada" }) }),
        passwordCredential: (data) => ({ id: data.id, type: "password" }),
      });
      expect(yield* odd.password()).toEqual(Option.none());
    }),
  );
});

describe("Credentials identity", () => {
  it.effect("signs in through the first provider with an account, then auto-selects", () =>
    Effect.gen(function* () {
      const c = yield* control;
      expect((yield* Credentials.Credentials).identitySupported).toBe(true);
      yield* c.identityAccount(configURL, "old-token");
      yield* c.identityAccount(configURL, "id-token");
      const offered: Credentials.IdentityRequest = {
        providers: [
          { configURL: "https://other.example/fedcm.json", clientId: "x" },
          ...identityRequest.providers,
        ],
        context: "signin",
        mode: "active",
      };
      expect(yield* reason(Credentials.identity(offered, "silent"))).toBe("Network");
      expect(yield* Credentials.identity(offered)).toEqual({
        token: "id-token",
        isAutoSelected: false,
        configURL: Option.some(configURL),
      });
      expect((yield* Credentials.identity(offered, "silent")).isAutoSelected).toBe(true);
      expect((yield* Credentials.identity(offered, "required")).isAutoSelected).toBe(false);
      expect((yield* c.requests).map((r) => r.ceremony)).toEqual(
        Array.from({ length: 4 }, () => "identity"),
      );
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("fails Network with no account, a dismissed prompt, or after a disconnect", () =>
    Effect.gen(function* () {
      const c = yield* control;
      expect(yield* reason(Credentials.identity(identityRequest))).toBe("Network");
      yield* c.identityAccount(configURL, "id-token");
      yield* c.dismissNext;
      expect(yield* reason(Credentials.identity(identityRequest))).toBe("Network");
      yield* Credentials.identity(identityRequest);
      yield* Credentials.disconnectIdentity(disconnect);
      yield* Credentials.disconnectIdentity(disconnect);
      expect(yield* c.disconnects).toEqual([disconnect, disconnect]);
      expect(yield* reason(Credentials.identity(identityRequest, "silent"))).toBe("Network");
      yield* Credentials.identity(identityRequest);
      yield* Credentials.preventSilentAccess;
      expect(yield* reason(Credentials.identity(identityRequest, "silent"))).toBe("Network");
    }).pipe(Effect.provide(TestCredentials.layer())),
  );

  it.effect("fails Unsupported without FedCM, and Failed for a credential with no token", () =>
    Effect.gen(function* () {
      const without = TestCredentials.make({ identity: false }).credentials;
      expect(without.identitySupported).toBe(false);
      expect(yield* reason(without.identity(identityRequest))).toBe("Unsupported");
      expect(yield* reason(without.disconnectIdentity(disconnect))).toBe("Unsupported");
      const empty = Credentials.make({
        ...resolving({ credential: Option.none() }),
        identityCredential: {},
      });
      expect(yield* reason(empty.identity(identityRequest, "optional"))).toBe("Failed");
      expect(yield* reason(empty.disconnectIdentity(disconnect))).toBe("Unsupported");
    }),
  );

  it.effect("reads a token without the optional fields, and aborts on interruption", () =>
    Effect.gen(function* () {
      const bare = Credentials.make({
        ...resolving({ credential: Option.some({ token: "t" }) }),
        identityCredential: {},
      });
      expect(yield* bare.identity(identityRequest)).toEqual({
        token: "t",
        isAutoSelected: false,
        configURL: Option.none(),
      });
      const aborted: Array<boolean> = [];
      const pending = Credentials.make({
        container: {
          create: refused,
          get: (options) =>
            new Promise((_resolve, reject) => {
              options?.signal?.addEventListener("abort", () => {
                aborted.push(true);
                reject(new DOMException("aborted", "AbortError"));
              });
            }),
        },
        statics: {},
        identityCredential: {},
      });
      const fiber = yield* Effect.forkChild(pending.identity(identityRequest));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      expect(aborted).toEqual([true]);
    }),
  );
});
