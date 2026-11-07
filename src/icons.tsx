/*
 * The few icons of the 2026 redesign that Feather (react-icons/fi) does not have, drawn the same
 * way: 24 by 24, round caps, current color.
 */
type IconProps = { size?: number; strokeWidth?: number; className?: string };

function Svg({ size = 22, strokeWidth = 2.2, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}

/** A bathroom scale: the Body tab. */
export function ScaleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="4" />
      <path d="M8 9.5a4 4 0 0 1 8 0" />
      <path d="m12 9.5 1.6-1.6" />
    </Svg>
  );
}

/** A medal: the Awards tab. */
export function MedalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.5 13.2 17 22l-5-3-5 3 1.5-8.8" />
    </Svg>
  );
}

/** A flame: streaks. */
export function FlameIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 22c4 0 7-2.8 7-7 0-3.5-2.2-6.2-4-8-.4 2.2-1.5 3.5-3 4 .5-3.5-1-7-4-9 0 3.5-3 6-3 11 0 4.4 3 9 7 9z" />
    </Svg>
  );
}

/** A light bulb: tips and insights. */
export function BulbIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
    </Svg>
  );
}

/** A ruler: waist measurements. */
export function RulerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 17 17 3l4 4L7 21z" />
      <path d="m7 13 2 2" />
      <path d="m10 10 2 2" />
      <path d="m13 7 2 2" />
    </Svg>
  );
}

/** A drop: body fat and water. */
export function DropIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z" />
    </Svg>
  );
}
