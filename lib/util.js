const { release, platform } = require('os')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const rpn = require('request-promise-native')
const debug = require('debug')('supr:util')
const unzipper = require('unzipper')

function epoch() {
  return Math.floor(new Date() / 1000)
}

async function getFfmpeg(localPath) {
  const file = fs.createWriteStream(`${path.resolve(localPath)}/ffmpeg.zip`)
  file.on('open', () => debug('Writing the file'))
  file.on('close', () => {
    debug('Closed the file')
    fs.createReadStream(`${path.resolve(localPath)}/ffmpeg.zip`)
      .pipe(unzipper.Extract({ path: path.resolve(localPath) }).on('close', () => debug('Unzip done')))
  })
  rpn
    .get('https://ffmpeg.zeranoe.com/builds/win64/static/ffmpeg-4.1-win64-static.zip')
    .on('response', (response) => {
      debug(response.statusCode)
      debug(response.headers['content-type'])
    })
    .pipe(file)
}

async function getWorkerKeyPair(peer) {
  try {
    const workerId = crypto.createHash('sha256')
      .update(`${peer.host}:${peer.port}`)
      .digest().toString('hex')
    const workerSecret = crypto.randomBytes(16).toString('hex')
    const writer = fs.createWriteStream('.worker')
    return new Promise((resolve, reject) => {
      writer.on('finish', () => process.nextTick(() => resolve({
        id: workerId, secret: workerSecret
      })))
      writer.on('error', wErr => reject(wErr))

      writer.write(`${workerId}|${workerSecret}`)
      writer.end()
    })
  } catch (err) {
    throw err
  }
}

async function getTracks(cfs) {
  const tracks = await cfs.readdir(`${cfs.HOME}/tracks/inputs/`)
  return new Promise((resolve, reject) => {
    try {
      const validTracks = tracks.filter(t => !t.includes('video') && !t.includes('data'))
      resolve(validTracks)
    } catch (e) { reject(e) }
  })
}

function getOs() {
  return [ platform() || '', release() || '' ]
}

module.exports = {
  epoch, getOs, getTracks, getWorkerKeyPair, getFfmpeg
}
