/**
 * WHATWG URL parsing as an `Option`.
 *
 * `URL.parse` would do, but it needs Node 22.1 and the package's floor is
 * Node 22.0 (`engines.node`, #71); `URL.canParse` is Node 19.9.
 *
 * @internal
 */
import * as Option from "effect/Option";

/** `input` parsed as a URL (against `base`, when given); `None` when it is not one. */
export const parseUrl = (input: string | URL, base?: string | URL): Option.Option<URL> =>
  URL.canParse(input, base) ? Option.some(new URL(input, base)) : Option.none();
