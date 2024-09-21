const { createCFS } = require('cfsnet/create')
const debug = require('debug')('supr:create')

/*
 *  Suprnova CFS layout
 * ----------------------
 *
 * VAR/log            - Suprnova log files (created by cfsnet already)
 * HOME/segments      - Output dir for encoded segments
 * HOME/sources       - Input dir for source segments
 * HOME/suprprofile   - A file containing Suprnova profile name ('work' or 'source')
 *
 */

async function prepareDirs(cfs) {
  try {
    return await Promise.all([
      `${cfs.HOME}/participants`,
      `${cfs.HOME}/outputs/concats`,
      `${cfs.HOME}/outputs/muxes`,
      `${cfs.HOME}/segments/outputs`,
      `${cfs.HOME}/segments/inputs`,
      `${cfs.HOME}/tracks/outputs`,
      `${cfs.HOME}/tracks/inputs`,
      `${cfs.HOME}/metadata`,
      `${cfs.HOME}/sources`
    ].map(dir => cfs.mkdirp(dir)))
  } catch (e) {
    throw Error(e)
  }
}

function writeProfile(prof, cfs) {
  const wstream = cfs.createWriteStream('suprprofile', { flags: 'w' })
  return new Promise((resolve, reject) => {
    wstream.on('finish', () => process.nextTick(() => resolve()))
    wstream.on('error', err => reject(err))

    wstream.write(`${prof}`)

    wstream.end()
  })
}

async function main(id, key = null, prof = 'pool') {
  try {
    const cfs = await createCFS({ id, key })
    debug('cfs', id, key)
    await Promise.all([ prepareDirs(cfs), writeProfile(prof, cfs) ])
    debug('created preparation dirs for the CFS')
    return cfs
  } catch (err) {
    throw err
  }
}

module.exports = main
