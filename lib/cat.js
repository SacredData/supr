const debug = require('debug')('supr:cat')
const process = require('process')
const pump = require('pump')

function tail(cfs) {
  // Work in Progress
  return new Promise((resolve, reject) => {
    pump(
      cfs.createReadStream('/var/log/events', { live: true }),
      process.stdout,
      (err) => {
        if (err) { reject(err) }
        resolve()
      }
    )
  })
}

async function main(path, cfs) {
  debug(`CFS id: ${cfs.identifier.toString('utf8')}`)
  if (path === '/var/log/events') {
    return tail(cfs)
  }
  return pump(cfs.createReadStream(path), process.stdout)
}

module.exports = main
