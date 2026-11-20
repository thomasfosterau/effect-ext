/**
 * An in-memory passkey authenticator for tests of code that uses
 * `Credentials`: {@link layer} provides the real adapter over it, plus
 * {@link Control} to read the stored passkeys, fail a ceremony, pick a
 * passkey from autofill, and read the signals sent.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Base64Url } from "effect/encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  type AcceptedCredentials,
  type Bytes,
  Credentials,
  CreationOptionsJson,
  type CreationOptionsLike,
  type CredentialsContainerLike,
  type CurrentUserDetails,
  type DescriptorJson,
  type DescriptorLike,
  make as makeCredentials,
  type PublicKeyCredentialStaticsLike,
  RequestOptionsJson,
  type RequestOptionsLike,
  type UnknownCredential,
} from "../Credentials.ts";

/**
 * The in-memory authenticator's starting state. `supported: false` builds
 * the unsupported service. Each part of the API is present unless set
 * `false`: `parsers` (`parseCreationOptionsFromJSON` /
 * `parseRequestOptionsFromJSON`), `clientCapabilities`
 * (`getClientCapabilities`; without it, the two older yes/no checks),
 * `level2` (the attestation response's accessors) and `signals`. `rpId`
 * is the page's domain, `example.com` by default.
 *
 * @since 0.1.0
 * @category models
 */
export interface Options {
  readonly supported?: boolean;
  readonly parsers?: boolean;
  readonly clientCapabilities?: boolean;
  readonly level2?: boolean;
  readonly signals?: boolean;
  readonly rpId?: string;
}

/**
 * A passkey the authenticator holds, its ids as base64url.
 *
 * @since 0.1.0
 * @category models
 */
export interface Passkey {
  readonly id: string;
  readonly rpId: string;
  readonly userId: string;
  readonly name: string;
  readonly displayName: string;
}

/**
 * A signal the code under test sent, with its options.
 *
 * @since 0.1.0
 * @category models
 */
export type Signal =
  | { readonly kind: "unknownCredential"; readonly options: UnknownCredential }
  | { readonly kind: "allAcceptedCredentials"; readonly options: AcceptedCredentials }
  | { readonly kind: "currentUserDetails"; readonly options: CurrentUserDetails };

/**
 * One ceremony the code under test started.
 *
 * @since 0.1.0
 * @category models
 */
export interface Request {
  readonly ceremony: "create" | "get";
  readonly mediation: Option.Option<string>;
}

/**
 * Drives the in-memory authenticator.
 *
 * - `passkeys` — every passkey registered, in order.
 * - `failNext` — the next ceremony rejects with this `DOMException` name
 *   (`"NotAllowedError"` for a user who cancels, …).
 * - `waiting` — whether a conditional sign-in is waiting on autofill.
 * - `pick` — the user picks this passkey (by id) from autofill, completing
 *   the waiting conditional sign-in.
 * - `signals` — every signal sent, in order.
 * - `requests` — every ceremony started, in order.
 *
 * A modal sign-in uses the first passkey that matches; with none, it
 * rejects `NotAllowedError`, as the platform does once the user gives up.
 *
 * @since 0.1.0
 * @category services
 */
export class Control extends Context.Service<
  Control,
  {
    readonly passkeys: Effect.Effect<ReadonlyArray<Passkey>>;
    readonly failNext: (name: string) => Effect.Effect<void>;
    readonly waiting: Effect.Effect<boolean>;
    readonly pick: (id: string) => Effect.Effect<void>;
    readonly signals: Effect.Effect<ReadonlyArray<Signal>>;
    readonly requests: Effect.Effect<ReadonlyArray<Request>>;
  }
>()("@thomasfosterau/effect-platform-browser/BrowserTesting/CredentialsControl") {}

/**
 * What {@link make} builds: the `Credentials` service over the in-memory
 * authenticator, and the {@link Control} that drives it.
 *
 * @since 0.1.0
 * @category models
 */
export interface Fixture {
  readonly credentials: Credentials["Service"];
  readonly control: Control["Service"];
}

interface Stored {
  readonly rawId: Bytes;
  readonly passkey: Passkey;
}

const ALGORITHMS: ReadonlyArray<number> = [-7, -257];

const utf8 = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && Arr.every(Arr.fromIterable(a), (byte, index) => byte === b[index]);

const listed = (rawId: Bytes, descriptors?: ReadonlyArray<DescriptorLike>) =>
  Arr.some(descriptors ?? [], (descriptor) => sameBytes(descriptor.id, rawId));

/** The platform's parser: throws a `TypeError` on a malformed field, as it does. */
const decodeBytes = (value: string): Bytes =>
  Result.match(Base64Url.decode(value), {
    onFailure: () => {
      throw new TypeError(`not base64url: ${value}`);
    },
    onSuccess: (decoded) => Uint8Array.from(decoded),
  });

const decodeDescriptors = (list: ReadonlyArray<DescriptorJson>) =>
  Arr.map(list, (descriptor): DescriptorLike => ({
    ...descriptor,
    id: decodeBytes(descriptor.id),
  }));

const parseCreation = (json: unknown): CreationOptionsLike => {
  const { user, challenge, excludeCredentials, ...rest } =
    Schema.decodeUnknownSync(CreationOptionsJson)(json);
  const options = {
    ...rest,
    user: { ...user, id: decodeBytes(user.id) },
    challenge: decodeBytes(challenge),
  };
  // The platform leaves an absent list absent.
  return excludeCredentials === undefined
    ? options
    : { ...options, excludeCredentials: decodeDescriptors(excludeCredentials) };
};

const parseRequest = (json: unknown): RequestOptionsLike => {
  const { challenge, allowCredentials, ...rest } =
    Schema.decodeUnknownSync(RequestOptionsJson)(json);
  const options = { ...rest, challenge: decodeBytes(challenge) };
  return allowCredentials === undefined
    ? options
    : { ...options, allowCredentials: decodeDescriptors(allowCredentials) };
};

/** `clientDataJSON`, as the platform serialises it. */
const ClientDataJson = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, challenge: Schema.String, origin: Schema.String }),
);

const clientData = (type: string, challenge: Bytes, rpId: string) =>
  utf8(
    Schema.encodeSync(ClientDataJson)({
      type,
      challenge: Base64Url.encode(challenge),
      origin: `https://${rpId}`,
    }),
  );

/** The in-memory authenticator behind `navigator.credentials`. */
class FakeContainer implements CredentialsContainerLike {
  readonly stored: Array<Stored> = [];
  readonly requests: Array<Request> = [];
  failure = Option.none<string>();
  waiting = Option.none<(id: string) => void>();
  readonly #rpId: string;
  readonly #level2: boolean;
  constructor(rpId: string, level2: boolean) {
    this.#rpId = rpId;
    this.#level2 = level2;
  }
  #takeFailure(): Option.Option<DOMException> {
    const failure = this.failure;
    this.failure = Option.none();
    return Option.map(failure, (name) => new DOMException(`ceremony failed: ${name}`, name));
  }
  create(options: { readonly publicKey: CreationOptionsLike }): Promise<object | null> {
    this.requests.push({ ceremony: "create", mediation: Option.none() });
    const publicKey = options.publicKey;
    const failure = this.#takeFailure();
    if (Option.isSome(failure)) return Promise.reject(failure.value);
    const rpId = publicKey.rp.id ?? this.#rpId;
    if (Arr.some(this.stored, (stored) => listed(stored.rawId, publicKey.excludeCredentials))) {
      return Promise.reject(new DOMException("already registered", "InvalidStateError"));
    }
    if (!Arr.some(publicKey.pubKeyCredParams, (param) => ALGORITHMS.includes(param.alg))) {
      return Promise.reject(new DOMException("no supported algorithm", "NotSupportedError"));
    }
    const rawId = Uint8Array.of(this.stored.length + 1, 0xca, 0xfe);
    const passkey: Passkey = {
      id: Base64Url.encode(rawId),
      rpId,
      userId: Base64Url.encode(publicKey.user.id),
      name: publicKey.user.name,
      displayName: publicKey.user.displayName,
    };
    this.stored.push({ rawId, passkey });
    const response = {
      clientDataJSON: clientData("webauthn.create", publicKey.challenge, rpId),
      attestationObject: Uint8Array.of(0xa0).buffer,
    };
    const level2 = {
      getAuthenticatorData: () => Uint8Array.of(1, 2, 3).buffer,
      getPublicKey: () => Uint8Array.of(4, 5, 6).buffer,
      getPublicKeyAlgorithm: () => -7,
      getTransports: () => ["internal"],
    };
    return Promise.resolve({
      id: passkey.id,
      rawId: rawId.buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: this.#level2 ? { ...response, ...level2 } : response,
      getClientExtensionResults: () =>
        publicKey.extensions?.["credProps"] === true ? { credProps: { rk: true } } : {},
    });
  }
  get(options: {
    readonly publicKey: RequestOptionsLike;
    readonly mediation?: string;
    readonly signal?: AbortSignal;
  }): Promise<object | null> {
    this.requests.push({ ceremony: "get", mediation: Option.fromUndefinedOr(options.mediation) });
    const publicKey = options.publicKey;
    const failure = this.#takeFailure();
    if (Option.isSome(failure)) return Promise.reject(failure.value);
    const rpId = publicKey.rpId ?? this.#rpId;
    const allowed = publicKey.allowCredentials ?? [];
    const candidates = Arr.filter(
      this.stored,
      (stored) =>
        stored.passkey.rpId === rpId &&
        (Arr.isReadonlyArrayEmpty(allowed) || listed(stored.rawId, allowed)),
    );
    const assertion = (stored: Stored) => ({
      id: stored.passkey.id,
      rawId: stored.rawId.buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: clientData("webauthn.get", publicKey.challenge, rpId),
        authenticatorData: Uint8Array.of(1, 2, 3).buffer,
        signature: Uint8Array.of(7, 8, 9).buffer,
        userHandle: decodeBytes(stored.passkey.userId).buffer,
      },
      getClientExtensionResults: () =>
        publicKey.extensions?.["prf"] === undefined
          ? {}
          : { prf: { results: { first: Uint8Array.of(0xff).buffer } } },
    });
    if (options.mediation !== "conditional") {
      return Option.match(Arr.head(candidates), {
        onNone: () => Promise.reject(new DOMException("no passkey", "NotAllowedError")),
        onSome: (stored) => Promise.resolve(assertion(stored)),
      });
    }
    // Autofill: waits for the user to pick, or for the page to abort.
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      const abort = () => {
        this.waiting = Option.none();
        reject(new DOMException("aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiting = Option.some((id) => {
        this.waiting = Option.none();
        signal?.removeEventListener("abort", abort);
        Option.match(
          Arr.findFirst(candidates, (stored) => stored.passkey.id === id),
          {
            onNone: () => reject(new DOMException("no passkey", "NotAllowedError")),
            onSome: (stored) => resolve(assertion(stored)),
          },
        );
      });
    });
  }
}

const CAPABILITIES = {
  conditionalGet: true,
  conditionalCreate: false,
  hybridTransport: false,
  passkeyPlatformAuthenticator: true,
  userVerifyingPlatformAuthenticator: true,
  "extension:prf": true,
} satisfies Readonly<Record<string, boolean>>;

/**
 * Builds the `Credentials` service over a fresh in-memory authenticator,
 * and its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const { credentials, control } = TestCredentials.make()
 * const program = Effect.gen(function* () {
 *   yield* control.failNext("NotAllowedError")
 *   return yield* Effect.flip(credentials.authenticate({ challenge: "Y2hhbGxlbmdl" }))
 * })
 * Effect.runPromise(program).then((error) => console.log(error.reason)) // "NotAllowed"
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (options?: Options): Fixture => {
  const container = new FakeContainer(options?.rpId ?? "example.com", options?.level2 !== false);
  const signals: Array<Signal> = [];
  const record = (signal: Signal): Promise<void> => {
    signals.push(signal);
    return Promise.resolve();
  };
  const statics: PublicKeyCredentialStaticsLike = {
    isConditionalMediationAvailable: () => Promise.resolve(true),
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
  };
  const withParsers: PublicKeyCredentialStaticsLike =
    options?.parsers === false
      ? statics
      : {
          ...statics,
          parseCreationOptionsFromJSON: parseCreation,
          parseRequestOptionsFromJSON: parseRequest,
        };
  const withCapabilities: PublicKeyCredentialStaticsLike =
    options?.clientCapabilities === false
      ? withParsers
      : { ...withParsers, getClientCapabilities: () => Promise.resolve(CAPABILITIES) };
  const withSignals: PublicKeyCredentialStaticsLike =
    options?.signals === false
      ? withCapabilities
      : {
          ...withCapabilities,
          signalUnknownCredential: (signal) =>
            record({ kind: "unknownCredential", options: signal }),
          signalAllAcceptedCredentials: (signal) =>
            record({ kind: "allAcceptedCredentials", options: signal }),
          signalCurrentUserDetails: (signal) =>
            record({ kind: "currentUserDetails", options: signal }),
        };
  return {
    credentials: makeCredentials(
      options?.supported === false ? undefined : { container, statics: withSignals },
    ),
    control: Control.of({
      passkeys: Effect.sync(() => Arr.map(container.stored, (stored) => stored.passkey)),
      failNext: (name) =>
        Effect.sync(() => {
          container.failure = Option.some(name);
        }),
      waiting: Effect.sync(() => Option.isSome(container.waiting)),
      pick: (id) => Effect.sync(() => Option.map(container.waiting, (resolve) => resolve(id))),
      signals: Effect.sync(() => [...signals]),
      requests: Effect.sync(() => [...container.requests]),
    }),
  };
};

/**
 * {@link make}, as a layer providing both the `Credentials` service and
 * its {@link Control}.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* Credentials.register({
 *     rp: { name: "Example" },
 *     user: { id: "dXNlci0x", name: "ada@example.com", displayName: "Ada" },
 *     challenge: "Y2hhbGxlbmdl",
 *     pubKeyCredParams: [{ type: "public-key", alg: -7 }],
 *   })
 *   const control = yield* TestCredentials.Control
 *   return yield* control.passkeys
 * })
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then((passkeys) =>
 *   console.log(passkeys.map((passkey) => passkey.rpId)), // ["example.com"]
 * )
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer = (options?: Options): Layer.Layer<Credentials | Control> =>
  Layer.syncContext(() => {
    const { credentials, control } = make(options);
    return Context.make(Credentials, credentials).pipe(Context.add(Control, control));
  });
