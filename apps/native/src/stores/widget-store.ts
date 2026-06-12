// Transitional facade over the (now empty) widget store and the derived
// `useCurrentStep` routing hook, both implemented in `widget-store.impl.ts`.
// Kept so existing `@/stores/widget-store` import sites and the Storybook
// manual mock (`__mocks__/widget-store.ts`) keep working until the module is
// deleted in a later stage.
export * from "./widget-store.impl";
