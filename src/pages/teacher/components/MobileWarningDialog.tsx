import { Monitor } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface MobileWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileWarningDialog({ open, onOpenChange }: MobileWarningDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><div className="p-2 bg-amber-100 rounded-xl"><Monitor className="w-5 h-5 text-amber-600" /></div>Desktop Recommended</DialogTitle>
          <DialogDescription className="text-slate-600 pt-2">The interactive tutorial is optimized for desktop screens (1024px and wider). For the best experience, we recommend using a laptop or desktop computer the first time you go through the tutorial.</DialogDescription>
        </DialogHeader>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 my-2"><p className="text-sm text-amber-800 font-medium"><strong>Why desktop?</strong> The tutorial highlights specific UI elements and may not display correctly on smaller screens.</p></div>
        <DialogFooter className="gap-2 sm:gap-0"><Button onClick={() => onOpenChange(false)} className="bg-indigo-600 hover:bg-indigo-700">Got it, I'll use Desktop</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}