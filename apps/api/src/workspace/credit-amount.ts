const scale = 10_000_000_000n;

export function creditUnits(amount: string): bigint {
  const match = /^(-?)(\d{1,14})(?:\.(\d{1,10}))?$/u.exec(amount);
  if (!match) throw new RangeError('Credits require up to ten decimal places');
  const magnitude =
    BigInt(match[2]!) * scale + BigInt((match[3] ?? '').padEnd(10, '0'));
  return match[1] === '-' ? -magnitude : magnitude;
}

export function creditDecimal(units: bigint): string {
  const magnitude = units < 0n ? -units : units;
  return `${units < 0n ? '-' : ''}${magnitude / scale}.${String(magnitude % scale).padStart(10, '0')}`;
}
