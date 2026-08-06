import { describe, expect, it } from 'vitest';
import {
  classifyMediaLink,
  dedupeMediaLinks,
  mediaAttachmentsFromLinks,
  normalizeMediaLink,
} from '../src/media-links';

describe('media link normalization', () => {
  it('normalizes wikilink aliases and sizing hints', () => {
    expect(normalizeMediaLink('![[Photos/IMG%209011.MOV|640]]')).toBe('Photos/IMG 9011.MOV');
    expect(normalizeMediaLink('[[cover.jpg|cover]]')).toBe('cover.jpg');
  });

  it('classifies all supported media families and remote images', () => {
    expect(classifyMediaLink('movie.MOV')).toMatchObject({ kind: 'video', extension: 'mov' });
    expect(classifyMediaLink('voice.oga')).toMatchObject({ kind: 'audio', extension: 'oga' });
    expect(classifyMediaLink('https://cdn.example.test/photo.webp?width=800')).toMatchObject({ kind: 'image', extension: 'webp' });
    expect(classifyMediaLink('document.pdf').kind).toBe('unknown');
  });

  it('preserves encoded remote URLs and case-sensitive internal paths', () => {
    const remote = 'https://cdn.example.test/Photo%2FOne.JPG?sig=A%2BB';
    expect(normalizeMediaLink(remote)).toBe(remote);
    expect(mediaAttachmentsFromLinks(['Photos/One.JPG', 'Photos/one.jpg'], 'note.md')).toHaveLength(2);
  });

  it('keeps external URLs distinct when only path casing differs', () => {
    const urls = [
      'https://cdn.example.test/Photo.JPG',
      'https://cdn.example.test/photo.jpg',
    ];
    expect(mediaAttachmentsFromLinks(urls, 'note.md').map((item) => item.normalizedLink)).toEqual(urls);
    expect(dedupeMediaLinks(urls)).toEqual(urls);
  });

  it('preserves正文 order while de-duplicating aliases', () => {
    const links = dedupeMediaLinks([
      'photo.jpg',
      '![[photo.jpg|thumb]]',
      'video.mp4',
      'voice.mp3',
    ]);
    expect(links).toEqual(['photo.jpg', 'video.mp4', 'voice.mp3']);
    expect(mediaAttachmentsFromLinks(links, 'Calendar/Daily/2026-08-06.md').map((item) => item.kind))
      .toEqual(['image', 'video', 'audio']);
  });
});
