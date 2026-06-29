type Disposable = {
  dispose: () => void;
};

type DecorationsCollection = {
  clear: () => void;
  set: () => void;
  append: () => void;
};

function createDisposable(): Disposable {
  return { dispose() {} };
}

function createDecorationsCollection(): DecorationsCollection {
  return {
    clear() {},
    set() {},
    append() {},
  };
}

export class Range {
  constructor(
    public readonly startLineNumber: number,
    public readonly startColumn: number,
    public readonly endLineNumber: number,
    public readonly endColumn: number,
  ) {}
}

export function createStandaloneCodeEditor() {
  return {
    setModel() {},
    revealLineInCenter() {},
    updateOptions() {},
    createDecorationsCollection,
    onDidChangeModelContent: createDisposable,
    addCommand() {},
    getModel() {
      return null;
    },
    dispose() {},
  };
}

export function createStandaloneDiffEditor() {
  const originalEditor = createStandaloneCodeEditor();
  const modifiedEditor = createStandaloneCodeEditor();

  return {
    setModel() {},
    getOriginalEditor() {
      return originalEditor;
    },
    getModifiedEditor() {
      return modifiedEditor;
    },
    getLineChanges() {
      return [];
    },
    onDidUpdateDiff: createDisposable,
    dispose() {},
  };
}

export const editor = {
  ScrollType: {
    Smooth: 0,
    Immediate: 1,
  },
  defineTheme() {},
  setModelMarkers() {},
  create: createStandaloneCodeEditor,
  createDiffEditor: createStandaloneDiffEditor,
};

export const languages = {
  getLanguages() {
    return [];
  },
  register() {},
  registerHoverProvider: createDisposable,
  registerCompletionItemProvider: createDisposable,
};

export const KeyMod = {
  CtrlCmd: 2048,
};

export const KeyCode = {
  KeyS: 49,
};

export default {
  editor,
  languages,
  Range,
  KeyMod,
  KeyCode,
};
