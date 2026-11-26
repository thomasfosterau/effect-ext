/**
 * Unit tests for the first-party Cohere Effect AI provider — `CohereClient`
 * and the four model surfaces (`CohereLanguageModel`, `CohereEmbeddingModel`,
 * `CohereRerankerModel`, `CohereClassifierModel`).
 *
 * The network is stubbed at `FetchHttpClient.Fetch` — the same technique the
 * effect-ai-cloudflare and mistral provider tests use. Each stub captures the outgoing
 * request (URL, `authorization` header, JSON body) and returns a canned Cohere
 * v2 response (or an SSE stream), so the tests exercise request construction,
 * prompt / tool / structured-output conversion, and response decoding without
 * reaching the network. No live key is ever used.
 *
 * Two streaming behaviours AGENTS.md requires of every streaming provider are
 * proven directly against a pull-based SSE body that releases one frame per
 * pull:
 *   - **backpressure** — `streamText` pulls frames incrementally, so a partial
 *     consumer neither drains nor buffers the whole HTTP body;
 *   - **interruption** — interrupting the consuming Effect aborts the in-flight
 *     request (its `AbortSignal` fires) and cancels the response body stream.
 *
 * @module tests/cohere
 */

import { describe, expect, layer } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as P from "effect/Predicate";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as R from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Struct from "effect/Struct";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { AiError, EmbeddingModel, LanguageModel, Tool, Toolkit } from "effect/ai";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ClassifierModel, RerankerModel } from "@thomasfosterau/effect-ext";
import {
  CohereClient,
  CohereClassifierModel,
  CohereEmbeddingModel,
  CohereLanguageModel,
  CohereRerankerModel,
} from "@thomasfosterau/effect-ai-cohere";
import { expectFailureInstanceOf } from "./helpers/effect";

// ── Fetch stubbing ────────────────────────────────────────────────────

interface CapturedRequest {
  readonly url: string;
  readonly authorization: Option.Option<string>;
  readonly headers: Record<string, string>;
  readonly body: RequestBody;
}

/** The JSON body of a captured request, decoded: the fields the tests read, then any other key. */
const RequestBody = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.optionalKey(Schema.String),
    stream: Schema.optionalKey(Schema.Boolean),
    temperature: Schema.optionalKey(Schema.Finite),
    messages: Schema.optionalKey(Schema.Array(Schema.Record(Schema.String, Schema.Json))),
    tools: Schema.optionalKey(Schema.Array(Schema.Record(Schema.String, Schema.Json))),
    tool_choice: Schema.optionalKey(Schema.Json),
    response_format: Schema.optionalKey(
      Schema.Struct({
        type: Schema.optionalKey(Schema.String),
        schema: Schema.optionalKey(Schema.Json),
      }),
    ),
    input_type: Schema.optionalKey(Schema.String),
    texts: Schema.optionalKey(Schema.Array(Schema.String)),
    output_dimension: Schema.optionalKey(Schema.Finite),
    embedding_types: Schema.optionalKey(Schema.Array(Schema.String)),
    query: Schema.optionalKey(Schema.String),
    documents: Schema.optionalKey(Schema.Array(Schema.String)),
    top_n: Schema.optionalKey(Schema.Finite),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
type RequestBody = typeof RequestBody.Type;

/** A captured body: the decoded JSON, or `{}` for a request without one. */
const decodeBody = (text: string): RequestBody =>
  Option.getOrElse(Schema.decodeOption(Schema.fromJsonString(RequestBody))(text), () => ({}));

const makeFetch = (respond: (captured: CapturedRequest) => Response) => {
  const calls: Array<CapturedRequest> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = decodeBody(await request.clone().text());
    const captured: CapturedRequest = {
      url: request.url,
      authorization: Option.fromNullishOr(request.headers.get("authorization")),
      headers: R.fromEntries(request.headers),
      body,
    };
    calls.push(captured);
    return respond(captured);
  };
  return { calls, fetch };
};

/** Serialises a canned response fixture as JSON text. */
const toJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const jsonResponse = (body: Schema.Json, status = 200): Response =>
  new Response(toJson(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Builds a Cohere v2 SSE stream — `data:`-framed events, closed (no sentinel). */
const sseResponse = (frames: ReadonlyArray<unknown>): Response => {
  const text = frames
    .map((frame) => `data: ${P.isString(frame) ? frame : toJson(frame)}\n\n`)
    .join("");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
};

const chatReply = (over?: Record<string, Schema.Json>) => ({
  id: "c1",
  message: { role: "assistant", content: [{ type: "text", text: "Bonjour" }] },
  finish_reason: "COMPLETE",
  usage: { tokens: { input_tokens: 10, output_tokens: 3 } },
  ...over,
});

const clientLayer = (options?: { readonly apiKey?: Redacted.Redacted; readonly apiUrl?: string }) =>
  CohereClient.layer({
    apiKey: options?.apiKey ?? Redacted.make("test-key"),
    ...(options?.apiUrl !== undefined ? { apiUrl: options.apiUrl } : undefined),
  }).pipe(Layer.provide(FetchHttpClient.layer));

const modelLayer = (options?: {
  readonly apiKey?: Redacted.Redacted;
  readonly config?: Omit<CohereLanguageModel.ConfigService, "model">;
}) =>
  CohereLanguageModel.layer({
    model: "command-a-03-2025",
    ...Struct.pick(options ?? {}, ["config"]),
  }).pipe(Layer.provide(clientLayer(Struct.pick(options ?? {}, ["apiKey"]))));

// ── Text generation ───────────────────────────────────────────────────

describe("CohereLanguageModel.generateText", () => {
  layer(modelLayer())((t) => {
    t.effect("omits a tool result's content key when the result is undefined", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({
          prompt: [
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  id: "call_1",
                  name: "get_weather",
                  isFailure: false,
                  result: undefined,
                },
              ],
            },
          ],
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        const message = calls[0]?.body.messages?.[0];
        expect(message).toEqual({ role: "tool", tool_call_id: "call_1" });
      }),
    );

    t.effect("posts to /v2/chat with a bearer token and decodes the reply", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        const response = yield* LanguageModel.generateText({ prompt: "dis bonjour" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe("https://api.cohere.com/v2/chat");
        expect(calls[0]?.authorization).toEqual(Option.some("Bearer test-key"));
        expect(calls[0]?.body.model).toBe("command-a-03-2025");
        expect(calls[0]?.body.stream).toBe(false);
        expect(response.text).toBe("Bonjour");
        expect(response.usage.inputTokens.total).toBe(10);
        expect(response.usage.outputTokens.total).toBe(3);
        expect(response.finishReason).toBe("stop");
      }),
    );
  });

  layer(
    CohereLanguageModel.layer({ model: "command-r" }).pipe(
      Layer.provide(CohereClient.layer({})),
      Layer.provide(FetchHttpClient.layer),
    ),
  )((t) => {
    t.effect("omits the authorization header when constructed without an API key", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.authorization).toEqual(Option.none());
      }),
    );
  });

  layer(modelLayer())((t) => {
    t.effect("translates each prompt message into its Cohere wire form", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({
          prompt: [
            { role: "system", content: "be brief" },
            {
              role: "user",
              content: [
                { type: "text", text: "look" },
                { type: "file", mediaType: "image/png", data: "data:image/png;base64,AAAA" },
              ],
            },
            {
              role: "assistant",
              content: [
                { type: "text", text: "checking" },
                {
                  type: "tool-call",
                  id: "call_1",
                  name: "get_weather",
                  params: { city: "Paris" },
                  providerExecuted: false,
                },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  id: "call_1",
                  name: "get_weather",
                  isFailure: false,
                  result: { temp: 20 },
                },
              ],
            },
          ],
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        const messages = calls[0]?.body.messages ?? [];
        expect(messages[0]).toEqual({ role: "system", content: "be brief" });
        expect(messages[1]).toEqual({
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        });
        expect(messages[2]).toEqual({
          role: "assistant",
          content: "checking",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Paris"}' },
            },
          ],
        });
        expect(messages[3]).toEqual({
          role: "tool",
          tool_call_id: "call_1",
          content: '{"temp":20}',
        });
      }),
    );

    t.effect("collapses a text-only user message into a plain string", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({ prompt: "just text" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.body.messages?.[0]).toEqual({ role: "user", content: "just text" });
      }),
    );

    t.effect("base64-encodes Uint8Array image bytes into a data URL", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({
          prompt: [
            {
              role: "user",
              content: [
                {
                  type: "file",
                  mediaType: "image/jpeg",
                  data: new Uint8Array([0x41, 0x42, 0x43]),
                },
              ],
            },
          ],
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        const messages = calls[0]?.body.messages ?? [];
        expect(messages[0]).toEqual({
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }],
        });
      }),
    );

    t.effect("rejects unsupported (non-image) file parts with an AiError", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* expectFailureInstanceOf(
          LanguageModel.generateText({
            prompt: [
              {
                role: "user",
                content: [{ type: "file", mediaType: "application/zip", data: "AAAA" }],
              },
            ],
          }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
          AiError.AiError,
        );
      }),
    );

    t.effect("maps a non-2xx status to an AiError", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() => jsonResponse({ message: "rate limited" }, 429));

        yield* expectFailureInstanceOf(
          LanguageModel.generateText({ prompt: "hi" }).pipe(
            Effect.provideService(FetchHttpClient.Fetch, fetch),
          ),
          AiError.AiError,
        );
      }),
    );

    t.effect(
      "sends URL and wildcard-typed images, a tool-call-only turn and a text tool result",
      () =>
        Effect.gen(function* () {
          const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

          yield* LanguageModel.generateText({
            prompt: [
              {
                role: "user",
                content: [
                  {
                    type: "file",
                    mediaType: "image/png",
                    data: new URL("https://example.com/a.png"),
                  },
                  { type: "file", mediaType: "image/png", data: "https://example.com/b.png" },
                  { type: "file", mediaType: "image/*", data: "QUJD" },
                ],
              },
              {
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    id: "call_1",
                    name: "get_weather",
                    params: { city: "Paris" },
                    providerExecuted: false,
                  },
                ],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    id: "call_1",
                    name: "get_weather",
                    isFailure: false,
                    result: "sunny",
                  },
                ],
              },
            ],
          }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

          const messages = calls[0]?.body.messages ?? [];
          expect(messages[0]).toEqual({
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "https://example.com/a.png" } },
              { type: "image_url", image_url: { url: "https://example.com/b.png" } },
              { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
            ],
          });
          expect(messages[1]).toMatchObject({ role: "assistant", content: null });
          expect(messages[2]).toMatchObject({
            role: "tool",
            tool_call_id: "call_1",
            content: "sunny",
          });
        }),
    );

    t.effect("maps a success body that is not JSON at all to an InvalidOutputError", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(
          () =>
            new Response("not json", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        );

        const error = yield* expectFailureInstanceOf(
          LanguageModel.generateText({ prompt: "hi" }).pipe(
            Effect.provideService(FetchHttpClient.Fetch, fetch),
          ),
          AiError.AiError,
        );
        expect(error.reason._tag).toBe("InvalidOutputError");
      }),
    );

    t.effect("maps an undecodable success body to an AiError", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() => jsonResponse({ not: "a chat reply" }));

        yield* expectFailureInstanceOf(
          LanguageModel.generateText({ prompt: "hi" }).pipe(
            Effect.provideService(FetchHttpClient.Fetch, fetch),
          ),
          AiError.AiError,
        );
      }),
    );
  });
});

// ── Configuration & apiUrl (BYOK) override ────────────────────────────

/** A fetch stub that rejects, simulating a transport-level failure. */
const networkDownFetch: typeof globalThis.fetch = async () => {
  throw new TypeError("network down");
};

describe("CohereLanguageModel configuration", () => {
  layer(modelLayer({ config: { temperature: 0.2, maxTokens: 128 } }))((t) => {
    t.effect("threads construction-time config into the request", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.body.temperature).toBe(0.2);
        expect(calls[0]?.body).toHaveProperty("max_tokens", 128);
      }),
    );
  });

  layer(modelLayer({ config: { temperature: 0.2 } }))((t) => {
    t.effect("lets withConfigOverride win over construction-time config", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          CohereLanguageModel.withConfigOverride({ temperature: 0.9 }),
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.body.temperature).toBe(0.9);
      }),
    );
  });

  layer(
    modelLayer({
      config: {
        temperature: 0.1,
        topP: 0.9,
        topK: 20,
        maxTokens: 64,
        seed: 7,
        stopSequences: ["STOP"],
        presencePenalty: 0.5,
        frequencyPenalty: 0.25,
      },
    }),
  )((t) => {
    t.effect("threads every tunable config field into the request body", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        const body = calls[0]?.body ?? {};
        expect(body.p).toBe(0.9);
        expect(body.k).toBe(20);
        expect(body.max_tokens).toBe(64);
        expect(body.seed).toBe(7);
        expect(body.stop_sequences).toEqual(["STOP"]);
        expect(body.presence_penalty).toBe(0.5);
        expect(body.frequency_penalty).toBe(0.25);
      }),
    );
  });

  layer(
    CohereLanguageModel.layer({ model: "command-r" }).pipe(
      Layer.provide(clientLayer({ apiUrl: "https://gateway.example/cohere" })),
    ),
  )((t) => {
    t.effect("routes requests through an apiUrl override (BYOK contract)", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.url).toBe("https://gateway.example/cohere/v2/chat");
        expect(calls[0]?.authorization).toEqual(Option.some("Bearer test-key"));
      }),
    );
  });

  const configuredClient = CohereClient.layerConfig({
    apiKey: Config.succeed(Redacted.make("cfg-key")),
    apiUrl: Config.succeed("https://proxy.example"),
  }).pipe(Layer.provide(FetchHttpClient.layer));
  layer(
    CohereLanguageModel.layer({ model: "command-r7b-12-2024" }).pipe(
      Layer.provide(configuredClient),
    ),
  )((t) => {
    t.effect("provides the model through a Config-driven client layer with apiUrl override", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.url).toBe("https://proxy.example/v2/chat");
        expect(calls[0]?.authorization).toEqual(Option.some("Bearer cfg-key"));
      }),
    );
  });

  layer(
    CohereLanguageModel.layer({ model: "command-r" }).pipe(
      Layer.provide(
        CohereClient.layer({
          apiKey: Redacted.make("k"),
          transformClient: (client) =>
            HttpClient.mapRequest(client, HttpClientRequest.setHeader("x-test", "1")),
        }).pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    ),
  )((t) => {
    t.effect("applies a transformClient to outgoing requests", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.headers["x-test"]).toBe("1");
      }),
    );
  });

  layer(modelLayer())((t) => {
    t.effect("maps a transport failure to an AiError", () =>
      expectFailureInstanceOf(
        LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, networkDownFetch),
        ),
        AiError.AiError,
      ),
    );
  });
});

// ── Structured output ─────────────────────────────────────────────────

layer(modelLayer())("CohereLanguageModel.generateObject", (t) => {
  t.effect("requests a json_object response format with a schema and decodes the object", () =>
    Effect.gen(function* () {
      const { calls, fetch } = makeFetch(() =>
        jsonResponse(
          chatReply({
            message: {
              role: "assistant",
              content: [{ type: "text", text: toJson({ city: "Paris" }) }],
            },
          }),
        ),
      );

      const response = yield* LanguageModel.generateObject({
        prompt: "which city",
        objectName: "city_result",
        schema: Schema.Struct({ city: Schema.String }),
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

      expect(calls[0]?.body.response_format?.type).toBe("json_object");
      expect(calls[0]?.body.response_format?.schema).toBeDefined();
      expect(response.value).toEqual({ city: "Paris" });
    }),
  );
});

// ── Tool calling ──────────────────────────────────────────────────────

const weatherTool = Tool.make("get_weather", {
  description: "Look up the weather for a city",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.String,
});
const weatherToolkit = Toolkit.make(weatherTool);
const weatherHandlers = weatherToolkit.toLayer({
  get_weather: ({ city }) => Effect.succeed(`sunny in ${city}`),
});

/** The exact wire definition `weatherTool` is sent as. */
const weatherToolRequest = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Look up the weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: true,
    },
  },
};

const toolCallReply = (over?: Record<string, Schema.Json>) =>
  chatReply({
    message: {
      role: "assistant",
      tool_plan: "I will look up the weather.",
      tool_calls: [
        {
          id: "call_9",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Paris"}' },
        },
      ],
    },
    finish_reason: "TOOL_CALL",
    ...over,
  });

describe("CohereLanguageModel tool calling", () => {
  layer(Layer.merge(modelLayer(), weatherHandlers))((t) => {
    t.effect("sends tool definitions and resolves the model's tool call", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

        const response = yield* LanguageModel.generateText({
          prompt: "weather in Paris?",
          toolkit: weatherToolkit,
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        const tools = calls[0]?.body.tools ?? [];
        expect(tools[0]).toMatchObject({ function: { name: "get_weather" } });
        // "auto" — Cohere expresses it by omitting tool_choice.
        expect(calls[0]?.body.tool_choice).toBeUndefined();
        expect(response.toolCalls).toHaveLength(1);
        expect(response.toolResults[0]?.result).toBe("sunny in Paris");
        expect(response.finishReason).toBe("tool-calls");
      }),
    );

    t.effect('maps a required tool choice to Cohere\'s "REQUIRED"', () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

        yield* LanguageModel.generateText({
          prompt: "weather?",
          toolkit: weatherToolkit,
          toolChoice: "required",
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.body.tool_choice).toBe("REQUIRED");
      }),
    );

    t.effect("pins a specific tool by filtering the tool set and requiring a call", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

        yield* LanguageModel.generateText({
          prompt: "weather?",
          toolkit: weatherToolkit,
          toolChoice: { tool: "get_weather" } as const,
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.body.tool_choice).toBe("REQUIRED");
        expect(calls[0]?.body.tools).toHaveLength(1);
      }),
    );

    t.effect("restricts tools to a required oneOf subset", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

        yield* LanguageModel.generateText({
          prompt: "weather?",
          toolkit: weatherToolkit,
          toolChoice: { mode: "required", oneOf: ["get_weather"] } as const,
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.body.tool_choice).toBe("REQUIRED");
        expect(calls[0]?.body.tools).toHaveLength(1);
      }),
    );

    t.effect("restricts tools to an auto oneOf subset, leaving tool_choice unset", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(toolCallReply()));

        yield* LanguageModel.generateText({
          prompt: "weather?",
          toolkit: weatherToolkit,
          toolChoice: { mode: "auto", oneOf: ["get_weather"] } as const,
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.body.tool_choice).toBeUndefined();
        expect(calls[0]?.body.tools).toHaveLength(1);
      }),
    );

    t.effect('sends the full tool set with Cohere\'s "NONE" for a none tool choice', () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        const response = yield* LanguageModel.generateText({
          prompt: "weather?",
          toolkit: weatherToolkit,
          toolChoice: "none",
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        // The model sees the tools but is forbidden from calling them.
        // The whole body is pinned, so a stray or missing field fails the test.
        expect(calls[0]?.body).toEqual({
          model: "command-a-03-2025",
          messages: [{ role: "user", content: "weather?" }],
          stream: false,
          tools: [weatherToolRequest],
          tool_choice: "NONE",
        });
        expect(response.text).toBe("Bonjour");
        expect(response.toolCalls).toHaveLength(0);
      }),
    );
  });

  layer(modelLayer())((t) => {
    t.effect("sends neither tools nor tool_choice without a toolkit", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

        // Without a toolkit, LanguageModel forwards toolChoice "none" with no tools.
        yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(calls[0]?.body).not.toHaveProperty("tools");
        expect(calls[0]?.body).not.toHaveProperty("tool_choice");
      }),
    );
  });

  layer(Layer.merge(modelLayer(), weatherHandlers))((t) => {
    t.effect("synthesises an id for a tool call the model returned without one", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() =>
          jsonResponse(
            toolCallReply({
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    type: "function",
                    function: { name: "get_weather", arguments: '{"city":"Caen"}' },
                  },
                ],
              },
            }),
          ),
        );

        const response = yield* LanguageModel.generateText({
          prompt: "weather?",
          toolkit: weatherToolkit,
          disableToolCallResolution: true,
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(response.toolCalls).toHaveLength(1);
        expect(response.toolCalls[0]?.id).toBeTypeOf("string");
      }),
    );
  });
});

// ── Finish reasons ────────────────────────────────────────────────────

layer(modelLayer())("CohereLanguageModel finish reasons", (t) => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["COMPLETE", "stop"],
    ["STOP_SEQUENCE", "stop"],
    ["MAX_TOKENS", "length"],
    ["TOOL_CALL", "tool-calls"],
    ["ERROR_TOXIC", "content-filter"],
    ["ERROR", "error"],
    ["something_new", "other"],
  ];

  Arr.forEach(cases, ([wire, expected]) => {
    t.effect(`maps the "${wire}" finish reason to "${expected}"`, () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() =>
          jsonResponse(
            chatReply({
              message: { role: "assistant", content: [{ type: "text", text: "x" }] },
              finish_reason: wire,
            }),
          ),
        );

        const response = yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        expect(response.finishReason).toBe(expected);
      }),
    );
  });

  t.effect("maps a null finish reason to unknown", () =>
    Effect.gen(function* () {
      const { fetch } = makeFetch(() =>
        jsonResponse(
          chatReply({
            message: { role: "assistant", content: [{ type: "text", text: "x" }] },
            finish_reason: null,
          }),
        ),
      );

      const response = yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );

      expect(response.finishReason).toBe("unknown");
    }),
  );

  t.effect("reads usage reported under meta when usage is absent", () =>
    Effect.gen(function* () {
      const { fetch } = makeFetch(() =>
        jsonResponse({
          ...Struct.omit(chatReply(), ["usage"]),
          meta: { tokens: { input_tokens: 7, output_tokens: 2 } },
        }),
      );

      const response = yield* LanguageModel.generateText({ prompt: "hi" }).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );

      expect(response.usage.inputTokens.total).toBe(7);
      expect(response.usage.outputTokens.total).toBe(2);
    }),
  );
});

// ── Streaming ─────────────────────────────────────────────────────────

describe("CohereLanguageModel.streamText", () => {
  layer(Layer.merge(modelLayer(), weatherHandlers))((t) => {
    t.effect('streams with the full tool set and Cohere\'s "NONE" for a none tool choice', () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() =>
          sseResponse([
            { type: "message-start", id: "s9", delta: { message: { role: "assistant" } } },
            {
              type: "content-start",
              index: 0,
              delta: { message: { content: { type: "text", text: "" } } },
            },
            {
              type: "content-delta",
              index: 0,
              delta: { message: { content: { text: "Bonjour" } } },
            },
            { type: "content-end", index: 0 },
            { type: "message-end", delta: { finish_reason: "COMPLETE" } },
          ]),
        );

        const parts = yield* LanguageModel.streamText({
          prompt: "weather?",
          toolkit: weatherToolkit,
          toolChoice: "none",
        }).pipe(Stream.runCollect, Effect.provideService(FetchHttpClient.Fetch, fetch));

        // The streaming request carries the same tools and directive.
        expect(calls[0]?.body).toEqual({
          model: "command-a-03-2025",
          messages: [{ role: "user", content: "weather?" }],
          stream: true,
          tools: [weatherToolRequest],
          tool_choice: "NONE",
        });
        expect(parts.some((part) => part.type === "tool-call")).toBe(false);
      }),
    );
  });

  layer(modelLayer())((t) => {
    t.effect("emits bracketed text parts and a finish part from an SSE stream", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() =>
          sseResponse([
            { type: "message-start", id: "s1", delta: { message: { role: "assistant" } } },
            {
              type: "content-start",
              index: 0,
              delta: { message: { content: { type: "text", text: "" } } },
            },
            { type: "content-delta", index: 0, delta: { message: { content: { text: "Hello" } } } },
            {
              type: "content-delta",
              index: 0,
              delta: { message: { content: { text: " world" } } },
            },
            { type: "content-end", index: 0 },
            {
              type: "message-end",
              delta: {
                finish_reason: "COMPLETE",
                usage: { tokens: { input_tokens: 3, output_tokens: 2 } },
              },
            },
          ]),
        );

        const parts = yield* LanguageModel.streamText({ prompt: "greet" }).pipe(
          Stream.runCollect,
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        );

        const types = parts.map((part) => part.type);
        expect(types[0]).toBe("response-metadata");
        expect(types).toContain("text-start");
        expect(types).toContain("text-end");

        const text = parts
          .filter((part) => part.type === "text-delta")
          .map((part) => part.delta)
          .join("");
        expect(text).toBe("Hello world");

        const finish = parts.find((part) => part.type === "finish");
        expect(finish).toBeDefined();
        expect(finish?.reason).toBe("stop");
      }),
    );
  });

  layer(Layer.merge(modelLayer(), weatherHandlers))((t) => {
    t.effect("assembles a streamed tool call across events", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() =>
          sseResponse([
            { type: "message-start", id: "s2", delta: { message: { role: "assistant" } } },
            { type: "tool-plan-delta", delta: { message: { tool_plan: "I will check." } } },
            {
              type: "tool-call-start",
              index: 0,
              delta: {
                message: {
                  tool_calls: {
                    id: "call_5",
                    type: "function",
                    function: { name: "get_weather", arguments: "" },
                  },
                },
              },
            },
            {
              type: "tool-call-delta",
              index: 0,
              delta: { message: { tool_calls: { function: { arguments: '{"ci' } } } },
            },
            {
              type: "tool-call-delta",
              index: 0,
              delta: { message: { tool_calls: { function: { arguments: 'ty":"Nice"}' } } } },
            },
            { type: "tool-call-end", index: 0 },
            { type: "message-end", delta: { finish_reason: "TOOL_CALL" } },
          ]),
        );

        const parts = yield* LanguageModel.streamText({
          prompt: "weather",
          toolkit: weatherToolkit,
          disableToolCallResolution: true,
        }).pipe(Stream.runCollect, Effect.provideService(FetchHttpClient.Fetch, fetch));

        const types = parts.map((part) => part.type);
        expect(types).toContain("tool-params-start");
        expect(types).toContain("tool-params-end");

        const toolCall = parts.find((part) => part.type === "tool-call");
        expect(toolCall).toBeDefined();
        expect(toolCall?.params).toEqual({ city: "Nice" });
        expect(toolCall?.name).toBe("get_weather");
      }),
    );
  });

  layer(modelLayer())((t) => {
    t.effect("fails the stream when an event frame carries a non-finite number literal", () =>
      Effect.gen(function* () {
        // `1e400` overflows a double: `JSON.parse` read it as `Infinity`, but
        // `Schema.Json` rejects a non-finite number, so the frame reaches the
        // event decoder as a raw string and the stream fails as an `AiError`.
        const { fetch } = makeFetch(() =>
          sseResponse([
            '{"type":"message-end","delta":{"finish_reason":"COMPLETE","usage":{"tokens":{"input_tokens":1e400,"output_tokens":2}}}}',
          ]),
        );

        yield* expectFailureInstanceOf(
          LanguageModel.streamText({ prompt: "hi" }).pipe(
            Stream.runCollect,
            Effect.provideService(FetchHttpClient.Fetch, fetch),
          ),
          AiError.AiError,
        );
      }),
    );

    t.effect("fails the stream when an event frame is not valid JSON", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() => sseResponse(["this is not json"]));

        yield* expectFailureInstanceOf(
          LanguageModel.streamText({ prompt: "hi" }).pipe(
            Stream.runCollect,
            Effect.provideService(FetchHttpClient.Fetch, fetch),
          ),
          AiError.AiError,
        );
      }),
    );

    t.effect(
      "maps an SSE framing failure (an event over the decoder's size cap) to an InvalidOutputError",
      () =>
        Effect.gen(function* () {
          // One `data:` line one code unit past `Sse.decode()`'s default 10 MiB
          // `maxEventSize`, never terminated by a blank line: the decoder fails with
          // `Sse.SseError` (`EventTooLarge`), which must surface as an `AiError`,
          // never as a raw transport error.
          const oversized = `data: ${"x".repeat(10 * 1024 * 1024)}\n`;
          const { fetch } = makeFetch(
            () =>
              new Response(oversized, {
                status: 200,
                headers: { "content-type": "text/event-stream" },
              }),
          );

          const error = yield* expectFailureInstanceOf(
            LanguageModel.streamText({ prompt: "hi" }).pipe(
              Stream.runCollect,
              Effect.provideService(FetchHttpClient.Fetch, fetch),
            ),
            AiError.AiError,
          );

          expect(error.module).toBe("CohereClient");
          expect(error.method).toBe("chatStream");
          expect(error.reason).toBeInstanceOf(AiError.InvalidOutputError);
          expect(error.reason.message).toContain("exceeded the maximum size");
        }),
    );
  });
});

// ── Streaming backpressure and interruption ───────────────────────────

/**
 * A pull-based SSE body that releases one `data:` frame per consumer pull,
 * recording how many pulls happened and whether the body was cancelled, plus
 * the `AbortSignal` the client handed to `fetch` — the instrument for the
 * backpressure and interruption assertions. With `hang`, every pull after the
 * frames run out stays pending forever instead of closing the body, so the
 * consumer blocks mid-stream until it is interrupted.
 */
const makeChunkedSseFetch = (frames: ReadonlyArray<unknown>, hang = false) => {
  const encoder = new TextEncoder();
  const state = { pulled: 0, cancelled: false, signal: Option.none<AbortSignal>() };
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      const frame = frames[index];
      if (frame !== undefined) {
        index += 1;
        controller.enqueue(encoder.encode(`data: ${toJson(frame)}\n\n`));
        return undefined;
      }
      if (hang) {
        return new Promise<void>(() => {});
      }
      // Cohere ends its stream by closing after `message-end`, with no sentinel.
      controller.close();
      return undefined;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    state.signal = Option.fromNullishOr(init?.signal);
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { fetch, state };
};

const streamOpeningFrames = [
  { type: "message-start", id: "s4", delta: { message: { role: "assistant" } } },
  { type: "content-start", index: 0, delta: { message: { content: { type: "text", text: "" } } } },
];

const textDeltaFrame = (text: string) => ({
  type: "content-delta",
  index: 0,
  delta: { message: { content: { text } } },
});

layer(modelLayer())("CohereLanguageModel.streamText backpressure and interruption", (t) => {
  t.effect("pulls SSE frames incrementally — a partial consumer does not drain the body", () =>
    Effect.gen(function* () {
      const frames = [
        ...streamOpeningFrames,
        ...Array.from({ length: 50 }, (_, i) => textDeltaFrame(`t${i}`)),
      ];
      const { fetch, state } = makeChunkedSseFetch(frames);
      // The pull count at the moment each text delta reached the consumer.
      const pulledAtDelta: Array<number> = [];

      const deltas = yield* LanguageModel.streamText({ prompt: "count" }).pipe(
        Stream.filter((part) => part.type === "text-delta"),
        Stream.tap(() => Effect.sync(() => pulledAtDelta.push(state.pulled))),
        Stream.take(3),
        Stream.runCollect,
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );

      expect(deltas.map((part) => part.delta)).toEqual(["t0", "t1", "t2"]);
      // Each delta arrived after only a handful of frames had been pulled…
      expect(pulledAtDelta.every((pulled) => pulled < 10)).toBe(true);
      // …and the body was never drained: backpressure held, no unbounded buffering.
      expect(state.pulled).toBeLessThan(frames.length);
      // Ending consumption early cancelled the underlying HTTP body stream.
      expect(state.cancelled).toBe(true);
    }),
  );

  t.effect("aborts the in-flight HTTP stream when the consuming Effect is interrupted", () =>
    Effect.gen(function* () {
      const { fetch, state } = makeChunkedSseFetch(
        [...streamOpeningFrames, textDeltaFrame("Hello")],
        true,
      );

      yield* Effect.gen(function* () {
        const latch = yield* Deferred.make<void>();
        const fiber = yield* Effect.forkChild(
          LanguageModel.streamText({ prompt: "greet" }).pipe(
            Stream.tap((part) =>
              part.type === "text-delta" ? Deferred.succeed(latch, undefined) : Effect.void,
            ),
            Stream.runDrain,
          ),
        );
        yield* Deferred.await(latch);
        yield* Fiber.interrupt(fiber);
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

      // Interrupting the Effect aborted the in-flight HTTP request…
      expect(Option.isSome(state.signal) && state.signal.value.aborted).toBe(true);
      // …and cancelled the response body stream.
      expect(state.cancelled).toBe(true);
    }),
  );
});

// ── Embeddings ────────────────────────────────────────────────────────

const embedLayer = (options?: CohereEmbeddingModel.Options) =>
  CohereEmbeddingModel.layer(options ?? { inputType: "search_document" }).pipe(
    Layer.provide(clientLayer()),
  );

describe("CohereEmbeddingModel", () => {
  layer(embedLayer())((t) => {
    t.effect(
      "posts to /v2/embed with the pinned model and dimension, decoding vectors + usage",
      () =>
        Effect.gen(function* () {
          const { calls, fetch } = makeFetch(() =>
            jsonResponse({
              embeddings: {
                float: [
                  [0.1, 0.2, 0.3],
                  [0.4, 0.5, 0.6],
                ],
              },
              meta: { billed_units: { input_tokens: 4 } },
            }),
          );

          const response = yield* Effect.gen(function* () {
            const model = yield* EmbeddingModel.EmbeddingModel;
            return yield* model.embedMany(["alpha", "bravo"]);
          }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

          expect(calls[0]?.url).toBe("https://api.cohere.com/v2/embed");
          expect(calls[0]?.body.model).toBe(CohereEmbeddingModel.EMBEDDING_MODEL);
          expect(calls[0]?.body.model).toBe("embed-v4.0");
          expect(calls[0]?.body.input_type).toBe("search_document");
          expect(calls[0]?.body.output_dimension).toBe(1024);
          expect(calls[0]?.body.output_dimension).toBe(CohereEmbeddingModel.EMBEDDING_DIMENSIONS);
          expect(calls[0]?.body.embedding_types).toEqual(["float"]);
          expect(calls[0]?.body.texts).toEqual(["alpha", "bravo"]);

          expect(response.embeddings.map((embed) => embed.vector)).toEqual([
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
          ]);
          expect(response.usage.inputTokens).toBe(4);
        }),
    );
  });

  layer(
    embedLayer({
      inputType: "search_query",
      model: "embed-english-v3.0",
      outputDimension: 512,
    }),
  )((t) => {
    t.effect("honours an overridden input type, model, and output dimension", () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() => jsonResponse({ embeddings: { float: [[1, 2]] } }));

        yield* Effect.gen(function* () {
          const model = yield* EmbeddingModel.EmbeddingModel;
          return yield* model.embedMany(["q"]);
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.body.input_type).toBe("search_query");
        expect(calls[0]?.body.model).toBe("embed-english-v3.0");
        expect(calls[0]?.body.output_dimension).toBe(512);
      }),
    );
  });

  layer(embedLayer())((t) => {
    t.effect("maps a non-2xx embed status to an AiError", () =>
      Effect.gen(function* () {
        const { fetch } = makeFetch(() => jsonResponse({ message: "bad" }, 400));

        yield* expectFailureInstanceOf(
          Effect.gen(function* () {
            const model = yield* EmbeddingModel.EmbeddingModel;
            return yield* model.embedMany(["x"]);
          }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
          AiError.AiError,
        );
      }),
    );
  });
});

// ── Reranking ─────────────────────────────────────────────────────────

const rerankLayer = (options?: CohereRerankerModel.Options) =>
  CohereRerankerModel.layer(options).pipe(Layer.provide(clientLayer()));

layer(rerankLayer())("CohereRerankerModel", (t) => {
  t.effect(
    "posts to /v2/rerank with the pinned model and returns results sorted by relevance",
    () =>
      Effect.gen(function* () {
        const { calls, fetch } = makeFetch(() =>
          jsonResponse({
            results: [
              { index: 0, relevance_score: 0.1 },
              { index: 2, relevance_score: 0.9 },
              { index: 1, relevance_score: 0.5 },
            ],
            meta: { billed_units: { search_units: 1 } },
          }),
        );

        const response = yield* Effect.gen(function* () {
          const model = yield* RerankerModel.RerankerModel;
          return yield* model.rerank({
            query: "which is best?",
            documents: ["alpha", "bravo", "charlie"],
          });
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

        expect(calls[0]?.url).toBe("https://api.cohere.com/v2/rerank");
        expect(calls[0]?.body.model).toBe(CohereRerankerModel.RERANK_MODEL);
        expect(calls[0]?.body.model).toBe("rerank-v3.5");
        expect(calls[0]?.body.query).toBe("which is best?");
        expect(calls[0]?.body.documents).toEqual(["alpha", "bravo", "charlie"]);

        expect(response.results.map((result) => result.index)).toEqual([2, 1, 0]);
        expect(response.results[0]?.relevanceScore).toBe(0.9);
        expect(response.usage.inputTokens).toStrictEqual(Option.some(1));
      }),
  );

  t.effect("passes topN through as top_n", () =>
    Effect.gen(function* () {
      const { calls, fetch } = makeFetch(() =>
        jsonResponse({ results: [{ index: 1, relevance_score: 0.8 }] }),
      );

      yield* Effect.gen(function* () {
        const model = yield* RerankerModel.RerankerModel;
        return yield* model.rerank({ query: "q", documents: ["a", "b", "c"], topN: 1 });
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

      expect(calls[0]?.body.top_n).toBe(1);
    }),
  );

  t.effect("short-circuits an empty documents array without a request", () =>
    Effect.gen(function* () {
      const { calls, fetch } = makeFetch(() => jsonResponse({ results: [] }));

      const response = yield* Effect.gen(function* () {
        const model = yield* RerankerModel.RerankerModel;
        return yield* model.rerank({ query: "q", documents: [] });
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

      expect(response.results).toEqual([]);
      expect(calls).toHaveLength(0);
    }),
  );
});

// ── Classification (chat + structured output) ─────────────────────────

const classifierLayer = (options?: CohereClassifierModel.Options) =>
  CohereClassifierModel.layer(options).pipe(Layer.provide(clientLayer()));

layer(classifierLayer())("CohereClassifierModel", (t) => {
  t.effect("classifies via Cohere chat + structured output over /v2/chat", () =>
    Effect.gen(function* () {
      const { calls, fetch } = makeFetch(() =>
        jsonResponse(
          chatReply({
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: toJson({
                    classifications: [
                      {
                        classes: [
                          { label: "negative", score: 0.1 },
                          { label: "positive", score: 0.9 },
                        ],
                      },
                    ],
                  }),
                },
              ],
            },
          }),
        ),
      );

      const response = yield* Effect.gen(function* () {
        const model = yield* ClassifierModel.ClassifierModel;
        return yield* model.classify({
          inputs: ["great product"],
          labels: ["positive", "negative"],
        });
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

      expect(calls[0]?.url).toBe("https://api.cohere.com/v2/chat");
      expect(calls[0]?.body.model).toBe(CohereClassifierModel.DEFAULT_MODEL);
      expect(calls[0]?.body.response_format?.type).toBe("json_object");
      // Deterministic labelling — temperature defaults to 0.
      expect(calls[0]?.body.temperature).toBe(0);

      expect(response.classifications[0]?.classes[0]).toEqual(
        new ClassifierModel.ClassScore({ label: "positive", score: 0.9 }),
      );
    }),
  );

  t.effect("fails with AiError when the model returns a label outside the requested set", () =>
    Effect.gen(function* () {
      const { fetch } = makeFetch(() =>
        jsonResponse(
          chatReply({
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: toJson({
                    classifications: [{ classes: [{ label: "bogus", score: 0.5 }] }],
                  }),
                },
              ],
            },
          }),
        ),
      );

      yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const model = yield* ClassifierModel.ClassifierModel;
          return yield* model.classify({ inputs: ["x"], labels: ["a", "b"] });
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
        AiError.AiError,
      );
    }),
  );

  t.effect("short-circuits empty inputs without a request", () =>
    Effect.gen(function* () {
      const { calls, fetch } = makeFetch(() => jsonResponse(chatReply()));

      const response = yield* Effect.gen(function* () {
        const model = yield* ClassifierModel.ClassifierModel;
        return yield* model.classify({ inputs: [] });
      }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch));

      expect(response.classifications).toEqual([]);
      expect(calls).toHaveLength(0);
    }),
  );
});

// ── Client-level embed/rerank error mapping ───────────────────────────

layer(clientLayer())("CohereClient", (t) => {
  t.effect("maps an undecodable rerank body to an AiError", () =>
    Effect.gen(function* () {
      const { fetch } = makeFetch(() => jsonResponse({ nonsense: true }));

      yield* expectFailureInstanceOf(
        Effect.gen(function* () {
          const client = yield* CohereClient.CohereClient;
          return yield* client.rerank({ model: "rerank-v3.5", query: "q", documents: ["a"] });
        }).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
        AiError.AiError,
      );
    }),
  );
});
