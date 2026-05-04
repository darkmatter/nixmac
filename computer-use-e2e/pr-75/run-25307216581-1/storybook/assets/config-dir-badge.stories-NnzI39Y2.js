import{j as s,p as o}from"./iframe-C-u98npA.js";import{C as n}from"./config-dir-badge-BHgbpSZS.js";import"./preload-helper-PPVm8Dsz.js";import"./file-badge-CdNrAozR.js";import"./folder-open-CRy-m6sE.js";const i=o.meta({title:"Widget/ConfigDirBadge",component:n,parameters:{layout:"centered"},tags:["autodocs"]}),r=i.story({render:()=>s.jsx(n,{configDir:"/Users/alice/.darwin"})}),t=i.story({render:()=>s.jsx(n,{configDir:"/Users/alice/nixos-config"})}),e=i.story({render:()=>s.jsxs("p",{className:"text-muted-foreground text-xs flex items-center gap-1 flex-wrap",children:["Content of ",s.jsx(n,{configDir:"/Users/alice/.darwin"})," may be seen by your AI provider."]})});r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <ConfigDirBadge configDir="/Users/alice/.darwin" />
})`,...r.input.parameters?.docs?.source}}};t.input.parameters={...t.input.parameters,docs:{...t.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <ConfigDirBadge configDir="/Users/alice/nixos-config" />
})`,...t.input.parameters?.docs?.source}}};e.input.parameters={...e.input.parameters,docs:{...e.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <p className="text-muted-foreground text-xs flex items-center gap-1 flex-wrap">
      Content of <ConfigDirBadge configDir="/Users/alice/.darwin" /> may be seen by your AI provider.
    </p>
})`,...e.input.parameters?.docs?.source},description:{story:"Shown inline in a sentence, as used in the privacy note",...e.input.parameters?.docs?.description}}};const u=["Default","CustomDir","InlineInText"];export{t as CustomDir,r as Default,e as InlineInText,u as __namedExportsOrder,i as default};
