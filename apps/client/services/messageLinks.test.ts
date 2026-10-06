import { expect, test } from 'bun:test'
import { parseMessageLinks, standaloneMessageLink } from './messageLinks'

const video = 'https://www.youtube.com/watch?v=D8PikZ1KhUo'

test('plain and Markdown link-only messages use the same destination', () => {
  for (const text of [video, ` ${video}\n`, `[${video}](${video})`, `[Watch this](${video})`]) {
    expect(standaloneMessageLink(parseMessageLinks(text))?.url).toBe(video)
  }
})

test('inline links preserve surrounding text and sentence punctuation', () => {
  expect(parseMessageLinks(`See (${video}), then [watch](${video}).`)).toEqual([
    { text: 'See (' },
    { text: video, url: video },
    { text: '), then ' },
    { text: 'watch', url: video },
    { text: '.' },
  ])
  expect(standaloneMessageLink(parseMessageLinks(`|[${video}](${video})`))).toBeUndefined()
  expect(standaloneMessageLink(parseMessageLinks(`${video} ${video}`))).toBeUndefined()
})

test('balanced URL parentheses and adjacent Markdown links keep their destinations', () => {
  const url = 'https://example.com/wiki/Title_(topic)'
  expect(parseMessageLinks(`[Topic](${url})[Next](https://example.org)`)).toEqual([
    { text: 'Topic', url },
    { text: 'Next', url: 'https://example.org/' },
  ])
  expect(parseMessageLinks(`(${url})`)).toEqual([{ text: '(' }, { text: url, url }, { text: ')' }])
})

test('www links use HTTPS, and invalid or non-web targets remain plain text', () => {
  expect(parseMessageLinks('www.example.com')).toEqual([
    { text: 'www.example.com', url: 'https://www.example.com/' },
  ])
  for (const text of [
    'Hello there',
    '[unsafe](javascript:alert(1))',
    '[file](file:///secret)',
    'https://',
    'https://example.com:99999',
    'user@www.example.com',
  ]) {
    expect(parseMessageLinks(text)).toEqual([{ text }])
    expect(standaloneMessageLink(parseMessageLinks(text))).toBeUndefined()
  }
})
