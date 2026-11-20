/** A `DOMException`-shaped rejection: only its `name` is read. */
export const domError = (name: string): DOMException => new DOMException(name, name);
