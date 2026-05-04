import{j as m,p as e}from"./iframe-C-u98npA.js";import{C as r,a as s,b as d,c as i,d as t,e as n,f as a,g as p}from"./command-l29Mx239.js";import{S as c}from"./settings-CvVfXj7c.js";import{H as l}from"./history-C-vU5Oou.js";import{F as C}from"./file-text-USzk9CW4.js";import"./preload-helper-PPVm8Dsz.js";import"./dialog-Co34hKFa.js";import"./index-CK7_WtWS.js";import"./index-tKTb_eGA.js";import"./index-CKQQGJB5.js";import"./index-CBAhRqrw.js";import"./index-DINYspHe.js";import"./index-CoO9uR_f.js";import"./Combination-D6w0BdlX.js";import"./index-CW1S6uvd.js";import"./utils-BQHNewu7.js";import"./x-BHB0f5-f.js";import"./index-CHTdBjS2.js";import"./search-G_8IzrC6.js";const u=e.meta({title:"UI/Command",component:r,parameters:{layout:"centered"},tags:["autodocs"]}),o=u.story({render:()=>m.jsxs(r,{className:"w-[420px] rounded-lg border shadow-md",children:[m.jsx(s,{placeholder:"Search nixmac actions..."}),m.jsxs(d,{children:[m.jsx(i,{children:"No results found."}),m.jsxs(t,{heading:"Navigation",children:[m.jsxs(n,{children:[m.jsx(c,{}),"Settings",m.jsx(a,{children:"⌘,"})]}),m.jsxs(n,{children:[m.jsx(l,{}),"History",m.jsx(a,{children:"⌘H"})]})]}),m.jsx(p,{}),m.jsx(t,{heading:"Files",children:m.jsxs(n,{children:[m.jsx(C,{}),"flake.nix"]})})]})]})});o.input.parameters={...o.input.parameters,docs:{...o.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <Command className="w-[420px] rounded-lg border shadow-md">
      <CommandInput placeholder="Search nixmac actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem>
            <Settings />
            Settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <History />
            History
            <CommandShortcut>⌘H</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Files">
          <CommandItem>
            <FileText />
            flake.nix
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
})`,...o.input.parameters?.docs?.source}}};const T=["Palette"];export{o as Palette,T as __namedExportsOrder,u as default};
