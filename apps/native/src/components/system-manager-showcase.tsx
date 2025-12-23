import { CardGridStyle } from "@/components/styles/card-grid-style";
import { StepperWizardStyle } from "@/components/styles/stepper-wizard-style";
import { VercelListStyle } from "@/components/styles/vercel-list-style";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SystemManagerShowcase() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 text-center">
        <h1 className="font-semibold text-2xl tracking-tight">nixmac System Manager</h1>
        <p className="mt-2 text-muted-foreground">Alternative design concepts</p>
      </div>

      <Tabs className="w-full" defaultValue="vercel">
        <TabsList className="mb-6 grid w-full grid-cols-3">
          <TabsTrigger value="vercel">A. Deployment List</TabsTrigger>
          <TabsTrigger value="cards">B. Card Grid</TabsTrigger>
          <TabsTrigger value="stepper">E. Stepper Wizard</TabsTrigger>
        </TabsList>

        <TabsContent value="vercel">
          <VercelListStyle />
        </TabsContent>

        <TabsContent value="cards">
          <CardGridStyle />
        </TabsContent>

        <TabsContent value="stepper">
          <StepperWizardStyle />
        </TabsContent>
      </Tabs>
    </div>
  );
}
