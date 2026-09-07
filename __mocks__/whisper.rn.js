/** Jest mock: whisper.rn native module is unavailable in tests. */
class WhisperContext {
  async transcribe() {
    return {stop: () => {}, promise: Promise.resolve({result: ''})};
  }
  async release() {}
}

async function initWhisper() {
  return new WhisperContext();
}

async function releaseAllWhisper() {}

module.exports = {WhisperContext, initWhisper, releaseAllWhisper};
