import{j as e,p as h}from"./iframe-C-u98npA.js";import{I as m}from"./icon-title-description-card-coRLXrLt.js";import{S as v}from"./sparkles-BFirNw3e.js";import{I as x}from"./info-BoB1uvcp.js";import{T as y}from"./triangle-alert-CTpJPFe0.js";import{C as f}from"./circle-check-big-28P8cHPc.js";import{S as k}from"./shield-DC_eakE0.js";import{T as S}from"./terminal-BhB-bsmt.js";import"./preload-helper-PPVm8Dsz.js";import"./utils-BQHNewu7.js";const t=h.meta({title:"components/IconTitleDescriptionCard",component:m,parameters:{layout:"centered"},decorators:[g=>e.jsx(g,{})],tags:["autodocs"],argTypes:{variant:{control:"select",options:["default","info","warning","success"],description:"Visual variant for different use cases"},icon:{control:!1,description:"Icon element to display"},title:{control:"text",description:"Card title"},description:{control:"text",description:"Card description/content"}}}),d=e.jsxs("svg",{"aria-label":"Information",className:"size-full",fill:"none",role:"img",stroke:"currentColor",viewBox:"0 0 24 24",children:[e.jsx("title",{children:"Information"}),e.jsx("path",{d:"M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:2})]}),s=t.story({args:{icon:d,title:"Why does nixmac need these permissions?",description:"nixmac manages your macOS system declaratively, similar to NixOS. It needs access to configuration files, the ability to install packages, and permission to modify system settings to provide a complete system management experience."}}),i=t.story({args:{variant:"info",icon:e.jsx(x,{className:"size-full"}),title:"Getting Started",description:"This setup wizard will guide you through configuring nixmac for your system. The process typically takes 2-3 minutes to complete."}}),n=t.story({args:{variant:"warning",icon:e.jsx(y,{className:"size-full"}),title:"Backup Recommended",description:"Before making system changes, we recommend creating a backup of your current configuration. This ensures you can restore your system if needed."}}),r=t.story({args:{variant:"success",icon:e.jsx(f,{className:"size-full"}),title:"Setup Complete!",description:"Your system is now configured and ready to use. You can start managing your macOS setup declaratively through nixmac."}}),a=t.story({args:{variant:"info",icon:e.jsx(k,{className:"size-full"}),title:"Security & Privacy",description:"nixmac only accesses the specific directories and resources it needs. All system modifications are transparent and can be reviewed before applying."}}),o=t.story({args:{icon:e.jsx(S,{className:"size-full"}),title:"How it Works",description:"nixmac uses nix-darwin and home-manager to provide declarative system configuration. Your entire system state is defined in version-controlled configuration files."}}),c=t.story({args:{variant:"success",icon:e.jsx(v,{className:"size-full"}),title:"AI-Powered Configuration",description:"Our AI assistant can help you discover new packages, optimize your setup, and suggest improvements based on your usage patterns."}}),p=t.story({render:()=>e.jsxs("div",{className:"space-y-4",children:[e.jsx(m,{description:"This is important information you should know before proceeding.",icon:d,title:"Before You Start",variant:"info"}),e.jsx(m,{description:"Make sure to backup your important files before making system changes.",icon:e.jsx(y,{className:"size-full"}),title:"Backup Warning",variant:"warning"}),e.jsx(m,{description:"Your configuration has been successfully applied to the system.",icon:e.jsx(f,{className:"size-full"}),title:"Changes Applied",variant:"success"})]})}),u=t.story({args:{icon:d,title:"Detailed System Configuration Process",description:"This comprehensive setup process involves multiple steps including permission verification, system package installation, configuration file generation, service management, and final system validation. Each step is carefully orchestrated to ensure your system remains stable and functional throughout the entire process. The declarative nature of nixmac means that every change is predictable and reproducible across different machines and environments."}}),l=t.story({args:{icon:d,title:"Quick Tip",description:"Use ⌘+Shift+O to quickly open the nixmac interface."},decorators:[g=>e.jsx(g,{})]});s.input.parameters={...s.input.parameters,docs:{...s.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: CustomInfoIcon,
    title: "Why does nixmac need these permissions?",
    description: "nixmac manages your macOS system declaratively, similar to NixOS. It needs access to configuration files, the ability to install packages, and permission to modify system settings to provide a complete system management experience."
  }
})`,...s.input.parameters?.docs?.source},description:{story:"Default variant - neutral informational card",...s.input.parameters?.docs?.description}}};i.input.parameters={...i.input.parameters,docs:{...i.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    variant: "info",
    icon: <InfoIcon className="size-full" />,
    title: "Getting Started",
    description: "This setup wizard will guide you through configuring nixmac for your system. The process typically takes 2-3 minutes to complete."
  }
})`,...i.input.parameters?.docs?.source},description:{story:"Info variant - highlighted informational content",...i.input.parameters?.docs?.description}}};n.input.parameters={...n.input.parameters,docs:{...n.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    variant: "warning",
    icon: <AlertTriangle className="size-full" />,
    title: "Backup Recommended",
    description: "Before making system changes, we recommend creating a backup of your current configuration. This ensures you can restore your system if needed."
  }
})`,...n.input.parameters?.docs?.source},description:{story:"Warning variant - important notices or cautions",...n.input.parameters?.docs?.description}}};r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    variant: "success",
    icon: <CheckCircle className="size-full" />,
    title: "Setup Complete!",
    description: "Your system is now configured and ready to use. You can start managing your macOS setup declaratively through nixmac."
  }
})`,...r.input.parameters?.docs?.source},description:{story:"Success variant - positive feedback or completed states",...r.input.parameters?.docs?.description}}};a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    variant: "info",
    icon: <Shield className="size-full" />,
    title: "Security & Privacy",
    description: "nixmac only accesses the specific directories and resources it needs. All system modifications are transparent and can be reviewed before applying."
  }
})`,...a.input.parameters?.docs?.source},description:{story:"Security context example",...a.input.parameters?.docs?.description}}};o.input.parameters={...o.input.parameters,docs:{...o.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: <Terminal className="size-full" />,
    title: "How it Works",
    description: "nixmac uses nix-darwin and home-manager to provide declarative system configuration. Your entire system state is defined in version-controlled configuration files."
  }
})`,...o.input.parameters?.docs?.source},description:{story:"Technical explanation example",...o.input.parameters?.docs?.description}}};c.input.parameters={...c.input.parameters,docs:{...c.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    variant: "success",
    icon: <Sparkles className="size-full" />,
    title: "AI-Powered Configuration",
    description: "Our AI assistant can help you discover new packages, optimize your setup, and suggest improvements based on your usage patterns."
  }
})`,...c.input.parameters?.docs?.source},description:{story:"Feature highlight example",...c.input.parameters?.docs?.description}}};p.input.parameters={...p.input.parameters,docs:{...p.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="space-y-4">
      <IconTitleDescriptionCard description="This is important information you should know before proceeding." icon={CustomInfoIcon} title="Before You Start" variant="info" />
      <IconTitleDescriptionCard description="Make sure to backup your important files before making system changes." icon={<AlertTriangle className="size-full" />} title="Backup Warning" variant="warning" />
      <IconTitleDescriptionCard description="Your configuration has been successfully applied to the system." icon={<CheckCircle className="size-full" />} title="Changes Applied" variant="success" />
    </div>
})`,...p.input.parameters?.docs?.source},description:{story:"Multiple cards example - shows how they look when stacked",...p.input.parameters?.docs?.description}}};u.input.parameters={...u.input.parameters,docs:{...u.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: CustomInfoIcon,
    title: "Detailed System Configuration Process",
    description: "This comprehensive setup process involves multiple steps including permission verification, system package installation, configuration file generation, service management, and final system validation. Each step is carefully orchestrated to ensure your system remains stable and functional throughout the entire process. The declarative nature of nixmac means that every change is predictable and reproducible across different machines and environments."
  }
})`,...u.input.parameters?.docs?.source},description:{story:"Long content example - tests text wrapping and layout",...u.input.parameters?.docs?.description}}};l.input.parameters={...l.input.parameters,docs:{...l.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: CustomInfoIcon,
    title: "Quick Tip",
    description: "Use ⌘+Shift+O to quickly open the nixmac interface."
  },
  decorators: [(Story: React.ComponentType) => <Story />]
})`,...l.input.parameters?.docs?.source},description:{story:"Compact layout example",...l.input.parameters?.docs?.description}}};const O=["Default","InfoVariant","Warning","Success","SecurityInfo","TechnicalDetails","FeatureHighlight","MultipleCards","LongContent","Compact"];export{l as Compact,s as Default,c as FeatureHighlight,i as InfoVariant,u as LongContent,p as MultipleCards,a as SecurityInfo,r as Success,o as TechnicalDetails,n as Warning,O as __namedExportsOrder,t as default};
