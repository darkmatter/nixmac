import {
  AppServerClient,
  clickResponseIndicatesFailure,
  codexAppServerDriverDescriptor,
  contentImage,
  contentText,
  setValueResponseIndicatesFailure,
} from "../transport.mjs";
import {
  normalizeActionResult,
  normalizeVisibleState,
} from "./runtime-contract.mjs";

export { codexAppServerDriverDescriptor };

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
    const response = await this.client.tool("get_app_state", { app });
    return normalizeVisibleState({
      text: contentText(response),
      imageBase64: contentImage(response),
    });
  }

  async click({ app, elementIndex }) {
    const response = await this.client.tool("click", {
      app,
      element_index: elementIndex,
    });
    const text = contentText(response);
    const isError = clickResponseIndicatesFailure(response, text);
    return normalizeActionResult({ ok: !isError, text, isError });
  }

  async setValue({ app, elementIndex, value }) {
    if (typeof value !== "string") {
      throw new TypeError("Codex app-server setValue requires a string value");
    }
    const response = await this.client.tool("set_value", {
      app,
      element_index: elementIndex,
      value,
    });
    const text = contentText(response);
    const isError = setValueResponseIndicatesFailure(response, text);
    return normalizeActionResult({ ok: !isError, text, isError });
  }

  close() {
    this.client.close();
  }
}
