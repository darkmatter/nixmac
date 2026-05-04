import{j as e,p as n}from"./iframe-C-u98npA.js";import{C as t,a,b as i,c,d as r,e as d,f as s,g as m,h as p,i as u,j as C,k,l as B}from"./index-Bv5QQAaS.js";import"./preload-helper-PPVm8Dsz.js";import"./index-DINYspHe.js";import"./index-CK7_WtWS.js";import"./index-tKTb_eGA.js";import"./index-CKQQGJB5.js";import"./index-CBAhRqrw.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-LHNt3CwB.js";import"./utils-BQHNewu7.js";import"./select-Dxl8s-46.js";import"./index-BdQq_4o_.js";import"./index-CD2TtmNW.js";import"./index-eiDJy8c2.js";import"./index-CoO9uR_f.js";import"./Combination-D6w0BdlX.js";import"./index-CO_i5btI.js";import"./index-Dezg7c6w.js";import"./chevron-down-CqVHLixH.js";import"./check-CF8tKEk8.js";const g=n.meta({title:"Kibo UI/CodeBlock",component:t,parameters:{layout:"centered"},tags:["autodocs"]}),x=[{language:"nix",filename:"flake.nix",code:`{
  description = "nixmac demo";

  outputs = { self, nixpkgs }: {
    darwinConfigurations.demo = nixpkgs.lib.darwinSystem {
      modules = [ ./darwin-configuration.nix ];
    };
  };
}`},{language:"typescript",filename:"settings.ts",code:`export const provider = "codex";
export const maxIterations = 25;

export function ready() {
  return provider.length > 0;
}`}],l=g.story({render:()=>e.jsxs(t,{className:"h-[360px] w-[720px]",data:x,defaultValue:"nix",children:[e.jsxs(a,{children:[e.jsx(i,{children:o=>e.jsx(c,{value:o.language,children:o.filename},o.filename)}),e.jsxs(r,{children:[e.jsx(d,{children:e.jsx(s,{placeholder:"Select file"})}),e.jsx(m,{children:o=>e.jsx(p,{value:o.language,children:o.filename},o.filename)})]}),e.jsx(u,{})]}),e.jsx(C,{children:o=>e.jsx(k,{value:o.language,children:e.jsx(B,{language:o.language,children:o.code})},o.filename)})]})});l.input.parameters={...l.input.parameters,docs:{...l.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <CodeBlock className="h-[360px] w-[720px]" data={files} defaultValue="nix">
      <CodeBlockHeader>
        <CodeBlockFiles>
          {item => <CodeBlockFilename key={item.filename} value={item.language}>
              {item.filename}
            </CodeBlockFilename>}
        </CodeBlockFiles>
        <CodeBlockSelect>
          <CodeBlockSelectTrigger>
            <CodeBlockSelectValue placeholder="Select file" />
          </CodeBlockSelectTrigger>
          <CodeBlockSelectContent>
            {item => <CodeBlockSelectItem key={item.filename} value={item.language}>
                {item.filename}
              </CodeBlockSelectItem>}
          </CodeBlockSelectContent>
        </CodeBlockSelect>
        <CodeBlockCopyButton />
      </CodeBlockHeader>
      <CodeBlockBody>
        {item => <CodeBlockItem key={item.filename} value={item.language}>
            <CodeBlockContent language={item.language as BundledLanguage}>
              {item.code}
            </CodeBlockContent>
          </CodeBlockItem>}
      </CodeBlockBody>
    </CodeBlock>
})`,...l.input.parameters?.docs?.source}}};const q=["MultiFile"];export{l as MultiFile,q as __namedExportsOrder,g as default};
