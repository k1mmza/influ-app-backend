/**
 * TEST PLAN — parseVideoUrl (pure, no DB/network)
 * ===============================================
 * The 3 valid forms, param-stripping, host/scheme variants, id-shape
 * validation, and the null skip-signal for everything else.
 */

import { parseVideoUrl } from './video-url';

const VALID_ID = 'dQw4w9WgXcQ'; // 11 chars

describe('parseVideoUrl', () => {
  it('parses the watch?v= form', () => {
    expect(parseVideoUrl(`https://www.youtube.com/watch?v=${VALID_ID}`)).toEqual({
      platform: 'youtube',
      videoId: VALID_ID,
    });
  });

  it('parses the youtu.be short-link form', () => {
    expect(parseVideoUrl(`https://youtu.be/${VALID_ID}`)).toEqual({
      platform: 'youtube',
      videoId: VALID_ID,
    });
  });

  it('parses the /shorts/ form', () => {
    expect(parseVideoUrl(`https://www.youtube.com/shorts/${VALID_ID}`)).toEqual({
      platform: 'youtube',
      videoId: VALID_ID,
    });
  });

  it('ignores extra query params (&t=, ?si=)', () => {
    expect(
      parseVideoUrl(`https://www.youtube.com/watch?v=${VALID_ID}&t=30s`),
    ).toEqual({ platform: 'youtube', videoId: VALID_ID });
    expect(parseVideoUrl(`https://youtu.be/${VALID_ID}?si=abc123XYZ`)).toEqual({
      platform: 'youtube',
      videoId: VALID_ID,
    });
  });

  it('handles host/scheme/trailing-slash variants', () => {
    const expected = { platform: 'youtube', videoId: VALID_ID };
    expect(parseVideoUrl(`http://youtube.com/watch?v=${VALID_ID}`)).toEqual(expected);
    expect(parseVideoUrl(`https://youtube.com/shorts/${VALID_ID}/`)).toEqual(expected);
    expect(parseVideoUrl(`https://m.youtube.com/watch?v=${VALID_ID}`)).toEqual(expected);
  });

  it('returns null for a non-YouTube URL', () => {
    expect(parseVideoUrl('https://www.tiktok.com/@x/video/1234567890')).toBeNull();
    expect(parseVideoUrl('https://drive.google.com/file/d/abc/view')).toBeNull();
  });

  it('returns null for an unparseable string', () => {
    expect(parseVideoUrl('not a url at all')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseVideoUrl('')).toBeNull();
    expect(parseVideoUrl('   ')).toBeNull();
  });

  it('returns null when the id is the wrong shape (malformed tail)', () => {
    expect(parseVideoUrl('https://youtu.be/tooShort')).toBeNull();
    expect(parseVideoUrl('https://www.youtube.com/watch?v=way_too_long_id_here')).toBeNull();
    expect(parseVideoUrl('https://www.youtube.com/shorts/')).toBeNull();
  });
});
