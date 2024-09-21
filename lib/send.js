const Peer = require('./peer')

async function main(dk, cfs) {
  try {
    const p = new Peer(dk, cfs)
    return await p.joinPool(dk, 'send')
  } catch (err) {
    throw err
  }
}

module.exports = main
