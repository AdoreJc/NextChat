import * as React from "react";

/**
 * Line icons of the chat UI, drawn with `currentColor` so they follow the
 * theme tokens. Keep them out of a bare `<div>`: the legacy dark theme rule
 * `div:not(.no-dark) > svg` inverts icons, which these do not need.
 */
function Line(props: { children: React.ReactNode; size?: number }) {
  const size = props.size ?? 18;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {props.children}
    </svg>
  );
}

type IconProps = { size?: number };

export const NewChatLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
    <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 8 16l1.2-4z" />
  </Line>
);

export const SearchLine = (p: IconProps) => (
  <Line {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Line>
);

export const SidebarLine = (p: IconProps) => (
  <Line {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </Line>
);

export const MaskLine = (p: IconProps) => (
  <Line {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Line>
);

export const ToolLine = (p: IconProps) => (
  <Line {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <path d="M16.5 14v5M14 16.5h5" />
  </Line>
);

export const SettingsLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Line>
);

export const LoginLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    <path d="M10 8l4 4-4 4" />
    <path d="M14 12H4" />
  </Line>
);

export const TrashLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Line>
);

export const CopyLine = (p: IconProps) => (
  <Line {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Line>
);

export const RetryLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 6.3" />
    <path d="M20 4v7h-7" />
  </Line>
);

export const EditLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </Line>
);

export const PinLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M9 4h6l-1 6 3 3H7l3-3z" />
    <path d="M12 13v7" />
  </Line>
);

export const ExportLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
  </Line>
);

export const PlusLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M12 5v14M5 12h14" />
  </Line>
);

export const ArrowUpLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Line>
);

export const ArrowDownLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M12 5v14M5 12l7 7 7-7" />
  </Line>
);

export const ChevronDownLine = (p: IconProps) => (
  <Line {...p}>
    <path d="m6 9 6 6 6-6" />
  </Line>
);

export const MenuLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Line>
);

export const StopLine = (p: IconProps) => (
  <Line {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
  </Line>
);

export const SparkLine = (p: IconProps) => (
  <Line {...p}>
    <path d="M12 4l1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.3z" />
    <path d="M18.5 16v4M16.5 18h4" />
  </Line>
);
