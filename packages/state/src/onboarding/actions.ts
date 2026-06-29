// Actions now live inside the store itself (see `store.ts`). This module is
// kept only as a re-export so existing deep imports (`./actions`) keep working.
export { onboardingActions, type OnboardingActions } from "./store";
