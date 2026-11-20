import * as Option from "effect/Option";
import type * as Effect from "effect/Effect";
import * as EffectM from "effect/Effect";
import { WorkerScope } from "@thomasfosterau/effect-platform-worker-shared/WorkerScope";

/** A `WorkerGlobalScope` stand-in: an `EventTarget` with the readings. */
export const stubScope = (href = "https://example.com/worker.js") =>
  Object.assign(new EventTarget(), {
    location: { href },
    isSecureContext: true,
    crossOriginIsolated: false,
  });

/** Runs `effect` inside the stub scope. */
export const inScope =
  (self: ReturnType<typeof stubScope>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    EffectM.provideService(effect, WorkerScope, Option.some(self));

/** An event carrying extra fields, as the platform's subclasses do. */
/** The fields the platform's `Event` subclasses carry, as the tests set them. */
export interface EventFields {
  readonly message?: string;
  readonly error?: string;
  readonly reason?: string;
  readonly data?: Readonly<Record<string, number | string>>;
  readonly ports?: ReadonlyArray<MessagePort>;
}

export const event = (type: string, fields: EventFields): Event =>
  Object.assign(new Event(type), fields);
