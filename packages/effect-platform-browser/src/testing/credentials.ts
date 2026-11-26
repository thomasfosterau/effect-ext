/**
 * An in-memory passkey authenticator for tests of code that uses
 * `Credentials`: {@link layer} provides the real adapter over it, plus
 * {@link Control} to read the stored passkeys and passwords, fail a
 * ceremony, pick a passkey from autofill, script an identity provider, and
 * read the signals sent.
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
  type CredentialLike,
  type CredentialsContainerLike,
  type CurrentUserDetails,
  type DescriptorJson,
  type DescriptorLike,
  type IdentityDisconnect,
  type IdentityRequest,
  make as makeCredentials,
  type PasswordData,
  type PublicKeyCredentialStaticsLike,
  RequestOptionsJson,
  type RequestOptionsLike,
  type UnknownCredential,
  type WebAuthnLike,
} from "../Credentials.ts";

/**
 * The in-memory authenticator's starting state. `supported: false` builds
 * the unsupported service. Each part of the API is present unless set
 * `false`: `parsers` (`parseCreationOptionsFromJSON` /
 * `parseRequestOptionsFromJSON`), `clientCapabilities`
 * (`getClientCapabilities`; without it, the two older yes/no checks),
 * `level2` (the attestation response's accessors), `signals`,
 * `passwords` (`PasswordCredential`) and `identity` (FedCM). `rpId` is the
 * page's domain, `example.com` by default.
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
  readonly passwords?: boolean;
  readonly identity?: boolean;
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
  readonly ceremony: "create" | "get" | "store" | "password" | "identity";
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
 * - `passwords` — every password stored, by id, in the order first stored.
 * - `dismissNext` — the user dismisses the next password or identity
 *   prompt: a password request resolves `null`, an identity one rejects
 *   `NetworkError`.
 * - `identityAccount` — the provider at `configURL` has a signed-in
 *   account, issuing `token`.
 * - `silentAccess` — whether a silent sign-in may succeed: `false` after
 *   `preventSilentAccess`, until the user next signs in through a prompt.
 * - `disconnects` — every identity disconnect sent, in order.
 *
 * A modal sign-in uses the first passkey that matches; with none, it
 * rejects `NotAllowedError`, as the platform does once the user gives up.
 * A password request signs in without a prompt where silent access is
 * allowed and exactly one password is stored (always for `silent`, which
 * otherwise resolves `null`; never for `required`); the prompt picks the
 * first stored. An identity request uses the first offered provider with
 * an account, rejecting `NetworkError` with none; it signs in without a
 * prompt (`isAutoSelected`) where silent access is allowed and the user has
 * signed in to this client before.
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
    readonly passwords: Effect.Effect<ReadonlyArray<PasswordData>>;
    readonly dismissNext: Effect.Effect<void>;
    readonly identityAccount: (configURL: string, token: string) => Effect.Effect<void>;
    readonly silentAccess: Effect.Effect<boolean>;
    readonly disconnects: Effect.Effect<ReadonlyArray<IdentityDisconnect>>;
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

interface Account {
  readonly configURL: string;
  readonly token: string;
}

/** What `new PasswordCredential(data)` builds: a `TypeError` for an empty id or password, as the platform throws. */
const passwordCredential = (data: PasswordData): CredentialLike & PasswordData => {
  if (data.id === "" || data.password === "") {
    throw new TypeError("a password credential needs an id and a password");
  }
  return { type: "password", ...data, name: data.name ?? "", iconURL: data.iconURL ?? "" };
};

const noAccount = () => Promise.reject(new DOMException("no account", "NetworkError"));

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
  readonly passwords: Array<PasswordData> = [];
  readonly accounts: Array<Account> = [];
  readonly connected: Array<string> = [];
  readonly disconnects: Array<IdentityDisconnect> = [];
  failure = Option.none<string>();
  dismiss = false;
  silentAccess = true;
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
  #takeDismiss(): boolean {
    const dismiss = this.dismiss;
    this.dismiss = false;
    return dismiss;
  }
  store(credential: CredentialLike & PasswordData): Promise<void> {
    this.requests.push({ ceremony: "store", mediation: Option.none() });
    const failure = this.#takeFailure();
    if (Option.isSome(failure)) return Promise.reject(failure.value);
    const { type: _type, ...data } = credential;
    const index = Arr.findFirstIndex(this.passwords, (stored) => stored.id === data.id);
    Option.match(index, {
      onNone: () => this.passwords.push(data),
      onSome: (at) => this.passwords.splice(at, 1, data),
    });
    return Promise.resolve();
  }
  preventSilentAccess(): Promise<void> {
    this.silentAccess = false;
    return Promise.resolve();
  }
  disconnect(options: IdentityDisconnect): Promise<void> {
    this.disconnects.push(options);
    const key = `${options.configURL} ${options.clientId}`;
    const index = this.connected.indexOf(key);
    if (index !== -1) this.connected.splice(index, 1);
    return Promise.resolve();
  }
  #password(mediation?: string): Promise<object | null> {
    const silent = mediation !== "required" && this.silentAccess && this.passwords.length === 1;
    if (silent) return Promise.resolve(passwordCredential(this.passwords[0]));
    if (mediation === "silent" || this.#takeDismiss()) return Promise.resolve(null);
    return Option.match(Arr.head(this.passwords), {
      onNone: () => Promise.resolve(null),
      onSome: (stored) => {
        this.silentAccess = true;
        return Promise.resolve(passwordCredential(stored));
      },
    });
  }
  #identity(request: IdentityRequest, mediation?: string): Promise<object | null> {
    const offered = Arr.findFirst(request.providers, (provider) =>
      Option.map(
        Arr.findFirst(this.accounts, (account) => account.configURL === provider.configURL),
        (account) => ({ provider, token: account.token }),
      ),
    );
    return Option.match(offered, {
      onNone: noAccount,
      onSome: ({ provider, token }) => {
        const key = `${provider.configURL} ${provider.clientId}`;
        const credential = (isAutoSelected: boolean) => ({
          type: "identity",
          token,
          isAutoSelected,
          configURL: provider.configURL,
        });
        const auto = mediation !== "required" && this.silentAccess && this.connected.includes(key);
        if (auto) return Promise.resolve(credential(true));
        if (mediation === "silent" || this.#takeDismiss()) return noAccount();
        if (!this.connected.includes(key)) this.connected.push(key);
        this.silentAccess = true;
        return Promise.resolve(credential(false));
      },
    });
  }
  get(options: {
    readonly publicKey?: RequestOptionsLike;
    readonly password?: boolean;
    readonly identity?: IdentityRequest;
    readonly mediation?: string;
    readonly signal?: AbortSignal;
  }): Promise<object | null> {
    const ceremony =
      options.identity === undefined
        ? options.password === true
          ? "password"
          : "get"
        : "identity";
    this.requests.push({ ceremony, mediation: Option.fromUndefinedOr(options.mediation) });
    const failure = this.#takeFailure();
    if (Option.isSome(failure)) return Promise.reject(failure.value);
    if (options.identity !== undefined) return this.#identity(options.identity, options.mediation);
    const publicKey = options.publicKey;
    if (publicKey === undefined) return this.#password(options.mediation);
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
  const withPasswords: WebAuthnLike =
    options?.passwords === false
      ? { container, statics: withSignals }
      : { container, statics: withSignals, passwordCredential };
  const webAuthn: WebAuthnLike =
    options?.identity === false
      ? withPasswords
      : {
          ...withPasswords,
          identityCredential: { disconnect: (signal) => container.disconnect(signal) },
        };
  return {
    credentials: makeCredentials(options?.supported === false ? undefined : webAuthn),
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
      passwords: Effect.sync(() => [...container.passwords]),
      dismissNext: Effect.sync(() => {
        container.dismiss = true;
      }),
      identityAccount: (configURL, token) =>
        Effect.sync(() => {
          const others = Arr.filter(
            container.accounts,
            (account) => account.configURL !== configURL,
          );
          container.accounts.splice(0, container.accounts.length, ...others, { configURL, token });
        }),
      silentAccess: Effect.sync(() => container.silentAccess),
      disconnects: Effect.sync(() => [...container.disconnects]),
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
