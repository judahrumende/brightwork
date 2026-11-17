import { useId } from 'react';

const paths = {
  home: 'M2 7 8 2l6 5v7H9.5v-4h-3v4H2z',
  box: 'm8 1.5 6 3.2v6.6l-6 3.2-6-3.2V4.7zM2 4.7l6 3.1 6-3.1M8 7.8v6.7',
  mail: 'M2 3.6h12v8.8H2zM2 4l6 5 6-5',
  calendar: 'M2 4h12v10H2zM2 7h12M5 2v3m6-3v3',
  message:
    'M13.7 7.5a5.7 5.7 0 0 1-8.2 5.1l-3.3 1 .8-3A5.7 5.7 0 1 1 13.7 7.5Z',
  globe:
    'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12',
  heart: 'M8 13.5 2.8 8.4C-.1 5.2 4.6.8 8 4.5c3.4-3.7 8.1.7 5.2 3.9z',
  ad: 'm2 6 11-3v10L2 10zm2 4 2 4h2l-1-3',
  pen: 'm2 11 8-8 3 3-8 8-3-1zM8.5 4.5l3 3',
  image: 'M2 2.5h12v11H2zM2 11l4-4 3 3 2-2 3 3m-4.5-6h.1',
  film: 'M2 4h8v8H2zm8 2 4-2v8l-4-2',
  list: 'm2 4 1 1 2-2m-3 5 1 1 2-2m-3 5 1 1 2-2m2-7h7m-7 4h7m-7 4h7',
  check: 'm4 8 3 3 5-6',
  chevron: 'm4 6 4 4 4-4',
  close: 'm4 4 8 8m0-8-8 8',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm3.3-1.2 3 3',
  folder: 'M2 4.5h4l1.4 1.8H14v6.3H2z',
  plus: 'M8 3v10M3 8h10',
  settings: 'M3 5h10M3 11h10M6 3v4m4 2v4',
  bell: 'M4.5 6a3.5 3.5 0 0 1 7 0c0 4 2 4 2 5h-11c0-1 2-1 2-5ZM6.5 13a1.5 1.5 0 0 0 3 0',
  more: 'M3 8h.1m4.9 0h.1m4.9 0h.1',
  arrow: 'M3 8h9m-4-4 4 4-4 4',
} as const;

export function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth={name === 'more' ? '2' : '1.4'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Mascot({ size = 72 }: { size?: number }) {
  const paint = useId();
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size * 0.8}
      viewBox="0 0 90 72"
      fill="none"
    >
      <defs>
        <linearGradient
          id={paint}
          x1="40"
          y1="14"
          x2="52"
          y2="62"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#dfedff" />
        </linearGradient>
      </defs>
      <path
        d="M24 58C11 58 5 51 5 43c0-10 7-17 16-18 2-11 12-18 23-18 11 0 20 7 23 17 11 0 18 7 18 15 0 10-8 18-19 18-5 6-12 9-20 9-9 0-16-4-22-8Z"
        fill={`url(#${paint})`}
      />
      <path
        d="M32 39v2m23-2v2m-15 4q4 6 8 0"
        stroke="#273b62"
        strokeWidth="3.25"
        strokeLinecap="round"
      />
      <path
        d="m70 28 1.2 3.8 3.8 1.2-3.8 1.2L70 38l-1.2-3.8L65 33l3.8-1.2L70 28Z"
        fill="#8bafed"
      />
      <path
        d="M27 44h3m28 0h3"
        stroke="#abc5f5"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
