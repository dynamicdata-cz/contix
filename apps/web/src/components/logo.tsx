/**
 * Logo CONTIX v brandu DynamicData (v1.68, ADR-161): zaoblený rámeček a geometrické písmo z loga DynamicData,
 * dvoubarevné (hlavní + šedá) jako „dynamic|data“. Barvy jen ze škály slate (tmavý panel i režim je přepíší).
 * Zdroj tvarů: docs/brand/contix-*.svg (vygenerováno z loga DynamicData).
 */

export function ContixMark({ className = "h-8 w-8", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="13 266 192 192" className={className} role="img" aria-label={title ?? "CONTIX"}>
      <path className="fill-slate-900" fillRule="evenodd" d="M168.6,455.66l-118.54.06c-20.02.01-34.66-16.11-34.65-35.64l.01-115.72c0-19.76,15.08-35.43,35.09-35.43h117.08c18.09,0,34.72,14.08,34.72,32.7l.03,121.2C202.34,440.63,186.81,455.65,168.6,455.66ZM197.29,422.67l.05-120.32c0-15.78-13.69-28.31-29.37-28.32l-116.94-.08c-16-.02-30.34,11.93-30.35,28.45l-.04,119.68c0,16.02,13.86,28.64,29.6,28.64h117.53C182.88,450.72,197.29,438.78,197.29,422.67Z"/>
      <g transform="translate(29 -267.2) scale(1.65)"><path transform="translate(-516.6 0)" className="fill-slate-900" d="M537.03,370.77l26.36-.02.01,11.48-31.04-.38c-9.59-.12-16.08-7.49-15.83-16.14.23-8.48,7.09-15.5,16.56-15.61l30.25-.35.12,11.48h-26.64c-2.03-.01-4.6,2.63-4.64,4.44C532.11,368.23,534.41,370.77,537.03,370.77Z"/>
      </g><g transform="translate(109.2 -215.2) scale(1.65)"><path className="fill-slate-500" d="M0 349.8H15.6L23 357.8L30.4 349.8H46L31 366L46 382.2H30.4L23 374.2L15.6 382.2H0L15 366Z"/>
      </g>
    </svg>
  );
}

export function ContixWordmark({ className = "h-4", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 335 265.1 49" className={className} role="img" aria-label={title ?? "CONTIX"}>
      <path transform="translate(-516.60 0)" className="fill-slate-900" fillRule="evenodd" d="M537.03,370.77l26.36-.02.01,11.48-31.04-.38c-9.59-.12-16.08-7.49-15.83-16.14.23-8.48,7.09-15.5,16.56-15.61l30.25-.35.12,11.48h-26.64c-2.03-.01-4.6,2.63-4.64,4.44C532.11,368.23,534.41,370.77,537.03,370.77Z"/>
      <path transform="translate(49.20 0)" className="fill-slate-900" fillRule="evenodd" d="M16.2 349.8H30.6A16.2 16.2 0 0 1 30.6 382.2H16.2A16.2 16.2 0 0 1 16.2 349.8ZM20.4 361.2H26.4A4.8 4.8 0 0 1 26.4 370.8H20.4A4.8 4.8 0 0 1 20.4 361.2Z"/>
      <path transform="translate(-225.00 0)" className="fill-slate-900" fillRule="evenodd" d="M356.04,366.42c0-2.61-2.54-5.22-4.87-5.22l-12.42.03.02,20.94-15.52.04.03-32.46,32.61.43c7.88.1,14.25,5.56,15.49,12.89l.1,19.09-15.5.03L356.04,366.42Z"/>
      <path transform="translate(-516.30 0)" className="fill-slate-500" fillRule="evenodd" d="M683.13,370.23l19.86.6v11.42s-22.57-.49-22.57-.49c-7.76-.17-14.95-6.07-15.01-13.81l-.15-18.23,8.97-7.05c1.19-.94,5.38-.76,6.42-.5l.13,7.62h22.19s.04,11.4.04,11.4l-22.05.11C680.09,363.11,680.94,369.9,683.13,370.23Z"/>
      <g transform="translate(-299.10 0)" className="fill-slate-500"><polygon points="488.3 382.19 488.19 370.97 494.18 370.73 494.28 361.28 488.22 361.18 488.25 349.82 509.77 349.83 509.73 370.65 515.68 370.81 515.78 382.17 488.3 382.19"/>
      <rect x="494.24" y="337.27" width="15.51" height="10.23"/>
      </g><path transform="translate(219.10 0)" className="fill-slate-500" fillRule="evenodd" d="M0 349.8H15.6L23 357.8L30.4 349.8H46L31 366L46 382.2H30.4L23 374.2L15.6 382.2H0L15 366Z"/>
      
    </svg>
  );
}
