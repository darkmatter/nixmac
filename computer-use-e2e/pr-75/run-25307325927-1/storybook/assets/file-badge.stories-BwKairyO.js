import{j as e,p as d}from"./iframe-C-u98npA.js";import{F as r}from"./file-badge-CdNrAozR.js";import{F as s}from"./folder-open-CRy-m6sE.js";import{F as c}from"./file-BdSOSu91.js";import{L as l}from"./lock-XfrD2W8t.js";import{S as p}from"./shield-DC_eakE0.js";import"./preload-helper-PPVm8Dsz.js";const t=d.meta({title:"UI/FileBadge",component:r,parameters:{layout:"centered"},tags:["autodocs"]}),i=t.story({render:()=>e.jsx(r,{icon:s,children:".darwin"})}),n=t.story({render:()=>e.jsx(r,{icon:c,children:".gitignore"})}),o=t.story({render:()=>e.jsx(r,{children:"flake.nix"})}),a=t.story({render:()=>e.jsxs("div",{className:"flex items-center gap-3",children:[e.jsx(r,{icon:s,children:".darwin"}),e.jsx(r,{icon:c,children:".gitignore"}),e.jsx(r,{icon:l,children:"secrets"}),e.jsx(r,{icon:p,children:"flake.nix"}),e.jsx(r,{children:"result"})]})});i.input.parameters={...i.input.parameters,docs:{...i.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <FileBadge icon={FolderOpen}>.darwin</FileBadge>
})`,...i.input.parameters?.docs?.source}}};n.input.parameters={...n.input.parameters,docs:{...n.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <FileBadge icon={File}>.gitignore</FileBadge>
})`,...n.input.parameters?.docs?.source}}};o.input.parameters={...o.input.parameters,docs:{...o.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <FileBadge>flake.nix</FileBadge>
})`,...o.input.parameters?.docs?.source}}};a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="flex items-center gap-3">
      <FileBadge icon={FolderOpen}>.darwin</FileBadge>
      <FileBadge icon={File}>.gitignore</FileBadge>
      <FileBadge icon={Lock}>secrets</FileBadge>
      <FileBadge icon={Shield}>flake.nix</FileBadge>
      <FileBadge>result</FileBadge>
    </div>
})`,...a.input.parameters?.docs?.source}}};const f=["WithFolderIcon","WithFileIcon","NoIcon","AllVariants"];export{a as AllVariants,o as NoIcon,n as WithFileIcon,i as WithFolderIcon,f as __namedExportsOrder,t as default};
