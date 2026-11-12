/**
 * Compile-time assertions for the RSS item shape: RSS 2.0 requires a
 * `title` or a `description` on every item. Every binding is exported so an
 * unused-local error can never stand in for the assertion a directive
 * expects.
 */
import type { RssItem } from "@thomasfosterau/effect-ext/RssFeed";

export const titled: RssItem = { path: "/a", title: "A" };
export const described: RssItem = { path: "/a", description: "A" };
export const both: RssItem = { path: "/a", title: "A", description: "A" };

// @ts-expect-error — an item with neither a title nor a description.
export const neither: RssItem = { path: "/a" };

// @ts-expect-error — an `undefined` member is not a value: omit the key, and the item has neither.
export const undefinedBoth: RssItem = { path: "/a", title: undefined, description: undefined };
