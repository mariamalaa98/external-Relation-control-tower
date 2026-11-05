import { useEffect, useState, type ReactNode } from "react";
import { createDataverseClient, PulseNavigation } from "pulse-shared-navigation";
import { MicrosoftDataverseService } from "./generated/services/MicrosoftDataverseService";

const pulseClient = createDataverseClient(MicrosoftDataverseService);
let openPulseNav = () => {};

/** Opens the Pulse hub sidebar from the icon in this app's rail. */
export function openPulseNavigation() {
  openPulseNav();
}

export function PulseFrame({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openPulseNav = () => setOpen(true);
    return () => {
      openPulseNav = () => {};
    };
  }, []);
  return (
    <>
      <PulseNavigation
        client={pulseClient}
        variant="overlay"
        isOpen={open}
        onClose={() => setOpen(false)}
        powerAppId="dd69ba9f-0c04-49f7-8da3-f1aa49aaaa3d"
      />
      {children}
    </>
  );
}
