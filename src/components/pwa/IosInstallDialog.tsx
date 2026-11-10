import { Share, Plus, MoreHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface IosInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const steps = [
  {
    icon: Share,
    title: "Tap the Share button",
    description: "It is the square with an arrow at the bottom of Safari.",
  },
  {
    icon: MoreHorizontal,
    title: "Tap Add to Home Screen",
    description: "Scroll down in the share sheet if you do not see it.",
  },
  {
    icon: Plus,
    title: "Tap Add",
    description: "SMART will appear on your home screen like an app.",
  },
];

export default function IosInstallDialog({ open, onOpenChange }: IosInstallDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install SMART on iPhone or iPad</DialogTitle>
          <DialogDescription>
            Safari installs apps through the Share menu. This takes a few seconds.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <step.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {step.title}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Grades and attendance still need an internet connection. The installed app only opens
          faster and works without the browser bar.
        </p>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
