import{r as g,j as e}from"./iframe-C-u98npA.js";import{I as p}from"./icon-title-description-card-coRLXrLt.js";import{I as x}from"./icon-title-subtitle-BVxEDBsN.js";import{B as d}from"./button-Cs8JYVoL.js";import{C as y}from"./card-DTcOoczF.js";const h=[{id:"desktop",name:"Desktop Folder Access",description:"Required to manage and sync desktop files and configurations",required:!0,canRequestProgrammatically:!0,status:"pending"},{id:"documents",name:"Documents Folder Access",description:"Required to access and manage configuration files stored in Documents",required:!0,canRequestProgrammatically:!0,status:"pending"},{id:"admin",name:"Administrator Privileges",description:"Required to install system packages and modify system configurations",required:!0,canRequestProgrammatically:!1,status:"pending",instructions:"You will be prompted for your password when needed"},{id:"full-disk",name:"Full Disk Access",description:"Recommended for complete system management capabilities",required:!1,canRequestProgrammatically:!1,status:"pending",instructions:"First make sure nixmac is in your Applications folder (not running from the install disk image). Then go to System Settings → Privacy & Security → Full Disk Access and add nixmac to the list."}];function b({compact:t,permission:s,onRequestPermission:n}){const i=a=>{switch(a){case"granted":return"Granted";case"denied":return"Retry";case"pending":return"Request";default:return"Request"}};return e.jsx("div",{className:t?"flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0":"flex flex-col gap-3 border-b pb-6 last:border-b-0 last:pb-0",children:e.jsxs("div",{className:"flex items-start justify-between gap-3",children:[e.jsxs("div",{className:"min-w-0 flex-1",children:[e.jsxs("div",{className:"mb-1 flex flex-wrap items-center gap-2",children:[e.jsx("h3",{className:t?"font-medium text-foreground text-sm":"font-medium text-foreground",children:s.name}),s.required?e.jsx("span",{className:"rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs",children:"Required"}):null,e.jsx(q,{status:s.status})]}),e.jsx("p",{className:"text-muted-foreground text-sm",children:s.description}),s.instructions?e.jsx("div",{className:"mt-2 rounded-md border border-border bg-secondary/50 p-3",children:e.jsx("p",{className:"font-mono text-muted-foreground text-xs",children:s.instructions})}):null]}),e.jsx("div",{className:"flex-shrink-0",children:s.canRequestProgrammatically?e.jsx(d,{disabled:s.status==="granted",onClick:()=>n(s.id),size:"sm",variant:s.status==="granted"?"secondary":"default",children:i(s.status)}):e.jsx(d,{disabled:s.status==="granted",onClick:()=>n(s.id),size:"sm",variant:"outline",children:s.status==="granted"?"Granted":"Mark as Done"})})]})},s.id)}function j({onComplete:t,initialPermissions:s=h,compact:n=!1}){const[i,a]=g.useState(s),c=r=>{a(f=>f.map(o=>o.id===r?{...o,status:Math.random()>.3?"granted":"denied"}:o))},l=i.filter(r=>r.required).every(r=>r.status==="granted"),m=e.jsxs("svg",{"aria-label":"Console icon",className:"size-7 text-primary-foreground",fill:"none",role:"img",stroke:"currentColor",viewBox:"0 0 24 24",children:[e.jsx("title",{children:"Console icon"}),e.jsx("path",{d:"M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:2})]}),u=e.jsxs("svg",{"aria-label":"Information",className:"size-full",fill:"none",role:"img",stroke:"currentColor",viewBox:"0 0 24 24",children:[e.jsx("title",{children:"Information"}),e.jsx("path",{d:"M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",strokeLinecap:"round",strokeLinejoin:"round",strokeWidth:2})]});return e.jsx("div",{className:n?"h-full overflow-auto p-4":"flex min-h-screen items-center justify-center bg-background p-4 md:p-8",children:e.jsxs("div",{className:n?"w-full":"w-full max-w-3xl",children:[e.jsx(x,{compact:n,icon:m,subtitle:n?"Grant the following permissions to continue":"To manage your macOS system declaratively, nixmac needs the following permissions",title:"System Permissions"}),e.jsx(y,{className:n?"mb-4 p-4":"mb-6 p-6",children:e.jsx("div",{className:n?"space-y-4":"space-y-6",children:i.map(r=>e.jsx(b,{compact:n,onRequestPermission:c,permission:r},r.id))})}),e.jsxs("div",{className:"flex items-center justify-between",children:[e.jsx("p",{className:"text-muted-foreground text-sm",children:l?"All required permissions granted!":"Grant all required permissions to continue"}),e.jsx(d,{disabled:!l,onClick:t,size:"lg",children:"Continue to Console"})]}),!n&&e.jsx(p,{className:"mt-6",description:"nixmac manages your macOS system declaratively, similar to NixOS. It needs access to configuration files, the ability to install packages, and permission to modify system settings to provide a complete system management experience.",icon:u,title:"Why does nixmac need these permissions?",variant:"default"})]})})}function q({status:t}){const s={granted:"bg-console-success/10 text-console-success border-console-success/20",denied:"bg-console-error/10 text-console-error border-console-error/20",pending:"bg-secondary text-muted-foreground border-border"},n={granted:"✓",denied:"✗",pending:"○"};return e.jsxs("span",{className:`rounded-md border px-2 py-0.5 font-medium text-xs ${s[t]}`,children:[n[t]," ",t.charAt(0).toUpperCase()+t.slice(1)]})}j.__docgenInfo={description:"",methods:[],displayName:"PermissionsScreen",props:{onComplete:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""},initialPermissions:{required:!1,tsType:{name:"Array",elements:[{name:"Permission"}],raw:"Permission[]"},description:"",defaultValue:{value:`[
  {
    id: "desktop",
    name: "Desktop Folder Access",
    description: "Required to manage and sync desktop files and configurations",
    required: true,
    canRequestProgrammatically: true,
    status: "pending",
  },
  {
    id: "documents",
    name: "Documents Folder Access",
    description:
      "Required to access and manage configuration files stored in Documents",
    required: true,
    canRequestProgrammatically: true,
    status: "pending",
  },
  {
    id: "admin",
    name: "Administrator Privileges",
    description:
      "Required to install system packages and modify system configurations",
    required: true,
    canRequestProgrammatically: false,
    status: "pending",
    instructions: "You will be prompted for your password when needed",
  },
  {
    id: "full-disk",
    name: "Full Disk Access",
    description: "Recommended for complete system management capabilities",
    required: false,
    canRequestProgrammatically: false,
    status: "pending",
    instructions:
      "First make sure nixmac is in your Applications folder (not running from the install disk image). Then go to System Settings → Privacy & Security → Full Disk Access and add nixmac to the list.",
  },
]`,computed:!1}},compact:{required:!1,tsType:{name:"boolean"},description:"When true, renders a compact version suitable for embedding in a widget",defaultValue:{value:"false",computed:!1}}}};export{j as P,h as d};
