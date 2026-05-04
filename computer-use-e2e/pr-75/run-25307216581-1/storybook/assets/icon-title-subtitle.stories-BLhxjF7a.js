import{c as b,j as e,p as S}from"./iframe-C-u98npA.js";import{I as s}from"./icon-title-subtitle-BVxEDBsN.js";import{S as h}from"./shield-DC_eakE0.js";import{D as v}from"./download-8URUUCW-.js";import{C as x}from"./circle-check-big-28P8cHPc.js";import{L as C}from"./lock-XfrD2W8t.js";import{T as k}from"./terminal-BhB-bsmt.js";import"./preload-helper-PPVm8Dsz.js";import"./utils-BQHNewu7.js";const w=[["path",{d:"M11 10.27 7 3.34",key:"16pf9h"}],["path",{d:"m11 13.73-4 6.93",key:"794ttg"}],["path",{d:"M12 22v-2",key:"1osdcq"}],["path",{d:"M12 2v2",key:"tus03m"}],["path",{d:"M14 12h8",key:"4f43i9"}],["path",{d:"m17 20.66-1-1.73",key:"eq3orb"}],["path",{d:"m17 3.34-1 1.73",key:"2wel8s"}],["path",{d:"M2 12h2",key:"1t8f8n"}],["path",{d:"m20.66 17-1.73-1",key:"sg0v6f"}],["path",{d:"m20.66 7-1.73 1",key:"1ow05n"}],["path",{d:"m3.34 17 1.73-1",key:"nuk764"}],["path",{d:"m3.34 7 1.73 1",key:"1ulond"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}],["circle",{cx:"12",cy:"12",r:"8",key:"46899m"}]],I=b("cog",w),t=S.meta({title:"components/IconTitleSubtitle",component:s,parameters:{layout:"centered"},tags:["autodocs"],argTypes:{compact:{control:"boolean",sub:"Compact layout for smaller spaces"},showIconInCompact:{control:"boolean",sub:"Show icon even in compact mode"},icon:{control:!1,sub:"Icon element to display (optional)"},title:{control:"text",sub:"Main title text"},sub:{control:"text",sub:"Subtitle below the title"}}}),f=e.jsxs("svg",{"aria-label":"Console icon",className:"size-7 text-primary-foreground",fill:"none",role:"img",stroke:"currentColor",viewBox:"0 0 24 24",children:[e.jsx("title",{children:"Console icon"}),e.jsx("path",{d:"M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:2})]}),o=t.story({args:{icon:f,title:"System Permissions",subtitle:"To manage your macOS system declaratively, nixmac needs the following permissions"}}),i=t.story({args:{compact:!0,title:"System Permissions",subtitle:"Grant the following permissions to continue"}}),r=t.story({args:{compact:!0,showIconInCompact:!0,icon:f,title:"System Permissions",subtitle:"Grant the following permissions to continue"}}),n=t.story({args:{title:"Welcome to nixmac",subtitle:"Let's get your macOS system configured declaratively"}}),a=t.story({args:{icon:e.jsx(x,{className:"size-7 text-primary-foreground"}),title:"Setup Complete!",subtitle:"Your system is now configured and ready to use. You can start managing your macOS setup declaratively through nixmac."}}),c=t.story({args:{icon:e.jsx(h,{className:"size-7 text-primary-foreground"}),title:"System Backup",subtitle:"Before making changes to your system configuration, we recommend creating a backup of your current setup."}}),m=t.story({args:{icon:e.jsx(v,{className:"size-7 text-primary-foreground"}),title:"Installing Packages",subtitle:"nixmac is installing the required system packages and configuring your environment. This may take a few minutes."}}),p=t.story({args:{icon:e.jsx(I,{className:"size-7 text-primary-foreground"}),title:"Configuration Manager",subtitle:"Manage your system configuration files, packages, and settings from a single declarative interface."}}),l=t.story({args:{icon:e.jsx(C,{className:"size-7 text-primary-foreground"}),title:"Security & Privacy",subtitle:"Configure security settings and privacy permissions for your nixmac installation."}}),u=t.story({args:{icon:e.jsx(k,{className:"size-7 text-primary-foreground"}),title:"Terminal Integration",subtitle:"nixmac provides seamless terminal integration for advanced system management and debugging."}}),d=t.story({args:{icon:f,title:"Advanced System Configuration and Package Management Interface",subtitle:"This comprehensive system management tool provides declarative configuration capabilities for macOS through nix-darwin and home-manager integration. Manage packages, services, and system settings through version-controlled configuration files."}}),g=t.story({render:()=>e.jsxs("div",{className:"max-w-2xl space-y-8",children:[e.jsx(s,{icon:e.jsx(h,{className:"size-7 text-primary-foreground"}),subtitle:"First step in the onboarding process",title:"Step 1: Permissions"}),e.jsx(s,{compact:!0,subtitle:"Compact version for step navigation",title:"Step 2: Configuration"}),e.jsx(s,{icon:e.jsx(x,{className:"size-7 text-primary-foreground"}),subtitle:"Final step with completion icon",title:"Step 3: Complete"})]})}),y=t.story({render:()=>e.jsxs("div",{className:"grid grid-cols-1 gap-8 lg:grid-cols-2",children:[e.jsxs("div",{className:"rounded-lg border p-6",children:[e.jsx("h3",{className:"mb-4 font-medium text-sm",children:"Full Size"}),e.jsx(s,{icon:f,subtitle:"To manage your macOS system declaratively, nixmac needs the following permissions",title:"System Permissions"})]}),e.jsxs("div",{className:"rounded-lg border p-6",children:[e.jsx("h3",{className:"mb-4 font-medium text-sm",children:"Compact"}),e.jsx(s,{compact:!0,subtitle:"Grant the following permissions to continue",title:"System Permissions"})]})]})});o.input.parameters={...o.input.parameters,docs:{...o.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: ConsoleIcon,
    title: "System Permissions",
    subtitle: "To manage your macOS system declaratively, nixmac needs the following permissions"
  }
})`,...o.input.parameters?.docs?.source},description:{story:"Default full-size header with icon",...o.input.parameters?.docs?.description}}};i.input.parameters={...i.input.parameters,docs:{...i.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    compact: true,
    title: "System Permissions",
    subtitle: "Grant the following permissions to continue"
  }
})`,...i.input.parameters?.docs?.source},description:{story:"Compact version suitable for widgets or smaller spaces",...i.input.parameters?.docs?.description}}};r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    compact: true,
    showIconInCompact: true,
    icon: ConsoleIcon,
    title: "System Permissions",
    subtitle: "Grant the following permissions to continue"
  }
})`,...r.input.parameters?.docs?.source},description:{story:"Compact with icon shown (override default behavior)",...r.input.parameters?.docs?.description}}};n.input.parameters={...n.input.parameters,docs:{...n.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    title: "Welcome to nixmac",
    subtitle: "Let's get your macOS system configured declaratively"
  }
})`,...n.input.parameters?.docs?.source},description:{story:"Without icon - text only header",...n.input.parameters?.docs?.description}}};a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: <CheckCircle className="size-7 text-primary-foreground" />,
    title: "Setup Complete!",
    subtitle: "Your system is now configured and ready to use. You can start managing your macOS setup declaratively through nixmac."
  }
})`,...a.input.parameters?.docs?.source},description:{story:"Setup completion example",...a.input.parameters?.docs?.description}}};c.input.parameters={...c.input.parameters,docs:{...c.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: <Shield className="size-7 text-primary-foreground" />,
    title: "System Backup",
    subtitle: "Before making changes to your system configuration, we recommend creating a backup of your current setup."
  }
})`,...c.input.parameters?.docs?.source},description:{story:"Backup notification example",...c.input.parameters?.docs?.description}}};m.input.parameters={...m.input.parameters,docs:{...m.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: <Download className="size-7 text-primary-foreground" />,
    title: "Installing Packages",
    subtitle: "nixmac is installing the required system packages and configuring your environment. This may take a few minutes."
  }
})`,...m.input.parameters?.docs?.source},description:{story:"Installation progress example",...m.input.parameters?.docs?.description}}};p.input.parameters={...p.input.parameters,docs:{...p.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: <Cog className="size-7 text-primary-foreground" />,
    title: "Configuration Manager",
    subtitle: "Manage your system configuration files, packages, and settings from a single declarative interface."
  }
})`,...p.input.parameters?.docs?.source},description:{story:"Configuration management example",...p.input.parameters?.docs?.description}}};l.input.parameters={...l.input.parameters,docs:{...l.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: <Lock className="size-7 text-primary-foreground" />,
    title: "Security & Privacy",
    subtitle: "Configure security settings and privacy permissions for your nixmac installation."
  }
})`,...l.input.parameters?.docs?.source},description:{story:"Security settings example",...l.input.parameters?.docs?.description}}};u.input.parameters={...u.input.parameters,docs:{...u.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: <Terminal className="size-7 text-primary-foreground" />,
    title: "Terminal Integration",
    subtitle: "nixmac provides seamless terminal integration for advanced system management and debugging."
  }
})`,...u.input.parameters?.docs?.source},description:{story:"Terminal access example",...u.input.parameters?.docs?.description}}};d.input.parameters={...d.input.parameters,docs:{...d.input.parameters?.docs,source:{originalSource:`meta.story({
  args: {
    icon: ConsoleIcon,
    title: "Advanced System Configuration and Package Management Interface",
    subtitle: "This comprehensive system management tool provides declarative configuration capabilities for macOS through nix-darwin and home-manager integration. Manage packages, services, and system settings through version-controlled configuration files."
  }
})`,...d.input.parameters?.docs?.source},description:{story:"Long title and subtitle example",...d.input.parameters?.docs?.description}}};g.input.parameters={...g.input.parameters,docs:{...g.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="max-w-2xl space-y-8">
      <IconTitleSub icon={<Shield className="size-7 text-primary-foreground" />} subtitle="First step in the onboarding process" title="Step 1: Permissions" />
      <IconTitleSub compact subtitle="Compact version for step navigation" title="Step 2: Configuration" />
      <IconTitleSub icon={<CheckCircle className="size-7 text-primary-foreground" />} subtitle="Final step with completion icon" title="Step 3: Complete" />
    </div>
})`,...g.input.parameters?.docs?.source},description:{story:"Multiple headers example - shows stacking behavior",...g.input.parameters?.docs?.description}}};y.input.parameters={...y.input.parameters,docs:{...y.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="rounded-lg border p-6">
        <h3 className="mb-4 font-medium text-sm">Full Size</h3>
        <IconTitleSub icon={ConsoleIcon} subtitle="To manage your macOS system declaratively, nixmac needs the following permissions" title="System Permissions" />
      </div>
      <div className="rounded-lg border p-6">
        <h3 className="mb-4 font-medium text-sm">Compact</h3>
        <IconTitleSub compact subtitle="Grant the following permissions to continue" title="System Permissions" />
      </div>
    </div>
})`,...y.input.parameters?.docs?.source},description:{story:"Responsive comparison - shows both sizes side by side",...y.input.parameters?.docs?.description}}};const D=["Default","Compact","CompactWithIcon","TextOnly","SetupComplete","BackupNotification","InstallationProgress","ConfigManagement","SecuritySettings","TerminalAccess","LongContent","MultipleHeaders","ResponsiveComparison"];export{c as BackupNotification,i as Compact,r as CompactWithIcon,p as ConfigManagement,o as Default,m as InstallationProgress,d as LongContent,g as MultipleHeaders,y as ResponsiveComparison,l as SecuritySettings,a as SetupComplete,u as TerminalAccess,n as TextOnly,D as __namedExportsOrder,t as default};
