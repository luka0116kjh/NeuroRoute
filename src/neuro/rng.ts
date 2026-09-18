/**
 * 재현 가능한 의사난수 생성기 (mulberry32).
 * 같은 seed → 같은 수열. Math.random() 은 사용하지 않는다.
 */
export function createRng(seed: number): () => number {
  let state = normalizeSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** NaN/Infinity/실수 seed 도 32비트 정수로 안정적으로 변환 */
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.floor(seed) >>> 0;
}

/** 여러 숫자를 하나의 32비트 해시로 섞는다 (센서값 기반 결정적 타이브레이커용) */
export function hashNumbers(values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    // 소수점 둘째 자리까지 양자화해 부동소수 잡음에 둔감하게 만든다.
    const q = Number.isFinite(v) ? Math.round(v * 100) : 0;
    h ^= q & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
