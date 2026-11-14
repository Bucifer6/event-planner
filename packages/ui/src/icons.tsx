import type { ReactNode, SVGProps } from "react";

/**
 * Maison icons: 1.5px hairline strokes on a 24 grid, square caps — drawn to sit beside
 * Bodoni's thin serifs. Decorative by default (aria-hidden); pass `title` to make one meaningful.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number; title?: string };

function make(children: ReactNode, displayName: string) {
  function Icon({ size = 20, title, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="square"
        strokeLinejoin="miter"
        role={title ? "img" : undefined}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        focusable="false"
        {...rest}
      >
        {children}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

export const IconPlus = make(<path d="M12 5v14M5 12h14" />, "IconPlus");
export const IconMinus = make(<path d="M5 12h14" />, "IconMinus");
export const IconClose = make(<path d="M6 6l12 12M18 6L6 18" />, "IconClose");
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />, "IconCheck");
export const IconChevronRight = make(<path d="M9 5l7 7-7 7" />, "IconChevronRight");
export const IconChevronLeft = make(<path d="M15 5l-7 7 7 7" />, "IconChevronLeft");
export const IconChevronDown = make(<path d="M5 9l7 7 7-7" />, "IconChevronDown");
export const IconArrowRight = make(<path d="M4 12h16M14 6l6 6-6 6" />, "IconArrowRight");
export const IconArrowLeft = make(<path d="M20 12H4M10 6l-6 6 6 6" />, "IconArrowLeft");
export const IconExternal = make(<path d="M14 5h5v5M19 5l-8 8M11 7H5v12h12v-6" />, "IconExternal");
export const IconMore = make(
  <>
    <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={2.5} />
  </>,
  "IconMore",
);
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />, "IconMenu");
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="M16 16l4 4" />
  </>,
  "IconSearch",
);
export const IconAlert = make(
  <>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </>,
  "IconAlert",
);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </>,
  "IconInfo",
);
export const IconSuccess = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8 12.5l3 3 5-6" />
  </>,
  "IconSuccess",
);
export const IconCalendar = make(
  <>
    <path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5" />
  </>,
  "IconCalendar",
);
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3 2" />
  </>,
  "IconClock",
);
export const IconPin = make(
  <>
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2" />
  </>,
  "IconPin",
);
export const IconGuests = make(
  <>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M16 5.5a3 3 0 010 5.5M17.5 14.5c2 .8 3.5 2.8 3.5 5.5" />
  </>,
  "IconGuests",
);
export const IconPerson = make(
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
  </>,
  "IconPerson",
);
export const IconTasks = make(<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />, "IconTasks");
export const IconBudget = make(
  <>
    <path d="M4 7h16v12H4zM4 11h16" />
    <path d="M15 15h2" />
  </>,
  "IconBudget",
);
export const IconSupplier = make(<path d="M4 9l2-4h12l2 4M4 9v10h16V9M4 9h16M10 19v-5h4v5" />, "IconSupplier");
export const IconHome = make(<path d="M4 11l8-7 8 7M6 10v10h12V10" />, "IconHome");
export const IconOccasion = make(
  <>
    <path d="M5 21V4M5 5h13l-3 4 3 4H5" />
  </>,
  "IconOccasion",
);
export const IconDirectory = make(
  <>
    <path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h3" />
  </>,
  "IconDirectory",
);
export const IconEnvelope = make(<path d="M4 6h16v12H4zM4 7l8 6 8-6" />, "IconEnvelope");
export const IconLink = make(
  <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  "IconLink",
);
export const IconCopy = make(<path d="M9 9h11v11H9zM5 15H4V4h11v1" />, "IconCopy");
export const IconDownload = make(<path d="M12 4v11M7 11l5 5 5-5M5 20h14" />, "IconDownload");
export const IconUpload = make(<path d="M12 16V5M7 9l5-5 5 5M5 20h14" />, "IconUpload");
export const IconEdit = make(<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />, "IconEdit");
export const IconTrash = make(<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />, "IconTrash");
export const IconLock = make(
  <>
    <path d="M6 11h12v9H6zM9 11V8a3 3 0 016 0v3" />
  </>,
  "IconLock",
);
export const IconShield = make(<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />, "IconShield");
export const IconSettings = make(
  <>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </>,
  "IconSettings",
);
export const IconUndo = make(<path d="M8 5L4 9l4 4M4 9h10a5 5 0 010 10h-3" />, "IconUndo");
export const IconPreview = make(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
  "IconPreview",
);
export const IconTable = make(
  <>
    <circle cx="12" cy="12" r="5" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  </>,
  "IconTable",
);
export const IconPlan = make(<path d="M4 4h16v16H4zM4 10h7V4M11 20v-5h9M15 15v-5" />, "IconPlan");
export const IconFlower = make(
  <>
    <circle cx="12" cy="9" r="2" />
    <path d="M12 7c0-2 1-3.5 0-4-1 .5 0 2 0 4zM14 9c2 0 3.5 1 4 0-.5-1-2 0-4 0zM10 9c-2 0-3.5 1-4 0 .5-1 2 0 4 0zM12 11v10M12 16c2-2 4-2 5-1M12 18c-2-2-4-2-5-1" />
  </>,
  "IconFlower",
);
export const IconCar = make(
  <>
    <path d="M4 16v-4l2-5h12l2 5v4M4 16h16M4 16v2M20 16v2M4 12h16" />
  </>,
  "IconCar",
);
export const IconPlane = make(<path d="M3 13l18-8-6 16-3-7z M12 14l9-9" />, "IconPlane");
export const IconQr = make(<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 14v6h-3M14 20h.01" />, "IconQr");
export const IconBell = make(<path d="M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4" />, "IconBell");
export const IconGift = make(<path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1-3-5-4-5-1.5S10 7 12 7zm0 0c1-3 5-4 5-1.5S14 7 12 7z" />, "IconGift");
export const IconMusic = make(
  <>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </>,
  "IconMusic",
);
export const IconMenuCard = make(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />, "IconMenuCard");
export const IconLeaf = make(<path d="M5 19c0-9 5-14 14-14 0 9-5 14-14 14zM5 19l8-8" />, "IconLeaf");
export const IconSparkle = make(<path d="M12 3l1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-1.8z" />, "IconSparkle");
export const IconFilter = make(<path d="M4 6h16M7 12h10M10 18h4" />, "IconFilter");
export const IconSignOut = make(<path d="M14 4h6v16h-6M4 12h11M11 8l4 4-4 4" />, "IconSignOut");
export const IconPlay = make(<path d="M7 5l12 7-12 7z" />, "IconPlay");
export const IconPause = make(<path d="M8 5v14M16 5v14" />, "IconPause");
export const IconRefresh = make(<path d="M19 6v5h-5M5 18v-5h5M18 11a7 7 0 00-12-3M6 13a7 7 0 0012 3" />, "IconRefresh");
export const IconBuilding = make(<path d="M5 21V5h9v16M14 10h5v11M3 21h18M8 9h3M8 13h3M8 17h3" />, "IconBuilding");
export const IconKey = make(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M16 7l3 3" />
  </>,
  "IconKey",
);
export const IconGlobe = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" />
  </>,
  "IconGlobe",
);

/** A small engraved flourish used between an invitation's title and its details. */
export function Ornament({ width = 96, ...rest }: Omit<SVGProps<SVGSVGElement>, "children"> & { width?: number }) {
  return (
    <svg
      className="ed-invite__ornament"
      width={width}
      height={12}
      viewBox="0 0 96 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      aria-hidden
      focusable="false"
      {...rest}
    >
      <path d="M0 6h38M58 6h38" />
      <path d="M48 1l5 5-5 5-5-5z" />
    </svg>
  );
}
