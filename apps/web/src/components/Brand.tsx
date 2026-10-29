/** Product name shown under the MySoft Attendance logo. */
export const APP_NAME = 'QR and Phones Attendance';
export const LOGO_SRC = '/brand/mysoft-attendance.png';

/** The MYSOFT ATTENDANCE logo with "QR and Phones Attendance" under it (sign-in screens, apps). */
export function BrandLockup({ size = 'md', center, name = APP_NAME, sub }: { size?: 'sm' | 'md' | 'lg'; center?: boolean; name?: string; sub?: string }) {
  return (
    <div className={`brand-lockup ${size}${center ? ' center' : ''}`}>
      <span className="brand-logo"><img src={LOGO_SRC} alt="MySoft Attendance" /></span>
      <span className="brand-name">{name}</span>
      {sub && <span className="brand-sub">{sub}</span>}
    </div>
  );
}
