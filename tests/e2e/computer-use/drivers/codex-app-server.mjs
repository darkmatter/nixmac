import {
  AppServerClient,
  clickResponseIndicatesFailure,
  codexAppServerDriverDescriptor,
  contentImage,
  contentText,
  setValueResponseIndicatesFailure,
} from "../transport.mjs";
import { validateElementAddress } from "./contract.mjs";
import {
  normalizeActionResult,
  normalizeVisibleState,
} from "./runtime-contract.mjs";

export { codexAppServerDriverDescriptor };

function requireApp(app) {
  if (typeof app !== "string" || app.trim() === "") {
    throw new TypeError("Codex app-server requires app to be a non-empty string");
  }
  return app;
}

function requireElementIndex(method, elementIndex) {
  const hasSupportedType =
    typeof elementIndex === "string" || Number.isInteger(elementIndex);
  const validation = hasSupportedType
    ? validateElementAddress({
        kind: "codex-index",
        index: elementIndex,
      })
    : { ok: false };
  if (!validation.ok) {
    throw new TypeError(
      `Codex app-server ${method} requires a valid Codex elementIndex`,
    );
  }
  return elementIndex;
}

export class CodexAppServerDriver {
  constructor(url, options = {}) {
    this.client = new AppServerClient(url, options);
  }

  async connect() {
    await this.client.connect();
  }

  async prepareTarget({ appBundleId } = {}) {
    if (typeof appBundleId !== "string" || appBundleId.trim() === "") {
      throw new TypeError("Codex app-server target requires a non-empty appBundleId");
    }
  }

  async visibleState({ app }) {
    const validatedApp = requireApp(app);
    const response = await this.client.tool(
      "get_app_state",
      { app: validatedApp },
      90_000,
    );
    return normalizeVisibleState({
      text: contentText(response),
      imageBase64: contentImage(response),
    });
  }

  async click({ app, elementIndex }) {
    const validatedApp = requireApp(app);
    const validatedElementIndex = requireElementIndex("click", elementIndex);
    const response = await this.client.tool("click", {
      app: validatedApp,
      element_index: validatedElementIndex,
    });
    const text = contentText(response);
    const failed = clickResponseIndicatesFailure(response, text);
    const isError = response?.result?.isError === true;
    return normalizeActionResult({ ok: !failed, text, isError });
  }

  async setValue({ app, elementIndex, value }) {
    const validatedApp = requireApp(app);
    const validatedElementIndex = requireElementIndex(
      "setValue",
      elementIndex,
    );
    if (typeof value !== "string") {
      throw new TypeError("Codex app-server setValue requires a string value");
    }
    const response = await this.client.tool("set_value", {
      app: validatedApp,
      element_index: validatedElementIndex,
      value,
    });
    const text = contentText(response);
    const failed = setValueResponseIndicatesFailure(response, text);
    const isError = response?.result?.isError === true;
    return normalizeActionResult({ ok: !failed, text, isError });
  }

  close() {
    this.client.close();
  }
}
