export const runtimeDriverMethods = Object.freeze([
  "connect",
  "prepareTarget",
  "visibleState",
  "click",
  "setValue",
  "close",
]);

export function normalizeVisibleState({
  text = "",
  imageBase64 = "",
  target = null,
  metadata = {},
} = {}) {
  if (typeof text !== "string") throw new TypeError("visible state text must be a string");
  if (typeof imageBase64 !== "string")
    throw new TypeError("visible state imageBase64 must be a string");
  return Object.freeze({
    text,
    imageBase64,
    target: target ? Object.freeze({ ...target }) : null,
    metadata: Object.freeze({ ...metadata }),
  });
}

export function normalizeActionResult({ ok, text = "", isError = false } = {}) {
  return Object.freeze({
    ok: ok === true && isError !== true,
    text: String(text || ""),
    isError: isError === true,
  });
}

export function validateRuntimeDriver(driver) {
  const missing = runtimeDriverMethods.filter(
    (method) => typeof driver?.[method] !== "function",
  );
  if (missing.length) throw new TypeError(`Runtime driver missing: ${missing.join(", ")}`);
  return driver;
}
