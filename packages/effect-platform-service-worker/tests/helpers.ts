import type {
  ClientLike,
  ClientsLike,
  WindowClientLike,
} from "@thomasfosterau/effect-platform-service-worker/Clients";

/** A `DOMException`-shaped rejection: only its `name` is read. */
export const domError = (name: string): DOMException => new DOMException(name, name);

export const client = (id: string, url = "https://example.com/", type = "worker") => {
  const posted: Array<unknown> = [];
  const self: ClientLike & { readonly posted: Array<unknown> } = {
    id,
    type,
    url,
    posted,
    postMessage: (message) => {
      posted.push(message);
    },
  };
  return self;
};

export const windowClient = (id: string, url: string) => {
  const calls: Array<string> = [];
  const self: WindowClientLike & { readonly calls: Array<string> } = {
    ...client(id, url, "window"),
    calls,
    focused: false,
    visibilityState: "hidden",
    focus: async () => {
      calls.push("focus");
      return self;
    },
    navigate: async (to) => {
      calls.push(`navigate ${to}`);
      return to.startsWith("https://example.com/") ? self : null;
    },
  };
  return self;
};

export const clientsStub = (
  all: ReadonlyArray<ClientLike>,
  overrides: Partial<ClientsLike> = {},
) => {
  const calls: Array<string> = [];
  const self: ClientsLike & { readonly calls: Array<string> } = {
    calls,
    get: async (id) => all.find((one) => one.id === id),
    matchAll: async (options) => {
      calls.push(`matchAll ${options?.type} ${String(options?.includeUncontrolled)}`);
      return all;
    },
    openWindow: async (url) => {
      calls.push(`open ${url}`);
      return null;
    },
    claim: async () => {
      calls.push("claim");
    },
    ...overrides,
  };
  return self;
};
