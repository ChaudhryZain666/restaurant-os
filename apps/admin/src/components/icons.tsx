import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

export const IconGrid = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </Icon>
);

export const IconClipboard = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M9 11h6M9 15h6" />
  </Icon>
);

export const IconMenuBook = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 5c2-1 5-1 8 0 3-1 6-1 8 0v13c-2-1-5-1-8 0-3-1-6-1-8 0Z" />
    <path d="M12 5v13" />
  </Icon>
);

export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6.3M21.5 20a6 6 0 0 0-4.8-5.9" />
  </Icon>
);

export const IconKitchen = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 21V10a7 7 0 0 1 14 0v11" />
    <path d="M3 21h18" />
    <path d="M9 21v-5M15 21v-5" />
  </Icon>
);

export const IconTruck = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2" y="7" width="13" height="10" rx="1" />
    <path d="M15 10h4l3 3v4h-7z" />
    <circle cx="7" cy="19" r="1.6" />
    <circle cx="17.5" cy="19" r="1.6" />
  </Icon>
);

export const IconIdBadge = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <circle cx="12" cy="10" r="2.5" />
    <path d="M8 17c.5-2 2-3 4-3s3.5 1 4 3" />
  </Icon>
);

export const IconTag = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 11.5V5a1 1 0 0 1 1-1h6.5a1 1 0 0 1 .7.3l9 9a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-9-9a1 1 0 0 1-.3-.7Z" />
    <circle cx="7.5" cy="7.5" r="1.4" />
  </Icon>
);

export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 20V10M11 20V4M18 20v-7" />
    <path d="M2 20h20" />
  </Icon>
);

export const IconHeadset = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
    <rect x="2.5" y="13" width="4.5" height="6" rx="1.5" />
    <rect x="17" y="13" width="4.5" height="6" rx="1.5" />
    <path d="M19.5 19v1a3 3 0 0 1-3 3h-3" />
  </Icon>
);

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Icon>
);

export const IconStore = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 9.5 4.5 3.5h15L21 9.5" />
    <path d="M3 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
    <path d="M5 10.5V21h14V10.5" />
  </Icon>
);

export const IconWallet = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <circle cx="16" cy="13.5" r="1.3" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconBook = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
  </Icon>
);

export const IconSliders = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 6h9M17 6h3M4 12h3M9 12h11M4 18h13M21 18h-1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="7" cy="12" r="2" />
    <circle cx="19" cy="18" r="2" />
  </Icon>
);

export const IconStar = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9Z" />
  </Icon>
);

export const IconTable = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M6 12v9M18 12v9" />
  </Icon>
);

export const IconQrCode = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" />
  </Icon>
);

export const IconPalette = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 21a9 9 0 1 1 0-18c4.5 0 8 3 8 6.5 0 2-1.5 3.5-3.5 3.5H15a1.5 1.5 0 0 0-1 2.6c.4.4.6.9.6 1.4 0 1.1-1.1 2-2.6 2Z" />
    <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Icon>
);
