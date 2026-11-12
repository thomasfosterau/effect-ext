/**
 * Unit tests for `src/WorkersAi.ts`: `@effect/ai-cloudflare`'s
 * `CloudflareClient` and `CloudflareDecisionModel`, re-exported and wired to
 * the AI Gateway the other modules route through.
 *
 * Config is supplied through `ConfigProvider.fromUnknown` and the network is
 * stubbed at `FetchHttpClient.Fetch`, so these tests check the Workers AI
 * REST URL, the API token, the `cf-aig-gateway-id` routing header and the
 * gateway's `cf-aig-authorization` token without reaching the network.
 *
 * @module tests/unit/workers-ai
 */

import { assert, describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as R from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Decision, DecisionModel } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as Upstream from "@effect/ai-cloudflare";
import {
  CloudflareClient,
  CloudflareDecisionModel,
  CloudflareSchema,
  cloudflareClientLayer,
  decisionModelLayerConfig,
} from "@thomasfosterau/effect-ai-cloudflare";
import { runTest, runTestExit } from "./helpers/effect";

interface CapturedRequest {
  readonly url: string;
  /** Every request header, keyed by its lower-case name. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

const clefResponse = {
  success: true,
  result: {
    model: "clef-flash",
    answers: { urgent: { type: "noul", noul: 0.75 } },
    usage: { input_tokens: 12, output_tokens: 3 },
  },
};

/** A `FetchHttpClient.Fetch` stub that records each request. */
const stubFetch = () => {
  const calls: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      headers: R.fromEntries(request.headers),
      body: await request.json(),
    });
    return Response.json(clefResponse);
  };
  return { calls, layer: Layer.succeed(FetchHttpClient.Fetch, fetch) };
};

const stubConfig = (values: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(values));

const Triage = Decision.make({
  input: Schema.String,
  decisions: {
    urgent: Decision.probability({ instructions: "Does this need immediate attention?" }),
  },
});

const decideUrgent = DecisionModel.decide(Triage, { input: "Checkout is down." });

const config = {
  CF_ACCOUNT_ID: "acct",
  CF_AIG_GATEWAY_ID: "my-gateway",
  CF_AIG_TOKEN: "gateway-token",
  CF_API_TOKEN: "api-token",
};

describe("WorkersAi", () => {
  it("re-exports @effect/ai-cloudflare's modules unchanged", () => {
    expect(CloudflareClient).toBe(Upstream.CloudflareClient);
    expect(CloudflareDecisionModel).toBe(Upstream.CloudflareDecisionModel);
    expect(CloudflareSchema).toBe(Upstream.CloudflareSchema);
  });

  it("decisionModelLayerConfig routes Clef through the gateway with both tokens", async () => {
    const { calls, layer } = stubFetch();
    const response = await runTest(
      decideUrgent.pipe(
        Effect.provide(
          decisionModelLayerConfig({ model: "clef-flash" }).pipe(
            Layer.provide(Layer.merge(layer, stubConfig(config))),
          ),
        ),
      ),
    );

    expect(response.answers.urgent.probability).toBe(0.75);
    expect(response.usage.inputTokens).toBe(12);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef-flash",
      headers: {
        authorization: "Bearer api-token",
        "cf-aig-gateway-id": "my-gateway",
        "cf-aig-authorization": "Bearer gateway-token",
      },
    });
    expect(calls[0]?.body).toMatchObject({ model: "clef-flash" });
  });

  it("decisionModelLayerConfig fails with a ConfigError without CF_API_TOKEN", async () => {
    const { layer } = stubFetch();
    const { CF_API_TOKEN: _omitted, ...rest } = config;
    const exit = await runTestExit(
      decideUrgent.pipe(
        Effect.provide(
          decisionModelLayerConfig({ model: "clef" }).pipe(
            Layer.provide(Layer.merge(layer, stubConfig(rest))),
          ),
        ),
      ),
    );

    assert(Exit.isFailure(exit));
    const error = Cause.squash(exit.cause);
    expect(error).toBeInstanceOf(Config.ConfigError);
  });

  it("cloudflareClientLayer honours apiUrl and applies transformClient after the gateway headers", async () => {
    const { calls, layer } = stubFetch();
    const clientLayer = cloudflareClientLayer({
      gateway: {
        accountId: "acct",
        gatewayId: "other-gateway",
        token: Redacted.make("gateway-token"),
      },
      apiToken: Redacted.make("api-token"),
      apiUrl: "https://proxy.example/v4",
      transformClient: (client) =>
        HttpClient.mapRequest(client, HttpClientRequest.setHeader("x-extra", "yes")),
    });

    await runTest(
      decideUrgent.pipe(
        Effect.provide(
          CloudflareDecisionModel.layer({ model: "clef" }).pipe(
            Layer.provide(clientLayer),
            Layer.provide(layer),
          ),
        ),
      ),
    );

    expect(calls[0]).toMatchObject({
      url: "https://proxy.example/v4/accounts/acct/ai/run/@cf/cloudflare/clef",
      headers: {
        "cf-aig-gateway-id": "other-gateway",
        "cf-aig-authorization": "Bearer gateway-token",
        "x-extra": "yes",
      },
    });
  });
});
