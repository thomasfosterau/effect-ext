/**
 * Passkeys (WebAuthn) as an Effect service, in the JSON shapes a server
 * sends and expects back: decode the server's options with
 * {@link CreationOptionsJson} or {@link RequestOptionsJson}, `register` or
 * `authenticate`, and encode the response with
 * {@link RegistrationResponseJson} or {@link AuthenticationResponseJson}.
 * Verifying a response is the server's job. Stored passwords and FedCM
 * sign-ins are on the same service.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Base64Url } from "effect/encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import { reasonOf } from "./internal/dom.ts";
import { ambientWebAuthn } from "./internal/globals.ts";

/**
 * Unpadded base64url, as every binary field of the WebAuthn JSON forms is.
 *
 * @since 0.1.0
 * @category schemas
 */
export const Base64UrlString = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]*$/u, { message: "expected base64url" })),
);

/**
 * @since 0.1.0
 * @category models
 */
export type Base64UrlString = typeof Base64UrlString.Type;

/**
 * A credential to exclude from a registration or allow in an
 * authentication, by its id.
 *
 * @since 0.1.0
 * @category schemas
 */
export const DescriptorJson = Schema.Struct({
  id: Base64UrlString,
  type: Schema.String,
  transports: Schema.optionalKey(Schema.Array(Schema.String)),
});

/**
 * @since 0.1.0
 * @category models
 */
export type DescriptorJson = typeof DescriptorJson.Type;

/**
 * `PublicKeyCredentialCreationOptionsJSON`: what a server sends to start
 * registering a passkey.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 *
 * const options = Schema.decodeUnknownSync(Credentials.CreationOptionsJson)({
 *   rp: { id: "example.com", name: "Example" },
 *   user: { id: "dXNlci0x", name: "ada@example.com", displayName: "Ada" },
 *   challenge: "Y2hhbGxlbmdl",
 *   pubKeyCredParams: [{ type: "public-key", alg: -7 }],
 * })
 * console.log(options.rp.name) // "Example"
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const CreationOptionsJson = Schema.Struct({
  rp: Schema.Struct({ id: Schema.optionalKey(Schema.String), name: Schema.String }),
  user: Schema.Struct({ id: Base64UrlString, name: Schema.String, displayName: Schema.String }),
  challenge: Base64UrlString,
  pubKeyCredParams: Schema.Array(Schema.Struct({ type: Schema.String, alg: Schema.Finite })),
  timeout: Schema.optionalKey(Schema.Finite),
  excludeCredentials: Schema.optionalKey(Schema.Array(DescriptorJson)),
  authenticatorSelection: Schema.optionalKey(
    Schema.Struct({
      authenticatorAttachment: Schema.optionalKey(Schema.String),
      residentKey: Schema.optionalKey(Schema.String),
      requireResidentKey: Schema.optionalKey(Schema.Boolean),
      userVerification: Schema.optionalKey(Schema.String),
    }),
  ),
  hints: Schema.optionalKey(Schema.Array(Schema.String)),
  attestation: Schema.optionalKey(Schema.String),
  attestationFormats: Schema.optionalKey(Schema.Array(Schema.String)),
  extensions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

/**
 * @since 0.1.0
 * @category models
 */
export type CreationOptionsJson = typeof CreationOptionsJson.Type;

/**
 * `PublicKeyCredentialRequestOptionsJSON`: what a server sends to start a
 * sign-in. With no `allowCredentials`, any passkey for the site will do.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 *
 * const options = Schema.decodeUnknownSync(Credentials.RequestOptionsJson)({
 *   challenge: "Y2hhbGxlbmdl",
 *   rpId: "example.com",
 *   userVerification: "preferred",
 * })
 * console.log(options.rpId) // "example.com"
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const RequestOptionsJson = Schema.Struct({
  challenge: Base64UrlString,
  timeout: Schema.optionalKey(Schema.Finite),
  rpId: Schema.optionalKey(Schema.String),
  allowCredentials: Schema.optionalKey(Schema.Array(DescriptorJson)),
  userVerification: Schema.optionalKey(Schema.String),
  hints: Schema.optionalKey(Schema.Array(Schema.String)),
  extensions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

/**
 * @since 0.1.0
 * @category models
 */
export type RequestOptionsJson = typeof RequestOptionsJson.Type;

/** What both responses carry beside the authenticator's own response. */
const credentialFields = {
  id: Base64UrlString,
  rawId: Base64UrlString,
  type: Schema.Literal("public-key"),
  authenticatorAttachment: Schema.optional(Schema.String),
  clientExtensionResults: Schema.Record(Schema.String, Schema.Json),
};

/**
 * `RegistrationResponseJSON`: the new passkey, for the server to verify
 * and store. `authenticatorData`, `publicKey` and `publicKeyAlgorithm` are
 * missing where the agent predates WebAuthn Level 2's accessors (the
 * server reads them from `attestationObject` instead).
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 *
 * const response = Schema.decodeUnknownSync(Credentials.RegistrationResponseJson)({
 *   id: "Y3JlZA",
 *   rawId: "Y3JlZA",
 *   type: "public-key",
 *   clientExtensionResults: {},
 *   response: { clientDataJSON: "e30", attestationObject: "AA", transports: ["internal"] },
 * })
 * console.log(response.response.transports) // ["internal"]
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const RegistrationResponseJson = Schema.Struct({
  ...credentialFields,
  response: Schema.Struct({
    clientDataJSON: Base64UrlString,
    attestationObject: Base64UrlString,
    authenticatorData: Schema.optional(Base64UrlString),
    transports: Schema.optional(Schema.Array(Schema.String)),
    publicKey: Schema.optional(Base64UrlString),
    publicKeyAlgorithm: Schema.optional(Schema.Finite),
  }),
});

/**
 * @since 0.1.0
 * @category models
 */
export type RegistrationResponseJson = typeof RegistrationResponseJson.Type;

/**
 * `AuthenticationResponseJSON`: the signed challenge, for the server to
 * verify against the stored passkey. `userHandle` is the `user.id` the
 * passkey was registered with, present for a discoverable passkey.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 *
 * const response = Schema.decodeUnknownSync(Credentials.AuthenticationResponseJson)({
 *   id: "Y3JlZA",
 *   rawId: "Y3JlZA",
 *   type: "public-key",
 *   clientExtensionResults: {},
 *   response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA", userHandle: "dXNlci0x" },
 * })
 * console.log(response.response.userHandle) // "dXNlci0x"
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const AuthenticationResponseJson = Schema.Struct({
  ...credentialFields,
  response: Schema.Struct({
    clientDataJSON: Base64UrlString,
    authenticatorData: Base64UrlString,
    signature: Base64UrlString,
    userHandle: Schema.optional(Base64UrlString),
  }),
});

/**
 * @since 0.1.0
 * @category models
 */
export type AuthenticationResponseJson = typeof AuthenticationResponseJson.Type;

/**
 * Bytes as the platform takes them.
 *
 * @since 0.1.0
 * @category models
 */
export type Bytes = Uint8Array<ArrayBuffer>;

/**
 * {@link DescriptorJson} with its id as bytes.
 *
 * @since 0.1.0
 * @category models
 */
export interface DescriptorLike extends Omit<DescriptorJson, "id"> {
  readonly id: Bytes;
}

/**
 * The structural slice of `PublicKeyCredentialCreationOptions`:
 * {@link CreationOptionsJson} with its binary fields as bytes.
 *
 * @since 0.1.0
 * @category models
 */
export interface CreationOptionsLike extends Omit<
  CreationOptionsJson,
  "user" | "challenge" | "excludeCredentials"
> {
  readonly user: Omit<CreationOptionsJson["user"], "id"> & { readonly id: Bytes };
  readonly challenge: Bytes;
  readonly excludeCredentials?: ReadonlyArray<DescriptorLike>;
}

/**
 * The structural slice of `PublicKeyCredentialRequestOptions`:
 * {@link RequestOptionsJson} with its binary fields as bytes.
 *
 * @since 0.1.0
 * @category models
 */
export interface RequestOptionsLike extends Omit<
  RequestOptionsJson,
  "challenge" | "allowCredentials"
> {
  readonly challenge: Bytes;
  readonly allowCredentials?: ReadonlyArray<DescriptorLike>;
}

/**
 * The structural slice of an `AuthenticatorAttestationResponse`. The
 * accessors are WebAuthn Level 2; older agents lack them.
 *
 * @since 0.1.0
 * @category models
 */
export interface AttestationResponseLike {
  readonly clientDataJSON: ArrayBuffer;
  readonly attestationObject: ArrayBuffer;
  readonly getAuthenticatorData?: () => ArrayBuffer;
  readonly getPublicKey?: () => ArrayBuffer | null;
  readonly getPublicKeyAlgorithm?: () => number;
  readonly getTransports?: () => ReadonlyArray<string>;
}

/**
 * The structural slice of an `AuthenticatorAssertionResponse`.
 *
 * @since 0.1.0
 * @category models
 */
export interface AssertionResponseLike {
  readonly clientDataJSON: ArrayBuffer;
  readonly authenticatorData: ArrayBuffer;
  readonly signature: ArrayBuffer;
  readonly userHandle: ArrayBuffer | null;
}

/**
 * The structural slice of a `PublicKeyCredential`.
 *
 * @since 0.1.0
 * @category models
 */
export interface PublicKeyCredentialLike<Response> {
  readonly id: string;
  readonly rawId: ArrayBuffer;
  readonly authenticatorAttachment: string | null;
  readonly response: Response;
  getClientExtensionResults(): object;
}

/**
 * How a sign-in asks the user. `conditional` offers passkeys in the
 * autofill of an `autocomplete="… webauthn"` field and waits, without a
 * dialog, until the user picks one.
 *
 * @since 0.1.0
 * @category models
 */
export type Mediation = "conditional" | "optional" | "required";

/**
 * Tells the passkey provider a credential id the server no longer knows
 * (deleted, or never stored), so it can hide or remove it.
 *
 * @since 0.1.0
 * @category models
 */
export interface UnknownCredential {
  readonly rpId: string;
  readonly credentialId: string;
}

/**
 * Tells the passkey provider every credential id the server accepts for a
 * user, so it can hide or remove the rest.
 *
 * @since 0.1.0
 * @category models
 */
export interface AcceptedCredentials {
  readonly rpId: string;
  readonly userId: string;
  readonly allAcceptedCredentialIds: ReadonlyArray<string>;
}

/**
 * Tells the passkey provider a user's current name and display name.
 *
 * @since 0.1.0
 * @category models
 */
export interface CurrentUserDetails {
  readonly rpId: string;
  readonly userId: string;
  readonly name: string;
  readonly displayName: string;
}

/**
 * The structural slice of `navigator.credentials` this module calls. The
 * options are the platform's binary forms ({@link CreationOptionsLike},
 * {@link RequestOptionsLike}, or what the platform's own parser returned),
 * and a ceremony resolves with a `PublicKeyCredential`, checked
 * structurally.
 *
 * @since 0.1.0
 * @category models
 */
export interface CredentialsContainerLike {
  create(options?: {
    readonly publicKey?: object;
    readonly signal?: AbortSignal;
  }): Promise<object | null>;
  get(options?: {
    readonly publicKey?: object;
    readonly password?: boolean;
    readonly identity?: object;
    readonly mediation?: string;
    readonly signal?: AbortSignal;
  }): Promise<object | null>;
  store?(credential: CredentialLike): Promise<void>;
  preventSilentAccess?(): Promise<void>;
}

/**
 * The structural slice of a `Credential`: what `store` takes.
 *
 * @since 0.2.0
 * @category models
 */
export interface CredentialLike {
  readonly id: string;
  readonly type: string;
}

/**
 * How a password or identity sign-in asks the user. `silent` never shows
 * a prompt: it resolves only where the user has signed in before and
 * {@link preventSilentAccess} has not been called since.
 *
 * @since 0.2.0
 * @category models
 */
export type SignInMediation = "silent" | "optional" | "required";

/**
 * A password to store after the user signs in with a form. `name` and
 * `iconURL` show in the browser's account chooser.
 *
 * @since 0.2.0
 * @category models
 */
export interface PasswordData {
  readonly id: string;
  readonly password: string;
  readonly name?: string;
  readonly iconURL?: string;
}

/**
 * A password the browser filled back.
 *
 * @since 0.2.0
 * @category models
 */
export interface StoredPassword {
  readonly id: string;
  readonly password: string;
  readonly name: Option.Option<string>;
  readonly iconURL: Option.Option<string>;
}

/**
 * One identity provider a FedCM sign-in offers. `params` reach the
 * provider's ID assertion endpoint as JSON.
 *
 * @since 0.2.0
 * @category models
 */
export interface IdentityProvider {
  readonly configURL: string;
  readonly clientId: string;
  readonly nonce?: string;
  readonly loginHint?: string;
  readonly domainHint?: string;
  readonly fields?: ReadonlyArray<string>;
  readonly params?: Readonly<Record<string, Schema.Json>>;
}

/**
 * A FedCM sign-in: the providers to offer, the wording of the prompt
 * (`context`), and whether it is a widget the browser shows unprompted
 * (`passive`) or a dialog after a click (`active`).
 *
 * @since 0.2.0
 * @category models
 */
export interface IdentityRequest {
  readonly providers: ReadonlyArray<IdentityProvider>;
  readonly context?: "signin" | "signup" | "use" | "continue";
  readonly mode?: "active" | "passive";
}

/**
 * What a FedCM sign-in returned: the provider's token for the server to
 * verify, whether the browser picked the account without asking, and the
 * provider that issued it (`None` where the agent does not say).
 *
 * @since 0.2.0
 * @category models
 */
export interface IdentityToken {
  readonly token: string;
  readonly isAutoSelected: boolean;
  readonly configURL: Option.Option<string>;
}

/**
 * Asks a provider to forget that the user signed in to this site with an
 * account (`accountHint`: its id, or an email it gave).
 *
 * @since 0.2.0
 * @category models
 */
export interface IdentityDisconnect {
  readonly configURL: string;
  readonly clientId: string;
  readonly accountHint: string;
}

/**
 * The structural slice of `IdentityCredential`'s static methods this
 * module calls. Its presence is what says the agent has FedCM.
 *
 * @since 0.2.0
 * @category models
 */
export interface IdentityCredentialStaticsLike {
  disconnect?(this: void, options: IdentityDisconnect): Promise<void>;
}

/**
 * The structural slice of `PublicKeyCredential`'s static methods this
 * module calls, each missing where the agent lacks it. Static operations
 * ignore `this`, so each is called unbound.
 *
 * @since 0.1.0
 * @category models
 */
export interface PublicKeyCredentialStaticsLike {
  parseCreationOptionsFromJSON?(this: void, options: unknown): object;
  parseRequestOptionsFromJSON?(this: void, options: unknown): object;
  getClientCapabilities?(this: void): Promise<Readonly<Record<string, boolean>>>;
  isConditionalMediationAvailable?(this: void): Promise<boolean>;
  isUserVerifyingPlatformAuthenticatorAvailable?(this: void): Promise<boolean>;
  signalUnknownCredential?(this: void, options: UnknownCredential): Promise<void>;
  signalAllAcceptedCredentials?(this: void, options: AcceptedCredentials): Promise<void>;
  signalCurrentUserDetails?(this: void, options: CurrentUserDetails): Promise<void>;
}

/**
 * The Credential Management API: `navigator.credentials` and
 * `PublicKeyCredential`, plus `PasswordCredential` and `IdentityCredential`
 * where the agent has them.
 *
 * @since 0.1.0
 * @category models
 */
export interface WebAuthnLike {
  readonly container: CredentialsContainerLike;
  readonly statics: PublicKeyCredentialStaticsLike;
  /** `new PasswordCredential(data)`, where the agent has it (Chromium). */
  readonly passwordCredential?: ((data: PasswordData) => CredentialLike) | undefined;
  /** `IdentityCredential`, where the agent has FedCM. */
  readonly identityCredential?: IdentityCredentialStaticsLike | undefined;
}

/**
 * Why a ceremony failed.
 *
 * - `Unsupported` — the agent has no WebAuthn, or not this part of it.
 * - `NotAllowed` — the user cancelled, the ceremony timed out, or no
 *   passkey matched: WebAuthn does not say which, by design.
 * - `InvalidState` — registering: the authenticator already holds one of
 *   `excludeCredentials`.
 * - `Security` — the RP id does not match the page's origin.
 * - `NotSupported` — no authenticator supports any of `pubKeyCredParams`.
 * - `Constraint` — the authenticator cannot meet `authenticatorSelection`.
 * - `Aborted` — aborted from outside the fiber.
 * - `Network` — FedCM: the provider could not be reached, the user has no
 *   account with it, or the user dismissed the prompt.
 * - `Encoding` — the options carry a malformed base64url field.
 * - `Failed` — anything else; `cause` carries the platform's error.
 *
 * @since 0.1.0
 * @category errors
 */
export type CredentialsErrorReason =
  | "Unsupported"
  | "NotAllowed"
  | "InvalidState"
  | "Security"
  | "NotSupported"
  | "Constraint"
  | "Aborted"
  | "Network"
  | "Encoding"
  | "Failed";

/**
 * A WebAuthn ceremony or signal that failed.
 *
 * @example
 * ```ts
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 *
 * const error = new Credentials.CredentialsError({
 *   reason: "NotAllowed",
 *   message: "credentials: NotAllowed",
 *   cause: undefined,
 * })
 * console.log(error.reason) // "NotAllowed"
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export class CredentialsError extends Schema.TaggedError<
  CredentialsError,
  { readonly brand: unique symbol }
>()("CredentialsError", {
  reason: Schema.Literals([
    "Unsupported",
    "NotAllowed",
    "InvalidState",
    "Security",
    "NotSupported",
    "Constraint",
    "Aborted",
    "Network",
    "Encoding",
    "Failed",
  ]),
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const credentialsError = (reason: CredentialsErrorReason, cause: unknown) =>
  new CredentialsError({ reason, cause, message: `credentials: ${reason}` });

const REJECTION_REASONS = {
  NotAllowedError: "NotAllowed",
  InvalidStateError: "InvalidState",
  SecurityError: "Security",
  NotSupportedError: "NotSupported",
  ConstraintError: "Constraint",
  AbortError: "Aborted",
  NetworkError: "Network",
} satisfies Readonly<Record<string, CredentialsErrorReason>>;

const fromRejection = (cause: unknown) =>
  credentialsError(reasonOf(cause, REJECTION_REASONS, "Failed"), cause);

/** A base64url field as bytes; `Encoding` where it is malformed. */
const bytes = (value: string): Effect.Effect<Bytes, CredentialsError> =>
  Effect.mapError(
    Effect.map(Effect.fromResult(Base64Url.decode(value)), (decoded) => Uint8Array.from(decoded)),
    (cause) => credentialsError("Encoding", cause),
  );

const descriptors = (list?: ReadonlyArray<DescriptorJson>) =>
  Effect.forEach(
    list ?? [],
    (descriptor) =>
      Effect.map(bytes(descriptor.id), (id): DescriptorLike => ({ ...descriptor, id })),
    { concurrency: 1 },
  );

/** `parseCreationOptionsFromJSON`, by hand, for agents without it. */
const creationOptions = (json: CreationOptionsJson) =>
  Effect.gen(function* () {
    const { user, challenge, excludeCredentials, ...rest } = json;
    return {
      ...rest,
      user: { ...user, id: yield* bytes(user.id) },
      challenge: yield* bytes(challenge),
      excludeCredentials: yield* descriptors(excludeCredentials),
    } satisfies CreationOptionsLike;
  });

/** `parseRequestOptionsFromJSON`, by hand, for agents without it. */
const requestOptions = (json: RequestOptionsJson) =>
  Effect.gen(function* () {
    const { challenge, allowCredentials, ...rest } = json;
    return {
      ...rest,
      challenge: yield* bytes(challenge),
      allowCredentials: yield* descriptors(allowCredentials),
    } satisfies RequestOptionsLike;
  });

/** Options through the platform's parser where it has one, else by hand. */
const parse = <Json>(
  parser: ((json: Json) => object) | undefined,
  byHand: (json: Json) => Effect.Effect<object, CredentialsError>,
  json: Json,
): Effect.Effect<object, CredentialsError> =>
  parser === undefined
    ? byHand(json)
    : Effect.try({
        try: () => parser(json),
        catch: (cause) => credentialsError("Encoding", cause),
      });

const encode = (buffer: ArrayBuffer): string => Base64Url.encode(new Uint8Array(buffer));

/**
 * A client extension output as JSON: its binary members as base64url, and
 * anything JSON cannot hold (none the specification defines) as `null`.
 */
const jsonValue = (value: unknown): Schema.Json => {
  if (P.isString(value) || P.isNumber(value) || P.isBoolean(value) || P.isNull(value)) return value;
  if (value instanceof ArrayBuffer) return encode(value);
  if (ArrayBuffer.isView(value)) {
    return Base64Url.encode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value)) return Arr.map(value, jsonValue);
  if (P.isObject(value)) return R.map(value, jsonValue);
  return null;
};

const extensionResults = (credential: PublicKeyCredentialLike<unknown>) =>
  R.map({ ...credential.getClientExtensionResults() }, jsonValue);

const registrationJson = (
  credential: PublicKeyCredentialLike<AttestationResponseLike>,
): RegistrationResponseJson => {
  const { response } = credential;
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: "public-key",
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: extensionResults(credential),
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      attestationObject: encode(response.attestationObject),
      authenticatorData: Option.getOrUndefined(
        Option.map(Option.fromUndefinedOr(response.getAuthenticatorData?.()), encode),
      ),
      transports: response.getTransports?.(),
      publicKey: Option.getOrUndefined(
        Option.map(Option.fromNullishOr(response.getPublicKey?.()), encode),
      ),
      publicKeyAlgorithm: response.getPublicKeyAlgorithm?.(),
    },
  };
};

const authenticationJson = (
  credential: PublicKeyCredentialLike<AssertionResponseLike>,
): AuthenticationResponseJson => {
  const { response } = credential;
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: "public-key",
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: extensionResults(credential),
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      authenticatorData: encode(response.authenticatorData),
      signature: encode(response.signature),
      userHandle: Option.getOrUndefined(
        Option.map(Option.fromNullishOr(response.userHandle), encode),
      ),
    },
  };
};

const isCredential = (value: unknown): value is PublicKeyCredentialLike<unknown> =>
  P.hasProperty(value, "id") &&
  P.isString(value.id) &&
  P.hasProperty(value, "rawId") &&
  value.rawId instanceof ArrayBuffer &&
  P.hasProperty(value, "getClientExtensionResults") &&
  P.hasProperty(value, "response") &&
  P.hasProperty(value.response, "clientDataJSON") &&
  value.response.clientDataJSON instanceof ArrayBuffer;

/** Whether a registration resolved with a credential carrying an attestation. */
const isAttestation = (value: unknown): value is PublicKeyCredentialLike<AttestationResponseLike> =>
  isCredential(value) &&
  P.hasProperty(value.response, "attestationObject") &&
  value.response.attestationObject instanceof ArrayBuffer;

/** Whether a sign-in resolved with a credential carrying an assertion. */
const isAssertion = (value: unknown): value is PublicKeyCredentialLike<AssertionResponseLike> =>
  isCredential(value) &&
  P.hasProperty(value.response, "signature") &&
  value.response.signature instanceof ArrayBuffer;

/** What a ceremony resolved with, as `A`; `Failed` for anything else (`null`). */
const resolved =
  <A>(is: (value: unknown) => value is A) =>
  (value: unknown): Effect.Effect<A, CredentialsError> =>
    is(value) ? Effect.succeed(value) : Effect.fail(credentialsError("Failed", value));

/** One yes/no question to the agent: `None` where it cannot answer. */
const ask = (question?: () => Promise<boolean>) =>
  question === undefined
    ? Effect.succeedNone
    : Effect.option(Effect.tryPromise({ try: question, catch: fromRejection }));

/**
 * The WebAuthn service. Provide {@link layer} in a page, or
 * `TestCredentials.layer` from `@thomasfosterau/effect-platform-browser/BrowserTesting` in tests.
 *
 * - `supported` — whether the agent has public-key credentials.
 * - `register` — creates a passkey from the server's creation options.
 * - `authenticate` — signs the server's challenge with a passkey;
 *   `mediation: "conditional"` waits for the user to pick one from
 *   autofill. Interrupting either aborts the ceremony.
 * - `capabilities` — what the client can do, by WebAuthn's capability
 *   names (`conditionalGet`, `passkeyPlatformAuthenticator`,
 *   `userVerifyingPlatformAuthenticator`, `hybridTransport`, extensions as
 *   `extension:<name>`). Where the agent has no `getClientCapabilities`,
 *   the two it can still answer; empty without WebAuthn.
 * - `signalUnknownCredential` / `signalAllAcceptedCredentials` /
 *   `signalCurrentUserDetails` — keep the user's passkey provider in step
 *   with the server. They are hints: `Effect.ignore` is the usual call.
 *
 * - `passwordsSupported` — whether the agent stores passwords
 *   (`PasswordCredential`, Chromium only).
 * - `storePassword` — offers to save the password the user just signed in
 *   with; resolves whether or not the user accepts.
 * - `password` — the stored password for this site, `None` where the user
 *   has none or dismisses the chooser.
 * - `identitySupported` — whether the agent has FedCM.
 * - `identity` — signs in through an identity provider; interrupting it
 *   aborts the prompt.
 * - `disconnectIdentity` — asks a provider to forget an account's sign-in
 *   to this site.
 * - `preventSilentAccess` — after a sign-out: the next password or
 *   identity sign-in asks the user rather than signing in silently.
 *
 * @since 0.1.0
 * @category services
 */
export class Credentials extends Context.Service<
  Credentials,
  {
    readonly supported: boolean;
    readonly register: (
      options: CreationOptionsJson,
    ) => Effect.Effect<RegistrationResponseJson, CredentialsError>;
    readonly authenticate: (
      options: RequestOptionsJson,
      mediation?: Mediation,
    ) => Effect.Effect<AuthenticationResponseJson, CredentialsError>;
    readonly capabilities: Effect.Effect<Readonly<Record<string, boolean>>>;
    readonly signalUnknownCredential: (
      options: UnknownCredential,
    ) => Effect.Effect<void, CredentialsError>;
    readonly signalAllAcceptedCredentials: (
      options: AcceptedCredentials,
    ) => Effect.Effect<void, CredentialsError>;
    readonly signalCurrentUserDetails: (
      options: CurrentUserDetails,
    ) => Effect.Effect<void, CredentialsError>;
    readonly passwordsSupported: boolean;
    readonly storePassword: (data: PasswordData) => Effect.Effect<void, CredentialsError>;
    readonly password: (
      mediation?: SignInMediation,
    ) => Effect.Effect<Option.Option<StoredPassword>, CredentialsError>;
    readonly identitySupported: boolean;
    readonly identity: (
      request: IdentityRequest,
      mediation?: SignInMediation,
    ) => Effect.Effect<IdentityToken, CredentialsError>;
    readonly disconnectIdentity: (
      options: IdentityDisconnect,
    ) => Effect.Effect<void, CredentialsError>;
    readonly preventSilentAccess: Effect.Effect<void, CredentialsError>;
  }
>()("@thomasfosterau/effect-platform-browser/Credentials") {}

/** A signal through `send`; `Unsupported` where the agent lacks it. */
const sendSignal =
  <A>(send?: (options: A) => Promise<void>) =>
  (options: A): Effect.Effect<void, CredentialsError> =>
    send === undefined
      ? Effect.fail(credentialsError("Unsupported", undefined))
      : Effect.tryPromise({ try: () => send(options), catch: fromRejection });

const unsupportedError = () => Effect.fail(credentialsError("Unsupported", undefined));

const isPasswordCredential = (
  value: unknown,
): value is {
  readonly id: string;
  readonly password: string;
  readonly name?: string;
  readonly iconURL?: string;
} =>
  P.hasProperty(value, "type") &&
  value.type === "password" &&
  P.hasProperty(value, "id") &&
  P.isString(value.id) &&
  P.hasProperty(value, "password") &&
  P.isString(value.password);

const isIdentityCredential = (
  value: unknown,
): value is {
  readonly token: string;
  readonly isAutoSelected?: boolean;
  readonly configURL?: string;
} => P.hasProperty(value, "token") && P.isString(value.token);

/** The platform's `""` for an absent name or icon, as `None`. */
const nonEmpty = (value?: string): Option.Option<string> =>
  Option.filter(Option.fromUndefinedOr(value), (text) => text !== "");

const storePasswordWith =
  (container: CredentialsContainerLike, create?: (data: PasswordData) => CredentialLike) =>
  (data: PasswordData): Effect.Effect<void, CredentialsError> => {
    const store = container.store?.bind(container);
    return create === undefined || store === undefined
      ? unsupportedError()
      : Effect.flatMap(
          Effect.try({
            try: () => create(data),
            catch: (cause) => credentialsError("Failed", cause),
          }),
          (credential) => Effect.tryPromise({ try: () => store(credential), catch: fromRejection }),
        );
  };

const passwordWith =
  (container: CredentialsContainerLike, supported: boolean) =>
  (mediation?: SignInMediation): Effect.Effect<Option.Option<StoredPassword>, CredentialsError> =>
    supported
      ? Effect.map(
          Effect.tryPromise({
            try: (signal) =>
              container.get(
                mediation === undefined
                  ? { password: true, signal }
                  : { password: true, mediation, signal },
              ),
            catch: fromRejection,
          }),
          (credential) =>
            Option.map(
              Option.liftPredicate(credential, isPasswordCredential),
              (found): StoredPassword => ({
                id: found.id,
                password: found.password,
                name: nonEmpty(found.name),
                iconURL: nonEmpty(found.iconURL),
              }),
            ),
        )
      : unsupportedError();

const identityWith =
  (container: CredentialsContainerLike, supported: boolean) =>
  (
    request: IdentityRequest,
    mediation?: SignInMediation,
  ): Effect.Effect<IdentityToken, CredentialsError> =>
    supported
      ? Effect.tryPromise({
          try: (signal) =>
            container.get(
              mediation === undefined
                ? { identity: request, signal }
                : { identity: request, mediation, signal },
            ),
          catch: fromRejection,
        }).pipe(
          Effect.flatMap(resolved(isIdentityCredential)),
          Effect.map((credential): IdentityToken => ({
            token: credential.token,
            isAutoSelected: credential.isAutoSelected === true,
            configURL: Option.fromUndefinedOr(credential.configURL),
          })),
        )
      : unsupportedError();

/**
 * Builds the {@link Credentials} service over WebAuthn; `undefined` builds
 * the unsupported service. {@link layer} passes the ambient one.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 *
 * const credentials = Credentials.make()
 * Effect.runPromise(credentials.capabilities).then(console.log) // {}
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = (webAuthn?: WebAuthnLike): Credentials["Service"] => {
  if (webAuthn === undefined) {
    const unsupported = Effect.fail(credentialsError("Unsupported", undefined));
    return Credentials.of({
      supported: false,
      register: () => unsupported,
      authenticate: () => unsupported,
      capabilities: Effect.succeed({}),
      signalUnknownCredential: () => unsupported,
      signalAllAcceptedCredentials: () => unsupported,
      signalCurrentUserDetails: () => unsupported,
      passwordsSupported: false,
      storePassword: () => unsupported,
      password: () => unsupported,
      identitySupported: false,
      identity: () => unsupported,
      disconnectIdentity: () => unsupported,
      preventSilentAccess: unsupported,
    });
  }
  const { container, statics } = webAuthn;
  const legacyCapabilities = Effect.map(
    Effect.all(
      {
        conditionalGet: ask(statics.isConditionalMediationAvailable),
        userVerifyingPlatformAuthenticator: ask(
          statics.isUserVerifyingPlatformAuthenticatorAvailable,
        ),
      },
      { concurrency: "unbounded" },
    ),
    R.getSomes,
  );
  const getClientCapabilities = statics.getClientCapabilities;
  return Credentials.of({
    supported: true,
    register: (json) =>
      Effect.flatMap(
        parse(statics.parseCreationOptionsFromJSON, creationOptions, json),
        (publicKey) =>
          Effect.tryPromise({
            try: (signal) => container.create({ publicKey, signal }),
            catch: fromRejection,
          }).pipe(Effect.flatMap(resolved(isAttestation)), Effect.map(registrationJson)),
      ),
    authenticate: (json, mediation) =>
      Effect.flatMap(
        parse(statics.parseRequestOptionsFromJSON, requestOptions, json),
        (publicKey) =>
          Effect.tryPromise({
            try: (signal) =>
              container.get(
                mediation === undefined ? { publicKey, signal } : { publicKey, mediation, signal },
              ),
            catch: fromRejection,
          }).pipe(Effect.flatMap(resolved(isAssertion)), Effect.map(authenticationJson)),
      ),
    capabilities:
      getClientCapabilities === undefined
        ? legacyCapabilities
        : Effect.orElseSucceed(
            Effect.tryPromise({ try: getClientCapabilities, catch: fromRejection }),
            () => ({}),
          ),
    signalUnknownCredential: sendSignal(statics.signalUnknownCredential),
    signalAllAcceptedCredentials: sendSignal(statics.signalAllAcceptedCredentials),
    signalCurrentUserDetails: sendSignal(statics.signalCurrentUserDetails),
    passwordsSupported: webAuthn.passwordCredential !== undefined,
    storePassword: storePasswordWith(container, webAuthn.passwordCredential),
    password: passwordWith(container, webAuthn.passwordCredential !== undefined),
    identitySupported: webAuthn.identityCredential !== undefined,
    identity: identityWith(container, webAuthn.identityCredential !== undefined),
    disconnectIdentity: sendSignal(webAuthn.identityCredential?.disconnect),
    preventSilentAccess: Effect.suspend(() => {
      const prevent = container.preventSilentAccess?.bind(container);
      return prevent === undefined
        ? Effect.fail(credentialsError("Unsupported", undefined))
        : Effect.tryPromise({ try: prevent, catch: fromRejection });
    }),
  });
};

/**
 * The {@link Credentials} service over the ambient WebAuthn; reports
 * `supported: false` where there is none.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 *
 * const program = Effect.map(Credentials.Credentials, (credentials) => credentials.supported)
 * Effect.runPromise(Effect.provide(program, Credentials.layer)).then(console.log) // false under Node
 * ```
 *
 * @since 0.1.0
 * @category layers
 */
export const layer: Layer.Layer<Credentials> = Layer.sync(Credentials, () =>
  make(Option.getOrUndefined(ambientWebAuthn())),
);

/**
 * Creates a passkey from the server's creation options.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Credentials.register({
 *   rp: { id: "example.com", name: "Example" },
 *   user: { id: "dXNlci0x", name: "ada@example.com", displayName: "Ada" },
 *   challenge: "Y2hhbGxlbmdl",
 *   pubKeyCredParams: [{ type: "public-key", alg: -7 }],
 * })
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then((response) =>
 *   console.log(response.type, response.response.transports), // "public-key" ["internal"]
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const register = (
  options: CreationOptionsJson,
): Effect.Effect<RegistrationResponseJson, CredentialsError, Credentials> =>
  Effect.flatMap(Credentials, (credentials) => credentials.register(options));

/**
 * Signs the server's challenge with a passkey.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   const registered = yield* Credentials.register({
 *     rp: { id: "example.com", name: "Example" },
 *     user: { id: "dXNlci0x", name: "ada@example.com", displayName: "Ada" },
 *     challenge: "Y2hhbGxlbmdl",
 *     pubKeyCredParams: [{ type: "public-key", alg: -7 }],
 *   })
 *   const signedIn = yield* Credentials.authenticate({ challenge: "c2lnbiBpbg", rpId: "example.com" })
 *   return [signedIn.id === registered.id, signedIn.response.userHandle]
 * })
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then(console.log) // [true, "dXNlci0x"]
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const authenticate = (
  options: RequestOptionsJson,
  mediation?: Mediation,
): Effect.Effect<AuthenticationResponseJson, CredentialsError, Credentials> =>
  Effect.flatMap(Credentials, (credentials) => credentials.authenticate(options, mediation));

/**
 * What the client can do, by WebAuthn's capability names.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Credentials.capabilities
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then((capabilities) =>
 *   console.log(capabilities.conditionalGet), // true
 * )
 * ```
 *
 * @since 0.1.0
 * @category accessors
 */
export const capabilities: Effect.Effect<
  Readonly<Record<string, boolean>>,
  never,
  Credentials
> = Effect.flatMap(Credentials, (credentials) => credentials.capabilities);

/**
 * Offers to save the password the user just signed in with, where the
 * agent stores passwords; `Unsupported` elsewhere.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* Credentials.storePassword({ id: "ada@example.com", password: "correct horse" })
 *   const control = yield* TestCredentials.Control
 *   return yield* control.passwords
 * })
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then((passwords) =>
 *   console.log(passwords.map((stored) => stored.id)), // ["ada@example.com"]
 * )
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const storePassword = (
  data: PasswordData,
): Effect.Effect<void, CredentialsError, Credentials> =>
  Effect.flatMap(Credentials, (credentials) => credentials.storePassword(data));

/**
 * The stored password for this site: `None` where the user has none or
 * dismisses the chooser.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Option from "effect/Option"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* Credentials.storePassword({ id: "ada@example.com", password: "correct horse" })
 *   const stored = yield* Credentials.password("optional")
 *   return Option.map(stored, (found) => found.id)
 * })
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then(console.log) // { _id: "Option", _tag: "Some", value: "ada@example.com" }
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const password = (
  mediation?: SignInMediation,
): Effect.Effect<Option.Option<StoredPassword>, CredentialsError, Credentials> =>
  Effect.flatMap(Credentials, (credentials) => credentials.password(mediation));

/**
 * Signs in through an identity provider (FedCM), returning its token for
 * the server to verify. Interrupting it aborts the prompt.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const configURL = "https://idp.example/fedcm.json"
 * const program = Effect.gen(function* () {
 *   const control = yield* TestCredentials.Control
 *   yield* control.identityAccount(configURL, "id-token-for-ada")
 *   return yield* Credentials.identity({ providers: [{ configURL, clientId: "rp-1" }] })
 * })
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then((signedIn) =>
 *   console.log(signedIn.token, signedIn.isAutoSelected), // "id-token-for-ada" false
 * )
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const identity = (
  request: IdentityRequest,
  mediation?: SignInMediation,
): Effect.Effect<IdentityToken, CredentialsError, Credentials> =>
  Effect.flatMap(Credentials, (credentials) => credentials.identity(request, mediation));

/**
 * Asks an identity provider to forget an account's sign-in to this site.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Credentials.disconnectIdentity({
 *   configURL: "https://idp.example/fedcm.json",
 *   clientId: "rp-1",
 *   accountHint: "ada@example.com",
 * })
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then(() => console.log("done"))
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const disconnectIdentity = (
  options: IdentityDisconnect,
): Effect.Effect<void, CredentialsError, Credentials> =>
  Effect.flatMap(Credentials, (credentials) => credentials.disconnectIdentity(options));

/**
 * After a sign-out: the next password or identity sign-in asks the user
 * rather than signing in silently.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import { Credentials } from "@thomasfosterau/effect-platform-browser"
 * import { TestCredentials } from "@thomasfosterau/effect-platform-browser/BrowserTesting"
 *
 * const program = Effect.gen(function* () {
 *   yield* Credentials.storePassword({ id: "ada@example.com", password: "correct horse" })
 *   yield* Credentials.preventSilentAccess
 *   return yield* Credentials.password("silent")
 * })
 * Effect.runPromise(Effect.provide(program, TestCredentials.layer())).then(console.log) // { _id: "Option", _tag: "None" }
 * ```
 *
 * @since 0.2.0
 * @category accessors
 */
export const preventSilentAccess: Effect.Effect<void, CredentialsError, Credentials> =
  Effect.flatMap(Credentials, (credentials) => credentials.preventSilentAccess);
