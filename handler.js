'use strict'

const request = require('superagent')
const async = require('async')
const config = require(`./config/production.json`)

const baseApiPath = 'https://api.twitter.com'
const targetPlaceID = 23424901      // http://woeid.rosselliot.co.nz/lookup/malaysia

module.exports.hello = (event, context, callback) => {
  let token = null

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
          trends.sort((a, b) => {   // sort by highest tweet volume
            if (a.tweet_volume < b.tweet_volume) {
              return 1
            } else {
              return -1
            }
          })

          console.log('Got trending topics', JSON.stringify(trends))
          return callback(null, trends)
        })
    }
  ], (err) => {
    if (err) return callback(err)
    return callback(null, { message: 'Done' })
  })
}
