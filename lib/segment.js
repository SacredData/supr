/* eslint import/no-dynamic-require: "off", no-unused-vars: "off" */

const debug = require('debug')('supr:segment')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs-extra')
const logger = require('pino')({ name: 'segments' })
const os = require('os')
const path = require('path')
const process = require('process')

const util = require(path.resolve(__dirname, 'util'))
const write = require(path.resolve(__dirname, 'write'))

if (os.platform() === 'win32') {
  ffmpeg.setFfmpegPath(path.join(process.cwd(), 'ffmpeg/ffmpeg-4.1-win64-static/bin/ffmpeg.exe'))
}

function paddy(num, padlen, padchar) {
  /* Helper function to pad segment numbers to files */
  const padChar = typeof padchar !== 'undefined' ? padchar : '0'
  const pad = new Array(1 + padlen).join(padChar)
  return (pad + num).slice(-pad.length)
}

function getFPS(localFile) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(localFile, (err, md) => {
      if (err) { reject(err) }
      try {
        const [ num, den ] = md.streams.filter(s => s.codec_type === 'video')[0].r_frame_rate.split('/')
        debug('determined local file FPS:', [ num, den ])
        resolve(parseFloat((num / den).toFixed(3)))
      } catch (e) {
        reject(e)
      }
    })
  })
}

async function clearSegDir(cfs) {
  try {
    const segFiles = await cfs.readdir(`${cfs.HOME}/segments/inputs`)
    if (segFiles.length === 0) {
      debug('segment directory has no files in it; no need to clear it out')
      return
    }
    await Promise.all(segFiles.map(sf => cfs.rimraf(`${cfs.HOME}/segments/inputs/${sf}`)))
    await cfs.readdir(`${cfs.HOME}/segments/inputs`)
    debug('cleared segment directory of the cfs')
  } catch (err) { throw err }
}

async function segment(localFile, cfs, temp) {
  await clearSegDir(cfs)
  const fps = await getFPS(localFile)
  const folderPath = path.join(temp, 'segments')
  const folder = await fs.ensureDir(folderPath)
  const ffmpegStream = cfs.createWriteStream('log/ffmpeg_segment.log', { flags: 'a' })
  return new Promise((resolve, reject) => {
    ffmpeg(localFile)
      .inputFPS(fps)
      .inputOptions([
        '-probesize 500M',
        '-analyzeduration 1000M'
      ])
      .output(`${folderPath}/segment%05d.264`)
      .outputOptions([
        /* Make sure FFmpeg grabs the primary video track, if >1 exists */
        '-c:v:0', 'copy',
        /* Remove all non-video tracks from the output files */
        '-sn', '-an', '-dn',
        /* Map the selected video track to the output file */
        '-map', '0:v:0',
        /* Default segmentation time will be nearest keyframe every 30s */
        '-segment_time', '30',
        '-f', 'segment',
        /* Do NOT segment on a non-keyframe for any reason */
        '-break_non_keyframes', '0',
      ])
      .on('start', cmd => debug(cmd))
      .on('error', ffErr => reject(ffErr))
      .on('stderr', async (stderr) => {
        debug(`${stderr}`)
        ffmpegStream.write(stderr)
        ffmpegStream.write('\n')
        /*
        if (stderr.includes('[segment @ ')) {
          logger.info({ segmentCount: count += 1 })
        } */
      })
      .on('end', () => {
        try {
          ffmpegStream.end()
          debug('ended FFmpeg log stream to CFS')
          const dirFiles = fs.readdirSync(folderPath)
          debug('wrote the following files: ', dirFiles)
          /* resolve({ segments: dirFiles.map(df => `segments/inputs/${df}`) })
          If we need to go back to writing the whole dir, here it is: */
          Promise.all(dirFiles.map(df => write(`${folderPath}/${df}`, cfs, 'segments/inputs')))
            .then(dirWrite => process.nextTick(() => resolve([ dirWrite, folderPath ])))
            .catch(dirWriteErr => reject(dirWriteErr))
        } catch (e) {
          reject(e)
        }
      })
      .run()
  })
}

module.exports = segment
