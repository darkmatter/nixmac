import{j as t,p as i}from"./iframe-C-u98npA.js";import{B as e}from"./button-Cs8JYVoL.js";import{C as o}from"./check-CF8tKEk8.js";import{D as l}from"./download-8URUUCW-.js";import{S as u}from"./settings-CvVfXj7c.js";import"./preload-helper-PPVm8Dsz.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./index-LHNt3CwB.js";import"./utils-BQHNewu7.js";const s=i.meta({title:"UI/Button",component:e,parameters:{layout:"centered"},tags:["autodocs"]}),n=s.story({render:()=>t.jsxs("div",{className:"flex flex-wrap items-center gap-3",children:[t.jsx(e,{children:"Default"}),t.jsx(e,{variant:"secondary",children:"Secondary"}),t.jsx(e,{variant:"outline",children:"Outline"}),t.jsx(e,{variant:"ghost",children:"Ghost"}),t.jsx(e,{variant:"destructive",children:"Delete"}),t.jsx(e,{variant:"link",children:"Link"})]})}),r=s.story({render:()=>t.jsxs("div",{className:"flex flex-wrap items-center gap-3",children:[t.jsxs(e,{size:"sm",children:[t.jsx(o,{}),"Save"]}),t.jsxs(e,{children:[t.jsx(l,{}),"Download"]}),t.jsx(e,{size:"lg",children:"Large Action"}),t.jsx(e,{"aria-label":"Settings",size:"icon",variant:"outline",children:t.jsx(u,{})})]})}),a=s.story({render:()=>t.jsxs("div",{className:"flex items-center gap-3",children:[t.jsx(e,{disabled:!0,children:"Default"}),t.jsx(e,{disabled:!0,variant:"outline",children:"Outline"})]})});n.input.parameters={...n.input.parameters,docs:{...n.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="flex flex-wrap items-center gap-3">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="link">Link</Button>
    </div>
})`,...n.input.parameters?.docs?.source}}};r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">
        <Check />
        Save
      </Button>
      <Button>
        <Download />
        Download
      </Button>
      <Button size="lg">Large Action</Button>
      <Button aria-label="Settings" size="icon" variant="outline">
        <Settings />
      </Button>
    </div>
})`,...r.input.parameters?.docs?.source}}};a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="flex items-center gap-3">
      <Button disabled>Default</Button>
      <Button disabled variant="outline">
        Outline
      </Button>
    </div>
})`,...a.input.parameters?.docs?.source}}};const j=["Variants","SizesAndIcons","Disabled"];export{a as Disabled,r as SizesAndIcons,n as Variants,j as __namedExportsOrder,s as default};
