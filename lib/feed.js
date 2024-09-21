const { Feed } = require('feed')

async function main(pool) {
  try {
    const feed = new Feed({
      title: pool.metadata.title || 'Suprnova Pool Feed',
      description: 'This is my personal feed!',
      id: pool.metadata.id || 'http://example.com/',
      link: pool.metadata.link || 'http://example.com/',
      image: 'http://example.com/image.png',
      favicon: 'http://example.com/favicon.ico',
      copyright: 'All rights reserved 2013, John Doe',
      updated: new Date(),
      generator: 'awesome',
      feedLinks: {
        json: 'https://example.com/json',
        atom: 'https://example.com/atom'
      },
      author: {
        name: pool.user
      }
    })

    return feed.rss2()
  } catch (e) {
    throw e
  }
}

module.exports = main
