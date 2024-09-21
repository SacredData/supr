const debug = require('debug')('supr:write')
const fs = require('fs')
const path = require('path')

function file(filepath, cfs, prefix = '') {
  try {
    const cfsPath = `${cfs.HOME}/${prefix}/${path.basename(filepath)}`
    debug('cfsPath', cfsPath)
    const stream = fs.createReadStream(path.resolve(filepath), {
      autoclose: true
    })
    const writer = cfs.createWriteStream(cfsPath)
    return new Promise((resolve, reject) => {
      writer.on('finish', () => process.nextTick(() => resolve(cfsPath)))
      writer.on('error', wErr => reject(wErr))

      stream.on('error', sErr => reject(sErr))

      stream.pipe(writer)
    })
  } catch (err) {
    throw err
  }
}

function dir(dirPath, cfs, prefix = '') {
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, async (err, dirFiles) => {
      const fff = dirFiles.map(d => path.resolve(`${dirPath}/${d}`))
      debug('dir files', fff)
      if (err) { reject(err) }
      try {
        fff.forEach(async (f) => {
          await file(
            path.resolve(`${dirPath}/${path.basename(f)}`),
            cfs,
            prefix
          )
        })
        process.nextTick(() => resolve(fff))
      } catch (e) {
        throw e
      }
    })
  })
}

async function main(filepath, cfs, prefix = '') {
  try {
    const stats = fs.statSync(filepath)
    if (stats.isDirectory()) {
      const dirWrite = await dir(filepath, cfs, prefix)
      return dirWrite
    }
    const fileWrite = await file(filepath, cfs, prefix)
    return fileWrite
  } catch (e) {
    throw e
  }
}

module.exports = main
