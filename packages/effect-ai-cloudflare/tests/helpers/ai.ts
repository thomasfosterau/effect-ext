/**
 * A typed stub for the Worker's `AI` binding.
 *
 * The code under test reaches the binding only through
 * `ai.gateway(gatewayId).getUrl(provider)` and `.run(data, options)`
 * (`src/Binding.ts`). A stub implements that slice with the package's own
 * `WorkersAiGateway` signatures rather than hiding behind an
 * `as unknown as WorkersAiBinding`, so a stub that drifts from them is a type
 * error under a manual `tsc` with a tsconfig that includes `tests/`. No gate
 * catches it: this package's `tsconfig.json` type-checks `src` only, and the
 * suites run type-stripped. That a real Workers `Ai` binding satisfies the same
 * types is `workers-types-binding.test.ts`'s job.
 *
 * @module tests/helpers/ai
 */

import * as Schema from "effect/Schema";
import type {
  GatewayUniversalRequest,
  WorkersAiBinding,
  WorkersAiGateway,
} from "@thomasfosterau/effect-ai-cloudflare/Binding";

/** The slice of the AI Gateway runtime object a stub implements. */
export type GatewayStub = Partial<WorkersAiGateway>;

/** A gateway member the test did not stub: reaching it rejects, failing the test. */
const unstubbed = (member: string) => () =>
  Promise.reject(new TypeError(`the stub gateway has no ${member}`));

/** Builds a stub binding whose `gateway(gatewayId)` returns `gateway(gatewayId)`. */
export const stubAiBinding = (gateway: (gatewayId: string) => GatewayStub): WorkersAiBinding => ({
  gateway: (gatewayId) => {
    const stub = gateway(gatewayId);
    return {
      getUrl: stub.getUrl ?? unstubbed("getUrl"),
      run: stub.run ?? unstubbed("run"),
    };
  },
});

/** One `run()` call a stub saw, with its JSON body decoded. */
interface GatewayCall extends Omit<GatewayUniversalRequest, "query"> {
  readonly query: Record<string, Schema.Json>;
}

const decodeQuery = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));

/** Builds a stub binding whose `gateway(id).run(data)` answers `response` and records each call. */
export const stubRun = (response: { readonly status: number; readonly body: Schema.Json }) => {
  const calls: Array<GatewayCall> = [];
  const ai = stubAiBinding(() => ({
    run: async (data) => {
      calls.push({ ...data, query: decodeQuery(data.query) });
      return Response.json(response.body, { status: response.status });
    },
  }));
  return { ai, calls };
};
