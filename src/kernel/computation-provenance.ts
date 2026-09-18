import { createHash } from 'node:crypto';

import {
  ALGORITHM_VERSIONS,
  type RegisteredAlgorithm,
} from './algorithm-versions.js';

export type ComputationProvenance = Readonly<{
  algorithm: string;
  version: string;
  inputsHash: string;
  computedAt: Date;
}>;

export type StampedComputation<Output> = Readonly<{
  value: Output;
  provenance: ComputationProvenance;
}>;

function canonicalize(input: unknown, ancestors: ReadonlySet<object>): string {
  if (input === null) return 'null';
  if (input === undefined) return 'undefined';
  if (typeof input === 'string') return `string:${JSON.stringify(input)}`;
  if (typeof input === 'boolean') return `boolean:${String(input)}`;
  if (typeof input === 'bigint') return `bigint:${input.toString()}`;
  if (typeof input === 'number') {
    if (Number.isNaN(input)) return 'number:NaN';
    if (input === Infinity) return 'number:Infinity';
    if (input === -Infinity) return 'number:-Infinity';
    if (Object.is(input, -0)) return 'number:-0';
    return `number:${String(input)}`;
  }
  if (typeof input === 'symbol' || typeof input === 'function') {
    throw new TypeError(
      'Computation inputs must be data, not executable values',
    );
  }
  if (ancestors.has(input)) {
    throw new TypeError('Computation inputs must not contain cycles');
  }
  const nextAncestors = new Set(ancestors).add(input);
  if (input instanceof Date) return `date:${input.toISOString()}`;
  if (input instanceof Uint8Array) {
    return `bytes:${Buffer.from(input).toString('hex')}`;
  }
  if (Array.isArray(input)) {
    return `array:[${input
      .map((item) => canonicalize(item, nextAncestors))
      .join(',')}]`;
  }
  if (input instanceof Set) {
    return `set:{${[...input]
      .map((item) => canonicalize(item, nextAncestors))
      .sort()
      .join(',')}}`;
  }
  if (input instanceof Map) {
    return `map:{${[...input]
      .map(
        ([key, value]) =>
          `${canonicalize(key, nextAncestors)}=>${canonicalize(value, nextAncestors)}`,
      )
      .sort()
      .join(',')}}`;
  }
  const record = input as Record<string, unknown>;
  return `object:{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalize(record[key], nextAncestors)}`,
    )
    .join(',')}}`;
}

export function hashComputationInputs(input: unknown): string {
  return createHash('sha256')
    .update(canonicalize(input, new Set()))
    .digest('hex');
}

export function withComputationProvenance<Input, Output>(
  algorithm: RegisteredAlgorithm,
  compute: (input: Input) => Output,
  clock: () => Date = () => new Date(),
): (input: Input) => StampedComputation<Output> {
  return (input) =>
    Object.freeze({
      value: compute(input),
      provenance: Object.freeze({
        algorithm,
        version: ALGORITHM_VERSIONS[algorithm],
        inputsHash: hashComputationInputs(input),
        computedAt: new Date(clock().getTime()),
      }),
    });
}
