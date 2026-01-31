import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { BootstrapConfig } from "@/components/widget/bootstrap-config";
import { DirectoryPicker } from "@/components/widget/directory-picker";

interface GeneralTabProps {
	configDir: string | null;
	hasFlake: boolean;
	host: string | null;
	hosts: string[];
	saveHost: (value: string) => void;
	handleRefreshHosts: () => void;
	setSettingsOpen: (open: boolean) => void;
}

export function GeneralTab({
	configDir,
	hasFlake,
	host,
	hosts,
	saveHost,
	handleRefreshHosts,
	setSettingsOpen,
}: GeneralTabProps) {
	return (
		<div className="space-y-6">
			<div>
				<h2 className="mb-4 font-semibold text-base">General</h2>
				<div className="space-y-4">
					{/* Config Directory */}
					<DirectoryPicker
						label="Configuration Directory"
						subLabel="Holds your nix-darwin flake"
					/>

					{/* Host Selection or Bootstrap */}
					{hasFlake ? (
						<div className="space-y-2">
							<label className="font-medium text-sm">Host</label>
							<div className="flex items-center gap-2">
								<Select onValueChange={saveHost} value={host || undefined}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Select a host" />
									</SelectTrigger>
									<SelectContent>
										{hosts.map((h) => (
											<SelectItem key={h} value={h}>
												{h}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button onClick={handleRefreshHosts} size="sm" variant="outline">
									Refresh
								</Button>
							</div>
							<p className="text-muted-foreground text-xs">
								The darwin configuration to use for this machine
							</p>
						</div>
					) : (
						configDir && (
							<BootstrapConfig
								label="Configuration"
								onSuccess={() => setSettingsOpen(false)}
							/>
						)
					)}
				</div>
			</div>
		</div>
	);
}
