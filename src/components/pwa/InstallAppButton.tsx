import { useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInstallPrompt } from "@/pwa/useInstallPrompt";
import IosInstallDialog from "./IosInstallDialog";

interface InstallAppButtonProps {
  collapsed: boolean;
}

export default function InstallAppButton({ collapsed }: InstallAppButtonProps) {
  const { state, promptInstall } = useInstallPrompt();
  const [iosDialogOpen, setIosDialogOpen] = useState(false);

  if (state === "installed" || state === "dismissed" || state === "unsupported") {
    return null;
  }

  const handleClick = () => {
    if (state === "ios") {
      setIosDialogOpen(true);
      return;
    }
    void promptInstall();
  };

  return (
    <>
      <div className={cn("border-b border-border/60", collapsed ? "mb-1 pb-1" : "mb-2 pb-2")}>
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "group flex items-center rounded-full text-[14px] font-medium text-foreground transition-colors duration-200 hover:bg-muted",
            collapsed
              ? "mx-auto h-9 w-9 justify-center"
              : "min-h-12 w-full px-4 py-2 lg:min-h-0 lg:py-1.5",
          )}
          title={collapsed ? "Install app" : undefined}
          aria-label="Install app"
        >
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
            <Download
              className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </span>
          <span className={cn("whitespace-nowrap", collapsed ? "sr-only" : "ml-4")}>
            Install app
          </span>
        </button>
      </div>

      <IosInstallDialog open={iosDialogOpen} onOpenChange={setIosDialogOpen} />
    </>
  );
}
