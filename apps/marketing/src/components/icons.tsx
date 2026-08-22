import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props} />;
}

export const IconCart = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="9" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.5 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6" />
  </Icon>
);

export const IconMenuBook = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 5c2-1 5-1 8 0 3-1 6-1 8 0v13c-2-1-5-1-8 0-3-1-6-1-8 0Z" />
    <path d="M12 5v13" />
  </Icon>
);

export const IconClipboard = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M9 11h6M9 15h6" />
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

export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6.3M21.5 20a6 6 0 0 0-4.8-5.9" />
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

export const IconStar = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8-6.1-3.6-6.1 3.6 1.5-6.8-5.2-4.7 6.9-.7L12 2.5Z" />
  </Icon>
);

export const IconQr = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2" />
  </Icon>
);

export const IconPalette = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 21a9 9 0 1 1 0-18c4.5 0 8.5 3 8.5 6.5 0 2-1.5 3.2-3.3 3.2h-2a1.7 1.7 0 0 0-1 3 1.6 1.6 0 0 1-2.2 2.2Z" />
    <circle cx="7.5" cy="11" r="1" fill="currentColor" />
    <circle cx="9.5" cy="7" r="1" fill="currentColor" />
    <circle cx="14.5" cy="7" r="1" fill="currentColor" />
  </Icon>
);

export const IconMapPin = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 21s7-6.6 7-12a7 7 0 1 0-14 0c0 5.4 7 12 7 12Z" />
    <circle cx="12" cy="9" r="2.4" />
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

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m5 13 4 4L19 7" />
  </Icon>
);

export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Icon>
);

export const IconPhone = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M11 19h2" />
  </Icon>
);

export const IconStore = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 9.5 4.5 3.5h15L21 9.5" />
    <path d="M3 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
    <path d="M5 10.5V21h14V10.5" />
    <path d="M10 21v-6h4v6" />
  </Icon>
);
