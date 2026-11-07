/**
 * Workers AI through the Cloudflare AI Gateway, on the official
 * `@effect/ai-cloudflare` package. Its `CloudflareClient` (the Workers AI
 * REST client: account id, API token, `apiUrl`, `transformClient`) and
 * `CloudflareDecisionModel` (Clef and Clef-flash for `effect/ai`'s
 * `DecisionModel`) are re-exported here unchanged, with `CloudflareSchema`,
 * so one package gives a consumer Workers AI decision models and the AI
 * Gateway routes of the other modules.
 *
 * What this module adds is the wiring to the same gateway the other modules
 * route through: {@link cloudflareClientLayer} builds upstream's
 * `CloudflareClient` from a {@link Url.GatewayUrlConfig} (its account id and
 * gateway id, `gatewayId` routing the REST calls through the gateway) and
 * sends the gateway's `cf-aig-authorization` token on every request, so an
 * authenticated gateway accepts them. {@link cloudflareClientLayerConfig}
 * reads the same `CF_ACCOUNT_ID`, `CF_AIG_GATEWAY_ID` and `CF_AIG_TOKEN` as
 * the `…FromUrl` variants, plus `CF_API_TOKEN`, the Cloudflare API token
 * Workers AI REST authenticates with.
 *
 * Decisions run over REST only: upstream's `CloudflareClient` service is an
 * `HttpClient` against `api.cloudflare.com`, so there is no Worker-binding
 * (`env.AI.run`) variant here.
 *
 * @module WorkersAi
 *
 * @copyright Thomas Foster
 */

import * as CloudflareClient from "@effect/ai-cloudflare/CloudflareClient";
import * as CloudflareDecisionModel from "@effect/ai-cloudflare/CloudflareDecisionModel";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import type { DecisionModel } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as Url from "./Url";

export * as CloudflareClient from "@effect/ai-cloudflare/CloudflareClient";
export * as CloudflareDecisionModel from "@effect/ai-cloudflare/CloudflareDecisionModel";
export * as CloudflareSchema from "@effect/ai-cloudflare/CloudflareSchema";

/** Options for {@link cloudflareClientLayer}. */
export interface CloudflareClientOptions {
  /**
   * The gateway to route through: its account id, gateway id and
   * authenticated-gateway token (`Url.gatewayUrlConfig` reads one).
   */
  readonly gateway: Url.GatewayUrlConfig;
  /**
   * The Cloudflare API token Workers AI REST authenticates with (a token
   * with Workers AI permission), sent as the bearer token. Not a provider
   * key: Workers AI is Cloudflare's own.
   */
  readonly apiToken: Redacted.Redacted;
  /**
   * Overrides the Workers AI REST base URL
   * (`https://api.cloudflare.com/client/v4` by default), for a proxy or a
   * test stub.
   */
  readonly apiUrl?: string | undefined;
  /** Customises the HTTP client, after the gateway headers are set. */
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined;
}

/**
 * Provides `@effect/ai-cloudflare`'s `CloudflareClient`, routed through an AI
 * Gateway: the client's `accountId` and `gatewayId` come from
 * `options.gateway`, and the gateway's `cf-aig-authorization` header is set
 * on every request. Provides `FetchHttpClient`, so the layer has no
 * requirements. Failures are upstream's: every call fails with an
 * `AiError` from `CloudflareClient.createDecisions`.
 *
 * @example
 * ```ts
 * import { cloudflareClientLayer, CloudflareDecisionModel } from "@thomasfosterau/effect-ai-cloudflare";
 * import * as Layer from "effect/Layer";
 * import * as Redacted from "effect/Redacted";
 *
 * const clef = CloudflareDecisionModel.layer({ model: "clef-flash" }).pipe(
 *   Layer.provide(
 *     cloudflareClientLayer({
 *       gateway: {
 *         accountId: "my-account",
 *         gatewayId: "my-gateway",
 *         token: Redacted.make("gateway-token"),
 *       },
 *       apiToken: Redacted.make("api-token"),
 *     }),
 *   ),
 * );
 * ```
 */
export const cloudflareClientLayer = (
  options: CloudflareClientOptions,
): Layer.Layer<CloudflareClient.CloudflareClient> => {
  const authHeader = Url.cfAigAuthorizationHeader(options.gateway);
  const transformClient = options.transformClient;
  return CloudflareClient.layer({
    accountId: options.gateway.accountId,
    apiKey: options.apiToken,
    gatewayId: options.gateway.gatewayId,
    apiUrl: options.apiUrl,
    transformClient: (client) => {
      const routed = HttpClient.mapRequest(client, HttpClientRequest.setHeaders(authHeader));
      return transformClient === undefined ? routed : transformClient(routed);
    },
  }).pipe(Layer.provide(FetchHttpClient.layer));
};

/**
 * {@link cloudflareClientLayer} from configuration: `CF_ACCOUNT_ID`,
 * `CF_AIG_GATEWAY_ID` and `CF_AIG_TOKEN` (`Url.gatewayUrlConfig`, as the
 * `…FromUrl` variants read them) and `CF_API_TOKEN`, the Workers AI API
 * token. All four are required: a missing or empty one fails layer
 * construction with a `Config.ConfigError`.
 */
export const cloudflareClientLayerConfig: Layer.Layer<
  CloudflareClient.CloudflareClient,
  Config.ConfigError
> = Layer.unwrap(
  Effect.gen(function* () {
    const gateway = yield* Url.gatewayUrlConfig;
    const apiToken = yield* Config.Redacted("CF_API_TOKEN");
    return cloudflareClientLayer({ gateway, apiToken });
  }),
);

/**
 * A Workers AI `DecisionModel` (Clef or Clef-flash) through the AI Gateway,
 * configured as {@link cloudflareClientLayerConfig} is:
 * `CloudflareDecisionModel.layer` over that client.
 */
export const decisionModelLayerConfig = (options: {
  readonly model: CloudflareDecisionModel.Model;
}): Layer.Layer<DecisionModel.DecisionModel, Config.ConfigError> =>
  CloudflareDecisionModel.layer(options).pipe(Layer.provide(cloudflareClientLayerConfig));
