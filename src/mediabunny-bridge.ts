// Keep the media parser behind a small local bridge so the service can cache
// the module instance across Obsidian plugin reloads without touching the
// shared Mediabunny diagnostic marker.
import { Input } from '../node_modules/mediabunny/dist/modules/src/input.js';
import {
  ADTS,
  FLAC,
  MATROSKA,
  MP3,
  MP4,
  OGG,
  QTFF,
  WAVE,
} from '../node_modules/mediabunny/dist/modules/src/input-format.js';
import { UrlSource } from '../node_modules/mediabunny/dist/modules/src/source.js';

export const mediaBunnyBridge = {
  Input,
  UrlSource,
  ADTS,
  FLAC,
  MATROSKA,
  MP3,
  MP4,
  OGG,
  QTFF,
  WAVE,
};

export type MediaBunnyBridge = typeof mediaBunnyBridge;
