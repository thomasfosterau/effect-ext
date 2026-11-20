/** A worker global stand-in: an `EventTarget` with the readings. */
const base = () =>
  Object.assign(new EventTarget(), {
    location: { href: "https://example.com/worker.js" },
    isSecureContext: true,
    crossOriginIsolated: false,
    closed: 0,
  });

export const dedicatedStub = (name = "") => {
  const posted: Array<unknown> = [];
  const self = Object.assign(base(), {
    name,
    posted,
    postMessage: (message: unknown) => {
      posted.push(message);
    },
    close: () => {
      self.closed += 1;
    },
  });
  return self;
};

export const sharedStub = (name = "") => {
  const self = Object.assign(base(), {
    name,
    close: () => {
      self.closed += 1;
    },
  });
  return self;
};

/** Dispatches `type` on `target`, carrying a connect event's ports or a message's data. */
export const fire = (
  target: EventTarget,
  type: "connect" | "message",
  fields: { readonly ports?: ReadonlyArray<MessagePort>; readonly data?: { readonly id: number } },
): boolean => target.dispatchEvent(Object.assign(new Event(type), fields));
