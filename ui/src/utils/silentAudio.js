export function createSilentBlobUrl(durationSecs) {
  const sampleRate = 8000
  const bitsPerSample = 8
  const numChannels = 1
  const numSamples = Math.ceil(sampleRate * Math.max(durationSecs, 1))
  const dataSize = numSamples * numChannels * (bitsPerSample / 8)
  const headerSize = 44
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
  view.setUint16(32, numChannels * (bitsPerSample / 8), true)
  view.setUint16(34, bitsPerSample, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  new Uint8Array(buffer, headerSize).fill(128)

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}
