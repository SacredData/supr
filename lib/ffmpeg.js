const debug = require('debug')('supr:ffmpeg')
const fs = require('fs')
const ffmpeg = require('fluent-ffmpeg')
const logger = require('pino')({ name: 'encode-progress' })
const os = require('os')
const path = require('path')

function parseEncodeSettings(encodeFile) {
  return new Promise((resolve, reject) => {
    fs.readFile(encodeFile, (err, data) => {
      const encodeSettings = JSON.parse(data)
      debug(encodeSettings)
      resolve(encodeSettings)
    })
  })
}

function translateSettings(settings) {
  return new Promise((resolve) => {
    resolve({
      fps: 30, // hard-coded til the encode.json is correct from suprnova-app
      width: 0,
      height: 0,
      bitrate: settings.video.bitrate || 0,
      quality: settings.video.quality || '',
      codec: settings.video.codec || 'AVC'
    })
  })
}

function createFFmpegOpts(translated) {
  return new Promise((resolve, reject) => {
    if (!translated.fps || !translated.bitrate) {
      reject('Missing values in FFmpeg command translation')
    }
    resolve({
      opts: {
        input:  [`-framerate ${translated.fps || 30}`],
        output:  [`-b:v ${translated.bitrate}k`, `-r ${translated.fps || 30}`]
      }
    })
  })
}

function encode(segment, settings) {
  return new Promise((resolve, reject) => {
    const ff = ffmpeg(segment).inputOptions(settings.opts.input)
    // The `.concat` at the end is required for the cmd to work... PERO POR QUE?!?!
    ff.output(`${os.tmpdir()}/${path.basename(segment)}`).outputOptions(settings.opts.output)
    ff.on('start', cmd => debug(cmd))
    ff.on('progress', prog => logger.info(prog))
    ff.on('error', err => reject(err))
    ff.on('end', () => resolve(`${os.tmpdir()}/${path.basename(segment)}`))
    ff.run()
  })
}

async function main(encodeJson, segment) {
  try {
    const translatedSettings = await translateSettings(await parseEncodeSettings(encodeJson))
    debug(translatedSettings)
    const ffCmd = await createFFmpegOpts(translatedSettings)
    const finishedEncode = await encode(segment, ffCmd)
    debug('finished encode', finishedEncode)
    return finishedEncode
  } catch (err) {
    debug(err)
    throw err
  }
}

module.exports = main
