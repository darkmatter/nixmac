import{j as r,p as o}from"./iframe-C-u98npA.js";import{S as t}from"./scroll-area-ibSmoDDq.js";import"./preload-helper-PPVm8Dsz.js";import"./index-CK7_WtWS.js";import"./index-tKTb_eGA.js";import"./index-CKQQGJB5.js";import"./index-CBAhRqrw.js";import"./index-CW1S6uvd.js";import"./index-eiDJy8c2.js";import"./index-BdQq_4o_.js";import"./utils-BQHNewu7.js";const a=o.meta({title:"UI/ScrollArea",component:t,parameters:{layout:"centered"},tags:["autodocs"]}),i=["flake.nix","darwin-configuration.nix","homebrew.nix","modules/security.nix","modules/packages.nix","modules/development.nix","modules/fonts.nix","modules/system-defaults.nix","secrets/example.age","README.md"],e=a.story({render:()=>r.jsx(t,{className:"h-56 w-72 rounded-md border",children:r.jsx("div",{className:"p-3",children:i.map(s=>r.jsx("div",{className:"border-b py-2 text-sm last:border-b-0",children:s},s))})})});e.input.parameters={...e.input.parameters,docs:{...e.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <ScrollArea className="h-56 w-72 rounded-md border">
      <div className="p-3">
        {files.map(file => <div className="border-b py-2 text-sm last:border-b-0" key={file}>
            {file}
          </div>)}
      </div>
    </ScrollArea>
})`,...e.input.parameters?.docs?.source}}};const y=["VerticalList"];export{e as VerticalList,y as __namedExportsOrder,a as default};
