'use strict'

const request = require('superagent')
const sentiment = require('sentiment')
const async = require('async')
const config = require(`./config/production.json`)

const baseApiPath = 'https://api.twitter.com'
const urlRegex = /http(s)?:\/\/[^\s]+/g
let token = null

module.exports.hello = (event, context, callback) => {
  const defaultPlaceId = 23424901        // http://woeid.rosselliot.co.nz/lookup/malaysia
  const defaultPeriod = 60              // 60 seconds
  const targetPlaceID = event.placeId || defaultPlaceId
  const periodSeconds = event.periodSeconds || defaultPeriod
  const currentTime = (new Date()).getTime()

  async.waterfall([
    (callback) => {
      // request bearer token
      const encodedSecret = new Buffer(`${config.twitter.key}:${config.twitter.secret}`).toString('base64')
      request
        .post(`${baseApiPath}/oauth2/token?grant_type=client_credentials`)
        .set('Authorization', `Basic ${encodedSecret}`)
        .set('Content-Type', 'application/json')
        .end((err, res) => {
          if (err) return callback(err)

          console.log('Got api bearer token')
          token = res.body.access_token
          return callback()
        })
    },
    (callback) => {
      // get trending topics in Malaysia
      request
        .get(`${baseApiPath}/1.1/trends/place.json?id=${targetPlaceID}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .end((err, res) => {
          if (err) return callback(err)

          let trends = res.body[0].trends
           // sort by highest tweet volume
          trends.sort((a, b) => b.tweet_volume - a.tweet_volume)
          return callback(null, trends)
        })
    },
    (trends, callback) => {
      console.time('Search & analyze tweets')
      async.mapLimit(trends, 10, (trend, callback) => {
        // for each trending topic, search and analyze the tweets
        searchTweets(trend.query, (err, tweets) => {
          if (err) return callback(err)

          const arr = tweets
            .filter((t) => {
              // only return the tweets happened between current and the previous lambda call
              const tweetTime = (new Date(t.created_at)).getTime()
              return currentTime - tweetTime < (periodSeconds * 1000)
            })
            .map((t) => {
              // the things we want
              const goodText = sanitizeText(t.text)
              const s = sentiment(goodText)
              const item = {
                topic: trend.name,
                text: goodText,
                sentiment: {
                  score: s.score,
                  comparative: s.comparative
                }
              }

              console.log('Analyzed text: ', JSON.stringify(item))
              return item
            })

          return callback(null, arr)
        })
      }, (err, result) => {
        if (err) return callback(err)

        console.timeEnd('Search & analyze tweets')
        // TODO: remove rubbish characters from text before analyzing sentiment
        // TODO: upload the result to S3
        return callback()
      })
    }
  ], (err) => {
    if (err) return callback(err)
    return callback(null, { message: 'Done' })
  })
}

function searchTweets (query, callback) {
  const uri = `${baseApiPath}/1.1/search/tweets.json?q=${query}&result_type=mixed&include_entities=false`
  request
    .get(uri)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .end((err, res) => {
      if (err) {
        console.error('Error searching tweets', uri)
        return callback(err)
      }
      callback(null, res.body.statuses)
    })
}

function sanitizeText (text) {
  // remove url
  let goodText = text.replace(urlRegex, '')

  // remove line breaks
  goodText = goodText.replace('\n', '')

  return goodText
}
