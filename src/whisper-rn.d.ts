/**
 * whisper.rn ships an `exports` map without a "." entry, so TypeScript
 * cannot resolve the bare specifier. Metro bundles it fine via the
 * package's react-native field; this shim covers type-checking only.
 */
declare module 'whisper.rn' {
  export {
    initWhisper,
    releaseAllWhisper,
    WhisperContext,
    TranscribeFileOptions,
    TranscribeOptions,
    TranscribeResult,
  } from '../node_modules/whisper.rn/lib/typescript/index';
}
