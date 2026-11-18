import { merge } from "../app/utils/merge";

describe("merge", () => {
  test("adds flat properties from source into target", () => {
    const target: any = { a: 1 };
    merge(target, { b: 2 });
    expect(target).toEqual({ a: 1, b: 2 });
  });

  test("overwrites primitive values", () => {
    const target: any = { a: 1, b: "old" };
    merge(target, { b: "new" });
    expect(target).toEqual({ a: 1, b: "new" });
  });

  test("deep-merges nested objects instead of replacing them", () => {
    const target: any = { a: { x: 1 } };
    merge(target, { a: { y: 2 } });
    expect(target).toEqual({ a: { x: 1, y: 2 } });
  });

  test("creates missing nested targets", () => {
    const target: any = {};
    merge(target, { a: { b: { c: 3 } } });
    expect(target).toEqual({ a: { b: { c: 3 } } });
  });

  describe("keys that do not name data of the object", () => {
    const incoming = () =>
      JSON.parse(
        `{
          "a": { "y": 2 },
          "__proto__": { "addedByMerge": true },
          "constructor": { "prototype": { "addedByMerge": true } },
          "prototype": { "addedByMerge": true },
          "nested": { "__proto__": { "addedByMerge": true }, "kept": 1 }
        }`,
      );

    afterEach(() => {
      delete (Object.prototype as any).addedByMerge;
    });

    test("are skipped, at any depth, without an error", () => {
      const before = Object.getOwnPropertyNames(Object.prototype).sort();
      const target: any = { a: { x: 1 } };

      expect(() => merge(target, incoming())).not.toThrow();

      expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
        before,
      );
      expect(({} as any).addedByMerge).toBeUndefined();
      expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(target.nested)).toBe(Object.prototype);
      expect(Object.keys(target).sort()).toEqual(["a", "nested"]);
    });

    test("the rest of the same input is merged as usual", () => {
      const target: any = { a: { x: 1 } };
      merge(target, incoming());
      expect(target).toEqual({ a: { x: 1, y: 2 }, nested: { kept: 1 } });
    });
  });
});
