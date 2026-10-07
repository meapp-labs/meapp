import { expect, test } from 'bun:test'
import { env } from './config.ts'
import { devSeedPreview } from './devSeed.ts'

const image = {
  v: 1,
  id: '7c29230e-970b-4a42-a4ae-9a239ef5f54e',
  kind: 'image',
  width: 640,
  height: 400,
  base: `cap/${'a'.repeat(32)}`,
  key: btoa('k'.repeat(32)),
  variants: [
    {
      name: 'orig',
      path: 'orig.enc',
      iv: btoa('i'.repeat(12)),
      size: 100,
      digest: btoa('d'.repeat(64)),
      mime: 'image/webp',
    },
  ],
}

test('fixture summaries hide media keys while ordinary JSON messages keep their original text', () => {
  const previous = env.NODE_ENV
  env.NODE_ENV = 'development'
  try {
    const envelope = JSON.stringify({ media: [image] })
    expect(devSeedPreview('meapp-dev-v1:image:0', envelope)).toBe('Shared photo')
    expect(
      devSeedPreview(
        'meapp-dev-v1:image:0',
        JSON.stringify({ text: 'Weekend plans', media: [image] }),
      ),
    ).toBe('Weekend plans')
    expect(devSeedPreview('ordinary-message', envelope)).toBe(envelope)
    expect(devSeedPreview('meapp-dev-v1:image:0', '{invalid')).toBe('{invalid')
  } finally {
    env.NODE_ENV = previous
  }
})

test('fixture envelopes are never decoded outside development', () => {
  const previous = env.NODE_ENV
  try {
    const envelope = JSON.stringify({ text: 'Fixture only', media: [image] })
    for (const mode of ['test', 'production'] as const) {
      env.NODE_ENV = mode
      expect(devSeedPreview('meapp-dev-v1:image:0', envelope)).toBe(envelope)
    }
  } finally {
    env.NODE_ENV = previous
  }
})
