import { describe, expect, it } from 'vitest'
import { averageVector, cosineSimilarity, normalize } from './index'

describe('averageVector', () => {
  it('takes the per-dimension mean', () => {
    expect(averageVector([[1, 0], [0, 1], [1, 1]])).toEqual([2 / 3, 2 / 3])
  })
})

describe('normalize', () => {
  it('rescales a vector to unit length', () => {
    const [x, y] = normalize([3, 4])
    expect(x).toBeCloseTo(0.6)
    expect(y).toBeCloseTo(0.8)
  })

  it('leaves a zero vector unchanged rather than dividing by zero', () => {
    expect(normalize([0, 0])).toEqual([0, 0])
  })

  it('produces a vector whose cosine similarity with itself is ~1', () => {
    const v = normalize(averageVector([[1, 0], [0.8, 0.2]]))
    expect(cosineSimilarity(v, v)).toBeCloseTo(1)
  })
})
