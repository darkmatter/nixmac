import{j as n,p as u}from"./iframe-C-u98npA.js";import{I as o,a as t,b as a,c as d,d as p,e as i,S as l}from"./input-group-BRqNmjah.js";import{S as c}from"./search-G_8IzrC6.js";import"./preload-helper-PPVm8Dsz.js";import"./index-LHNt3CwB.js";import"./utils-BQHNewu7.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./input-B-Agm3fc.js";const s=u.meta({title:"UI/InputGroup",component:o,parameters:{layout:"centered"},tags:["autodocs"]}),r=s.story({render:()=>n.jsxs("div",{className:"w-[420px] space-y-4",children:[n.jsxs(o,{children:[n.jsx(t,{children:n.jsx(c,{})}),n.jsx(p,{placeholder:"Search packages"}),n.jsx(t,{align:"inline-end",children:n.jsx(i,{"aria-label":"Filter",size:"icon-xs",children:n.jsx(l,{})})})]}),n.jsxs(o,{children:[n.jsx(t,{align:"inline-start",children:n.jsx(a,{children:"Host"})}),n.jsx(p,{defaultValue:"Farhans-MacBook-Pro"})]})]})}),e=s.story({render:()=>n.jsxs(o,{className:"w-[420px]",children:[n.jsx(t,{align:"block-start",children:n.jsx(a,{children:"Change request"})}),n.jsx(d,{defaultValue:"Install ripgrep and enable Touch ID sudo.",rows:4})]})});r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="w-[420px] space-y-4">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput placeholder="Search packages" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="Filter" size="icon-xs">
            <SlidersHorizontal />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupText>Host</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput defaultValue="Farhans-MacBook-Pro" />
      </InputGroup>
    </div>
})`,...r.input.parameters?.docs?.source}}};e.input.parameters={...e.input.parameters,docs:{...e.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <InputGroup className="w-[420px]">
      <InputGroupAddon align="block-start">
        <InputGroupText>Change request</InputGroupText>
      </InputGroupAddon>
      <InputGroupTextarea defaultValue="Install ripgrep and enable Touch ID sudo." rows={4} />
    </InputGroup>
})`,...e.input.parameters?.docs?.source}}};const f=["InlineAddons","BlockAddons"];export{e as BlockAddons,r as InlineAddons,f as __namedExportsOrder,s as default};
