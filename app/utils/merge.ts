// keys that do not name data of the object itself; they are never merged
const SKIPPED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function merge(target: any, source: any) {
  Object.keys(source).forEach(function (key) {
    if (SKIPPED_KEYS.has(key)) return;
    if (
      source.hasOwnProperty(key) && // Check if the property is not inherited
      source[key] &&
      typeof source[key] === "object"
    ) {
      merge((target[key] = target[key] || {}), source[key]);
      return;
    }
    target[key] = source[key];
  });
}
