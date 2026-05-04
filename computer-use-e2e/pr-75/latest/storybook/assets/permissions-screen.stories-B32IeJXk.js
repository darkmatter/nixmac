import{j as e,p as D,r as q}from"./iframe-C-u98npA.js";import{f as n}from"./index-ClYFKAFl.js";import{d as t,P as b}from"./permissions-screen-DF_o1lHM.js";import"./preload-helper-PPVm8Dsz.js";import"./icon-title-description-card-coRLXrLt.js";import"./utils-BQHNewu7.js";import"./icon-title-subtitle-BVxEDBsN.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./index-LHNt3CwB.js";import"./card-DTcOoczF.js";const r=D.meta({title:"Onboarding/PermissionsScreen",component:b,parameters:{layout:"fullscreen"},decorators:[s=>e.jsx(s,{})],tags:["autodocs"],argTypes:{compact:{control:"boolean",description:"When true, renders a compact version suitable for embedding in a widget"}}}),v=t.map(s=>({...s,status:"pending"})),R=t.map(s=>({...s,status:"granted"})),f=t.map(s=>({...s,status:s.required?"granted":"pending"})),G=[{...t[0],status:"granted"},{...t[1],status:"denied"},{...t[2],status:"pending"},{...t[3],status:"pending"}],P=[{...t[0],status:"granted"},{...t[1],status:"granted"},{...t[2],status:"denied"},{...t[3],status:"pending"}];function C({initialPermissions:s,compact:y=!1}){const[w,S]=q.useState(!1),j=()=>{n()(),S(!0)};if(w){const k=y?"flex h-64 items-center justify-center bg-background p-4":"flex min-h-screen items-center justify-center bg-background";return e.jsx("div",{className:k,children:e.jsxs("div",{className:"space-y-4 text-center",children:[e.jsx("div",{className:"mx-auto flex size-16 items-center justify-center rounded-full bg-console-success/10",children:e.jsxs("svg",{className:"size-8 text-console-success",fill:"none",stroke:"currentColor",viewBox:"0 0 24 24",children:[e.jsx("title",{children:"Success checkmark"}),e.jsx("path",{d:"M5 13l4 4L19 7",strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:2})]})}),e.jsx("h2",{className:y?"font-semibold text-lg":"font-semibold text-2xl",children:"Permissions Complete!"}),e.jsx("p",{className:y?"text-muted-foreground text-sm":"text-muted-foreground",children:"You would now proceed to the main console."}),e.jsx("button",{className:"text-primary text-sm underline",onClick:()=>S(!1),type:"button",children:"Reset Story"})]})})}return e.jsx(b,{compact:y,initialPermissions:s,onComplete:j})}const x=s=>e.jsx("div",{className:"bg-background p-8",children:e.jsx("div",{className:"mx-auto max-w-md rounded-lg border bg-card shadow-sm",children:e.jsx(s,{})})}),i=r.story({render:()=>e.jsx(C,{})}),o=r.story({args:{onComplete:n(),initialPermissions:v}}),a=r.story({args:{onComplete:n(),initialPermissions:R}}),c=r.story({args:{onComplete:n(),initialPermissions:f}}),m=r.story({args:{onComplete:n(),initialPermissions:G}}),p=r.story({args:{onComplete:n(),initialPermissions:P}}),d=r.story({render:()=>e.jsx(C,{initialPermissions:f})}),u=r.story({args:{compact:!0,onComplete:n(),initialPermissions:v},decorators:[x]}),l=r.story({args:{compact:!0,onComplete:n(),initialPermissions:f},decorators:[x]}),g=r.story({render:()=>e.jsx(C,{compact:!0,initialPermissions:P}),decorators:[x]}),h=r.story({args:{compact:!0,onComplete:n(),initialPermissions:P},decorators:[x]});i.input.parameters={...i.input.parameters,docs:{...i.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <InteractivePermissionsScreen />
})`,...i.input.parameters?.docs?.source},description:{story:`Default interactive state - All permissions pending

This is the first screen users see during onboarding after selecting
their config directory. They must grant all required permissions before
proceeding to the main console.

Click the "Request" buttons to simulate granting permissions.`,...i.input.parameters?.docs?.description}}};o.input.parameters={...o.input.parameters,docs:{...o.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: allPendingPermissions
  }
})`,...o.input.parameters?.docs?.source},description:{story:"All permissions pending - initial state when user first sees the screen",...o.input.parameters?.docs?.description}}};a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: allGrantedPermissions
  }
})`,...a.input.parameters?.docs?.source},description:{story:"All permissions granted - ready to continue",...a.input.parameters?.docs?.description}}};c.input.parameters={...c.input.parameters,docs:{...c.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: requiredGrantedPermissions
  }
})`,...c.input.parameters?.docs?.source},description:{story:`Required permissions granted - optional Full Disk Access still pending

The "Continue to Console" button is enabled because all required
permissions have been granted.`,...c.input.parameters?.docs?.description}}};m.input.parameters={...m.input.parameters,docs:{...m.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: someDeniedPermissions
  }
})`,...m.input.parameters?.docs?.source},description:{story:`Some permissions denied - shows retry state

When a permission is denied, the button changes to "Retry" to allow
the user to request it again.`,...m.input.parameters?.docs?.description}}};p.input.parameters={...p.input.parameters,docs:{...p.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    onComplete: fn(),
    initialPermissions: mixedStatePermissions
  }
})`,...p.input.parameters?.docs?.source},description:{story:`Mixed permission states - realistic mid-flow scenario

Shows a mix of granted, denied, and pending permissions as a user
might see while working through the onboarding process.`,...p.input.parameters?.docs?.description}}};d.input.parameters={...d.input.parameters,docs:{...d.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <InteractivePermissionsScreen initialPermissions={requiredGrantedPermissions} />
})`,...d.input.parameters?.docs?.source},description:{story:`Interactive with pre-granted required permissions

User only needs to optionally grant Full Disk Access before continuing.`,...d.input.parameters?.docs?.description}}};u.input.parameters={...u.input.parameters,docs:{...u.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    compact: true,
    onComplete: fn(),
    initialPermissions: allPendingPermissions
  },
  decorators: [CompactDecorator]
})`,...u.input.parameters?.docs?.source},description:{story:`Compact version suitable for embedding in widgets

Shows how the permissions screen renders when embedded in a smaller
container like a sidebar widget or modal dialog.`,...u.input.parameters?.docs?.description}}};l.input.parameters={...l.input.parameters,docs:{...l.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    compact: true,
    onComplete: fn(),
    initialPermissions: requiredGrantedPermissions
  },
  decorators: [CompactDecorator]
})`,...l.input.parameters?.docs?.source},description:{story:`Compact version with required permissions granted

User can proceed to the next step even in compact mode.`,...l.input.parameters?.docs?.description}}};g.input.parameters={...g.input.parameters,docs:{...g.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <InteractivePermissionsScreen compact={true} initialPermissions={mixedStatePermissions} />,
  decorators: [CompactDecorator]
})`,...g.input.parameters?.docs?.source},description:{story:`Interactive compact version

Shows the compact permissions screen with full interactivity.
Notice how the success state also adapts to the compact layout.`,...g.input.parameters?.docs?.description}}};h.input.parameters={...h.input.parameters,docs:{...h.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    compact: true,
    onComplete: fn(),
    initialPermissions: mixedStatePermissions
  },
  decorators: [CompactDecorator]
})`,...h.input.parameters?.docs?.source},description:{story:`Compact with mixed states

Demonstrates how different permission states look in the compact layout.`,...h.input.parameters?.docs?.description}}};const _=["Default","AllPending","AllGranted","RequiredGranted","SomeDenied","MixedStates","InteractiveReadyToContinue","Compact","CompactReadyToContinue","CompactInteractive","CompactMixedStates"];export{a as AllGranted,o as AllPending,u as Compact,g as CompactInteractive,h as CompactMixedStates,l as CompactReadyToContinue,i as Default,d as InteractiveReadyToContinue,p as MixedStates,c as RequiredGranted,m as SomeDenied,_ as __namedExportsOrder,r as default};
