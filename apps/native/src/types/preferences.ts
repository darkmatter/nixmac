export type ConfirmPrefKey = "confirmBuild" | "confirmClear" | "confirmRollback";

export type BoolPrefKey =
  | ConfirmPrefKey
  | "autoSummarizeOnFocus"
  | "scanHomebrewOnStartup"
  | "defaultToDiffTab"
  | "experimentalSpinningMascot";
